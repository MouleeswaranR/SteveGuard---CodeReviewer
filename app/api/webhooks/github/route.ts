import { NextResponse, NextRequest } from 'next/server';
import { publishReviewRequest } from '@/lib/kafka';
import { rateLimiter, repoAccessControl } from '@/lib/redis';
import { logger, generateTraceId, createTraceLogger } from '@/lib/logger';
import prisma from '@/lib/db';

/**
 * GitHub Webhook Handler (Layer 1 - Fast Path)
 * 
 * Designed for speed (< 100ms response time).
 * Validates webhook, checks quotas, publishes to Kafka.
 * Processing happens asynchronously in the Kafka consumer.
 */

export async function POST(req: NextRequest) {
  const traceId = generateTraceId();
  const log = createTraceLogger(traceId);

  const startTime = Date.now();

  try {
    const eventType = req.headers.get('x-github-event');
    const body = await req.json();

    // Ping event
    if (eventType === 'ping') {
      return NextResponse.json({ message: 'Pong' }, { status: 200 });
    }

    // Only process pull_request events
    if (eventType !== 'pull_request') {
      return NextResponse.json({ message: 'Event ignored' }, { status: 200 });
    }

    const action = body.action;
    const repo = body.repository;
    const prNumber = body.number;
    const sender = body.sender;

    const owner = repo.owner.login;
    const repoName = repo.name;
    const userId = sender.id.toString();

    // Only process specific PR actions
    const validActions = ['opened', 'synchronize', 'reopened', 'ready_for_review'];
    if (!validActions.includes(action)) {
      return NextResponse.json({ message: 'Action ignored' }, { status: 200 });
    }

    log.info({ action, owner, repoName, prNumber }, 'Processing PR event');

    // Find/create user
    let user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, subscriptionTier: true },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          id: userId,
          name: sender.login,
          email: sender.email || `${sender.login}@github.local`,
          subscriptionTier: 'FREE',
        },
      });
    }

    // Check rate limit
    const rateLimitCheck = await rateLimiter.checkLimit(userId, 100, 60);
    if (!rateLimitCheck.allowed) {
      log.warn({ userId }, 'Rate limit exceeded');
      return NextResponse.json(
        { error: 'Rate limit exceeded', resetTime: rateLimitCheck.resetTime },
        { status: 429 }
      );
    }

    // Check repo quota
    let repoCount = await repoAccessControl.getRepoCount(userId);
    if (repoCount === null) {
      const usage = await prisma.userUsage.findUnique({ where: { userId } });
      repoCount = usage ? usage.repositoryCount : 0;
      await repoAccessControl.setRepoCount(userId, repoCount);
    }

    const repoLimits: Record<string, number> = { FREE: 5, PRO: 50, ENTERPRISE: 500 };
    const limit = repoLimits[user.subscriptionTier] || 5;

    if (repoCount >= limit) {
      log.warn({ userId, tier: user.subscriptionTier, repoCount, limit }, 'Repo quota exceeded');
      return NextResponse.json(
        { error: 'Repository quota exceeded' },
        { status: 403 }
      );
    }

    // Publish to Kafka (fast, non-blocking)
    const reviewTraceId = await publishReviewRequest({
      owner,
      repo: repoName,
      prNumber,
      userId,
      prTitle: body.pull_request.title,
      prUrl: body.pull_request.html_url,
    });

    const duration = Date.now() - startTime;
    log.info({ duration, durationMs: duration }, `Webhook processed in ${duration}ms`);

    return NextResponse.json(
      { message: 'Review queued', traceId: reviewTraceId },
      { status: 200 }
    );
  } catch (error: any) {
    const duration = Date.now() - startTime;
    log.error({ error: error.message, stack: error.stack, duration }, 'Webhook error');
    return NextResponse.json({ error: 'Internal server error', details: error.message }, { status: 500 });
  }
}