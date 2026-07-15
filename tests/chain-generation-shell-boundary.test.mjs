import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const source = readFileSync(join(root, "lib", "chain-generator.sh"), "utf8");
const withoutComments = source
  .replace(/^\s*#.*$/gm, "")
  .replace(/\s+/g, " ")
  .trim();

assert.match(withoutComments, /exec node .*runner-chain-generation\.js/);
assert.doesNotMatch(withoutComments, /\b(jq|sed|grep|awk|cat|tr|date)\b/);
assert.doesNotMatch(withoutComments, /\b(source|mkdir|while|for)\b/);
assert.doesNotMatch(withoutComments, /claude/);
assert.doesNotMatch(withoutComments, /fallback|compatibility/i);
execFileSync("bash", ["-n", join(root, "lib", "chain-generator.sh")]);

console.log("chain generation shell boundary: typed invocation-only adapter");
