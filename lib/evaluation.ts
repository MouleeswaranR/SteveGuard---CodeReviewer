import prisma from './db';
import { generateText } from 'ai';
import { google } from '@ai-sdk/google';
import { logger } from './logger';

/**
 * Track review feedback from developers
 * Signals: thumbs up/down reactions, accepted suggestions, etc.
 */
export interface ReviewFeedback {
  reviewId: string;
  prNumber: number;
  repo: string;
  commentId: string;
  userId: string;
  reaction?: '+1' | '-1' | null; // GitHub reaction
  wasActioned?: boolean; // Did dev fix what we flagged?
  timestamp: Date;
}

/**
 * Record that a review was reacted to (thumbs up/down)
 */
export async function recordReviewReaction(
  reviewId: string,
  prNumber: number,
  repo: string,
  commentId: string,
  userId: string,
  reaction: '+1' | '-1'
): Promise<void> {
  try {
    await prisma.reviewFeedback.create({
      data: {
        reviewId,
        prNumber,
        repo,
        commentId,
        userId,
        reaction,
        timestamp: new Date(),
      },
    });

    logger.info(
      { reviewId, reaction, repo, prNumber },
      'Review reaction recorded'
    );
  } catch (error) {
    logger.error({ error, reviewId }, 'Error recording review reaction');
  }
}

/**
 * Record that a review suggestion was actioned (developer fixed it)
 */
export async function recordReviewActioned(
  reviewId: string,
  wasActioned: boolean
): Promise<void> {
  try {
    await prisma.reviewFeedback.updateMany({
      where: { reviewId },
      data: { wasActioned },
    });

    logger.info(
      { reviewId, wasActioned },
      'Review action recorded'
    );
  } catch (error) {
    logger.error({ error, reviewId }, 'Error recording review action');
  }
}

/**
 * LLM-as-Judge evaluator
 * Scores a review by having a second LLM evaluate it
 */
export async function evaluateReviewWithLLM(
  codeDiff: string,
  generatedReview: string,
  context?: string
): Promise<{
  accuracy: number;
  actionability: number;
  relevance: number;
  falsePositives: string[];
  strengths: string[];
  weaknesses: string[];
  overallScore: number;
}> {
  try {
    const prompt = `
You are an expert code reviewer evaluating another AI code review.

CODE DIFF:
\`\`\`
${codeDiff.slice(0, 2000)} ${codeDiff.length > 2000 ? '...[truncated]' : ''}
\`\`\`

CONTEXT (relevant code patterns):
${context ? context.slice(0, 1000) : 'None provided'}

GENERATED REVIEW:
\`\`\`
${generatedReview}
\`\`\`

Please evaluate this review on these dimensions:

1. **Accuracy (0-10)**: Are the identified issues actually real bugs or bad practices?
   - 10: All points are accurate and substantive
   - 5: Mix of accurate and some questionable points
   - 0: Mostly false positives or hallucinated issues

2. **Actionability (0-10)**: Can a developer act on these suggestions?
   - 10: Concrete, specific fixes provided
   - 5: General guidance but could be more specific
   - 0: Vague or unhelpful suggestions

3. **Relevance (0-10)**: Are the comments relevant to THIS specific diff?
   - 10: All comments are highly specific to the code
   - 5: Some comments are generic/boilerplate
   - 0: Comments are not related to the diff

4. **False Positives**: List specific false positive issues, if any

5. **Strengths**: What did this review do well?

6. **Weaknesses**: What could be improved?

Respond in ONLY valid JSON format with no markdown, no code blocks:
{
  "accuracy": <0-10>,
  "actionability": <0-10>,
  "relevance": <0-10>,
  "falsePositives": ["item1", "item2"],
  "strengths": ["strength1", "strength2"],
  "weaknesses": ["weakness1", "weakness2"],
  "overallScore": <0-10 average>
}
`;

    const result = await generateText({
      model: google('gemini-pro'),
      prompt,
      temperature: 0.5,
    });

    const evaluation = JSON.parse(result.text);

    return {
      accuracy: evaluation.accuracy,
      actionability: evaluation.actionability,
      relevance: evaluation.relevance,
      falsePositives: evaluation.falsePositives,
      strengths: evaluation.strengths,
      weaknesses: evaluation.weaknesses,
      overallScore:
        (evaluation.accuracy +
          evaluation.actionability +
          evaluation.relevance) /
        3,
    };
  } catch (error) {
    logger.error(
      { error },
      'Error evaluating review with LLM'
    );
    throw error;
  }
}

