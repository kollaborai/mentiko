import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { checkAuth } from "@/lib/auth/api-auth";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { Unauthorized } from "@/lib/api-errors";
import { buildChildEnv } from "@/lib/runs/child-env";
import { getCliBinary, getDetectableCliTools } from "@/lib/agents/agent-provider-catalog";
import {
  readCliDetectionCache,
  writeCliDetectionCache,
  type CachedCliTool,
} from "@/lib/system/cli-detection-cache";

export const dynamic = "force-dynamic";

const DETECTION_CACHE_TTL_MS = 60_000;

type CliTool = CachedCliTool;

function liveClaudeProcessExists(env: NodeJS.ProcessEnv): boolean {
  try {
    const output = execSync("ps -eo comm=,stat=", {
      encoding: "utf-8",
      timeout: 2000,
      stdio: ["pipe", "pipe", "pipe"],
      env,
    });
    return output.split("\n").some((line) => {
      const match = line.trim().match(/^(\S+)\s+(\S+)/);
      return match?.[1] === "claude" && !match[2].startsWith("Z");
    });
  } catch {
    // A failed process probe must never authorize a second heavyweight Claude
    // process on a constrained tenant.
    return true;
  }
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

  const now = Date.now();
  const cachedDetection = readCliDetectionCache();
  if (cachedDetection && now - cachedDetection.checkedAt < DETECTION_CACHE_TTL_MS) {
    return apiSuccess({ tools: cachedDetection.tools });
  }

  const tools: CliTool[] = [];
  const claudeBusy = liveClaudeProcessExists(env);

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
      // `claude --version` and `claude auth status` each boot the full CLI and
      // can consume hundreds of MB. Generic UI/MCP discovery must not run them
      // beside a live agent; keep prior metadata (if any) and report presence.
      if (cli === "claude" && claudeBusy) {
        const previous = cachedDetection?.tools.find((candidate) => candidate.name === cli);
        tools.push({
          name: cli,
          found: true,
          path,
          ...(previous?.version ? { version: previous.version } : {}),
          ...(previous?.authenticated !== undefined
            ? { authenticated: previous.authenticated }
            : {}),
        });
        continue;
      }
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
          case "antigravity": {
            // Antigravity CLI uses the OS keyring/browser flow; there is no
            // stable file token contract to inspect here.
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

  // Do not cache a deliberately partial busy-state response. The next idle
  // request may refresh version/auth metadata; successful results collapse all
  // incidental callers for one minute.
  if (!claudeBusy) writeCliDetectionCache({ checkedAt: now, tools });
  return apiSuccess({ tools });
});
