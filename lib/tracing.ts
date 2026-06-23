import { logger } from './logger';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { trace, context, SpanStatusCode } from '@opentelemetry/api';

/**
 * Distributed Tracing Module (OpenTelemetry + Jaeger)
 */

let sdk: NodeSDK | null = null;
const TRACING_ENABLED = process.env.ENABLE_TRACING === 'true';

/**
 * Initialize tracing
 */
export function initializeTracing() {
  if (!TRACING_ENABLED) return null;

  if (!sdk) {
    // We use the OTLP HTTP Exporter pointing to Jaeger's exposed 4318 port
    const exporter = new OTLPTraceExporter({
      url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318/v1/traces',
    });

    sdk = new NodeSDK({
      serviceName: 'steveguard',
      traceExporter: exporter,
    });

    try {
      sdk.start();
      logger.info('Tracing initialized (OpenTelemetry OTLP -> Jaeger)');
    } catch (err) {
      logger.error({ err }, 'Failed to initialize tracing');
    }
  }
  return sdk;
}

/**
 * Get tracer instance
 */
export function getTracer(name: string = 'steveguard') {
  return trace.getTracer(name);
}

/**
 * Create a span for tracing
 */
export function createSpan(operationName: string, attributes?: Record<string, any>) {
  const tracer = getTracer();
  const span = tracer.startSpan(operationName);
  if (attributes) {
    span.setAttributes(attributes);
  }
  return span;
}

/**
 * Trace an async operation
 */
export async function traceAsync<T>(
  operationName: string,
  fn: (span: any) => Promise<T>,
  attributes?: Record<string, any>
): Promise<T> {
  const tracer = getTracer();
  return tracer.startActiveSpan(operationName, async (span) => {
    if (attributes) {
      span.setAttributes(attributes);
    }
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error: any) {
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message || 'Error' });
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Trace a sync operation
 */
export function traceSync<T>(
  operationName: string,
  fn: (span: any) => T,
  attributes?: Record<string, any>
): T {
  const tracer = getTracer();
  return tracer.startActiveSpan(operationName, (span) => {
    if (attributes) {
      span.setAttributes(attributes);
    }
    try {
      const result = fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error: any) {
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message || 'Error' });
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Pre-configured spans for review pipeline
 */
export const reviewTracing = {
  webhookHandler: (traceId: string, prNumber: number, repo: string) => 
    createSpan('webhook-handler', { traceId, prNumber, repo }),
  
  kafkaProducer: (topic: string) => 
    createSpan('kafka-producer', { topic }),
  
  kafkaConsumer: (topic: string, partition: number) => 
    createSpan('kafka-consumer', { topic, partition }),
  
  ragRetrieval: (query: string, repo: string) => 
    createSpan('rag-retrieval', { query_length: query.length, repo }),
  
  geminiCall: (model: string, tokens?: number) => 
    createSpan('gemini-call', { model, tokens }),
  
  githubApi: (endpoint: string, method: string) => 
    createSpan('github-api', { endpoint, method }),
  
  evaluation: (reviewId: string) => 
    createSpan('evaluation', { reviewId }),
};

/**
 * Graceful shutdown
 */
export async function shutdownTracing() {
  if (sdk) {
    try {
      await sdk.shutdown();
      logger.info('Tracing shut down');
    } catch (error) {
      logger.error({ error }, 'Error shutting down tracing');
    }
  }
}

// Re-export for compatibility
export { SpanStatusCode, trace, context };

// Initialize on import if enabled
if (TRACING_ENABLED) {
  initializeTracing();
}

// Graceful shutdown on process exit
process.on('SIGTERM', async () => {
  await shutdownTracing();
});
