import { NextResponse } from "next/server";
import { requireOpsAuth } from "@/lib/mentiko-mcp-ops-auth";

export const dynamic = "force-dynamic";

interface DocArticle {
  route: string;
  title: string;
  description: string;
  tags: string[];
}

const DOCS_ARTICLES: DocArticle[] = [
  { route: "/docs/getting-started", title: "Getting Started", description: "first chain, first run, CLI setup", tags: ["onboarding", "beginner"] },
  { route: "/docs/chains", title: "Chains", description: "chain format, agents, events, routing", tags: ["workflows", "core"] },
  { route: "/docs/agents", title: "Agents", description: "agent definition, profiles, providers", tags: ["workflows", "core"] },
  { route: "/docs/runs", title: "Runs", description: "execution, output, artifacts, resume", tags: ["execution"] },
  { route: "/docs/schedules", title: "Schedules", description: "cron syntax, timezone, snooze", tags: ["automation", "timing"] },
  { route: "/docs/events", title: "Events", description: "event system, built-in events, custom", tags: ["workflows", "core"] },
  { route: "/docs/decisions", title: "Decisions", description: "guided flow, rounds, approval, tasks", tags: ["workflows", "advanced"] },
  { route: "/docs/email", title: "Email", description: "inbound/outbound, routing, triggers", tags: ["integrations"] },
  { route: "/docs/webhooks", title: "Webhooks", description: "outbound, inbound, HMAC, retries", tags: ["integrations"] },
  { route: "/docs/artifacts", title: "Artifacts", description: "agent outputs, diff, conversations", tags: ["execution", "output"] },
  { route: "/docs/tasks", title: "Tasks", description: "task lifecycle, epics, auto-run", tags: ["workflows"] },
  { route: "/docs/notifications", title: "Notifications", description: "channels, categories, quiet hours", tags: ["configuration"] },
  { route: "/docs/templates", title: "Templates", description: "marketplace, clone, placeholders", tags: ["workflows"] },
  { route: "/docs/workspaces", title: "Workspaces", description: "local, ssh, docker, config profiles", tags: ["execution", "infrastructure"] },
  { route: "/docs/api", title: "API Reference", description: "REST API reference", tags: ["advanced", "api"] },
  { route: "/docs/architecture", title: "Architecture", description: "4-layer architecture, data hierarchy", tags: ["advanced", "infrastructure"] },
  { route: "/docs/security", title: "Security", description: "auth, RBAC, secrets, token handling, organizations", tags: ["advanced", "security", "orgs", "namespaces"] },
  { route: "/docs/troubleshooting", title: "Troubleshooting", description: "common failures, debug patterns", tags: ["help", "debugging"] },
  { route: "/docs/metrics", title: "Metrics", description: "usage stats, token costs, performance", tags: ["monitoring"] },
];

/** GET /api/mentiko-mcp/ops/meta/docs — list all documentation articles */
export async function GET(req: Request) {
  const ctx = await requireOpsAuth(req);
  if (ctx instanceof NextResponse) return ctx;

  return NextResponse.json({ articles: DOCS_ARTICLES });
}
