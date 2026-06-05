import { NextRequest } from "next/server";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { checkAuth } from "@/lib/auth/api-auth";
import config from "@/lib/config";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const body = await request.json();

  // save to namespace-specific integrations file
  const integrationsDir = join(config.namespaceRoot, "integrations");
  if (!existsSync(integrationsDir)) {
    mkdirSync(integrationsDir, { recursive: true });
  }

  const integrationsFile = join(integrationsDir, "config.json");

  // filter out sensitive data before saving
  const sanitized = {
    github: {
      enabled: body.github?.enabled || false,
      owner: body.github?.config?.owner || "",
      repo: body.github?.config?.repo || "",
      labels: body.github?.config?.labels || ""
      // token not saved - use env var
    },
    slack: {
      enabled: body.slack?.enabled || false
      // webhook_url not saved - use env var
    },
    teams: {
      enabled: body.teams?.enabled || false
      // webhook_url not saved - use env var
    },
    email: {
      enabled: body.email?.enabled || false,
      to: body.email?.config?.to || "",
      from: body.email?.config?.from || ""
    }
  };

  writeFileSync(integrationsFile, JSON.stringify(sanitized, null, 2));

  return apiSuccess({ success: true });
});
