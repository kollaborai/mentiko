/**
 * auth.ts — `reconnect` tool handler: device-authorization re-auth for the bridge.
 *
 * Flow (two cheap calls, no client restart):
 *   1. reconnect() with no pending request → POST /auth/device/start, save the
 *      device code locally, return the magic verification link to the user.
 *   2. user opens the link, approves in the app.
 *   3. reconnect() again (or any ops 401 in Phase 3) → poll /auth/device/poll,
 *      and on approval persist {refresh_token, session_token} to the sidecar and
 *      push the access token into the live ops client.
 *
 * The actual pickup (poll + persist + set token) lives in ops-client
 * (tryPickupPendingDevice) so it's shared with the on-401 refresh path. Uses
 * plain fetch — these endpoints exist precisely to mint the token the ops client
 * is missing.
 */

import { WEB_URL, readPending, writePending } from "./session-store.js";
import { tryPickupPendingDevice } from "./ops-client.js";

interface DeviceStart {
  device_code: string;
  user_code: string;
  verification_url: string;
  interval: number;
  expires_in: number;
}

async function startDevice(): Promise<DeviceStart> {
  const res = await fetch(`${WEB_URL}/api/mentiko-mcp/auth/device/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_label: "Claude Code" }),
  });
  if (!res.ok) throw new Error(`device/start failed: ${res.status}`);
  return (await res.json()) as DeviceStart;
}

function linkMessage(userCode: string, url: string, suffix: string): string {
  return [
    "🔗 Authorize this connection in the Mentiko app:",
    "",
    `   ${url}`,
    "",
    `Confirm the code shown there matches:  ${userCode}`,
    suffix,
  ].join("\n");
}

export async function reconnect(): Promise<string> {
  // 1) finish a pending request if there is one
  const pending = readPending();
  if (pending) {
    const picked = await tryPickupPendingDevice();
    if (picked) {
      return "✓ Connected — your Mentiko session has been restored. Re-run your last command.";
    }
    // tryPickup clears the pending file only on denied/expired. If it's still
    // there, we're waiting on the user → re-show the link.
    if (readPending()) {
      return linkMessage(
        pending.user_code,
        pending.verification_url,
        "\nStill waiting for approval — approve the link above, then run `reconnect` again.",
      );
    }
    // denied/expired and cleared → fall through to start a fresh flow
  }

  // 2) start a new device flow
  let start: DeviceStart;
  try {
    start = await startDevice();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return `Could not start re-authentication: ${msg}`;
  }
  writePending({
    device_code: start.device_code,
    user_code: start.user_code,
    verification_url: start.verification_url,
  });
  return linkMessage(
    start.user_code,
    start.verification_url,
    "\nAfter you approve, run `reconnect` again (or just retry your command) to finish.",
  );
}
