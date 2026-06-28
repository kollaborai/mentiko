/**
 * ui-control.ts — `request_ui_control` tool.
 *
 * Grants this (headless) bridge the ability to drive ONE browser window's UI,
 * using the same code/approve UX as the device flow:
 *
 *   1. request_ui_control() → POST /ui-control/start; save pending; return the
 *      code + link for the user to open IN THE WINDOW THEY WANT CONTROLLED.
 *   2. user approves there → that window's sessionId is bound to a scoped
 *      signaling token.
 *   3. request_ui_control() again → poll /ui-control/poll; on approval write
 *      { signaling_token, session_id } to the ui-control sidecar. dispatch.ts
 *      then routes UI effects (navigate/highlight/open_*) to that window only.
 */

import {
  WEB_URL,
  readPendingUi,
  writePendingUi,
  clearPendingUi,
  writeUiControl,
} from "./session-store.js";

interface UiStart {
  device_code: string;
  user_code: string;
  verification_url: string;
}

interface UiPoll {
  status: string;
  signaling_token?: string;
  session_id?: string;
}

function linkMsg(userCode: string, url: string, suffix: string): string {
  const grantJson = JSON.stringify({
    type: "mentiko-ui-control",
    v: 1,
    code: userCode,
    label: "Claude Code",
  });
  return [
    "Relay these options to the user verbatim. To let me drive a window, they do ONE of them IN THE WINDOW they want me to control:",
    "",
    "  1) Paste this anywhere on the page (Cmd+V) — easiest, binds that exact window:",
    `       ${grantJson}`,
    "",
    `  2) Or press Cmd+M and type the code:  ${userCode}`,
    "",
    `  3) Or open this link there and approve:  ${url}`,
    "",
    `A one-tap confirm appears; the code shown should match:  ${userCode}`,
    suffix,
  ].join("\n");
}

async function startUi(): Promise<UiStart> {
  const res = await fetch(`${WEB_URL}/api/mentiko-mcp/ui-control/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_label: "Claude Code" }),
  });
  if (!res.ok) throw new Error(`ui-control/start failed: ${res.status}`);
  return (await res.json()) as UiStart;
}

async function pollUi(deviceCode: string): Promise<UiPoll> {
  const res = await fetch(
    `${WEB_URL}/api/mentiko-mcp/ui-control/poll?device_code=${encodeURIComponent(deviceCode)}`,
  );
  if (!res.ok) throw new Error(`ui-control/poll failed: ${res.status}`);
  return (await res.json()) as UiPoll;
}

export async function requestUiControl(): Promise<string> {
  // 1) finish a pending request if there is one
  const pending = readPendingUi();
  if (pending) {
    let result: UiPoll;
    try {
      result = await pollUi(pending.device_code);
    } catch (e) {
      return `Could not check approval: ${e instanceof Error ? e.message : String(e)}`;
    }
    if (result.status === "approved" && result.signaling_token && result.session_id) {
      writeUiControl({
        signaling_token: result.signaling_token,
        session_id: result.session_id,
      });
      clearPendingUi();
      return "UI control granted. I can now drive that window (navigate, highlight, open pages, toasts). Ask me to open something.";
    }
    if (result.status === "pending") {
      return linkMsg(
        pending.user_code,
        pending.verification_url,
        "\nStill waiting — approve in the target window, then run `request_ui_control` again.",
      );
    }
    // denied / expired → clear and start fresh below
    clearPendingUi();
  }

  // 2) start a new grant
  let start: UiStart;
  try {
    start = await startUi();
  } catch (e) {
    return `Could not start UI-control request: ${e instanceof Error ? e.message : String(e)}`;
  }
  writePendingUi({
    device_code: start.device_code,
    user_code: start.user_code,
    verification_url: start.verification_url,
  });
  return linkMsg(
    start.user_code,
    start.verification_url,
    "\nAfter you approve, run `request_ui_control` again to finish.",
  );
}
