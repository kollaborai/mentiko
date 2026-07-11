import {
  checkAutoRunTasks,
  getAutoRunServiceStatus,
  stopAutoRunService,
} from "@/lib/runs/auto-run-service";

const originalFetch = global.fetch;
const originalEnv = {
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
  NAMESPACE_ID: process.env.NAMESPACE_ID,
  ORG_ID: process.env.ORG_ID,
  WEB_PORT: process.env.WEB_PORT,
};

function response(body: unknown = {}): Response {
  return {
    ok: true,
    json: async () => body,
  } as Response;
}

function restoreEnv(key: keyof typeof originalEnv): void {
  const value = originalEnv[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

describe("auto-run service poller", () => {
  beforeEach(() => {
    stopAutoRunService();
    process.env.BETTER_AUTH_SECRET = "poller-secret";
    process.env.NAMESPACE_ID = "tenant-acme";
    process.env.ORG_ID = "engineering";
    process.env.WEB_PORT = "3200";
  });

  afterEach(() => {
    stopAutoRunService();
    global.fetch = originalFetch;
    restoreEnv("BETTER_AUTH_SECRET");
    restoreEnv("NAMESPACE_ID");
    restoreEnv("ORG_ID");
    restoreEnv("WEB_PORT");
  });

  it("forwards the configured org context to both reconcile and auto-run", async () => {
    const fetchMock = jest.fn(async (url: RequestInfo | URL, _init?: RequestInit) => {
      if (String(url).endsWith("/api/tasks/auto-run")) return response({ triggered: 2 });
      return response();
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await checkAutoRunTasks();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer poller-secret",
        "x-namespace-id": "tenant-acme",
        "x-org-id": "engineering",
      });
    }
  });

  it("keeps the in-flight guard while an earlier reconcile is unresolved", async () => {
    let resolveReconcile: ((value: Response) => void) | undefined;
    const reconcile = new Promise<Response>((resolve) => {
      resolveReconcile = resolve;
    });
    const fetchMock = jest.fn((url: RequestInfo | URL, _init?: RequestInit) => (
      String(url).endsWith("/api/tasks/reconcile")
        ? reconcile
        : Promise.resolve(response({ triggered: 0 }))
    ));
    global.fetch = fetchMock as unknown as typeof fetch;

    const firstCheck = checkAutoRunTasks();
    await checkAutoRunTasks();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getAutoRunServiceStatus().checkCount).toBe(0);

    resolveReconcile!(response());
    await firstCheck;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getAutoRunServiceStatus().checkCount).toBe(1);
  });
});
