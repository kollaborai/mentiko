import { execSync } from "child_process";
import { checkAuth } from "@/lib/auth/api-auth";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { Unauthorized } from "@/lib/api-errors";

export const dynamic = "force-dynamic";

interface ToolStatus {
  name: string;
  installed: boolean;
  version?: string;
  installCommand: string;
  reason: string;
}

// GET /api/tools/check - check if required tools are installed
export const GET = withErrorHandling(async (request: Request) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const tools: ToolStatus[] = [];

  // check claude code
  try {
    const version = execSync("claude --version 2>/dev/null || echo 'not found'", {
      encoding: "utf-8",
      timeout: 30000,
    }).trim();
    tools.push({
      name: "claude code",
      installed: version !== "not found",
      version: version !== "not found" ? version.split("\n")[0] : undefined,
      installCommand: "npm install -g @anthropic-ai/claude-code",
      reason: "AI agent for code tasks (recommended)",
    });
  } catch {
    tools.push({
      name: "claude code",
      installed: false,
      installCommand: "npm install -g @anthropic-ai/claude-code",
      reason: "AI agent for code tasks (recommended)",
    });
  }

  // check pty-manager (p)
  try {
    const version = execSync("p --version 2>/dev/null || echo 'not found'", {
      encoding: "utf-8",
      timeout: 30000,
    }).trim();
    tools.push({
      name: "pty-manager",
      installed: version !== "not found",
      version: version !== "not found" ? version : undefined,
      installCommand: "npm install -g @kollabor/pty-manager",
      reason: "session isolation for agents",
    });
  } catch {
    tools.push({
      name: "pty-manager",
      installed: false,
      installCommand: "npm install -g @kollabor/pty-manager",
      reason: "session isolation for agents",
    });
  }

  return apiSuccess({ tools });
});
