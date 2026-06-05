import { NextResponse } from "next/server";
import { requireOpsAuth } from "@/lib/ai-engine/mentiko-mcp-ops-auth";

export const dynamic = "force-dynamic";

interface SettingsPage {
  route: string;
  label: string;
  description: string;
  category: "account" | "workspace" | "system" | "billing" | "integrations" | "data" | "ai";
}

const SETTINGS_PAGES: SettingsPage[] = [
  // account
  { route: "/settings/account", label: "Account", description: "profile, name, email, password", category: "account" },
  { route: "/settings/security", label: "Security", description: "2FA, active sessions, password reset", category: "account" },
  { route: "/settings/appearance", label: "Appearance", description: "theme, display preferences", category: "account" },
  { route: "/settings/notifications", label: "Notifications", description: "email, slack, webhook, push preferences", category: "account" },
  { route: "/settings/ssh-keys", label: "SSH Keys", description: "SSH key management for remote workspaces", category: "account" },

  // workspace + execution
  { route: "/settings/secrets", label: "Secrets", description: "encrypted API keys and credentials", category: "workspace" },
  { route: "/settings/agent-configs", label: "Agent Configs", description: "CLI execution configurations", category: "workspace" },
  { route: "/settings/run-profiles", label: "Run Profiles", description: "execution, model, workspace, retry, gateway", category: "workspace" },
  { route: "/settings/agent-health", label: "Agent Health", description: "agent health monitoring", category: "workspace" },
  { route: "/settings/sessions", label: "PTY Sessions", description: "active PTY session management", category: "workspace" },
  { route: "/settings/pty", label: "PTY Settings", description: "pty-manager configuration", category: "workspace" },

  // integrations
  { route: "/settings/email", label: "Email", description: "inbound/outbound email integration", category: "integrations" },
  { route: "/settings/api-keys", label: "API Keys", description: "API key management", category: "integrations" },

  // ai + generation
  { route: "/settings/generation", label: "Generation", description: "AI generation templates", category: "ai" },

  // data
  { route: "/settings/artifacts", label: "Artifacts", description: "artifact storage settings", category: "data" },
  { route: "/settings/data", label: "Data", description: "data management, export", category: "data" },

  // system
  { route: "/settings/system", label: "System", description: "diagnostics, version, health", category: "system" },
  { route: "/settings/logs", label: "Logs", description: "system log viewer", category: "system" },
  { route: "/settings/metrics", label: "Metrics", description: "usage stats, performance charts", category: "system" },
  { route: "/settings/performance", label: "Performance", description: "performance monitoring", category: "system" },
  { route: "/settings/billing", label: "Billing", description: "plan, billing info, subscription", category: "billing" },
  { route: "/settings/organization", label: "Organization", description: "org settings, members, invites", category: "system" },
];

/** GET /api/mentiko-mcp/ops/meta/settings — list all settings pages */
export async function GET(req: Request) {
  const ctx = await requireOpsAuth(req);
  if (ctx instanceof NextResponse) return ctx;

  return NextResponse.json({ pages: SETTINGS_PAGES });
}
