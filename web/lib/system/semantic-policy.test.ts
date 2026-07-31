/**
 * Semantic-policy circuit breaker (chain-contract-plan-of-record.md A6).
 * Isolation: settings derive from config.globalRoot (MENTIKO_GLOBAL_ROOT), so
 * each test uses a throwaway temp root via jest.isolateModules.
 *
 * @jest-environment node
 */
import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import { join } from "path";
import { tmpdir } from "os";
import { mkdtempSync, rmSync, existsSync } from "fs";

type SettingsModule = typeof import("./system-settings");
let settings: SettingsModule;
let tempRoot = "";

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "semantic-policy-"));
  process.env.MENTIKO_GLOBAL_ROOT = tempRoot;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    settings = require("./system-settings");
  });
});

afterEach(() => {
  delete process.env.MENTIKO_GLOBAL_ROOT;
  if (tempRoot && existsSync(tempRoot)) rmSync(tempRoot, { recursive: true, force: true });
});

describe("resolveSemanticPolicyMode", () => {
  test("defaults to enforce with no override", () => {
    expect(settings.resolveSemanticPolicyMode("ns")).toBe("enforce");
  });

  test("warn mode applies to all semantic rules when no rule_ids are scoped", () => {
    settings.writeSystemSettings({
      ...settings.readSystemSettings("ns"),
      semantic_policy: { mode: "warn", reason: "gate regression", actor: "admin", changed_at: new Date().toISOString() },
    }, "ns");
    expect(settings.resolveSemanticPolicyMode("ns")).toBe("warn");
    expect(settings.resolveSemanticPolicyMode("ns", "any-rule")).toBe("warn");
  });

  test("rule-scoped warn mode leaves other rules enforcing", () => {
    settings.writeSystemSettings({
      ...settings.readSystemSettings("ns"),
      semantic_policy: { mode: "warn", rule_ids: ["lifecycle-subject-v2"], reason: "x" },
    }, "ns");
    expect(settings.resolveSemanticPolicyMode("ns", "lifecycle-subject-v2")).toBe("warn");
    expect(settings.resolveSemanticPolicyMode("ns", "another-rule")).toBe("enforce");
    // An unnamed rule cannot claim a scoped override.
    expect(settings.resolveSemanticPolicyMode("ns")).toBe("enforce");
  });

  test("an expired override is inert", () => {
    settings.writeSystemSettings({
      ...settings.readSystemSettings("ns"),
      semantic_policy: {
        mode: "warn",
        reason: "x",
        expires_at: new Date(Date.now() - 60_000).toISOString(),
      },
    }, "ns");
    expect(settings.resolveSemanticPolicyMode("ns")).toBe("enforce");
  });

  test("namespace scope: another namespace stays in enforce", () => {
    settings.writeSystemSettings({
      ...settings.readSystemSettings("ns"),
      semantic_policy: { mode: "warn", reason: "x" },
    }, "ns");
    expect(settings.resolveSemanticPolicyMode("other-ns")).toBe("enforce");
  });
});

// The override must be impossible to reach from the structural gate: the
// generated-chain validator module must not import or consult it.
test("structural validation has no code path into the semantic override", () => {
  const { readFileSync } = jest.requireActual("fs") as typeof import("fs");
  const validatorSource = readFileSync(
    join(__dirname, "..", "chains", "generated-chain-delivery-contract.ts"),
    "utf-8",
  );
  expect(validatorSource).not.toContain("resolveSemanticPolicyMode");
  expect(validatorSource).not.toContain("system-settings");
});
