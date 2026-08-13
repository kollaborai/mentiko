#!/usr/bin/env node
/**
 * opsRequest is the CLI's only HTTP boundary to /api/mentiko-mcp/ops/*.
 * The behaviour that cannot be checked by reading the code is the 401 path:
 * a rejected-but-unexpired token must trigger exactly ONE forced refresh and
 * ONE retry — not zero (the command fails for a recoverable reason), and not a
 * loop (a revoked credential would hammer the server).
 *
 * Runs against a real loopback server, so the assertions are about observed
 * requests, not about intent.
 */
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const sandbox = mkdtempSync(join(tmpdir(), "mentiko-ops-client-"));
process.env.MENTIKO_GLOBAL_ROOT = sandbox;
delete process.env.MENTIKO_SESSION_TOKEN;

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (sub, offsetSeconds) =>
  `${b64({ alg: "HS256" })}.${b64({ sub, exp: Math.floor(Date.now() / 1000) + offsetSeconds })}.sig`;

const STALE = jwt("marco", 3600);   // unexpired locally, but the server rejects it
const FRESH = jwt("marco", 7200);

const mcpDir = join(sandbox, "mcp");
mkdirSync(mcpDir, { recursive: true, mode: 0o700 });
const sidecar = join(mcpDir, "session.json");
const seed = (value) =>
  writeFileSync(sidecar, JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });

// --- a server that rejects STALE once, mints FRESH, then accepts ------------

const seen = [];
const server = createServer((req, res) => {
  const auth = (req.headers.authorization || "").replace("Bearer ", "");
  seen.push({ url: req.url.split("?")[0], auth });

  if (req.url.startsWith("/api/mentiko-mcp/auth/token")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ session_token: FRESH, expires_in: 86400 }));
    return;
  }
  if (auth === FRESH) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ schedules: ["ok"] }));
    return;
  }
  res.writeHead(401, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "expired" }));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
process.env.MENTIKO_WEB_URL = `http://127.0.0.1:${server.address().port}`;

const { opsRequest, OpsError } = await import(join(import.meta.dirname, "..", "lib/mentiko-cli-auth.mjs"));

// --- 1. rejected token refreshes once and retries once ---------------------

seed({ session_token: STALE, refresh_token: "refresh-abc", updatedAt: Date.now() });
const result = await opsRequest("GET", "/api/mentiko-mcp/ops/schedules");
assert.deepEqual(result, { schedules: ["ok"] }, "a 401 must recover via refresh, not surface to the caller");

const opsCalls = seen.filter((s) => s.url.startsWith("/api/mentiko-mcp/ops/"));
const tokenCalls = seen.filter((s) => s.url.startsWith("/api/mentiko-mcp/auth/token"));
assert.equal(opsCalls.length, 2, `expected exactly one retry, saw ${opsCalls.length} ops calls`);
assert.equal(tokenCalls.length, 1, `expected exactly one refresh, saw ${tokenCalls.length}`);
assert.equal(opsCalls[0].auth, STALE, "first attempt uses the stored token");
assert.equal(opsCalls[1].auth, FRESH, "retry uses the refreshed token");

// --- 2. no refresh token: fail after one attempt, never loop ---------------

seen.length = 0;
seed({ session_token: STALE, updatedAt: Date.now() });
await assert.rejects(
  () => opsRequest("GET", "/api/mentiko-mcp/ops/schedules"),
  (e) => e instanceof OpsError && e.status === 401,
  "an unrecoverable 401 must raise OpsError, not hang or loop",
);
assert.equal(
  seen.filter((s) => s.url.startsWith("/api/mentiko-mcp/ops/")).length,
  1,
  "with no refresh token there must be exactly one attempt",
);

// --- 3. a refresh that returns the same token must not retry forever -------

seen.length = 0;
seed({ session_token: FRESH, refresh_token: "refresh-abc", updatedAt: Date.now() });
const server2Seen = seen;
await opsRequest("GET", "/api/mentiko-mcp/ops/schedules");
assert.equal(
  server2Seen.filter((s) => s.url.startsWith("/api/mentiko-mcp/ops/")).length,
  1,
  "a token the server accepts must not trigger a refresh at all",
);

// --- 4. timeout is bounded and reported, not hung -------------------------

const slow = createServer(() => { /* never responds */ });
await new Promise((r) => slow.listen(0, "127.0.0.1", r));
process.env.MENTIKO_WEB_URL = `http://127.0.0.1:${slow.address().port}`;
seed({ session_token: FRESH, updatedAt: Date.now() });
await assert.rejects(
  () => opsRequest("GET", "/api/mentiko-mcp/ops/schedules", { timeoutMs: 250 }),
  (e) => e instanceof OpsError && /timed out after 250ms/.test(e.message),
  "a hung server must surface a timeout, not block the CLI forever",
);

server.close();
slow.close();
console.log("cli ops client: 401 refresh-once, no-refresh single attempt, no needless refresh, bounded timeout");
