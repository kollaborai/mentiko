#!/usr/bin/env node
// Static regression guard for smoke auth checks.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(new URL("../..", import.meta.url).pathname);
const simple = readFileSync(resolve(root, "scripts/smoke-test.sh"), "utf8");
const advanced = readFileSync(resolve(root, "scripts/smoke-test-advanced.mjs"), "utf8");

assert.match(simple, /MENTIKO_ALLOW_DEV_AUTH_BYPASS/);
assert.match(advanced, /MENTIKO_ALLOW_DEV_AUTH_BYPASS/);
assert.doesNotMatch(simple, /status === 401 \|\| status === 200/);
assert.doesNotMatch(advanced, /response\.status === shouldBe \|\| response\.status === 200/);

const authApiScript = simple.slice(simple.indexOf('auth-api-test.mjs'));
assert.match(authApiScript, /const ALLOW_DEV_AUTH_BYPASS = process\.env\.MENTIKO_ALLOW_DEV_AUTH_BYPASS/);
assert.ok(
  authApiScript.indexOf("const ALLOW_DEV_AUTH_BYPASS") < authApiScript.indexOf("ALLOW_DEV_AUTH_BYPASS && status === 200"),
  "auth-api-test.mjs must define ALLOW_DEV_AUTH_BYPASS before using it"
);

console.log("  ok  smoke auth checks require explicit dev bypass for unauthenticated 200");
