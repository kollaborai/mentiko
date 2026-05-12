import Redis, { type RedisOptions } from "ioredis";

function createRedisConfig() {
  const host = process.env.MENTIKO_REDIS_HOST || "localhost";
  const port = parseInt(process.env.MENTIKO_REDIS_PORT || "6379", 10);
  const password = process.env.MENTIKO_REDIS_PASSWORD || undefined;
  const db = parseInt(process.env.MENTIKO_REDIS_DB || "0", 10);

  if (process.env.NODE_ENV === "production" && !password) {
    console.warn(
      "[redis] not configured: MENTIKO_REDIS_PASSWORD required in production"
    );
    return null;
  }

  return {
    host,
    port,
    password,
    db,
    maxRetriesPerRequest: 3,
    retryStrategy: (times: number) => {
      const delay = Math.min(Math.exp(times) * 50, 2000);
      return delay;
    },
  };
}

const config = createRedisConfig();
export const redisConfigured = Boolean(config);

export function createRedisClient(overrides: RedisOptions = {}) {
  if (!config) return null;
  return new Redis({ ...config, ...overrides });
}

const redis = createRedisClient();

export { redis };

export async function ping(): Promise<boolean> {
  if (!redis) return false;
  try {
    const result = await redis.ping();
    return result === "PONG";
  } catch {
    return false;
  }
}

export async function close(): Promise<void> {
  if (!redis) return;
  await redis.quit();
}
