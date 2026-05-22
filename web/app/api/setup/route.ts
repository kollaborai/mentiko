/**
 * POST /api/setup — run the AI setup agent chain for a workspace.
 *
 * Reads the ai-setup-agent template, injects the workspace path,
 * then delegates to the chains/run endpoint.
 *
 * Body: { workspacePath?: string }
 */

import { NextRequest } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { checkAuth } from "@/lib/api-auth";
import { getNamespaceIdFromRequest } from "@/lib/namespace-config";
import config from "@/lib/config";
import { Unauthorized, NotFound, InternalServerError } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { internalApiUrl } from "@/lib/internal-web-origin";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const namespaceId = await getNamespaceIdFromRequest(request);
  const body = await request.json() as { workspacePath?: string };

  // load the AI setup agent template
  const templatePath = join(config.root, "templates", "ai-setup-agent", "chain.json");
  if (!existsSync(templatePath)) {
    throw new NotFound("AI setup agent template", "ai-setup-agent");
  }

  let chain: Record<string, unknown>;
  try {
    chain = JSON.parse(readFileSync(templatePath, "utf-8"));
  } catch {
    throw new InternalServerError("Failed to read template");
  }

  // call the chains/run endpoint internally
  const runRes = await fetch(internalApiUrl("/api/chains/run", request.url), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // forward cookies for auth
      cookie: request.headers.get("cookie") || "",
      "x-namespace-id": namespaceId,
    },
    body: JSON.stringify({
      chain,
      workspacePath: body.workspacePath,
      userPrompt: body.workspacePath
        ? `Analyze and configure the project at: ${body.workspacePath}`
        : "Analyze and configure this project for optimal agent usage.",
    }),
  });

  const runData = await runRes.json();
  if (!runRes.ok) {
    const errMsg = typeof runData.error === "object"
      ? (runData.error?.message || JSON.stringify(runData.error))
      : (runData.error || "Failed to start setup");
    throw new InternalServerError(errMsg);
  }

  return apiSuccess({ ...(runData.data || runData), templateUsed: "ai-setup-agent" });
});
