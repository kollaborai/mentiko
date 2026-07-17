import { LOG_LEVELS, normalizeSystemLogSubmission } from "@/lib/system/system-logger";
import { resolveSystemLogEndpoint } from "@/lib/system/system-log-cli";

describe("system log submission normalization", () => {
  it("accepts each supported level", () => {
    for (const level of LOG_LEVELS) {
      const result = normalizeSystemLogSubmission({ level, source: "chain-runner", message: "m" });
      expect(result).toEqual({ ok: true, submission: { level, source: "chain-runner", message: "m" } });
    }
  });

  it("rejects a level outside the contract rather than casting it through", () => {
    const result = normalizeSystemLogSubmission({ level: "bogus", source: "s", message: "m" });
    expect(result).toEqual({ ok: false, error: "level must be one of error, warn, info" });
  });

  it("requires level, source, and message", () => {
    expect(normalizeSystemLogSubmission({ source: "s", message: "m" }).ok).toBe(false);
    expect(normalizeSystemLogSubmission({ level: "info", message: "m" }).ok).toBe(false);
    expect(normalizeSystemLogSubmission({ level: "info", source: "s" }).ok).toBe(false);
  });

  it("treats blank and non-string fields as absent", () => {
    expect(normalizeSystemLogSubmission({ level: "info", source: "   ", message: "m" }).ok).toBe(false);
    expect(normalizeSystemLogSubmission({ level: "info", source: 42, message: "m" }).ok).toBe(false);
  });

  it("omits detail when empty so the record keeps the field optional", () => {
    const result = normalizeSystemLogSubmission({ level: "info", source: "s", message: "m", detail: "" });
    expect(result).toEqual({ ok: true, submission: { level: "info", source: "s", message: "m" } });
  });

  it("keeps a populated detail and trims surrounding whitespace", () => {
    const result = normalizeSystemLogSubmission({ level: "warn", source: " s ", message: " m ", detail: " d " });
    expect(result).toEqual({ ok: true, submission: { level: "warn", source: "s", message: "m", detail: "d" } });
  });

  it("rejects non-object submissions", () => {
    expect(normalizeSystemLogSubmission(null).ok).toBe(false);
    expect(normalizeSystemLogSubmission("level=info").ok).toBe(false);
  });
});

describe("system log endpoint resolution", () => {
  it("prefers WEB_PORT, then PORT, then the default", () => {
    expect(resolveSystemLogEndpoint({ WEB_PORT: "3200" } as NodeJS.ProcessEnv))
      .toBe("http://localhost:3200/api/system/logs");
    expect(resolveSystemLogEndpoint({ PORT: "3201" } as NodeJS.ProcessEnv))
      .toBe("http://localhost:3201/api/system/logs");
    expect(resolveSystemLogEndpoint({} as NodeJS.ProcessEnv))
      .toBe("http://localhost:3000/api/system/logs");
  });

  it("lets an explicit web URL win over port derivation", () => {
    expect(resolveSystemLogEndpoint({ MENTIKO_WEB_URL: "http://web:3000", PORT: "9" } as NodeJS.ProcessEnv))
      .toBe("http://web:3000/api/system/logs");
  });
});
