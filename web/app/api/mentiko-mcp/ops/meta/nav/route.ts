import { NextResponse } from "next/server";
import { requireOpsAuth } from "@/lib/ai-engine/mentiko-mcp-ops-auth";

export const dynamic = "force-dynamic";

interface NavChild {
  href: string;
  label: string;
}

interface NavCategory {
  key: string;
  label: string;
  href: string;
  color: string;
  children: NavChild[];
}

// Extracted from web/components/floating-pill-nav.tsx CATEGORIES array
const NAV_STRUCTURE: NavCategory[] = [
  {
    key: "home",
    label: "mentiko",
    href: "/dashboard",
    color: "#f59e0b",
    children: [
      { href: "/updates", label: "Updates" },
      { href: "/docs", label: "Docs" },
    ],
  },
  {
    key: "workspace",
    label: "Workspace",
    href: "/runs",
    color: "#5b9ef5",
    children: [
      { href: "/tasks", label: "Tasks" },
      { href: "/conversations", label: "Chat" },
      { href: "/tasks?type=decision", label: "Decisions" },
      { href: "/activity", label: "Activity" },
      { href: "/schedules", label: "Schedules" },
    ],
  },
  {
    key: "workflows",
    label: "Workflows",
    href: "/chains",
    color: "#b07ee8",
    children: [
      { href: "/links", label: "Links" },
      { href: "/agents", label: "Agents" },
      { href: "/artifacts", label: "Artifacts" },
      { href: "/generation", label: "Generation" },
      { href: "/schedules", label: "Schedules" },
      { href: "/email", label: "Email" },
      { href: "/webhooks", label: "Webhooks" },
      { href: "/events", label: "Events" },
    ],
  },
  {
    key: "marketplace",
    label: "Marketplace",
    href: "/marketplace",
    color: "#5cb88a",
    children: [
      { href: "/marketplace/templates", label: "Templates" },
      { href: "/marketplace/chains", label: "Chains" },
      { href: "/marketplace/agents", label: "Agents" },
      { href: "/marketplace/artifacts", label: "Artifacts" },
      { href: "/marketplace/plugins", label: "Plugins" },
    ],
  },
  {
    key: "settings",
    label: "Settings",
    href: "/settings",
    color: "#a0927b",
    children: [],
  },
];

/** GET /api/mentiko-mcp/ops/meta/nav — return the nav structure */
export async function GET(req: Request) {
  const ctx = await requireOpsAuth(req);
  if (ctx instanceof NextResponse) return ctx;

  return NextResponse.json({ categories: NAV_STRUCTURE });
}
