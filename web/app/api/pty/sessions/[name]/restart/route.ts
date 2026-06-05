import { NextRequest } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import { join } from "path";
import { Unauthorized, BadRequest, InternalServerError } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { checkAuth } from "@/lib/auth/api-auth";
import config from "@/lib/config";
import { buildChildEnv } from "@/lib/runs/child-env";

export const dynamic = "force-dynamic";

const execAsync = promisify(exec);

const SINGLETON_COMMANDS: Record<string, string> = {
  "mentiko-watchdog":
    `"${join(config.binDir, "p")}" kill mentiko-watchdog; "${join(config.binDir, "p")}" spawn mentiko-watchdog bash "${join(config.libDir, "watchdog.sh")}"`,
  "mentiko-chain-watcher":
    `"${join(config.binDir, "p")}" kill mentiko-chain-watcher; "${join(config.binDir, "p")}" spawn mentiko-chain-watcher bash "${join(config.libDir, "chain-event-watcher.sh")}" --namespace default`,
};

export const POST = withErrorHandling(
  async (request: NextRequest, context: { params: Promise<{ name: string }> }) => {
    if (!(await checkAuth(request))) {
      throw new Unauthorized();
    }

    const { name } = await context.params;

    const cmd = SINGLETON_COMMANDS[name];
    if (!cmd) {
      throw new BadRequest(`Session '${name}' is not a restartable singleton`, {
        session: name,
      });
    }

    try {
      const env = buildChildEnv();

      await execAsync(cmd, { cwd: config.root, env });
      return apiSuccess({ ok: true });
    } catch (error) {
      throw new InternalServerError(
        error instanceof Error ? error.message : String(error)
      );
    }
  }
);
