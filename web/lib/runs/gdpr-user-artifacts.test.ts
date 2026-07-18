/**
 * @jest-environment node
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  chainOwnedByUser,
  sweepGdprUserData,
} from "@/lib/runs/gdpr-user-sweep";

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
  it("removes only the user's chains, conversations, decisions, and runs", () => {
    const root = mkdtempSync(join(tmpdir(), "gdpr-"));
    try {
      const ns = seedNamespace(root);
      const ownedRun = join(ns, "runs", "run-1784102007562-bb990ff5");
      mkdirSync(ownedRun, { recursive: true });
      writeFileSync(join(ownedRun, "run.json"), JSON.stringify({
        id: "run-1784102007562-bb990ff5", chain: "gdpr", goal: "erase", started: "2026-07-15T00:00:00Z", status: "completed", agents: [], user_id: "u1",
      }));
      const result = sweepGdprUserData(ns, "u1");
      const removed = result.artifactPaths;
      expect(removed).toHaveLength(3);
      expect(result.runPaths).toEqual([expect.stringMatching(/\/runs\/run-1784102007562-bb990ff5$/)]);
      expect(existsSync(join(ns, "chains", "c-own"))).toBe(false);
      expect(existsSync(join(ns, "chains", "c-other"))).toBe(true);
      expect(existsSync(join(ns, "conversations", "mixed.jsonl"))).toBe(false);
      expect(existsSync(join(ns, "conversations", "other.jsonl"))).toBe(true);
      expect(existsSync(join(ns, "decisions", "d1.json"))).toBe(false);
      expect(existsSync(join(ns, "decisions", "d2.json"))).toBe(true);
      expect(existsSync(ownedRun)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not false-positive on a non-ownership field that mentions the user id", () => {
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

});
