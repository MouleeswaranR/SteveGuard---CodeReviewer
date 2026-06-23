import prisma from './db';
import redis from './redis';
import { logger } from './logger';
import { reviewMetrics } from './metrics';

/**
 * Pricing for different LLM models
 * Update these based on your provider's pricing
 */
const MODEL_PRICING = {
  'gemini-pro': {
    inputCostPer1kTokens: 0.0005, // $0.0005 per 1K input tokens
    outputCostPer1kTokens: 0.0015, // $0.0015 per 1K output tokens
  },
  'gemini-pro-vision': {
    inputCostPer1kTokens: 0.001,
    outputCostPer1kTokens: 0.002,
  },
  // Add more models as needed
};

export interface LLMUsage {
  model: string;
  userId: string;
  reviewId: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  timestamp: Date;
}

/**
 * Track LLM usage and cost
 * Call this after every LLM API call
 */
export async function trackLLMUsage(
  model: string,
  userId: string,
  reviewId: string,
  inputTokens: number,
  outputTokens: number
): Promise<LLMUsage> {
  const usage: LLMUsage = {
    model,
    userId,
    reviewId,
    inputTokens,
    outputTokens,
    estimatedCostUsd: calculateCost(model, inputTokens, outputTokens),
    timestamp: new Date(),
  };

  try {
    // Store in database for long-term analytics
    await prisma.lLMUsage.create({
      data: usage,
    });

    // Update Redis for fast queries
    const monthKey = getMonthKey();
    await redis.incrbyfloat(
      `cost:user:${userId}:${monthKey}`,
      usage.estimatedCostUsd
    );
    await redis.incrbyfloat(
      `tokens:user:${userId}:${monthKey}`,
      inputTokens + outputTokens
    );

    // Record metrics
    reviewMetrics.recordTokensUsed(inputTokens, outputTokens, model);

    logger.info(
      {
        model,
        userId,
        reviewId,
        inputTokens,
        outputTokens,
        estimatedCostUsd: usage.estimatedCostUsd,
      },
      'LLM usage tracked'
    );

    return usage;
  } catch (error) {
    logger.error({ error, model, userId }, 'Error tracking LLM usage');
    throw error;
  }
}

/**
 * Calculate estimated cost for LLM tokens
 */
export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const pricing = MODEL_PRICING[model as keyof typeof MODEL_PRICING];
  if (!pricing) {
    logger.warn({ model }, 'Unknown model for cost calculation');
    return 0;
  }

  const inputCost = (inputTokens / 1000) * pricing.inputCostPer1kTokens;
  const outputCost = (outputTokens / 1000) * pricing.outputCostPer1kTokens;

  return inputCost + outputCost;
}

/**
 * Get user's monthly cost
 */
export async function getUserMonthlyCost(userId: string): Promise<number> {
  try {
    const monthKey = getMonthKey();
    const cost = await redis.get(`cost:user:${userId}:${monthKey}`);
    return cost ? parseFloat(cost) : 0;
  } catch (error) {
    logger.error({ error, userId }, 'Error getting user monthly cost');
    return 0;
  }
}

/**
 * Get user's monthly token usage
 */
export async function getUserMonthlyTokens(userId: string): Promise<number> {
  try {
    const monthKey = getMonthKey();
    const tokens = await redis.get(`tokens:user:${userId}:${monthKey}`);
    return tokens ? parseInt(tokens) : 0;
  } catch (error) {
    logger.error({ error, userId }, 'Error getting user monthly tokens');
    return 0;
  }
}

/**
 * Get cost per review for user
 * Returns: { avgCostPerReview, totalCost, totalReviews }
 */
export async function getCostMetrics(
  userId: string,
  days: number = 30
): Promise<{
  avgCostPerReview: number;
  totalCost: number;
  totalReviews: number;
}> {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const usages = await prisma.lLMUsage.aggregate({
      where: {
        userId,
        timestamp: { gte: cutoffDate },
      },
      _sum: {
        estimatedCostUsd: true,
      },
      _count: {
        reviewId: true,
      },
    });

    const totalCost = usages._sum.estimatedCostUsd || 0;
    const totalReviews = usages._count.reviewId || 0;
    const avgCostPerReview = totalReviews > 0 ? totalCost / totalReviews : 0;

    return {
      avgCostPerReview,
      totalCost,
      totalReviews,
    };
  } catch (error) {
    logger.error({ error, userId }, 'Error getting cost metrics');
    return { avgCostPerReview: 0, totalCost: 0, totalReviews: 0 };
  }
}

/**
 * Check if user has exceeded their monthly budget
 * Based on subscription tier
 */
export async function checkBudgetLimit(
  userId: string,
  tier: string
): Promise<{ exceeded: boolean; currentCost: number; limit: number }> {
  const limits: Record<string, number> = {
    FREE: 5, // Free tier: $5/month
    PRO: 100, // Pro tier: $100/month
    ENTERPRISE: Infinity, // Enterprise: unlimited
  };

  const limit = limits[tier] || limits.FREE;
  const currentCost = await getUserMonthlyCost(userId);

  return {
    exceeded: currentCost >= limit,
    currentCost,
    limit,
  };
}

/**
 * Get formatted cost display
 */
export function formatCost(cost: number): string {
  return `$${cost.toFixed(4)}`;
}

/**
 * Get month key for Redis (YYYY-MM)
 */
export function getMonthKey(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Reset daily costs (call this via a scheduled job at midnight UTC)
 */
export async function resetDailyCosts(): Promise<void> {
  try {
    const pattern = 'cost:user:*:' + getMonthKey();
    const keys = await redis.keys(pattern);

    if (keys.length > 0) {
      await redis.del(...keys);
      logger.info({ count: keys.length }, 'Daily costs reset');
    }
  } catch (error) {
    logger.error({ error }, 'Error resetting daily costs');
  }
}

/**
 * Generate cost report for a date range
 */
export async function generateCostReport(
  startDate: Date,
  endDate: Date
): Promise<Array<{
  userId: string;
  totalCost: number;
  reviewCount: number;
  avgCostPerReview: number;
}>> {
  try {
    const usages = await prisma.lLMUsage.groupBy({
      by: ['userId'],
      where: {
        timestamp: {
          gte: startDate,
          lte: endDate,
        },
      },
      _sum: {
        estimatedCostUsd: true,
      },
      _count: {
        reviewId: true,
      },
    });

    return usages.map((usage) => ({
      userId: usage.userId,
      totalCost: usage._sum.estimatedCostUsd || 0,
      reviewCount: usage._count.reviewId || 0,
      avgCostPerReview: (usage._sum.estimatedCostUsd || 0) / (usage._count.reviewId || 1),
    }));
  } catch (error) {
    logger.error({ error }, 'Error generating cost report');
    return [];
  }
}

logger.info('Cost tracker initialized');
