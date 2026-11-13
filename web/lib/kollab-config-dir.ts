import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Kollab's global config dir, as the kollabor engine resolves it:
 * $KOLLAB_CONFIG_DIR when set, else ~/.kollab. Mentiko dev sets
 * KOLLAB_CONFIG_DIR (see lib/process-manager.ts) so its engine token,
 * MCP settings and profiles never overwrite a standalone kollab's.
 */
export function kollabConfigDir(): string {
  return process.env.KOLLAB_CONFIG_DIR?.trim() || join(homedir(), ".kollab");
}
