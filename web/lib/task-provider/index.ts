/**
 * Task provider factory.
 * Instantiates the correct provider based on the workspace config.
 * Resolves {secret:NAME} references before passing credentials to providers.
 */

import type { TaskProvider, TaskProviderConfig, TaskProviderType } from "./types";
export type { TaskProvider, TaskProviderConfig, TaskProviderType, TaskProviderMeta } from "./types";
export { TASK_PROVIDER_META, isTaskProviderType } from "./types";
import { NativeTaskProvider } from "./native";
import { LinearTaskProvider } from "./linear";
import { NotionTaskProvider } from "./notion";
import { MondayTaskProvider } from "./monday";
import { JiraTaskProvider } from "./jira";
import { getSecretByName } from "@/lib/secrets/secrets-store";

const SECRET_REF_PATTERN = /^\{secret:([^}]+)\}$/;

/**
 * Resolve secret references in credential values.
 * Supports {secret:NAME} syntax. Falls back to direct value for migration compatibility.
 * @throws Error if referenced secret is not found
 */
function resolveSecretReferences(
  creds: Record<string, string> | undefined,
  nsId: string,
  orgId: string
): Record<string, string> {
  if (!creds) return {};

  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(creds)) {
    const match = value.match(SECRET_REF_PATTERN);
    if (match) {
      const secretName = match[1];
      const secretValue = getSecretByName(nsId, orgId, secretName);
      if (secretValue === null) {
        throw new Error(`Secret not found: ${secretName}`);
      }
      resolved[key] = secretValue;
    } else {
      // Direct value (backward compatibility for migration)
      resolved[key] = value;
    }
  }
  return resolved;
}

export function createTaskProvider(
  config?: TaskProviderConfig,
  nsId?: string,
  orgId?: string,
  _cwd?: string
): TaskProvider {
  if (!config || config.type === "native") {
    return new NativeTaskProvider(orgId, nsId);
  }

  // Resolve secret references if namespace/org provided
  const creds = (nsId && orgId)
    ? resolveSecretReferences(config.credentials, nsId, orgId)
    : config.credentials ?? {};

  const opts = config.options;

  switch (config.type) {
    case "linear":
      return new LinearTaskProvider(creds, opts);
    case "notion":
      return new NotionTaskProvider(creds, opts);
    case "monday":
      return new MondayTaskProvider(creds, opts);
    case "jira":
      return new JiraTaskProvider(creds, opts);
    default: {
      const _exhaustive: never = config.type;
      console.warn(`[task-provider] Unknown provider type: ${_exhaustive}, falling back to native`);
      return new NativeTaskProvider(orgId, nsId);
    }
  }
}

/** Check if a provider type has a full implementation (not just a stub) */
export function isProviderImplemented(type: TaskProviderType): boolean {
  return type === "native" || type === "linear";
}
