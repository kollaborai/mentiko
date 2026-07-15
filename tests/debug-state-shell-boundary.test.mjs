#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const runLib = readFileSync(join(root, "lib", "run-lib.sh"), "utf8");
const route = readFileSync(join(root, "web", "app", "api", "chains", "[id]", "debug", "route.ts"), "utf8");

if (!runLib.includes("runner-debug-state.js")) throw new Error("run-lib must invoke the compiled debug-state boundary");
const debugSection = runLib.slice(runLib.indexOf("_debug_state_cli()"), runLib.indexOf("# export functions"));
if (/\b(jq|cat|mv|rm)\b/.test(debugSection)) throw new Error("run-lib debug helpers must not parse or mutate debug JSON in shell");
if (!route.includes("loadDebugState") || !route.includes("mutateDebugState") || !route.includes("clearDebugState")) throw new Error("debug API must use the typed debug-state owner");
if (/JSON\.parse\(readFileSync\([^\n]*debug/i.test(route)) throw new Error("debug API must not parse the persisted debug record directly");
console.log("PASS: debug state persistence has one typed owner");
