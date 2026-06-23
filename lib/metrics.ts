import {
  Counter,
  Histogram,
  Gauge,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';
import { logger } from './logger';

// Create a custom registry
export const metricsRegistry = new Registry();

// Collect default Node.js metrics
collectDefaultMetrics({ register: metricsRegistry });

/**
 * Review metrics
 */
export const reviewMetrics = {
  // Counter: total reviews by status
  totalReviews: new Counter({
    name: 'steveguard_reviews_total',
    help: 'Total number of reviews processed',
    labelNames: ['status'], // 'success', 'failed', 'timeout'
    registers: [metricsRegistry],
  }),

  // Histogram: review latency distribution
  reviewLatency: new Histogram({
    name: 'steveguard_review_latency_ms',
    help: 'Review processing latency in milliseconds',
    buckets: [50, 100, 200, 500, 1000, 2000, 5000, 10000],
    registers: [metricsRegistry],
  }),

  // Counter: LLM tokens used
  tokensUsed: new Counter({
    name: 'steveguard_llm_tokens_used',
    help: 'Total LLM tokens used',
    labelNames: ['model', 'type'], // type: 'input' or 'output'
    registers: [metricsRegistry],
  }),

  // Gauge: current cost (resets daily)
  costDaily: new Gauge({
    name: 'steveguard_cost_daily_usd',
    help: 'Daily cost in USD',
    labelNames: ['tier'],
    registers: [metricsRegistry],
  }),

  // Record review completion
  recordReviewCompleted: (latencyMs: number, status: 'success' | 'failed' | 'timeout' = 'success') => {
    reviewMetrics.totalReviews.inc({ status });
    reviewMetrics.reviewLatency.observe(latencyMs);
    logger.debug({ latencyMs, status }, 'Review metric recorded');
  },

  // Record tokens used
  recordTokensUsed: (inputTokens: number, outputTokens: number, model: string) => {
    reviewMetrics.tokensUsed.inc({ model, type: 'input' }, inputTokens);
    reviewMetrics.tokensUsed.inc({ model, type: 'output' }, outputTokens);
  },
};

/**
 * Cache metrics
 */
export const cacheMetrics = {
  // Counter: cache hits/misses
  cacheHits: new Counter({
    name: 'steveguard_cache_hits_total',
    help: 'Total cache hits',
    labelNames: ['cache_type'], // 'vector', 'session', 'repo_access'
    registers: [metricsRegistry],
  }),

  cacheMisses: new Counter({
    name: 'steveguard_cache_misses_total',
    help: 'Total cache misses',
    labelNames: ['cache_type'],
    registers: [metricsRegistry],
  }),

  // Gauge: cache hit ratio
  hitRatio: new Gauge({
    name: 'steveguard_cache_hit_ratio',
    help: 'Cache hit ratio',
    labelNames: ['cache_type'],
    registers: [metricsRegistry],
  }),

  recordHit: (cacheType: string) => {
    cacheMetrics.cacheHits.inc({ cache_type: cacheType });
    updateHitRatio(cacheType);
  },

  recordMiss: (cacheType: string) => {
    cacheMetrics.cacheMisses.inc({ cache_type: cacheType });
    updateHitRatio(cacheType);
  },
};

function updateHitRatio(cacheType: string) {
  // This would be called periodically to update the hit ratio gauge
  // In production, you'd aggregate these properly
}

/**
 * RAG retrieval metrics
 */
export const ragMetrics = {
  // Histogram: chunks retrieved
  chunksRetrieved: new Histogram({
    name: 'steveguard_rag_chunks_retrieved',
    help: 'Number of chunks retrieved from RAG',
    buckets: [1, 3, 5, 10, 20, 50],
    registers: [metricsRegistry],
  }),

  // Histogram: RAG latency
  ragLatency: new Histogram({
    name: 'steveguard_rag_latency_ms',
    help: 'RAG retrieval latency in milliseconds',
    buckets: [50, 100, 200, 500, 1000, 2000],
    registers: [metricsRegistry],
  }),

  // Gauge: retrieval precision (tracked from feedback)
  retrievalPrecision: new Gauge({
    name: 'steveguard_rag_precision',
    help: 'RAG retrieval precision score (0-1)',
    registers: [metricsRegistry],
  }),

  recordRetrieval: (chunksCount: number, latencyMs: number) => {
    ragMetrics.chunksRetrieved.observe(chunksCount);
    ragMetrics.ragLatency.observe(latencyMs);
  },
};

/**
 * API rate limiting metrics
 */
export const rateLimitMetrics = {
  // Counter: rate limit hits
  rateLimitExceeded: new Counter({
    name: 'steveguard_rate_limit_exceeded_total',
    help: 'Total rate limit exceeded events',
    labelNames: ['user_tier'],
    registers: [metricsRegistry],
  }),

  recordRateLimitExceeded: (userTier: string = 'free') => {
    rateLimitMetrics.rateLimitExceeded.inc({ user_tier: userTier });
  },
};

/**
 * Error metrics
 */
export const errorMetrics = {
  // Counter: errors by type
  errorCount: new Counter({
    name: 'steveguard_errors_total',
    help: 'Total errors',
    labelNames: ['error_type', 'severity'],
    registers: [metricsRegistry],
  }),

  recordError: (errorType: string, severity: 'low' | 'medium' | 'high' = 'medium') => {
    errorMetrics.errorCount.inc({ error_type: errorType, severity });
  },
};

/**
 * Kafka consumer lag metrics
 */
export const kafkaMetrics = {
  // Gauge: consumer lag
  consumerLag: new Gauge({
    name: 'steveguard_kafka_consumer_lag',
    help: 'Kafka consumer lag',
    labelNames: ['topic', 'partition'],
    registers: [metricsRegistry],
  }),

  // Counter: messages processed
  messagesProcessed: new Counter({
    name: 'steveguard_kafka_messages_processed_total',
    help: 'Total messages processed from Kafka',
    labelNames: ['topic', 'status'], // status: 'success' or 'failed'
    registers: [metricsRegistry],
  }),

  recordMessageProcessed: (topic: string, status: 'success' | 'failed' = 'success') => {
    kafkaMetrics.messagesProcessed.inc({ topic, status });
  },
};

/**
 * Endpoint to serve metrics in Prometheus format
 * Use this in a Next.js API route: GET /api/metrics
 */
export async function getMetricsEndpoint(): Promise<string> {
  return metricsRegistry.metrics();
}

logger.info('Prometheus metrics initialized');
