import { readFileSync } from "fs";
import { join } from "path";
import config from "./config";

let chainSchemaCache: string | null = null;
let agentSchemaCache: string | null = null;
let taskSchemaCache: string | null = null;

export function getChainSchema(): string {
  if (!chainSchemaCache) {
    const schemaPath = join(config.root, "lib", "schemas", "chain.schema.json");
    chainSchemaCache = readFileSync(schemaPath, "utf-8");
  }
  return chainSchemaCache;
}

export function getAgentSchema(): string {
  if (!agentSchemaCache) {
    const schemaPath = join(config.root, "lib", "schemas", "agent.schema.json");
    agentSchemaCache = readFileSync(schemaPath, "utf-8");
  }
  return agentSchemaCache;
}

export function getTaskSchema(): string {
  if (!taskSchemaCache) {
    const schemaPath = join(config.root, "lib", "schemas", "task.schema.json");
    taskSchemaCache = readFileSync(schemaPath, "utf-8");
  }
  return taskSchemaCache;
}
