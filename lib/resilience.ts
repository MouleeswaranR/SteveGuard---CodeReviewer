import CircuitBreaker from 'opossum';
import { logger } from './logger';

/**
 * Exponential backoff retry mechanism
 * Retries a function with exponentially increasing delays
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  initialDelayMs: number = 100,
  maxDelayMs: number = 10000
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      if (attempt < maxRetries - 1) {
        const delayMs = Math.min(
          initialDelayMs * Math.pow(2, attempt),
          maxDelayMs
        );
        logger.warn(
          { attempt, delayMs, error: error.message },
          `Retry attempt ${attempt + 1}/${maxRetries}, waiting ${delayMs}ms`
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  throw lastError || new Error('All retry attempts failed');
}

/**
 * Circuit breaker configuration
 * Prevents hammering a broken service
 */
interface CircuitBreakerOptions {
  timeout?: number;
  errorThresholdPercentage?: number;
  resetTimeout?: number;
  name?: string;
}

/**
 * Create a circuit breaker for a function
 * Stops calling a function if it fails too many times
 */
export function createCircuitBreaker<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  options: CircuitBreakerOptions = {}
): T {
  const breaker = new CircuitBreaker(fn, {
    timeout: options.timeout ?? 5000, // 5 second timeout
    errorThresholdPercentage: options.errorThresholdPercentage ?? 50, // Open after 50% failures
    resetTimeout: options.resetTimeout ?? 30000, // Try again after 30 seconds
    name: options.name ?? fn.name,
    onOpen: () => {
      logger.warn({ circuit: options.name }, 'Circuit breaker opened');
    },
    onHalfOpen: () => {
      logger.info({ circuit: options.name }, 'Circuit breaker half-open, testing...');
    },
    onClose: () => {
      logger.info({ circuit: options.name }, 'Circuit breaker closed');
    },
  });

  breaker.fallback(() => {
    throw new Error(`Circuit breaker is open for ${options.name || fn.name}`);
  });

  return breaker.fire.bind(breaker);
}

/**
 * Pre-configured circuit breakers for common services
 */
export const circuitBreakers = {
  /**
   * Gemini API circuit breaker
   * Prevents hammering Gemini when it's down
   */
  gemini: null as any,

  /**
   * Pinecone API circuit breaker
   */
  pinecone: null as any,

  /**
   * GitHub API circuit breaker
   */
  github: null as any,

  /**
   * Initialize circuit breakers (call this in your app startup)
   */
  initialize: (
    geminiCall: () => Promise<any>,
    pineconeCall: () => Promise<any>,
    githubCall: () => Promise<any>
  ) => {
    circuitBreakers.gemini = createCircuitBreaker(geminiCall, {
      timeout: 5000,
      errorThresholdPercentage: 50,
      resetTimeout: 30000,
      name: 'gemini-api',
    });

    circuitBreakers.pinecone = createCircuitBreaker(pineconeCall, {
      timeout: 3000,
      errorThresholdPercentage: 50,
      resetTimeout: 20000,
      name: 'pinecone-api',
    });

    circuitBreakers.github = createCircuitBreaker(githubCall, {
      timeout: 8000,
      errorThresholdPercentage: 50,
      resetTimeout: 30000,
      name: 'github-api',
    });

    logger.info('Circuit breakers initialized');
  },
};

/**
 * Graceful degradation wrapper
 * Falls back to a degraded function if the primary fails
 */
export async function withGracefulDegradation<T>(
  primary: () => Promise<T>,
  degraded: () => Promise<T>,
  primaryName: string = 'primary'
): Promise<T> {
  try {
    return await primary();
  } catch (error: any) {
    logger.warn(
      { error: error.message, fallback: `${primaryName}-degraded` },
      `Primary operation failed, using degraded version`
    );
    return degraded();
  }
}

/**
 * Timeout wrapper for promises
 * Rejects if operation takes longer than specified timeout
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operationName: string = 'operation'
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${operationName} timed out after ${timeoutMs}ms`)),
        timeoutMs
      )
    ),
  ]);
}

/**
 * Health check for a service
 * Returns true if service is healthy
 */
export async function healthCheck(
  checkFn: () => Promise<boolean>,
  timeoutMs: number = 5000,
  serviceName: string = 'service'
): Promise<boolean> {
  try {
    return await withTimeout(checkFn(), timeoutMs, `${serviceName} health check`);
  } catch (error: any) {
    logger.error(
      { error: error.message, service: serviceName },
      `Health check failed`
    );
    return false;
  }
}

/**
 * Bulkhead pattern: Limit concurrent requests to a service
 * Prevents one slow endpoint from consuming all resources
 */
export class BulkheadExecutor {
  private running: number = 0;
  private queue: Array<{
    fn: () => Promise<any>;
    resolve: (value: any) => void;
    reject: (error: any) => void;
  }> = [];

  constructor(
    private maxConcurrent: number,
    private name: string = 'bulkhead'
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn: fn as any, resolve, reject });
      this.process();
    });
  }

  private async process() {
    if (this.running >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }

    this.running++;
    const item = this.queue.shift();

    if (item) {
      try {
        const result = await item.fn();
        item.resolve(result);
      } catch (error) {
        item.reject(error);
      }
    }

    this.running--;
    this.process();
  }

  getStatus() {
    return {
      name: this.name,
      running: this.running,
      queued: this.queue.length,
      maxConcurrent: this.maxConcurrent,
    };
  }
}

/**
 * Create bulkhead executors for different services
 */
export const bulkheads = {
  gemini: new BulkheadExecutor(5, 'gemini-api'),
  pinecone: new BulkheadExecutor(10, 'pinecone-api'),
  github: new BulkheadExecutor(8, 'github-api'),
};

logger.info('Resilience patterns initialized');
