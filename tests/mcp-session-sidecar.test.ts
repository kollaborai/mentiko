import assert from "node:assert/strict";
import test from "node:test";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearPending,
  readSidecar,
  readSidecarForAuth,
  resolveMcpSessionPaths,
  writePending,
  writeSidecar,
} from "../lib/mentiko-mcp/handlers/session-store.ts";

const originalRoot = process.env.MENTIKO_GLOBAL_ROOT;
const originalToken = process.env.MENTIKO_SESSION_TOKEN;

test("MCP session sidecar validates records, preserves refresh credentials, and atomically publishes 0600 files", () => {
  const root = mkdtempSync(join(tmpdir(), "mentiko-mcp-sidecar-"));
  process.env.MENTIKO_GLOBAL_ROOT = root;
  try {
    const first = writeSidecar({ refresh_token: "refresh-one", session_token: "session-one" });
    const paths = resolveMcpSessionPaths();
    assert.equal(first.refresh_token, "refresh-one");
    assert.equal(lstatSync(paths.session).mode & 0o777, 0o600);

    const rotated = writeSidecar({ session_token: "session-two" });
    assert.deepEqual(rotated.refresh_token, "refresh-one");
    assert.deepEqual(readSidecar(), rotated);
    assert.match(readFileSync(paths.session, "utf8"), /session-two/);

    assert.throws(
      () => writePending({ device_code: "device", user_code: "code", verification_url: "not-a-url" }),
      /verification_url must be an http\(s\) URL/,
    );
    assert.equal(clearPending(), undefined);

    writeFileSync(paths.session, "not-json");
    assert.throws(() => readSidecar(), /Invalid MCP session sidecar/);
    assert.equal(readSidecarForAuth(), null);
    assert.equal(readFileSync(paths.session, "utf8"), "not-json");
  } finally {
    rmSync(root, { recursive: true, force: true });
    if (originalRoot === undefined) delete process.env.MENTIKO_GLOBAL_ROOT;
    else process.env.MENTIKO_GLOBAL_ROOT = originalRoot;
  }
});

test("MCP session sidecar rejects symlink files instead of following them", () => {
  const root = mkdtempSync(join(tmpdir(), "mentiko-mcp-sidecar-link-"));
  process.env.MENTIKO_GLOBAL_ROOT = root;
  try {
    const paths = resolveMcpSessionPaths();
    const target = join(root, "missing-target.json");
    mkdirSync(paths.directory, { recursive: true });
    symlinkSync(target, paths.session);
    assert.throws(() => readSidecar(), /must be a regular file/);
  } finally {
    rmSync(root, { recursive: true, force: true });
    if (originalRoot === undefined) delete process.env.MENTIKO_GLOBAL_ROOT;
    else process.env.MENTIKO_GLOBAL_ROOT = originalRoot;
  }
});

test("MCP ops ignores an invalid sidecar and continues with the configured session token", async () => {
  const root = mkdtempSync(join(tmpdir(), "mentiko-mcp-sidecar-ops-"));
  const originalFetch = globalThis.fetch;
  process.env.MENTIKO_GLOBAL_ROOT = root;
  process.env.MENTIKO_SESSION_TOKEN = "configured-session-token";
  try {
    const paths = resolveMcpSessionPaths();
    mkdirSync(paths.directory, { recursive: true });
    writeFileSync(paths.session, "not-json");
    globalThis.fetch = (async (_input, init) => {
      assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer configured-session-token");
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;
    const { opsGet } = await import(`../lib/mentiko-mcp/handlers/ops-client.ts?invalid-sidecar-${Date.now()}`);
    assert.deepEqual(await opsGet("/api/mentiko-mcp/ops/health"), { ok: true });
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(root, { recursive: true, force: true });
    if (originalRoot === undefined) delete process.env.MENTIKO_GLOBAL_ROOT;
    else process.env.MENTIKO_GLOBAL_ROOT = originalRoot;
    if (originalToken === undefined) delete process.env.MENTIKO_SESSION_TOKEN;
    else process.env.MENTIKO_SESSION_TOKEN = originalToken;
  }
});
