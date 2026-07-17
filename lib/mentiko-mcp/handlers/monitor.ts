import { opsGet } from "./ops-client.js";

/**
 * The Mentiko Monitor's aggregated system digest plus the user-editable
 * monitor directives (persona + report style) in a single call.
 */
export async function getSystemStatus() {
  return await opsGet("/api/mentiko-mcp/ops/monitor/status");
}
