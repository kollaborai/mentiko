/**
 * GET  /api/seed  - check if namespace has been seeded
 * POST /api/seed  - run seed (idempotent, skips existing files)
 */

import { NextRequest } from "next/server";
import { existsSync, readdirSync } from "fs";
import { execSync } from "child_process";
import path from "path";
import { checkAuth } from "@/lib/api-auth";
import { nsPath, orgPath } from "@/lib/config";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { Unauthorized, InternalServerError } from "@/lib/api-errors";
import { buildChildEnv } from "@/lib/child-env";

export const dynamic = "force-dynamic";

function isSeeded(namespaceId: string): boolean {
  return existsSync(nsPath(namespaceId, ".seeded"));
}

function seedStats(namespaceId: string, orgId: string) {
  const agentsDir = orgPath(namespaceId, orgId, "agents");
  const chainsDir = orgPath(namespaceId, orgId, "chains");
  const agents = existsSync(agentsDir)
    ? readdirSync(agentsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .length
    : 0;
  const chains = existsSync(chainsDir)
    ? readdirSync(chainsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .length
    : 0;
  return { agents, chains };
}

export const GET = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const seeded = isSeeded(namespaceId);
  const stats = seedStats(namespaceId, orgId);

  return apiSuccess({ seeded, namespaceId, stats });
});

export const POST = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);

  // resolve path to seed script relative to web dir
  const scriptPath = path.join(
    path.dirname(path.dirname(path.dirname(__dirname))),
    "web",
    "scripts",
    "seed.ts"
  );

  const env = buildChildEnv({
    NAMESPACE_ID: namespaceId,
  });

  let output = "";
  try {
    output = execSync(`npx tsx "${scriptPath}"`, {
      env,
      timeout: 30_000,
      encoding: "utf-8",
    });
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    output = err.stdout || err.stderr || err.message || "seed failed";
    throw new InternalServerError("Seed failed", { output });
  }

  const stats = seedStats(namespaceId, orgId);
  return apiSuccess({ ok: true, namespaceId, stats, output });
});
