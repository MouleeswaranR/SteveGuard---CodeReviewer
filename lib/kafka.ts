import { Kafka, Producer, Consumer, KafkaMessage } from 'kafkajs';
import { logger } from './logger';
import { v4 as uuidv4 } from 'uuid';

const kafka = new Kafka({
  clientId: 'steveguard-' + (process.env.NODE_ENV || 'development'),
  brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
  retry: {
    initialRetryTime: 100,
    retries: 8,
  },
  logLevel: process.env.KAFKA_LOG_LEVEL as any || 'warn',
  ssl: process.env.KAFKA_SSL === 'true',
  sasl: process.env.KAFKA_SASL_USERNAME
    ? {
        mechanism: 'plain',
        username: process.env.KAFKA_SASL_USERNAME,
        password: process.env.KAFKA_SASL_PASSWORD!,
      }
    : undefined,
});

let producer: Producer | null = null;
let consumer: Consumer | null = null;

const TOPICS = {
  PR_REVIEW_REQUESTED: 'pr.review.requested',
  PR_REVIEW_COMPLETED: 'pr.review.completed',
  PR_REVIEW_FAILED: 'pr.review.failed',
};

export async function initializeProducer(): Promise<Producer> {
  if (producer) return producer;

  producer = kafka.producer({
    idempotent: true,
    maxInFlightRequests: 5,
    retry: {
      initialRetryTime: 100,
      retries: 8,
    },
  });

  await producer.connect();
  logger.info('Kafka Producer initialized');
  return producer;
}

export async function initializeConsumer(
  groupId: string = 'steveguard-' + (process.env.NODE_ENV || 'development')
): Promise<Consumer> {
  if (consumer) return consumer;

  consumer = kafka.consumer({
    groupId,
    sessionTimeout: 30000,
    rebalanceTimeout: 60000,
  });

  await consumer.connect();
  logger.info(`Kafka Consumer initialized with group: ${groupId}`);
  return consumer;
}

export interface ReviewRequestEvent {
  traceId: string;
  owner: string;
  repo: string;
  prNumber: number;
  userId: string;
  prTitle: string;
  prUrl: string;
  timestamp: number;
}

export interface ReviewCompletedEvent {
  traceId: string;
  reviewId: string;
  owner: string;
  repo: string;
  prNumber: number;
  userId: string;
  review: string;
  tokensUsed: number;
  latencyMs: number;
  timestamp: number;
}

export interface ReviewFailedEvent {
  traceId: string;
  owner: string;
  repo: string;
  prNumber: number;
  userId: string;
  error: string;
  reason: string;
  timestamp: number;
  retryAttempt?: number;
}

/**
 * Publish a PR review request event to Kafka
 * This decouples the webhook handler from the review processing
 */
export async function publishReviewRequest(
  event: Omit<ReviewRequestEvent, 'traceId' | 'timestamp'>
): Promise<string> {
  const p = await initializeProducer();
  const traceId = uuidv4();
  const fullEvent: ReviewRequestEvent = {
    ...event,
    traceId,
    timestamp: Date.now(),
  };

  await p.send({
    topic: TOPICS.PR_REVIEW_REQUESTED,
    messages: [
      {
        key: `${event.owner}/${event.repo}#${event.prNumber}`,
        value: JSON.stringify(fullEvent),
        headers: {
          'trace-id': traceId,
          'user-id': event.userId,
        },
      },
    ],
  });

  logger.info(
    { traceId, owner: event.owner, repo: event.repo, prNumber: event.prNumber },
    'Review request published to Kafka'
  );
  return traceId;
}

/**
 * Publish a review completion event
 */
export async function publishReviewCompleted(
  event: ReviewCompletedEvent
): Promise<void> {
  const p = await initializeProducer();

  await p.send({
    topic: TOPICS.PR_REVIEW_COMPLETED,
    messages: [
      {
        key: `${event.owner}/${event.repo}#${event.prNumber}`,
        value: JSON.stringify(event),
        headers: {
          'trace-id': event.traceId,
          'user-id': event.userId,
        },
      },
    ],
  });

  logger.info(
    { traceId: event.traceId, reviewId: event.reviewId },
    'Review completed event published'
  );
}

/**
 * Publish a review failure event to dead letter queue
 */
export async function publishReviewFailed(
  event: ReviewFailedEvent
): Promise<void> {
  const p = await initializeProducer();

  await p.send({
    topic: TOPICS.PR_REVIEW_FAILED,
    messages: [
      {
        key: `${event.owner}/${event.repo}#${event.prNumber}`,
        value: JSON.stringify(event),
        headers: {
          'trace-id': event.traceId,
          'user-id': event.userId,
        },
      },
    ],
  });

  logger.error(
    { traceId: event.traceId, error: event.error },
    'Review failed event published to DLQ'
  );
}

/**
 * Subscribe to review request events and process them
 */
export async function subscribeToReviewRequests(
  handler: (event: ReviewRequestEvent, message: KafkaMessage) => Promise<void>
): Promise<void> {
  const c = await initializeConsumer('steveguard-review-processor');
  
  await c.subscribe({ topic: TOPICS.PR_REVIEW_REQUESTED, fromBeginning: false });

  await c.run({
    eachMessage: async ({ topic, partition, message }) => {
      const startTime = Date.now();
      try {
        const event = JSON.parse(message.value?.toString() || '{}') as ReviewRequestEvent;
        const traceId = event.traceId;

        logger.info(
          { traceId, partition, topic },
          'Processing review request from Kafka'
        );

        await handler(event, message);

        const processingTime = Date.now() - startTime;
        logger.info(
          { traceId, processingTime },
          'Review request processed successfully'
        );
      } catch (error) {
        logger.error(
          { error, partition, topic },
          'Error processing review request'
        );
        throw error; // This will trigger retry behavior
      }
    },
  });
}

/**
 * Disconnect Kafka clients
 */
export async function disconnectKafka(): Promise<void> {
  if (producer) {
    await producer.disconnect();
    producer = null;
  }
  if (consumer) {
    await consumer.disconnect();
    consumer = null;
  }
  logger.info('Kafka clients disconnected');
}

export { TOPICS };
