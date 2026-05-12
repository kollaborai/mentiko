import { opsDelete, opsGet, opsPatch, opsPost } from "./ops-client.js";

export async function listApplications() {
  return await opsGet("/api/mentiko-mcp/ops/applications");
}

export async function registerApplication(input: Record<string, unknown>) {
  return await opsPost("/api/mentiko-mcp/ops/applications", input);
}

export async function updateApplication(input: Record<string, unknown>) {
  return await opsPatch("/api/mentiko-mcp/ops/applications", input);
}

export async function deleteApplication(id: string) {
  return await opsDelete("/api/mentiko-mcp/ops/applications", { id });
}
