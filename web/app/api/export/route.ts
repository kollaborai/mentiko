import { NextRequest, NextResponse } from "next/server";
import { checkAuth } from "@/lib/api-auth";
import { getNamespaceConfig } from "@/lib/namespace-config";
import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import JSZip from "jszip";
import { Unauthorized } from "@/lib/api-errors";
import { withErrorHandling } from "@/lib/api-response";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const { chainsDir, agentsDir, runsDir, namespaceId } = await getNamespaceConfig(request);
  const zip = new JSZip();

  // export chains
  const chainsFolder = zip.folder("chains");
  if (chainsFolder && existsSync(chainsDir)) {
    const chainDirs = readdirSync(chainsDir, { withFileTypes: true });
    for (const dir of chainDirs) {
      if (dir.isDirectory()) {
        const chainFile = join(chainsDir, dir.name, "chain.json");
        if (existsSync(chainFile)) {
          chainsFolder.file(`${dir.name}.json`, readFileSync(chainFile, "utf-8"));
        }
      }
    }
  }

  // export agents
  const agentsFolder = zip.folder("agents");
  if (agentsFolder && existsSync(agentsDir)) {
    const agentDirs = readdirSync(agentsDir, { withFileTypes: true });
    for (const dir of agentDirs) {
      if (dir.isDirectory()) {
        const agentFile = join(agentsDir, dir.name, "agent.json");
        if (existsSync(agentFile)) {
          agentsFolder.file(`${dir.name}.json`, readFileSync(agentFile, "utf-8"));
        }
      }
    }
  }

  // export runs summary (metadata only, no full output)
  if (existsSync(runsDir)) {
    const runSummaries: Record<string, unknown>[] = [];
    const runDirs = readdirSync(runsDir, { withFileTypes: true });
    for (const dir of runDirs.slice(0, 500)) {
      if (dir.isDirectory()) {
        const runFile = join(runsDir, dir.name, "run.json");
        if (existsSync(runFile)) {
          try {
            const run = JSON.parse(readFileSync(runFile, "utf-8"));
            runSummaries.push({
              id: run.id,
              chain: run.chain,
              status: run.status,
              started: run.started,
              completed: run.completed,
              goal: typeof run.goal === "string" ? run.goal.slice(0, 200) : run.goal,
            });
          } catch {}
        }
      }
    }
    zip.file("runs-summary.json", JSON.stringify(runSummaries, null, 2));
  }

  // metadata
  zip.file("export-info.json", JSON.stringify({
    exportedAt: new Date().toISOString(),
    version: "1.0",
    namespace: namespaceId,
  }, null, 2));

  const buffer = await zip.generateAsync({ type: "nodebuffer" });

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="mentiko-export-${new Date().toISOString().split("T")[0]}.zip"`,
    },
  });
});
