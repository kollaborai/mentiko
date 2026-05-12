import { opsDelete, opsGet, opsPatch, opsPost } from "./ops-client.js";

export async function listSchedules() {
  return await opsGet("/api/mentiko-mcp/ops/schedules");
}

export async function createSchedule(input: Record<string, unknown>) {
  return await opsPost("/api/mentiko-mcp/ops/schedules", input);
}

export async function updateSchedule(input: Record<string, unknown>) {
  return await opsPatch("/api/mentiko-mcp/ops/schedules", input);
}

export async function deleteSchedule(id: string) {
  return await opsDelete("/api/mentiko-mcp/ops/schedules", { id });
}

export async function runScheduleNow(id: string) {
  return await opsPost("/api/mentiko-mcp/ops/schedules/run", { id }, { timeoutMs: 130_000 });
}
