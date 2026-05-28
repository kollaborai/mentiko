import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { checkAuth } from "@/lib/api-auth";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { Unauthorized } from "@/lib/api-errors";
import { buildChildEnv } from "@/lib/child-env";
import { getCliBinary, getDetectableCliTools } from "@/lib/agent-provider-catalog";

export const dynamic = "force-dynamic";

interface CliTool {
  name: string;
  found: boolean;
  version?: string;
  path?: string;
  authenticated?: boolean;
}

// GET /api/system/detect-cli - detect installed AI CLI tools
export const GET = withErrorHandling(async (request: Request) => {
  // Check for inbox-key bypass (for MCP ops routes)
  const inboxKey = request.headers.get("X-Mentiko-Inbox-Key");
  const expectedKey = process.env.MENTIKO_INBOX_KEY;
  const hasValidInboxKey = expectedKey && inboxKey === expectedKey;

  if (!hasValidInboxKey && !(await checkAuth(request))) {
    throw new Unauthorized();
  }

  // clean env: CLAUDECODE not in allowlist, so buildChildEnv drops it
  const env = buildChildEnv();

  const tools: CliTool[] = [];

  for (const tool of getDetectableCliTools()) {
    const cli = tool.id;
    const binary = getCliBinary(cli);
    let found = false;
    let version: string | undefined;
    let path: string | undefined;

    // check if binary exists via which
    try {
      path = execSync(`which ${binary}`, {
        encoding: "utf-8",
        timeout: 2000,
        stdio: ["pipe", "pipe", "pipe"],
        env,
      }).trim();
      found = !!path;
    } catch {
      // which failed - binary not on PATH
      found = false;
    }

    // if found, try to get version
    if (found) {
      try {
        const output = execSync(`${binary} --version`, {
          encoding: "utf-8",
          timeout: 15000,
          stdio: ["pipe", "pipe", "pipe"],
          env,
        }).trim();
        version = output.split("\n")[0] || undefined;
      } catch {
        // version check failed but binary exists
        version = undefined;
      }
    }

    // check if already authenticated
    let authenticated: boolean | undefined;
    if (found) {
      try {
        switch (cli) {
          case "claude": {
            // claude auth status returns JSON with loggedIn field
            const authOut = execSync("claude auth status", {
              encoding: "utf-8",
              timeout: 15000,
              stdio: ["pipe", "pipe", "pipe"],
              env,
            });
            const authData = JSON.parse(authOut);
            authenticated = authData.loggedIn === true;
            break;
          }
          case "codex": {
            // codex stores tokens in ~/.codex/auth.json
            const codexAuth = join(homedir(), ".codex", "auth.json");
            if (existsSync(codexAuth)) {
              const data = JSON.parse(readFileSync(codexAuth, "utf-8"));
              authenticated = !!(data.tokens || data.OPENAI_API_KEY);
            } else {
              authenticated = false;
            }
            break;
          }
          case "gemini": {
            // gemini stores oauth creds in ~/.gemini/oauth_creds.json
            const geminiAuth = join(homedir(), ".gemini", "oauth_creds.json");
            if (existsSync(geminiAuth)) {
              const data = JSON.parse(readFileSync(geminiAuth, "utf-8"));
              authenticated = !!(data.access_token || data.refresh_token);
            }
            break;
          }
          case "kollab":
          case "aider": {
            // auth comes from agent profiles + secrets vault, not env vars
            // leave as undefined (unknown) -- detected by profile config
            break;
          }
        }
      } catch {
        // auth check failed, leave undefined
      }
    }

    tools.push({ name: cli, found, version, path, authenticated });
  }

  return apiSuccess({ tools });
});
