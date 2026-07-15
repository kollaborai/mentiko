#!/usr/bin/env node
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { calculateNextRunSeconds, decodeEmbeddedSchedule, getScheduleState, initializeScheduleState, markScheduleRunEnd, markScheduleRunStart, scheduleDue, scheduleEnabled, scheduleRunning, setScheduleEnabled, setScheduleState, validateCron } from "@/lib/runner-v2/schedule-contract";

type Command = "field" | "validate-cron" | "next" | "state-init" | "state-get" | "state-set" | "enabled" | "set-enabled" | "running" | "due" | "mark-start" | "mark-end" | "list";

export function runScheduleContractCli(argv: string[], write: (line: string) => void = (line) => console.log(line)): void {
  const [command, ...rest] = argv;
  if (!isCommand(command)) throw new Error(usage());
  const values = parseValues(rest);
  switch (command) {
    case "field": {
      rejectUnexpected(values, new Set(["--chain-path", "--chain-dir", "--field"]));
      const schedule = decodeEmbeddedSchedule(required(values, "--chain-path"), required(values, "--chain-dir"));
      const field = required(values, "--field");
      if (!["cron", "timezone", "id", "name"].includes(field)) throw new Error("--field must be cron, timezone, id, or name");
      write(!schedule ? "" : field === "id" ? schedule.scheduleId : field === "name" ? schedule.chainName : field === "cron" ? schedule.cron : schedule.timezone);
      return;
    }
    case "validate-cron": {
      rejectUnexpected(values, new Set(["--cron"]));
      const cron = values.get("--cron");
      if (cron === undefined) throw new Error("--cron is required");
      const reason = validateCron(cron);
      if (reason) { write(`invalid: ${reason}`); throw new Error(`invalid: ${reason}`); }
      write("valid");
      return;
    }
    case "next": {
      rejectUnexpected(values, new Set(["--cron", "--after"]));
      write(String(calculateNextRunSeconds(required(values, "--cron"), integer(values, "--after", Math.floor(Date.now() / 1000)))));
      return;
    }
    case "state-init":
      rejectUnexpected(values, new Set(["--schedules-dir"]));
      initializeScheduleState(required(values, "--schedules-dir"));
      return;
    case "state-get":
      rejectUnexpected(values, new Set(["--schedules-dir", "--schedule-id"]));
      write(String(getScheduleState(required(values, "--schedules-dir"), required(values, "--schedule-id"))));
      return;
    case "state-set":
      rejectUnexpected(values, new Set(["--schedules-dir", "--schedule-id", "--timestamp"]));
      setScheduleState(required(values, "--schedules-dir"), required(values, "--schedule-id"), integer(values, "--timestamp", Math.floor(Date.now() / 1000)));
      return;
    case "enabled": {
      rejectUnexpected(values, new Set(["--chain-path", "--chain-dir", "--schedules-dir"]));
      const schedule = decodeEmbeddedSchedule(required(values, "--chain-path"), required(values, "--chain-dir"));
      write(schedule && scheduleEnabled(required(values, "--schedules-dir"), schedule) ? "true" : "false");
      return;
    }
    case "set-enabled": {
      rejectUnexpected(values, new Set(["--chain-path", "--chain-dir", "--schedules-dir", "--enabled"]));
      const schedule = decodeEmbeddedSchedule(required(values, "--chain-path"), required(values, "--chain-dir"));
      if (!schedule) throw new Error("Chain has no embedded schedule");
      const enabled = required(values, "--enabled");
      if (enabled !== "true" && enabled !== "false") throw new Error("--enabled must be true or false");
      setScheduleEnabled(required(values, "--schedules-dir"), schedule.scheduleId, enabled === "true");
      return;
    }
    case "running":
      rejectUnexpected(values, new Set(["--schedules-dir", "--schedule-id", "--now"]));
      write(scheduleRunning(required(values, "--schedules-dir"), required(values, "--schedule-id"), integer(values, "--now", Math.floor(Date.now() / 1000))) ? "true" : "false");
      return;
    case "due": {
      rejectUnexpected(values, new Set(["--chain-path", "--chain-dir", "--schedules-dir", "--now"]));
      const schedule = decodeEmbeddedSchedule(required(values, "--chain-path"), required(values, "--chain-dir"));
      write(schedule && scheduleDue(required(values, "--schedules-dir"), schedule, integer(values, "--now", Math.floor(Date.now() / 1000))) ? "true" : "false");
      return;
    }
    case "mark-start": {
      rejectUnexpected(values, new Set(["--chain-path", "--chain-dir", "--schedules-dir", "--pid", "--timestamp"]));
      const schedule = requireSchedule(values);
      markScheduleRunStart(required(values, "--schedules-dir"), schedule.scheduleId, integer(values, "--pid"), integer(values, "--timestamp", Math.floor(Date.now() / 1000)));
      return;
    }
    case "mark-end": {
      rejectUnexpected(values, new Set(["--chain-path", "--chain-dir", "--schedules-dir", "--status", "--timestamp"]));
      const schedule = requireSchedule(values);
      markScheduleRunEnd(required(values, "--schedules-dir"), schedule.scheduleId, required(values, "--status"), integer(values, "--timestamp", Math.floor(Date.now() / 1000)));
      return;
    }
    case "list": {
      rejectUnexpected(values, new Set(["--chain-dir", "--schedules-dir"]));
      write("scheduled chains:"); write("");
      for (const chainPath of findChainFiles(required(values, "--chain-dir"))) {
        const schedule = decodeEmbeddedSchedule(chainPath, required(values, "--chain-dir"));
        if (!schedule) continue;
        const lastRun = getScheduleState(required(values, "--schedules-dir"), schedule.scheduleId);
        const next = calculateNextRunSeconds(schedule.cron);
        write(`  ${schedule.chainName}`); write(`    schedule: ${schedule.cron}`); write(`    status:   ${scheduleEnabled(required(values, "--schedules-dir"), schedule) ? "enabled" : "disabled"}`); write(`    last:     ${lastRun ? new Date(lastRun * 1000).toISOString() : "never"}`); write(`    next:     ${next ? new Date(next * 1000).toISOString() : "unknown"}`); write("");
      }
      return;
    }
  }
}

