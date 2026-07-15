#!/usr/bin/env node
import {
  buildAgentProfileCommand,
  loadAgentProfile,
  profileTranscriptConfig,
  resolveAgentProfile,
  resolveDefaultProfile,
  resolveExactProfile,
} from "@/lib/runner-v2/agent-profile";
import { writeFileSync } from "node:fs";

type Command = "resolve" | "resolve-field" | "default" | "advisor" | "advisor-field" | "select" | "select-field" | "command" | "transcript" | "transcript-field" | "field" | "snapshot";

export function runRunnerAgentProfileCli(
  argv: string[],
  write: (line: string) => void = (line) => console.log(line),
): void {
  const [command, ...rest] = argv;
  if (!isCommand(command)) throw new Error(usage());
  const values = parseValues(rest);
  switch (command) {
    case "resolve": {
      rejectUnexpected(values, new Set(["--chain-path", "--agent-id", "--project-root", "--profiles-dir", "--org-root"]));
      const result = resolveAgentProfile({
        chainPath: required(values, "--chain-path"),
        agentId: required(values, "--agent-id"),
        projectRoot: optional(values, "--project-root"),
        profilesDir: required(values, "--profiles-dir"),
        orgRoot: optional(values, "--org-root"),
      });
      write(JSON.stringify(result ? publicProfile(result) : null));
      return;
    }
    case "resolve-field": {
      rejectUnexpected(values, new Set(["--chain-path", "--agent-id", "--project-root", "--profiles-dir", "--org-root", "--field"]));
      const result = resolveAgentProfile({
        chainPath: required(values, "--chain-path"), agentId: required(values, "--agent-id"),
        projectRoot: optional(values, "--project-root"), profilesDir: required(values, "--profiles-dir"), orgRoot: optional(values, "--org-root"),
      });
      const field = required(values, "--field");
      if (field !== "id" && field !== "path" && field !== "source") throw new Error("--field must be id, path, or source");
      write(result ? String(publicProfile(result)[field] || "") : "");
      return;
    }
    case "default":
    case "advisor": {
      rejectUnexpected(values, new Set(["--profiles-dir"]));
      const result = resolveDefaultProfile(required(values, "--profiles-dir"), command === "advisor" ? "advisor" : "namespace");
      write(JSON.stringify(result ? publicProfile(result) : null));
      return;
    }
    case "advisor-field": {
      rejectUnexpected(values, new Set(["--profiles-dir", "--field"]));
      const field = required(values, "--field");
      if (field !== "id" && field !== "path") throw new Error("--field must be id or path");
      const result = resolveDefaultProfile(required(values, "--profiles-dir"), "advisor");
      write(result ? String(publicProfile(result)[field]) : "");
      return;
    }
    case "select": {
      rejectUnexpected(values, new Set(["--profiles-dir", "--profile-id"]));
      write(JSON.stringify(publicProfile(resolveExactProfile(required(values, "--profiles-dir"), required(values, "--profile-id")))));
      return;
    }
    case "select-field": {
      rejectUnexpected(values, new Set(["--profiles-dir", "--profile-id", "--field"]));
      const field = required(values, "--field");
      if (field !== "id" && field !== "path" && field !== "source") throw new Error("--field must be id, path, or source");
      const result = resolveExactProfile(required(values, "--profiles-dir"), required(values, "--profile-id"));
      write(String(publicProfile(result)[field] || ""));
      return;
    }
    case "command": {
      rejectUnexpected(values, new Set(["--profile-path", "--interactive", "--namespace-id", "--org-id", "--model", "--purpose"]));
      const purpose = optional(values, "--purpose");
      if (purpose !== undefined && purpose !== "agent" && purpose !== "relay") throw new Error("--purpose must be agent or relay");
      write(buildAgentProfileCommand({
        profilePath: required(values, "--profile-path"),
        interactive: optional(values, "--interactive") === "true",
        namespaceId: required(values, "--namespace-id"),
        orgId: required(values, "--org-id"),
        modelOverride: optional(values, "--model"),
        purpose: purpose === "relay" ? "relay" : "agent",
      }));
      return;
    }
    case "transcript": {
      rejectUnexpected(values, new Set(["--profile-path"]));
      write(JSON.stringify(profileTranscriptConfig(required(values, "--profile-path"))));
      return;
    }
    case "transcript-field": {
      rejectUnexpected(values, new Set(["--profile-path", "--field"]));
      const field = required(values, "--field");
      if (field !== "cli" && field !== "logPath") throw new Error("--field must be cli or logPath");
      const transcript = profileTranscriptConfig(required(values, "--profile-path"));
      write(typeof transcript[field] === "string" ? transcript[field] : "");
      return;
    }
    case "field": {
      rejectUnexpected(values, new Set(["--profile-path", "--field"]));
      const field = required(values, "--field");
      if (field !== "cli") throw new Error("--field must be cli");
      const profile = loadAgentProfile(required(values, "--profile-path"));
      const cli = (profile as { cli?: unknown }).cli;
      write(typeof cli === "string" ? cli : "");
      return;
    }
    case "snapshot": {
      rejectUnexpected(values, new Set(["--output-path", "--agent-id", "--profile-id", "--profile-source", "--profile-file", "--cli", "--session", "--timestamp"]));
      writeFileSync(required(values, "--output-path"), `${JSON.stringify({
        agent_id: required(values, "--agent-id"), profile_id: optional(values, "--profile-id") || "",
        profile_source: optional(values, "--profile-source") || "", profile_file: optional(values, "--profile-file") || "",
        cli: optional(values, "--cli") || "", session: required(values, "--session"), timestamp: required(values, "--timestamp"),
      }, null, 2)}\n`, { mode: 0o600 });
      return;
    }
  }
}

function publicProfile(result: ReturnType<typeof loadAgentProfile> & { source?: string }) {
  return { id: result.id, name: result.name, path: result.path, ...(result.source ? { source: result.source } : {}) };
}

function parseValues(argv: string[]): Map<string, string> {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined || values.has(key)) throw new Error(usage());
    values.set(key, value);
  }
  return values;
}

function required(values: Map<string, string>, key: string): string {
  const value = values.get(key);
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function optional(values: Map<string, string>, key: string): string | undefined {
  return values.get(key);
}

function rejectUnexpected(values: Map<string, string>, allowed: Set<string>): void {
  for (const key of values.keys()) if (!allowed.has(key)) throw new Error(`${key} is not valid for runner-agent-profile`);
}

function isCommand(value: string | undefined): value is Command {
  return value === "resolve" || value === "resolve-field" || value === "default" || value === "advisor" || value === "advisor-field" || value === "select" || value === "select-field" || value === "command" || value === "transcript" || value === "transcript-field" || value === "field" || value === "snapshot";
}

function usage(): string {
  return "usage: runner-agent-profile <resolve|resolve-field|default|advisor|advisor-field|select|select-field|command|transcript|transcript-field|field|snapshot> [options]";
}

if (require.main === module) {
  try {
    runRunnerAgentProfileCli(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
