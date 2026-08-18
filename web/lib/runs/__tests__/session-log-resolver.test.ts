import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  encodeCwdSlug,
  fileBirthEpoch,
  findConversationFiles,
  resolveProfileLogDir,
  resolveSessionLog,
} from "@/lib/runs/session-log-resolver";

const UUID = "11111111-2222-3333-4444-555555555555";

function tempDir() {
  return mkdtempSync(join(tmpdir(), "mentiko-session-log-resolver-"));
}

describe("typed session transcript resolution", () => {
  it("uses the historical provider-specific path encoding without guessing a root", () => {
    expect(encodeCwdSlug("claude", "/work/project.name")).toBe("-work-project-name");
    expect(encodeCwdSlug("kollab-agent", "/work/project.name")).toBe("work_project.name");
    expect(encodeCwdSlug("codex", "/work/project.name")).toBe("");
    expect(resolveProfileLogDir({ cli: "codex" }, "/work/project")).toBe("");
    expect(resolveProfileLogDir({ cli: "claude", log_path: "/logs/" }, "/work/project")).toBe("/logs/-work-project");
  });

  it("maps a PTY capture UUID only to a regular JSONL in the configured root", () => {
    const root = tempDir();
    const pty = join(root, "fake-pty");
    const transcript = join(root, `${UUID}.jsonl`);
    writeFileSync(transcript, "{}\n");
    writeFileSync(pty, `#!/bin/sh\nprintf '%s\\n' 'capture ${UUID}'\n`);
    chmodSync(pty, 0o755);

    expect(resolveSessionLog(root, "agent-one", pty)).toBe(transcript);
    expect(resolveSessionLog(root, "agent-one", join(root, "missing-pty"))).toBe("");
  });

  it("uses the timestamp window before its deterministic newest-file fallback", () => {
    const root = tempDir();
    const current = join(root, "current.jsonl");
    writeFileSync(current, "{}\n");
    const currentEpoch = fileBirthEpoch(current);
    expect(findConversationFiles(root, currentEpoch, "claude")).toEqual([current]);

    const emptyWindow = findConversationFiles(root, currentEpoch - 10_000, "claude");
    expect(emptyWindow).toEqual([current]);
  });

  it("looks in Codex's date partition without escaping the configured root", () => {
    const root = tempDir();
    const now = new Date();
    const dated = join(root, String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0"));
    mkdirSync(dated, { recursive: true });
    const transcript = join(dated, "codex.jsonl");
    writeFileSync(transcript, "{}\n");

    expect(findConversationFiles(root, fileBirthEpoch(transcript), "codex")).toEqual([transcript]);
  });
});
