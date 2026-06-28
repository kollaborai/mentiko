import { NextResponse } from "next/server";
import { requireOpsAuth } from "@/lib/ai-engine/mentiko-mcp-ops-auth";

export const dynamic = "force-dynamic";

interface SettingsPage {
  route: string;
  label: string;
  description: string;
  category: "profile" | "access" | "workspace" | "organization" | "system" | "data" | "ai" | "integrations";
}

const SETTINGS_PAGES: SettingsPage[] = [
  // profile
  { route: "/settings", label: "Overview", description: "settings overview and account summary", category: "profile" },
  { route: "/settings/account", label: "Account", description: "profile, name, email, password", category: "profile" },
  { route: "/settings/appearance", label: "Appearance", description: "theme and display preferences", category: "profile" },
  { route: "/settings/pill-nav", label: "Navigation Bar", description: "floating navigation bar preferences", category: "profile" },
  { route: "/settings/notifications", label: "Notifications", description: "email, slack, webhook, and push preferences", category: "profile" },

  // access
  { route: "/settings/security", label: "Security", description: "2FA, active sessions, password reset", category: "access" },
  { route: "/settings/sessions", label: "Sessions", description: "active browser and auth sessions", category: "access" },
  { route: "/settings/ssh-keys", label: "SSH Keys", description: "SSH key management for remote workspaces", category: "access" },
  { route: "/settings/secrets", label: "Secrets", description: "encrypted API keys and credentials", category: "workspace" },

  // workspace + execution
  { route: "/settings/agent-configs", label: "Agent Configs", description: "CLI execution configurations", category: "workspace" },
  { route: "/settings/mentiko-agent", label: "Mentiko Agent", description: "Mentiko agent behavior and defaults", category: "workspace" },
  { route: "/settings/decisions", label: "Decisions", description: "decision workflow settings", category: "workspace" },

  // integrations
  { route: "/settings/email", label: "Email", description: "inbound/outbound email integration", category: "integrations" },

  // ai + generation
  { route: "/settings/generation", label: "Generation", description: "AI generation templates", category: "ai" },

  // data
  { route: "/settings/artifacts", label: "Artifacts", description: "artifact storage settings", category: "data" },
  { route: "/settings/data", label: "Data", description: "data management, export", category: "data" },
  { route: "/settings/organization", label: "Organization", description: "org settings, members, invites", category: "organization" },

  // system
  { route: "/settings/system", label: "System", description: "diagnostics, version, health", category: "system" },
  { route: "/settings/logs", label: "Logs", description: "system log viewer", category: "system" },
  { route: "/settings/audit", label: "Audit Trail", description: "security and system audit events", category: "system" },
  { route: "/settings/pty", label: "PTY Sessions", description: "active PTY session management and pty-manager configuration", category: "system" },
  { route: "/settings/mcp", label: "MCP", description: "MCP server and client configuration", category: "system" },
  { route: "/settings/metrics", label: "Metrics", description: "usage stats, performance charts", category: "system" },
  { route: "/settings/agent-health", label: "Agent Health", description: "agent health monitoring", category: "system" },
  { route: "/settings/performance", label: "Performance", description: "performance monitoring", category: "system" },
];

/** GET /api/mentiko-mcp/ops/meta/settings — list all settings pages */
export async function GET(req: Request) {
  const ctx = await requireOpsAuth(req);
  if (ctx instanceof NextResponse) return ctx;

  return NextResponse.json({ pages: SETTINGS_PAGES });
}