/**
 * Store LLM evaluation scores
 */
export async function storeEvaluationScore(
  reviewId: string,
  evaluation: ReturnType<typeof evaluateReviewWithLLM>
): Promise<void> {
  try {
    await prisma.reviewScore.create({
      data: {
        reviewId,
        accuracy: evaluation.accuracy,
        actionability: evaluation.actionability,
        relevance: evaluation.relevance,
        overallScore: evaluation.overallScore,
        metadata: {
          falsePositives: evaluation.falsePositives,
          strengths: evaluation.strengths,
          weaknesses: evaluation.weaknesses,
        },
      },
    });

    logger.info({ reviewId, score: evaluation.overallScore }, 'Evaluation score stored');
  } catch (error) {
    logger.error({ error, reviewId }, 'Error storing evaluation score');
  }
}

/**
 * Calculate review quality metrics
 * Returns stats about review performance
 */
export async function getReviewQualityMetrics(
  days: number = 30
): Promise<{
  avgAccuracy: number;
  avgActionability: number;
  avgRelevance: number;
  avgOverallScore: number;
  thumbsUpRate: number;
  actionedRate: number;
  falsePositiveRate: number;
  totalReviews: number;
  totalEvaluations: number;
}> {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    // Get evaluation scores
    const scores = await prisma.reviewScore.findMany({
      where: {
        createdAt: { gte: cutoffDate },
      },
    });

    // Get feedback data
    const feedback = await prisma.reviewFeedback.findMany({
      where: {
        timestamp: { gte: cutoffDate },
      },
    });

    // Get review count
    const reviews = await prisma.review.count({
      where: {
        createdAt: { gte: cutoffDate },
      },
    });

    const avgAccuracy =
      scores.length > 0
        ? scores.reduce((sum, s) => sum + (s.accuracy || 0), 0) / scores.length
        : 0;

    const avgActionability =
      scores.length > 0
        ? scores.reduce((sum, s) => sum + (s.actionability || 0), 0) /
          scores.length
        : 0;

    const avgRelevance =
      scores.length > 0
        ? scores.reduce((sum, s) => sum + (s.relevance || 0), 0) / scores.length
        : 0;

    const avgOverallScore =
      scores.length > 0
        ? scores.reduce((sum, s) => sum + (s.overallScore || 0), 0) /
          scores.length
        : 0;

    const thumbsUpFeedback = feedback.filter((f) => f.reaction === '+1').length;
    const totalFeedback = feedback.filter((f) => f.reaction !== null).length;
    const thumbsUpRate =
      totalFeedback > 0 ? thumbsUpFeedback / totalFeedback : 0;

    const actionedFeedback = feedback.filter((f) => f.wasActioned).length;
    const actionedCount = feedback.filter((f) => f.wasActioned !== null).length;
    const actionedRate = actionedCount > 0 ? actionedFeedback / actionedCount : 0;

    const falsePositiveCount = feedback.filter((f) =>
      f.reaction === '-1'
    ).length;
    const falsePositiveRate =
      totalFeedback > 0 ? falsePositiveCount / totalFeedback : 0;

    return {
      avgAccuracy,
      avgActionability,
      avgRelevance,
      avgOverallScore,
      thumbsUpRate,
      actionedRate,
      falsePositiveRate,
      totalReviews: reviews,
      totalEvaluations: scores.length,
    };
  } catch (error) {
    logger.error({ error }, 'Error calculating quality metrics');
    return {
      avgAccuracy: 0,
      avgActionability: 0,
      avgRelevance: 0,
      avgOverallScore: 0,
      thumbsUpRate: 0,
      actionedRate: 0,
      falsePositiveRate: 0,
      totalReviews: 0,
      totalEvaluations: 0,
    };
  }
}

/**
 * Identify worst performing review areas
 */
export async function getWorstPerformingRepos(
  days: number = 30
): Promise<Array<{ repo: string; avgScore: number; reviewCount: number }>> {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const repos = await prisma.review.groupBy({
      by: ['repositoryId'],
      where: {
        createdAt: { gte: cutoffDate },
      },
      _avg: {
        overallScore: true,
      },
      _count: true,
    });

    return repos
      .map((repo) => ({
        repo: repo.repositoryId,
        avgScore: repo._avg.overallScore || 0,
        reviewCount: repo._count,
      }))
      .sort((a, b) => a.avgScore - b.avgScore)
      .slice(0, 10);
  } catch (error) {
    logger.error({ error }, 'Error getting worst performing repos');
    return [];
  }
}

logger.info('Evaluation framework initialized');
