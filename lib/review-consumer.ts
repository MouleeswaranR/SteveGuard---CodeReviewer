import { subscribeToReviewRequests, publishReviewCompleted, publishReviewFailed, ReviewRequestEvent, ReviewCompletedEvent } from '@/lib/kafka';
import { vectorCache } from '@/lib/redis';
import { logger, createTraceLogger, logPerformance } from '@/lib/logger';
import { reviewTracing, traceAsync, SpanStatusCode } from '@/lib/tracing';
import { getPullRequestDiff, postReviewComment } from '@/module/github/lib/github';
import { retrieveContext, generateEmbedding } from '@/module/ai/lib/rag';
import { generateText } from 'ai';
import { google } from '@ai-sdk/google';
import prisma from '@/lib/db';
import { createHash } from 'crypto';
import { trackLLMUsage } from '@/lib/cost-tracker';
import { withGracefulDegradation, retryWithBackoff } from '@/lib/resilience';
import { reviewMetrics, ragMetrics, kafkaMetrics, cacheMetrics } from '@/lib/metrics';
import { KafkaMessage } from 'kafkajs';
import { recordReviewActioned } from '@/lib/evaluation';

/**
 * Initialize the Kafka consumer for review requests
 * This runs as a separate service/worker
 * 
 * Can be deployed to:
 * - Cloud Run (Google)
 * - Lambda (AWS)
 * - Container (any Kubernetes cluster)
 * - Even same server (different process)
 */
export async function startReviewConsumer() {
  logger.info('Starting review consumer...');

  try {
    await subscribeToReviewRequests(handleReviewRequest);
    logger.info('Review consumer started successfully');
  } catch (error) {
    logger.error({ error }, 'Failed to start review consumer');
    throw error;
  }
}

/**
 * Handle a review request from Kafka
 * This is the main review processing logic
 */
