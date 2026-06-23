import Redis from 'ioredis';
import { logger } from './logger';

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
  db: process.env.REDIS_DB ? parseInt(process.env.REDIS_DB) : 0,
  retryStrategy: (times) => Math.min(times * 50, 2000),
  enableReadyCheck: false,
  enableOfflineQueue: false,
});

redis.on('error', (err) => {
  logger.error({ error: err }, 'Redis connection error');
});

redis.on('connect', () => {
  logger.info('Redis connected');
});

redis.on('disconnect', () => {
  logger.warn('Redis disconnected');
});

/**
 * Vector Cache: Cache Pinecone embedding lookups
 * If the same file/function gets reviewed in back-to-back PRs,
 * the Pinecone embedding lookup is redundant
 */
export const vectorCache = {
  /**
   * Get cached embedding chunks for a file
   */
  async getChunks(fileHash: string): Promise<string[] | null> {
    try {
      const key = `rag:chunks:${fileHash}`;
      const cached = await redis.get(key);
      if (cached) {
        logger.debug({ key }, 'Vector cache hit');
        return JSON.parse(cached);
      }
      logger.debug({ key }, 'Vector cache miss');
      return null;
    } catch (error) {
      logger.error({ error }, 'Error reading from vector cache');
      return null;
    }
  },

  /**
   * Cache embedding chunks for a file (1 hour TTL)
   */
  async setChunks(fileHash: string, chunks: string[]): Promise<void> {
    try {
      const key = `rag:chunks:${fileHash}`;
      await redis.setex(key, 3600, JSON.stringify(chunks));
      logger.debug({ key }, 'Vector cache set');
    } catch (error) {
      logger.error({ error }, 'Error writing to vector cache');
    }
  },

  /**
   * Clear cache for a specific file
   */
  async invalidate(fileHash: string): Promise<void> {
    try {
      const key = `rag:chunks:${fileHash}`;
      await redis.del(key);
      logger.debug({ key }, 'Vector cache invalidated');
    } catch (error) {
      logger.error({ error }, 'Error invalidating vector cache');
    }
  },
};

/**
 * Repository Access Control: Seat-locking style repo quota tracking
 * Every webhook call checks if user is within their repo quota
 * Redis: repo_access:{userId} → count, EXPIRE at midnight
 */
export const repoAccessControl = {
  /**
   * Get remaining repo slots for a user
   * Returns null if not cached (needs Postgres lookup)
   */
  async getRepoCount(userId: string): Promise<number | null> {
    try {
      const key = `repo_access:${userId}`;
      const count = await redis.get(key);
      if (count !== null) {
        logger.debug({ userId, count }, 'Repo quota from cache');
        return parseInt(count);
      }
      return null;
    } catch (error) {
      logger.error({ error }, 'Error reading repo quota');
      return null;
    }
  },

  /**
   * Set repo quota for user (resets at midnight UTC)
   * Uses EXPIRE to auto-reset
   */
  async setRepoCount(userId: string, count: number): Promise<void> {
    try {
      const key = `repo_access:${userId}`;
      // Calculate seconds until midnight UTC
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      tomorrow.setUTCHours(0, 0, 0, 0);
      const ttl = Math.floor((tomorrow.getTime() - now.getTime()) / 1000);

      await redis.setex(key, ttl, count.toString());
      logger.info({ userId, count, ttl }, 'Repo quota set');
    } catch (error) {
      logger.error({ error }, 'Error setting repo quota');
    }
  },

  /**
   * Increment repo usage for user
   */
  async incrementUsage(userId: string): Promise<void> {
    try {
      const key = `repo_access:${userId}`;
      await redis.decr(key); // Decrement because we're counting remaining
      logger.debug({ userId }, 'Repo usage incremented');
    } catch (error) {
      logger.error({ error }, 'Error incrementing repo usage');
    }
  },
};

/**
 * Rate Limiting: Sliding window rate limiter
 * Prevents single user from hammering the review endpoint
 */
export const rateLimiter = {
  /**
   * Check if user has exceeded rate limit
   * Returns { allowed: boolean, remaining: number, resetTime: number }
   */
  async checkLimit(
    userId: string,
    limit: number = 10, // 10 reviews per minute per user
    windowSeconds: number = 60
  ): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
    try {
      const now = Date.now();
      const windowStart = Math.floor(now / 1000 / windowSeconds) * windowSeconds;
      const key = `ratelimit:${userId}:${windowStart}`;

      const count = await redis.incr(key);
      if (count === 1) {
        // First request in window, set expiry
        await redis.expire(key, windowSeconds + 1);
      }

      const remaining = Math.max(0, limit - count);
      const resetTime = (windowStart + windowSeconds) * 1000;

      if (count > limit) {
        logger.warn(
          { userId, count, limit },
          'Rate limit exceeded'
        );
        return { allowed: false, remaining: 0, resetTime };
      }

      logger.debug(
        { userId, count, remaining },
        'Rate limit check passed'
      );
      return { allowed: true, remaining, resetTime };
    } catch (error) {
      logger.error({ error }, 'Error checking rate limit');
      // Fail open in case of Redis error
      return { allowed: true, remaining: limit, resetTime: Date.now() + 60000 };
    }
  },

  /**
   * Get current rate limit status
   */
  async getStatus(
    userId: string,
    limit: number = 10,
    windowSeconds: number = 60
  ): Promise<{ current: number; limit: number; resetTime: number }> {
    try {
      const windowStart = Math.floor(Date.now() / 1000 / windowSeconds) * windowSeconds;
      const key = `ratelimit:${userId}:${windowStart}`;
      const count = await redis.get(key);
      const current = count ? parseInt(count) : 0;
      const resetTime = (windowStart + windowSeconds) * 1000;

      return { current, limit, resetTime };
    } catch (error) {
      logger.error({ error }, 'Error getting rate limit status');
      return { current: 0, limit, resetTime: Date.now() + 60000 };
    }
  },
};

/**
 * Session cache: Cache user/repo data temporarily
 */
export const sessionCache = {
  async set(key: string, value: any, ttlSeconds: number = 300): Promise<void> {
    try {
      await redis.setex(`session:${key}`, ttlSeconds, JSON.stringify(value));
    } catch (error) {
      logger.error({ error }, 'Error setting session cache');
    }
  },

  async get(key: string): Promise<any | null> {
    try {
      const value = await redis.get(`session:${key}`);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      logger.error({ error }, 'Error getting session cache');
      return null;
    }
  },

  async delete(key: string): Promise<void> {
    try {
      await redis.del(`session:${key}`);
    } catch (error) {
      logger.error({ error }, 'Error deleting session cache');
    }
  },
};

export default redis;
