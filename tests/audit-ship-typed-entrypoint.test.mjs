import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const source = readFileSync(join(root, "web", "lib", "system", "audit-log.ts"), "utf8");

assert.match(source, /join\(config\.codeRoot, "lib", "runner-audit-ship\.js"\)/);
assert.match(source, /spawn\(process\.execPath, \[shipper, "ship"\]/);
assert.doesNotMatch(source, /audit-ship\.sh/);
assert.doesNotMatch(source, /spawn\("bash", \[shipper\]/);

console.log("audit ship entrypoint: audit writer launches typed bundle directly");
