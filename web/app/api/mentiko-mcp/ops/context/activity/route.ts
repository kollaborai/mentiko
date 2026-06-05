import { NextResponse } from "next/server";
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { requireOpsAuth } from "@/lib/ai-engine/mentiko-mcp-ops-auth";
import config from "@/lib/config";
import { getAllChains } from "@/lib/chains/chain-utils";
import { orgPath } from "@/lib/config";

export const dynamic = "force-dynamic";

/** GET /api/mentiko-mcp/ops/context/activity — last 5 runs + recent chains */
export async function GET(req: Request) {
  const ctx = await requireOpsAuth(req);
  if (ctx instanceof NextResponse) return ctx;

  const { namespaceId, orgId } = ctx;
  const runsDir = config.runsDir;

  // recent runs (last 5, newest first)
  const recentRuns: { id: string; chain: string; status: string; started: string }[] = [];
  if (existsSync(runsDir)) {
    const entries = readdirSync(runsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.startsWith("run-"))
      .sort((a, b) => b.name.localeCompare(a.name))
      .slice(0, 5);

    for (const entry of entries) {
      try {
        const metaPath = join(runsDir, entry.name, "run.json");
        if (existsSync(metaPath)) {
          const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
          recentRuns.push({
            id: meta.id || entry.name,
            chain: meta.chain || meta.chainId || "unknown",
            status: meta.status || "unknown",
            started: meta.started || "",
          });
        }
      } catch {
        // skip malformed run dirs
      }
    }
  }

  // recent chains (last 5 by mtime)
  const chainsDir = orgPath(namespaceId, orgId, "chains");
  let recentChains: { id: string; name: string }[] = [];
  try {
    const allChains = getAllChains(chainsDir, "claude", undefined, namespaceId, orgId);
    recentChains = allChains.slice(0, 5).map((c: any) => ({
      id: c.id || c.name,
      name: c.name,
    }));
  } catch {
    // chains dir may not exist
  }

  return NextResponse.json({ recentRuns, recentChains });
}