function requireSchedule(values: Map<string, string>) { const schedule = decodeEmbeddedSchedule(required(values, "--chain-path"), required(values, "--chain-dir")); if (!schedule) throw new Error("Chain has no embedded schedule"); return schedule; }
function findChainFiles(dir: string): string[] { const output: string[] = []; for (const entry of readdirSync(dir, { withFileTypes: true })) { const path = join(dir, entry.name); if (entry.isDirectory()) output.push(...findChainFiles(path)); else if (entry.isFile() && entry.name === "chain.json") output.push(path); } return output; }
function parseValues(argv: string[]): Map<string, string> { const values = new Map<string, string>(); for (let i = 0; i < argv.length; i += 2) { const key = argv[i], value = argv[i + 1]; if (!key?.startsWith("--") || value === undefined || values.has(key)) throw new Error(usage()); values.set(key, value); } return values; }
function required(values: Map<string, string>, key: string): string { const value = values.get(key); if (!value) throw new Error(`${key} is required`); return value; }
function integer(values: Map<string, string>, key: string, fallback?: number): number { const value = values.get(key); if (value === undefined && fallback !== undefined) return fallback; if (value === undefined || !/^\d+$/.test(value)) throw new Error(`${key} must be a non-negative integer`); const result = Number(value); if (!Number.isSafeInteger(result)) throw new Error(`${key} must be a safe integer`); return result; }
function rejectUnexpected(values: Map<string, string>, allowed: Set<string>): void { for (const key of values.keys()) if (!allowed.has(key)) throw new Error(`${key} is not valid for runner-schedule-contract`); }
function isCommand(value: string | undefined): value is Command { return ["field", "validate-cron", "next", "state-init", "state-get", "state-set", "enabled", "set-enabled", "running", "due", "mark-start", "mark-end", "list"].includes(value || ""); }
function usage(): string { return "usage: runner-schedule-contract <field|validate-cron|next|state-init|state-get|state-set|enabled|set-enabled|running|due|mark-start|mark-end|list> [options]"; }

if (require.main === module) { try { runScheduleContractCli(process.argv.slice(2)); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; } }
