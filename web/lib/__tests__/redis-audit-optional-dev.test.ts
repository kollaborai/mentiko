const originalEnv = process.env;

const redisCtor = jest.fn();
const redisInstances: Array<{
  ping: jest.Mock;
  quit: jest.Mock;
  disconnect: jest.Mock;
  on: jest.Mock;
}> = [];

jest.mock("ioredis", () => {
  return {
    __esModule: true,
    default: redisCtor,
  };
});

jest.mock("../audit-exec", () => ({
  execAuditLog: jest.fn(),
}));

describe("optional redis in development", () => {
  beforeEach(() => {
    jest.resetModules();
    redisCtor.mockReset();
    redisInstances.length = 0;
    process.env = { ...originalEnv, NODE_ENV: "development" };
    delete process.env.MENTIKO_REDIS_HOST;
    delete process.env.MENTIKO_REDIS_PORT;
    delete process.env.MENTIKO_REDIS_PASSWORD;
    delete process.env.MENTIKO_REDIS_DB;
    delete process.env.MENTIKO_REDIS_ENABLED;
    redisCtor.mockImplementation(() => {
      const instance = {
        ping: jest.fn(async () => "PONG"),
        quit: jest.fn(async () => undefined),
        disconnect: jest.fn(),
        on: jest.fn(),
      };
      redisInstances.push(instance);
      return instance;
    });
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
    delete (globalThis as typeof globalThis & { __mentikoAuditQueue?: unknown }).__mentikoAuditQueue;
    delete (globalThis as typeof globalThis & { __mentikoAuditQueuePromise?: unknown }).__mentikoAuditQueuePromise;
    delete (globalThis as typeof globalThis & { __mentikoAuditWorker?: unknown }).__mentikoAuditWorker;
    delete (globalThis as typeof globalThis & { __mentikoAuditWorkerPromise?: unknown }).__mentikoAuditWorkerPromise;
    delete (globalThis as typeof globalThis & { __mentikoAuditQueueSkipWarned?: unknown }).__mentikoAuditQueueSkipWarned;
  });

  it("does not create a localhost redis client by default in dev", async () => {
    const redis = await import("../redis");

    expect(redis.redisConfigured).toBe(false);
    expect(redis.redis).toBeNull();
    expect(redisCtor).not.toHaveBeenCalled();
    await expect(redis.ping()).resolves.toBe(false);
  });

  it("skips audit queue work when redis is not configured in dev", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const { addAuditLog } = await import("../audit-queue");

    await expect(
      addAuditLog({
        eventType: "dev_audit_optional",
        description: "redis unavailable in local dev",
      }),
    ).resolves.toBeUndefined();

    expect(redisCtor).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      "[audit-queue] redis unavailable, skipping audit log:",
      "dev_audit_optional",
    );
  });

  it("treats explicit unreachable dev redis as optional for audit queue", async () => {
    process.env.MENTIKO_REDIS_HOST = "127.0.0.1";
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    redisCtor.mockImplementation(() => {
      const instance = {
        ping: jest.fn(async () => {
          throw new AggregateError([], "connect ECONNREFUSED 127.0.0.1:6379");
        }),
        quit: jest.fn(async () => undefined),
        disconnect: jest.fn(),
        on: jest.fn(),
      };
      redisInstances.push(instance);
      return instance;
    });

    const { addAuditLog } = await import("../audit-queue");

    await expect(
      addAuditLog({
        eventType: "dev_audit_down",
        description: "redis configured but down in local dev",
      }),
    ).resolves.toBeUndefined();

    expect(redisInstances[0]?.on).toHaveBeenCalledWith("error", expect.any(Function));
    expect(warn).toHaveBeenCalledWith(
      "[audit-queue] redis unavailable, skipping audit log:",
      "dev_audit_down",
    );
  });
});
