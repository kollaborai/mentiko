import { unwrapApiData } from "@/lib/api-client";

type TerminalConfig =
  | { mode: "direct"; port: number }
  | { mode: "proxy"; path: string };

let cached: Promise<TerminalConfig> | null = null;

async function fetchConfig(): Promise<TerminalConfig> {
  const res = await fetch("/api/terminal/config", { credentials: "include" });
  if (!res.ok) {
    throw new Error(`terminal config fetch failed: ${res.status}`);
  }
  return unwrapApiData<TerminalConfig>(await res.json());
}

// returns the ws base URL (no query string) for connecting to ws-terminal.
// Caller appends `?token=${token}`. Never trusts the server with the host —
// always uses window.location to prevent Host-header redirection attacks.
export async function getTerminalWsBaseUrl(): Promise<string> {
  if (typeof window === "undefined") {
    throw new Error("getTerminalWsBaseUrl is browser-only");
  }
  if (!cached) {
    cached = fetchConfig().catch((err) => {
      cached = null;
      throw err;
    });
  }
  const cfg = await cached;
  const { hostname, host, protocol } = window.location;
  const wsProto = protocol === "https:" ? "wss:" : "ws:";

  if (cfg.mode === "proxy") {
    return `${wsProto}//${host}${cfg.path}`;
  }
  return `${wsProto}//${hostname}:${cfg.port}`;
}
