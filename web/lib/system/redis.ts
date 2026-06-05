import Redis, { type RedisOptions } from "ioredis";

function createRedisConfig() {
  const isProduction = process.env.NODE_ENV === "production";
  const explicitDevRedis = Boolean(
    process.env.MENTIKO_REDIS_ENABLED ||
    process.env.MENTIKO_REDIS_HOST ||
    process.env.MENTIKO_REDIS_PORT ||
    process.env.MENTIKO_REDIS_PASSWORD ||
    process.env.MENTIKO_REDIS_DB
  );

  if (!isProduction && !explicitDevRedis) {
    return null;
  }

  const host = process.env.MENTIKO_REDIS_HOST || "localhost";
  const port = parseInt(process.env.MENTIKO_REDIS_PORT || "6379", 10);
  const password = process.env.MENTIKO_REDIS_PASSWORD || undefined;
  const db = parseInt(process.env.MENTIKO_REDIS_DB || "0", 10);

  if (isProduction && !password) {
    return null;
  }

  return {
    host,
    port,
    password,
    db,
    lazyConnect: true,
    maxRetriesPerRequest: 3,
    retryStrategy: (times: number) => {
      if (!isProduction) return null;
      const delay = Math.min(Math.exp(times) * 50, 2000);
      return delay;
    },
  };
}

const config = createRedisConfig();
export const redisConfigured = Boolean(config);

export function createRedisClient(overrides: RedisOptions = {}) {
  if (!config) return null;
  const client = new Redis({ ...config, ...overrides });
  client.on("error", () => {
    // Redis is optional in local dev. Callers surface availability explicitly.
  });
  return client;
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
  try {
    await redis.quit();
  } catch {
    redis.disconnect();
  }
}
