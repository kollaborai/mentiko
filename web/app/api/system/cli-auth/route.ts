import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/api-auth";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { BadRequest, Unauthorized } from "@/lib/api-errors";
import { pty } from "@/lib/pty-client";

export const dynamic = "force-dynamic";

const ALLOWED_TOOLS = ["claude", "codex", "gemini"] as const;
type AuthTool = (typeof ALLOWED_TOOLS)[number];

const AUTH_COMMANDS: Record<AuthTool, string> = {
  claude: "claude auth login",
  codex: "codex login --device-auth",
  gemini: "gemini auth login",
};

// POST /api/system/cli-auth - start interactive CLI auth session
export const POST = withErrorHandling(async (request: NextRequest) => {
  // Check for inbox-key bypass (for MCP ops routes)
  const inboxKey = request.headers.get("X-Mentiko-Inbox-Key");
  const expectedKey = process.env.MENTIKO_INBOX_KEY;
  const hasValidInboxKey = expectedKey && inboxKey === expectedKey;

  if (!hasValidInboxKey && !(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const body = await request.json();
  const { tool } = body as { tool?: string };

  if (!tool || !ALLOWED_TOOLS.includes(tool as AuthTool)) {
    throw new BadRequest(
      `Invalid tool. Must be one of: ${ALLOWED_TOOLS.join(", ")}`,
      { field: "tool", allowed: [...ALLOWED_TOOLS] }
    );
  }

  const authTool = tool as AuthTool;
  const sessionName = `cli-auth-${authTool}-${Date.now()}`;
  const authCommand = AUTH_COMMANDS[authTool];

  // split command into binary + args for pty.spawn
  const [cmd, ...args] = authCommand.split(" ");

  // BROWSER=echo prevents the CLI from auto-opening a real browser window.
  // instead it prints the URL to stdout, which we capture and show in our
  // embedded viewport. CLAUDECODE is unset to avoid nested detection.
  await pty.spawn(sessionName, "env", ["-u", "CLAUDECODE", "BROWSER=echo", cmd, ...args]);

  return apiSuccess({ sessionId: sessionName });
});

// GET /api/system/cli-auth - poll auth session status
export const GET = withErrorHandling(async (request: NextRequest) => {
  // Check for inbox-key bypass (for MCP ops routes)
  const inboxKey = request.headers.get("X-Mentiko-Inbox-Key");
  const expectedKey = process.env.MENTIKO_INBOX_KEY;
  const hasValidInboxKey = expectedKey && inboxKey === expectedKey;

  if (!hasValidInboxKey && !(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");

  if (!sessionId) {
    throw new BadRequest("sessionId query parameter is required", {
      field: "sessionId",
    });
  }

  const isAlive = await pty.alive(sessionId);
  let output = "";

  try {
    output = await pty.capture(sessionId, 50);
  } catch {
    // capture can fail if session doesn't exist
  }

  // strip ANSI escape codes so URL regex isn't broken by terminal formatting
  const ANSI_RE = /(?:\x1b(?:\[[0-?]*[ -/]*[@-~]|][^\x07]*(?:\x07|\x1b\\)|P[^\x1b]*\x1b\\|X[^\x1b]*\x1b\\|_[^\x1b]*\x1b\\|\^[^\x1b]*\x1b\\|[@-Z\\-_]))/g;
  const clean = output.replace(ANSI_RE, "");

  const lines = clean.split("\n").filter((l) => l.trim());
  const lowerOutput = clean.toLowerCase();

  const successPatterns = ["authenticated", "logged in", "success"];
  const failurePatterns = ["error", "failed", "denied"];

  const hasSuccess = successPatterns.some((p) => lowerOutput.includes(p));
  const hasFailure = failurePatterns.some((p) => lowerOutput.includes(p));

  // extract any URLs from cleaned output
  const urlMatch = clean.match(/https?:\/\/[^\s\x00-\x1f]+/);
  const authUrl = urlMatch ? urlMatch[0].replace(/[.)\]]+$/, "") : undefined;
  const deviceCodeMatch = clean.match(/\b[A-Z0-9]{4,8}-[A-Z0-9]{4,8}\b/);
  const deviceCode = deviceCodeMatch ? deviceCodeMatch[0] : undefined;

  if (!isAlive) {
    // session finished - determine outcome and cleanup
    await pty.remove(sessionId);

    if (hasSuccess) {
      return apiSuccess({
        status: "complete" as const,
        authUrl,
        deviceCode,
      });
    }

    // extract error message from last non-empty line
    const errorLine = lines.filter((l) => l.trim()).pop();
    return apiSuccess({
      status: "failed" as const,
      error: hasFailure
        ? errorLine || "Authentication failed"
        : "Session ended without confirmation",
      authUrl,
      deviceCode,
    });
  }

  // still running
  return apiSuccess({
    status: "pending" as const,
    authUrl,
    deviceCode,
  });
});
