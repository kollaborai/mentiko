import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { checkAuth } from "@/lib/api-auth";
import { apiSuccess, withErrorHandling } from "@/lib/api-response";
import { Unauthorized } from "@/lib/api-errors";

export const dynamic = "force-dynamic";

// lane B3: lets the floating bar decide whether to skip the codex token
// prompt because the engine already has a working "mentiko" profile via
// the local AI gateway proxy (wired by lane B2 on boot).

function readMentikoProfileActive(): boolean {
  const configPath = join(homedir(), ".kollab", "config.json");
  if (!existsSync(configPath)) return false;

  try {
    const raw = readFileSync(configPath, "utf-8");
    const data = JSON.parse(raw) as {
      kollabor?: { llm?: { active_profile?: unknown } };
    };
    return data?.kollabor?.llm?.active_profile === "mentiko";
  } catch {
    return false;
  }
}

export const GET = withErrorHandling(async (request: Request) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const gatewayEnabled = process.env.MENTIKO_AI_GATEWAY_ENABLED === "true";
  const mentikoProfileActive = readMentikoProfileActive();

  return apiSuccess({
    gatewayEnabled,
    mentikoProfileActive,
  });
});
