import { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth/auth-bridge";
import { Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

// returns the shape the browser needs to construct the ws-terminal URL.
// CRITICAL: never includes any host/origin from the request — clients
// combine these fields with their own window.location values. this prevents
// Host header injection from redirecting the browser's PTY session to an
// attacker-controlled WebSocket server.
//
// mode "direct" -> ws://{window.location.hostname}:{port}
// mode "proxy"  -> {ws|wss}://{window.location.host}{path}
export const GET = withErrorHandling(async (req: NextRequest) => {
  const user = await getSessionUser(req);
  if (!user) {
    throw new Unauthorized();
  }

  const proxyPath = process.env.WS_TERMINAL_PROXY_PATH;
  const proxyEnabled =
    process.env.MENTIKO_TERMINAL_PROXY === "true" || !!proxyPath;

  // The port the BROWSER connects to (host-side of any docker port mapping).
  // WS_PORT is the public-facing port operators configure. WS_TERMINAL_PORT
  // is the container-internal listen port — falling back to that handles
  // local-dev where there is no port mapping.
  const port = parseInt(
    process.env.WS_PORT || process.env.WS_TERMINAL_PORT || "3099",
    10
  );
  const path = proxyPath || "/ws/terminal";

  const body = proxyEnabled
    ? { mode: "proxy" as const, path }
    : { mode: "direct" as const, port };

  const res = apiSuccess(body);
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
});
