#!/usr/bin/env node
/**
 * The CLI and the MCP bridge share one credential file. If either side changes
 * the path, the shape, or the precedence, authorizing in one stops working for
 * the other — silently, because both treat an unreadable sidecar as "absent".
 *
 * This asserts the contract from both directions: the CLI's resolver honours
 * the documented precedence, and its path/shape still match what
 * lib/mentiko-mcp/handlers/session-store.ts reads.
 */
import { mkdtempSync, mkdirSync, writeFileSync, statSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const root = join(import.meta.dirname, "..");

// --- 1. the CLI resolver's precedence and refresh behaviour -----------------

const sandbox = mkdtempSync(join(tmpdir(), "mentiko-cli-auth-"));
process.env.MENTIKO_GLOBAL_ROOT = sandbox;
delete process.env.MENTIKO_SESSION_TOKEN;

const { resolveToken } = await import(join(root, "lib/mentiko-cli-auth.mjs"));

assert.equal(await resolveToken(), "", "no credential anywhere must resolve to empty, not throw");

// A sidecar written exactly as session-store.ts writeTyped produces it.
function jwt(claims) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "HS256" })}.${b64(claims)}.sig`;
}
const future = Math.floor(Date.now() / 1000) + 3600;
const past = Math.floor(Date.now() / 1000) - 3600;

const mcpDir = join(sandbox, "mcp");
mkdirSync(mcpDir, { recursive: true, mode: 0o700 });
const sidecar = join(mcpDir, "session.json");
const write = (value) =>
  writeFileSync(sidecar, JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });

write({ session_token: jwt({ sub: "marco", ns: "default", org: "default", exp: future }), updatedAt: Date.now() });
assert.equal(
  await resolveToken(),
  JSON.parse(readFileSync(sidecar, "utf8")).session_token,
  "a valid stored access token must be returned",
);

process.env.MENTIKO_SESSION_TOKEN = "injected-token";
assert.equal(
  await resolveToken(),
  "injected-token",
  "an injected token must win over the sidecar — agent runs and CI depend on this",
);
delete process.env.MENTIKO_SESSION_TOKEN;

// Expired access token with no refresh token must not be handed out.
write({ session_token: jwt({ sub: "marco", exp: past }), updatedAt: Date.now() });
assert.equal(await resolveToken(), "", "an expired token with no refresh must resolve to empty");

// A corrupt sidecar is untrusted, never fatal.
writeFileSync(sidecar, "{ not json", "utf8");
assert.equal(await resolveToken(), "", "a corrupt sidecar must be treated as absent, not throw");

// --- 2. the shape/path still match what the MCP bridge reads ---------------

const store = readFileSync(join(root, "lib/mentiko-mcp/handlers/session-store.ts"), "utf8");
const cli = readFileSync(join(root, "lib/mentiko-cli-auth.mjs"), "utf8");

for (const token of ['join(globalRoot, "mcp")', '"session.json"', '"pending-device.json"']) {
  assert.ok(store.includes(token), `session-store.ts should still derive ${token}`);
  assert.ok(cli.includes(token), `mentiko-cli-auth.mjs must derive the same ${token}`);
}
assert.ok(
  store.includes("MENTIKO_GLOBAL_ROOT") && cli.includes("MENTIKO_GLOBAL_ROOT"),
  "both sides must root the credential at MENTIKO_GLOBAL_ROOT",
);
assert.ok(
  store.includes("refresh_token") && store.includes("session_token") &&
  cli.includes("refresh_token") && cli.includes("session_token"),
  "both sides must use the {refresh_token, session_token} shape",
);
for (const mode of ["0o700", "0o600"]) {
  assert.ok(cli.includes(mode), `mentiko-cli-auth.mjs must preserve ${mode} permissions`);
}

// The written file must actually be 0600 — a credential, not a public file.
write({ session_token: jwt({ sub: "marco", exp: future }), updatedAt: Date.now() });
assert.equal(statSync(sidecar).mode & 0o777, 0o600, "sidecar must be 0600 on disk");

console.log("cli auth sidecar contract: precedence, refresh-absence, corruption, shape, 0600");
