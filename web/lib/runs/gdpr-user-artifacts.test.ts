/**
 * @jest-environment node
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// GDPR per-user artifact ownership is owned by lib/gdpr-user-artifacts.mjs.
// The shell boundary lib/gdpr-sweep.sh forwards the namespace root and user id
// and no longer greps raw JSON.

const modulePath = fileURLToPath(new URL("../../../lib/gdpr-user-artifacts.mjs", import.meta.url));
const shellPath = fileURLToPath(new URL("../../../lib/gdpr-sweep.sh", import.meta.url));

async function loadModule() {
  return import(modulePath);
}

function seedNamespace(root: string): string {
  const ns = join(root, "namespaces", "default");
  mkdirSync(join(ns, "chains", "c-own"), { recursive: true });
  mkdirSync(join(ns, "chains", "c-other"), { recursive: true });
  mkdirSync(join(ns, "conversations"), { recursive: true });
  mkdirSync(join(ns, "decisions"), { recursive: true });
  writeFileSync(join(ns, "chains", "c-own", "chain.json"), JSON.stringify({ created_by: "u1" }));
  // Mentions "u1" in a non-ownership field: a raw grep would false-positive.
  writeFileSync(join(ns, "chains", "c-other", "chain.json"), JSON.stringify({ created_by: "u2", note: "userId:u1" }));
  writeFileSync(join(ns, "conversations", "mixed.jsonl"), '{"user_id":"u2"}\n{"user_id":"u1"}\n');
  writeFileSync(join(ns, "conversations", "other.jsonl"), '{"user_id":"u2"}\n');
  writeFileSync(join(ns, "decisions", "d1.json"), JSON.stringify({ userId: "u1" }));
  writeFileSync(join(ns, "decisions", "d2.json"), JSON.stringify({ userId: "u2" }));
  return ns;
}

describe("typed GDPR user-artifact ownership", () => {
  it("removes only the user's chains, conversations, and decisions", async () => {
    const { sweepUserArtifacts } = await loadModule();
    const root = mkdtempSync(join(tmpdir(), "gdpr-"));
    try {
      const ns = seedNamespace(root);
      const removed: string[] = sweepUserArtifacts(ns, "u1");
      expect(removed).toHaveLength(3);
      expect(existsSync(join(ns, "chains", "c-own"))).toBe(false);
      expect(existsSync(join(ns, "chains", "c-other"))).toBe(true);
      expect(existsSync(join(ns, "conversations", "mixed.jsonl"))).toBe(false);
      expect(existsSync(join(ns, "conversations", "other.jsonl"))).toBe(true);
      expect(existsSync(join(ns, "decisions", "d1.json"))).toBe(false);
      expect(existsSync(join(ns, "decisions", "d2.json"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not false-positive on a non-ownership field that mentions the user id", async () => {
    const { chainOwnedByUser } = await loadModule();
    const root = mkdtempSync(join(tmpdir(), "gdpr-fp-"));
    try {
      const file = join(root, "chain.json");
      writeFileSync(file, JSON.stringify({ created_by: "u2", note: "userId:u1 mentioned" }));
      expect(chainOwnedByUser(file, "u1")).toBe(false);
      expect(chainOwnedByUser(file, "u2")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("supports a dry run that detects without deleting", async () => {
    const { sweepUserArtifacts } = await loadModule();
    const root = mkdtempSync(join(tmpdir(), "gdpr-dry-"));
    try {
      const ns = seedNamespace(root);
      const removed: string[] = sweepUserArtifacts(ns, "u1", { dryRun: true });
      expect(removed).toHaveLength(3);
      expect(existsSync(join(ns, "chains", "c-own"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("runs as a CLI and prints the removal log", () => {
    const root = mkdtempSync(join(tmpdir(), "gdpr-cli-"));
    try {
      const ns = seedNamespace(root);
      const out = execFileSync("node", [modulePath, "sweep", "--ns-root", ns, "--user-id", "u1"], { encoding: "utf8" });
      expect(out).toContain("[gdpr-sweep] removing chain:");
      expect(out).toContain("[gdpr-sweep] removing decision:");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("leaves the shell boundary free of raw-JSON ownership grep", () => {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const shell = readFileSync(shellPath, "utf8");
    expect(shell).toContain("gdpr-user-artifacts.mjs");
    expect(shell).not.toMatch(/grep -q "\\?"created_by/);
    expect(shell).not.toContain('"user_id":\\"');
    expect(shell).not.toContain('"userId":\\"');
  });
});
