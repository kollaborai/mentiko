import { applyBuiltinCliStartupHold, classifyCliReadiness } from "@/lib/runner-v2/readiness-policy";
import type { AgentProfileReadinessConfig } from "@/lib/types";

describe("runner-v2 readiness policy", () => {
  it("matches selected profile ready text patterns with shell literal casing", () => {
    const readiness: AgentProfileReadinessConfig = {
      enabled: true,
      ready_patterns: [{ name: "ready-banner", type: "text", value: "Ready" }],
    };

    expect(classifyCliReadiness({ readiness, output: "Ready\n>", failClosed: true })).toMatchObject({
      status: "ready",
      reason: "matched ready-banner",
      pattern: "ready-banner",
    });
    expect(classifyCliReadiness({ readiness, output: "ready\n>", failClosed: true })).toMatchObject({
      status: "unknown",
      reason: "no readiness pattern matched",
    });
  });

  it("matches selected profile regex patterns case-insensitively", () => {
    const readiness: AgentProfileReadinessConfig = {
      enabled: true,
      ready_patterns: [{ name: "regex-ready", type: "regex", value: "hooks[- ]active" }],
    };

    expect(classifyCliReadiness({ readiness, output: "HOOKS ACTIVE", failClosed: true })).toMatchObject({
      status: "ready",
      pattern: "regex-ready",
    });
  });

  it("uses shell group priority: blocked beats recover, retry, and ready", () => {
    const readiness: AgentProfileReadinessConfig = {
      enabled: true,
      blocked_patterns: [{ name: "auth", value: "Auth required", action: "block", risk: "high" }],
      recoverable_patterns: [{ name: "recover", value: "Auth required", action: "recover" }],
      retry_patterns: [{ name: "retry", value: "Auth required", action: "retry" }],
      ready_patterns: [{ name: "ready", value: "Auth required" }],
    };

    expect(classifyCliReadiness({ readiness, output: "Auth required", failClosed: true })).toMatchObject({
      status: "blocked",
      reason: "matched auth",
      action: "block",
      risk: "high",
    });
  });

  it("preserves disabled-policy legacy permissive readiness unless fail-closed is on", () => {
    const readiness: AgentProfileReadinessConfig = { enabled: false };

    expect(classifyCliReadiness({ readiness, output: "", failClosed: false })).toMatchObject({
      status: "ready",
      reason: "readiness disabled",
    });
    expect(classifyCliReadiness({ readiness, output: "", failClosed: true })).toMatchObject({
      status: "no_ready_signal",
      reason: "readiness not enabled (fail-closed)",
    });
  });

  it("classifies enabled profiles with no ready patterns as no-ready-signal only under fail-closed", () => {
    const readiness: AgentProfileReadinessConfig = {
      enabled: true,
      blocked_patterns: [{ name: "blocked", value: "blocked" }],
    };

    expect(classifyCliReadiness({ readiness, output: "plain prompt", failClosed: false })).toMatchObject({
      status: "ready",
      reason: "no ready patterns configured",
    });
    expect(classifyCliReadiness({ readiness, output: "plain prompt", failClosed: true })).toMatchObject({
      status: "no_ready_signal",
      reason: "readiness enabled but no ready_patterns configured (fail-closed)",
    });
  });

  describe("built-in cli startup hold (#123)", () => {
    const codexReadiness: AgentProfileReadinessConfig = {
      enabled: true,
      ready_patterns: [
        { name: "codex tui banner", type: "text", value: "OpenAI Codex (v", action: "ready", risk: "low", enabled: true },
      ],
    };
    const bannerScreen = "OpenAI Codex (v0.169.0)\nFind and fix a bug";
    const startupScreen = "OpenAI Codex (v0.169.0)\nWaiting for startup  · esc cancel";

    it("holds a matched codex ready verdict while Waiting for startup is on screen", () => {
      const ready = classifyCliReadiness({ readiness: codexReadiness, output: startupScreen, failClosed: true });
      expect(ready.status).toBe("ready");
      expect(applyBuiltinCliStartupHold("codex", startupScreen, ready)).toMatchObject({
        status: "unknown",
        reason: expect.stringContaining("Waiting for startup"),
      });
    });

    it("passes the same profile once the startup line is gone", () => {
      const ready = classifyCliReadiness({ readiness: codexReadiness, output: bannerScreen, failClosed: true });
      expect(ready.status).toBe("ready");
      expect(applyBuiltinCliStartupHold("codex", bannerScreen, ready).status).toBe("ready");
    });

    it("leaves claude profiles and non-ready verdicts untouched", () => {
      const ready = classifyCliReadiness({ readiness: codexReadiness, output: startupScreen, failClosed: true });
      expect(applyBuiltinCliStartupHold("claude", startupScreen, ready).status).toBe("ready");
      expect(applyBuiltinCliStartupHold(undefined, startupScreen, ready).status).toBe("ready");
      const unknown = classifyCliReadiness({ readiness: codexReadiness, output: "blank", failClosed: true });
      expect(applyBuiltinCliStartupHold("codex", startupScreen, unknown).status).toBe("unknown");
    });
  });
});