async function handleReviewRequest(
  event: ReviewRequestEvent,
  message: KafkaMessage
): Promise<void> {
  const { traceId, owner, repo, prNumber, userId, prTitle, prUrl } = event;
  const log = createTraceLogger(traceId);

  const startTime = Date.now();
  let reviewId: string = '';
  const webhookSpan = reviewTracing.webhookHandler(traceId, prNumber, `${owner}/${repo}`);

  try {

    // Get GitHub access token
    const account = await traceAsync('fetch-github-token', async () => {
      return await prisma.account.findFirst({
        where: { userId, providerId: 'github' },
      });
    });

    if (!account?.accessToken) {
      throw new Error(`GitHub token not found for user ${userId}`);
    }

    const accessToken = account.accessToken;

    // Fetch PR data (with tracing)
    const { diff, title, description } = await traceAsync(
      'fetch-pr-data',
      async () => {
        return await getPullRequestDiff(
          accessToken,
          owner,
          repo,
          prNumber
        );
      }
    );

    log.info({ prNumber, diffSize: diff.length }, 'PR data fetched');

    // Retrieve context from RAG (with caching and tracing)
    const context = await traceAsync(
      'retrieve-context',
      async () => {
        const query = `${title}\n${description}`;
        const ragSpan = reviewTracing.ragRetrieval(query, `${owner}/${repo}`);

        // Check cache first
        const fileHash = createHash('sha256').update(query).digest('hex');
        let chunks = await vectorCache.getChunks(fileHash);

        if (chunks) {
          cacheMetrics.recordHit('vector');
          log.debug('RAG cache hit');
          ragSpan.end();
          return chunks;
        }

        cacheMetrics.recordMiss('vector');

        // Not in cache, fetch from Pinecone with retry
        const ragStartTime = Date.now();
        chunks = await retryWithBackoff(
          () => retrieveContext(query, `${owner}/${repo}`),
          3,
          100
        );

        const ragLatency = Date.now() - ragStartTime;
        ragMetrics.recordRetrieval(chunks.length, ragLatency);

        // Cache for future use
        await vectorCache.setChunks(fileHash, chunks);

        log.info(
          { chunks: chunks.length, latency: ragLatency },
          'Context retrieved from Pinecone'
        );

        ragSpan.setAttribute('chunks.count', chunks.length);
        ragSpan.setAttribute('latency_ms', ragLatency);
        ragSpan.end();

        return chunks;
      }
    );

    // Generate review with LLM (with fallback to basic diff review)
    const review = await withGracefulDegradation(
      async () => {
        return await generateAIReview(
          title,
          description,
          diff,
          context,
          traceId
        );
      },
      async () => {
        // Graceful degradation: if Gemini fails, return diff-only review
        log.warn('Gemini API failed, using degraded diff-only review');
        return `# Code Review (Diff Analysis Only)\n\nUnable to perform full analysis at this time.\n\n\`\`\`diff\n${diff.slice(0, 500)}\n\`\`\``;
      }
    );

    log.info({ reviewLength: review.length }, 'Review generated');

    // Create review record in database
    const reviewRecord = await prisma.review.create({
      data: {
        repositoryId: `${owner}/${repo}`,
        prNumber,
        prTitle: title,
        prUrl: prUrl,
        review,
        status: 'completed',
        userId,
        traceId,
      },
    });

    reviewId = reviewRecord.id;

    // Post comment to GitHub with retry
    await retryWithBackoff(
      async () => {
        const githubSpan = reviewTracing.githubApi(
          `/repos/${owner}/${repo}/issues/${prNumber}/comments`,
          'POST'
        );

        try {
          await postReviewComment(accessToken, owner, repo, prNumber, review);
          githubSpan.end();
          log.info('Review comment posted to GitHub');
        } catch (error) {
          githubSpan.recordException(error as any);
          throw error;
        }
      },
      3,
      500
    );

    // Record completion metrics
    const latency = Date.now() - startTime;
    reviewMetrics.recordReviewCompleted(latency, 'success');
    kafkaMetrics.recordMessageProcessed('pr.review.requested', 'success');

    // Publish completion event
    const completedEvent: ReviewCompletedEvent = {
      traceId,
      reviewId,
      owner,
      repo,
      prNumber,
      userId,
      review,
      tokensUsed: 0, // TODO: Extract from response
      latencyMs: latency,
      timestamp: Date.now(),
    };

    await publishReviewCompleted(completedEvent);

    logPerformance('review-generation', latency, traceId, {
      prNumber,
      owner,
      repo,
    });

    log.info(
      { reviewId, latency },
      `Review completed in ${latency}ms`
    );
    webhookSpan.end();
  } catch (error: any) {
    const latency = Date.now() - startTime;
    reviewMetrics.recordReviewCompleted(latency, 'failed');
    kafkaMetrics.recordMessageProcessed('pr.review.requested', 'failed');

    log.error(
      { error: error.message, stack: error.stack, latency },
      'Review processing failed'
    );
    webhookSpan.recordException(error as Error);
    webhookSpan.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    webhookSpan.end();

    // Publish failure event to DLQ
    await publishReviewFailed({
      traceId,
      owner,
      repo,
      prNumber,
      userId,
      error: error.message,
      reason: error.stack || error.message,
      timestamp: Date.now(),
    });

    throw error;
  }
}

/**
 * Generate AI review using Gemini
 */
async function generateAIReview(
  title: string,
  description: string,
  diff: string,
  context: string[],
  traceId: string
): Promise<string> {
  const log = createTraceLogger(traceId);
  const span = reviewTracing.geminiCall('gemini-pro');

  try {
    const prompt = `
You are a senior software engineer performing a professional GitHub pull request review.

PR Title: ${title}
PR Description: ${description}

Relevant Context from Codebase:
${context.join('\n\n')}

Code Diff:
\`\`\`diff
${diff}
\`\`\`

Write feedback like a real automated reviewer (similar to CodeRabbit).

Rules:
- Be concise and professional.
- Use bullet points.
- Avoid long essays.
- Do NOT restate the entire diff.
- Keep total output under 400 words.
- If no major issues, say so clearly.
- Focus on: correctness, performance, security, maintainability, best practices.
`;

    const startTime = Date.now();

    const result = await generateText({
      model: google('gemini-1.5-pro'),
      prompt,
      temperature: 0.7,
    });

    const latency = Date.now() - startTime;
    span.setAttribute('latency_ms', latency);
    span.setAttribute('tokens_used', result.usage?.totalTokens || 0);

    // Track tokens for cost
    const inputTokens = result.usage?.inputTokens || 0;
    const outputTokens = result.usage?.outputTokens || 0;

    if (inputTokens > 0 || outputTokens > 0) {
      // Fire and forget cost tracking
      trackLLMUsage('gemini-pro', '', '', inputTokens, outputTokens).catch(
        (err) => log.error({ error: err }, 'Error tracking LLM usage')
      );
    }

    span.end();

    return result.text;
  } catch (error) {
    span.recordException(error as any);
    span.end();
    throw error;
  }
}

logger.info('Review consumer module loaded');
