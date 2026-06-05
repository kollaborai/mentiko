import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/auth/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { getProfile } from "@/lib/agents/agent-profile-storage";
import { execSync } from "child_process";
import { BadRequest, NotFound, Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { buildChildEnv } from "@/lib/runs/child-env";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling(
  async (
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
  ) => {
    if (!(await checkAuth(request))) {
      throw new Unauthorized();
    }

    const { id } = await context.params;
    const namespaceId = await getNamespaceIdFromRequest(request);
    const orgId = await getOrgIdFromRequest(request);
    const profile = getProfile(namespaceId, orgId, decodeURIComponent(id));

    if (!profile) {
      throw new NotFound("Profile", id);
    }

    const cli = profile.cli || "claude";
    // CLAUDECODE not in allowlist, so buildChildEnv drops it automatically
    const env = buildChildEnv(profile.env || {});

    // run a quick version/help check to verify the CLI works
    const testCmd = `${cli} --version`;

    try {
      const output = execSync(testCmd, {
        env,
        timeout: 30000,
        stdio: ["pipe", "pipe", "pipe"],
      }).toString().trim();

      return apiSuccess({
        ok: true,
        message: output
          ? `Connected — ${output.split("\n")[0]}`
          : "Connection successful",
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // extract meaningful error from stderr
      const stderr = (err as { stderr?: Buffer })?.stderr
        ?.toString()
        ?.trim();
      if (stderr?.includes("API key") || stderr?.includes("api_key") || stderr?.includes("unauthorized")) {
        throw new BadRequest("Invalid or missing API key");
      }
      if (stderr?.includes("command not found") || msg.includes("ENOENT")) {
        throw new BadRequest(`CLI not found: ${cli}`, { cli });
      }
      throw new BadRequest(
        stderr?.split("\n")[0] || msg.split("\n")[0] || "Connection failed"
      );
    }
  }
);
