import { opsGet, opsPost } from "./ops-client.js";

export async function listTerminalSessions() {
  return await opsGet("/api/mentiko-mcp/ops/terminal?action=list");
}

export async function readTerminal(session: string, lines = 50) {
  return await opsGet(
    `/api/mentiko-mcp/ops/terminal?action=read&session=${encodeURIComponent(session)}&lines=${lines}`,
  );
}

export async function sendCommand(session: string, command: string) {
  return await opsPost("/api/mentiko-mcp/ops/terminal", {
    action: "send",
    session,
    command,
  });
}
