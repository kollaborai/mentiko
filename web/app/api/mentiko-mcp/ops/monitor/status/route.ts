import { NextResponse } from "next/server";
import { requireOpsAuth } from "@/lib/ai-engine/mentiko-mcp-ops-auth";
import { buildMonitorStatusDigest } from "@/lib/monitor/status-digest";
import { getMonitorPrompt } from "@/lib/monitor/monitor-prompt-storage";

export const dynamic = "force-dynamic";

/**
 * GET /api/mentiko-mcp/ops/monitor/status — the get_system_status MCP tool.
 * One call hands the agent the full digest plus the user-editable monitor
 * directives, so persona and data always travel together.
 */
export async function GET(req: Request) {
  const ctx = await requireOpsAuth(req);
  if (ctx instanceof NextResponse) return ctx;

  const { namespaceId, orgId } = ctx;
  const digest = await buildMonitorStatusDigest(namespaceId, orgId);
  const directives = {
    persona: getMonitorPrompt(namespaceId, orgId, "monitor_persona").content,
    statusReport: getMonitorPrompt(namespaceId, orgId, "monitor_status_report").content,
  };

  return NextResponse.json({ digest, directives });
}
