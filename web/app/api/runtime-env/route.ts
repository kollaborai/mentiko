import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/api-auth";
import { Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import config from "@/lib/config";

export const dynamic = "force-dynamic";

// safe subset of runtime env vars to expose to the UI
const EXPOSED_VARS = [
  "MENTIKO_GLOBAL_ROOT",
  "MENTIKO_CODE_ROOT",
  "NAMESPACE_ID",
  "ORG_ID",
  "NODE_ENV",
  "DATABASE_URL",
  "MENTIKO_TIER",
  "CLI_BIN",
  "SESSION_PREFIX",
  "PTY_MANAGER_DIR",
  "NEXT_PUBLIC_WS_TERMINAL_PORT",
  "NEXT_PUBLIC_BASE_URL",
  "NEXT_PUBLIC_APP_URL",
  "MARKETPLACE_URL",
  "SMTP_HOST",
  "SMTP_FROM",
  "WEB_PORT",
  "BD_BIN",
] as const;

export const GET = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const vars: Record<string, string> = {};

  for (const key of EXPOSED_VARS) {
    const val = process.env[key];
    if (val) {
      vars[key] = val;
    }
  }

  // always include resolved config paths (even if env var not set)
  vars["MENTIKO_GLOBAL_ROOT"] = config.globalRoot;
  vars["MENTIKO_CODE_ROOT"] = config.codeRoot;
  vars["NAMESPACE_ID"] = config.namespaceId;
  vars["NODE_ENV"] = process.env.NODE_ENV || "development";

  return apiSuccess({ vars });
});
