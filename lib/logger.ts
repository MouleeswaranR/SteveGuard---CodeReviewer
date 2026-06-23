import pino from 'pino';
import { v4 as uuidv4 } from 'uuid';

// Initialize Pino logger with structured logging
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: {
    service: 'steveguard-reviewer',
    version: process.env.APP_VERSION || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
  },
  transport:
    process.env.NODE_ENV === 'development'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            levelFirst: true,
            singleLine: false,
            translateTime: 'SYS:standard',
          },
        }
      : undefined,
  formatters: {
    level: (label) => {
      return { level: label.toUpperCase() };
    },
  },
});

/**
 * Child logger with trace ID
 * Use this for all logging within a request/event processing context
 */
export function createTraceLogger(traceId: string) {
  return logger.child({ traceId });
}

/**
 * Generate a new trace ID for request correlation
 */
export function generateTraceId(): string {
  return uuidv4();
}

/**
 * Structured logging middleware for Express/Next.js
 * Adds traceId to all requests and logs request/response
 */
export function loggingMiddleware(req: any, res: any, next: any) {
  // Generate or extract trace ID from request headers
  let traceId = req.headers['x-trace-id'];
  if (!traceId) {
    traceId = generateTraceId();
    req.headers['x-trace-id'] = traceId;
  }

  // Add trace ID to response headers
  res.setHeader('X-Trace-ID', traceId);

  // Create child logger with trace ID
  const requestLogger = createTraceLogger(traceId);
  req.logger = requestLogger;

  const startTime = Date.now();

  // Log request
  requestLogger.info(
    {
      method: req.method,
      path: req.path || req.url,
      query: req.query,
      userAgent: req.headers['user-agent'],
    },
    'Incoming request'
  );

  // Log response
  const originalEnd = res.end;
  res.end = function (...args: any[]) {
    const statusCode = res.statusCode;
    const duration = Date.now() - startTime;

    const logLevel = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
    requestLogger[logLevel](
      {
        statusCode,
        durationMs: duration,
        contentLength: res.get('content-length'),
      },
      'Request completed'
    );

    originalEnd.apply(res, args);
  };

  next();
}

/**
 * Log performance metrics for long-running operations
 */
export function logPerformance(
  operation: string,
  durationMs: number,
  traceId?: string,
  metadata?: Record<string, any>
) {
  const level = durationMs > 5000 ? 'warn' : 'info';
  const childLogger = traceId ? createTraceLogger(traceId) : logger;

  childLogger[level](
    {
      operation,
      durationMs,
      ...metadata,
    },
    `Performance metric: ${operation}`
  );
}

/**
 * Log errors with full context
 */
export function logError(
  error: Error,
  context: string,
  traceId?: string,
  metadata?: Record<string, any>
) {
  const childLogger = traceId ? createTraceLogger(traceId) : logger;

  childLogger.error(
    {
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name,
      },
      ...metadata,
    },
    `Error in ${context}`
  );
}

export { logger };
