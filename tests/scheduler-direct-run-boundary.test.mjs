#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const service = readFileSync(join(root, "web/lib/schedules/scheduler-service.ts"), "utf8");
const route = readFileSync(join(root, "web/app/api/schedules/route.ts"), "utf8");
const launcher = readFileSync(join(root, "web/lib/schedules/direct-run-launch.ts"), "utf8");

for (const [name, source] of [["scheduler service", service], ["schedule trigger route", route]]) {
  if (source.includes("chain-runner.sh")) throw new Error(`${name} must not launch chain-runner`);
  if (!source.includes('"runner-v2-direct-run.js"')) throw new Error(`${name} must select the compiled typed direct-run runtime`);
  if (!source.includes("launchDetachedDirectRun")) throw new Error(`${name} must use the shared direct Node launch boundary`);
}
if (!launcher.includes("spawn(process.execPath") || !launcher.includes("detached: true") || !launcher.includes('stdio: "ignore"')) throw new Error("shared launch boundary must directly preserve detached Node semantics");

console.log("scheduler direct-run boundary: typed detached launch only");
