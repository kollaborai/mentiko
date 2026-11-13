#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPTS_DIR = join(REPO_ROOT, "scripts");
const MENTIKO_CLI = join(REPO_ROOT, "bin", "mentiko");
const EXAMPLE_CHAINS = readdirSync(SCRIPTS_DIR)
  .filter((file) => file.endsWith("-chain.json"))
  .sort();
const TEMP_GLOBAL_ROOT = mkdtempSync(join(tmpdir(), "mentiko-chain-validation-"));

after(() => rmSync(TEMP_GLOBAL_ROOT, { recursive: true, force: true }));

assert.ok(EXAMPLE_CHAINS.length > 0, "expected bundled example chain JSON files under scripts/");

for (const chainFile of EXAMPLE_CHAINS) {
  test(`${chainFile} passes mentiko validate`, () => {
    const result = spawnSync("/bin/bash", [MENTIKO_CLI, "validate", join(SCRIPTS_DIR, chainFile)], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        MENTIKO_CODE_ROOT: REPO_ROOT,
        MENTIKO_GLOBAL_ROOT: TEMP_GLOBAL_ROOT,
      },
    });

    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  });
}
