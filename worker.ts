/**
 * SteveGuard Review Consumer Worker
 * 
 * This is a separate service that processes review requests from Kafka.
 * Run this in a separate container/process from the main app.
 * 
 * Usage:
 *   tsx worker.ts                    # For development
 *   node dist/worker.js              # For production
 *   
 * Environment:
 *   Set all .env variables as in .env.example
 * 
 * Docker:
 *   docker run -e NODE_ENV=production \
 *     -e DATABASE_URL=$DATABASE_URL \
 *     -e KAFKA_BROKERS=$KAFKA_BROKERS \
 *     steveguard:latest \
 *     tsx worker.ts
 */

import 'dotenv/config';
import { initializeTracing, shutdownTracing } from '@/lib/tracing';
import { startReviewConsumer } from '@/lib/review-consumer';
import { logger } from '@/lib/logger';
import { disconnectKafka } from '@/lib/kafka';
import http from 'http';
import { metricsRegistry } from '@/lib/metrics';

// Start metrics server for Prometheus
const metricsServer = http.createServer(async (req, res) => {
  if (req.url === '/api/metrics') {
    res.setHeader('Content-Type', metricsRegistry.contentType);
    res.end(await metricsRegistry.metrics());
  } else {
    res.statusCode = 404;
    res.end();
  }
});

metricsServer.listen(3002, () => {
  logger.info('Metrics server listening on port 3002');
});

// Initialize OpenTelemetry tracing first
if (process.env.ENABLE_TRACING !== 'false') {
  try {
    initializeTracing();
    logger.info('Tracing initialized');
  } catch (error) {
    logger.warn({ error }, 'Failed to initialize tracing, continuing without it');
  }
}

async function main() {
  logger.info('🚀 Starting SteveGuard Review Consumer Worker...');
  
  try {
    // Validate required environment variables
    const requiredVars = [
      'DATABASE_URL',
      'KAFKA_BROKERS',
      'REDIS_HOST',
      'GOOGLE_GENERATIVE_AI_API_KEY',
      'PINECONE_DB_API_KEY',
    ];

    const missingVars = requiredVars.filter(
      (v) => !process.env[v]
    );

    if (missingVars.length > 0) {
      logger.error(
        { missingVars },
        `Missing required environment variables: ${missingVars.join(', ')}`
      );
      process.exit(1);
    }

    logger.info({
      nodeEnv: process.env.NODE_ENV,
      kafkaBrokers: process.env.KAFKA_BROKERS,
      redisHost: process.env.REDIS_HOST,
    }, 'Configuration loaded');

    // Start the review consumer
    await startReviewConsumer();
    
    logger.info('✅ Review consumer started successfully');
    logger.info('📊 Listening for review requests from Kafka...');

    // Graceful shutdown handlers
    process.on('SIGTERM', handleShutdown);
    process.on('SIGINT', handleShutdown);

  } catch (error) {
    logger.error({ error }, '❌ Fatal error starting consumer');
    process.exit(1);
  }
}

/**
 * Handle graceful shutdown
 */
async function handleShutdown() {
  logger.info('🛑 Received shutdown signal, starting graceful shutdown...');
  
  try {
    // Give in-flight requests time to complete
    logger.info('Waiting for in-flight requests to complete...');
    await new Promise((resolve) => setTimeout(resolve, 5000));
    
    // Disconnect Kafka
    logger.info('Disconnecting Kafka...');
    await disconnectKafka();
    
    // Shutdown tracing
    logger.info('Shutting down tracing...');
    await shutdownTracing();
    
    logger.info('✅ Graceful shutdown complete');
    process.exit(0);
  } catch (error) {
    logger.error({ error }, '❌ Error during graceful shutdown');
    process.exit(1);
  }
}

/**
 * Handle uncaught exceptions
 */
process.on('uncaughtException', (error) => {
  logger.error({ error }, '❌ Uncaught exception');
  process.exit(1);
});

/**
 * Handle unhandled promise rejections
 */
process.on('unhandledRejection', (reason, promise) => {
  logger.error({ reason, promise }, '❌ Unhandled rejection');
  process.exit(1);
});

// Start the worker
main();
