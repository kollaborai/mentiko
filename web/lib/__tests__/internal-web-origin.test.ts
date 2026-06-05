import { internalApiUrl, resolveInternalWebOrigin } from "@/lib/auth/internal-web-origin";

describe("internal web origin", () => {
  const previous = {
    internal: process.env.MENTIKO_INTERNAL_WEB_ORIGIN,
    webPort: process.env.WEB_PORT,
    port: process.env.PORT,
  };

  afterEach(() => {
    if (previous.internal === undefined) delete process.env.MENTIKO_INTERNAL_WEB_ORIGIN;
    else process.env.MENTIKO_INTERNAL_WEB_ORIGIN = previous.internal;
    if (previous.webPort === undefined) delete process.env.WEB_PORT;
    else process.env.WEB_PORT = previous.webPort;
    if (previous.port === undefined) delete process.env.PORT;
    else process.env.PORT = previous.port;
  });

  it("keeps loopback request origins unchanged", () => {
    expect(resolveInternalWebOrigin("http://127.0.0.1:3001")).toBe("http://127.0.0.1:3001");
    expect(internalApiUrl("/api/chains/run", "http://localhost:3002")).toBe(
      "http://localhost:3002/api/chains/run",
    );
  });

  it("maps public tenant origins to the local web port", () => {
    process.env.WEB_PORT = "3007";

    expect(resolveInternalWebOrigin("https://marco.mentiko.com")).toBe("http://127.0.0.1:3007");
    expect(internalApiUrl("/api/tasks/FEAT-001/run-chain", "https://marco.mentiko.com")).toBe(
      "http://127.0.0.1:3007/api/tasks/FEAT-001/run-chain",
    );
  });

  it("allows an explicit internal origin override", () => {
    process.env.MENTIKO_INTERNAL_WEB_ORIGIN = "http://mentiko-web:3000/";

    expect(resolveInternalWebOrigin("https://marco.mentiko.com")).toBe("http://mentiko-web:3000");
  });
});
