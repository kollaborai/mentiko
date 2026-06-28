"use client";

import { useCallback, useEffect, useState } from "react";
import { useKollaborBarStore } from "@/lib/ui/kollabor-bar-store";
import { showToast } from "@/components/app-shell/notifications-panel";
import { FLOATING_SURFACE_Z } from "@/lib/ui/floating-surface-z";

/**
 * UIControlGrant — in-app approval surface for letting an external agent (e.g.
 * Claude Code over MCP) drive THIS browser window.
 *
 * Two ways in, both binding the window the user is focused on (we read the live
 * engine sessionId from the bar store at approve time — no localStorage guessing,
 * so multi-window targeting is exact):
 *   1. Paste the grant JSON ({ "type": "mentiko-ui-control", "code": "..." })
 *      anywhere on the page — a global paste listener recognizes it and pops a
 *      one-tap confirm (not a silent auto-register, so a stray clipboard can't
 *      bind your UI).
 *   2. Press Cmd/Ctrl+Shift+M to open the box and type the code.
 *
 * Approve is cookie-authed server-side (POST /auth/device/approve), so only the
 * logged-in user can grant.
 */
export function UIControlGrant() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [label, setLabel] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const approve = useCallback(async (rawCode: string) => {
    const userCode = rawCode.trim();
    if (!userCode || submitting) return;
    const sessionId = useKollaborBarStore.getState().sessionId;
    if (!sessionId) {
      showToast({
        type: "error",
        title: "No active session in this window yet",
        message: "Wait for the assistant bar to connect, then try again.",
        duration: 5000,
      });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/mentiko-mcp/auth/device/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          user_code: userCode,
          decision: "approve",
          target_session_id: sessionId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.ok) {
        showToast({
          type: "success",
          title: `${label || "Agent"} can now control this window`,
          message: "",
          duration: 5000,
        });
        setOpen(false);
        setCode("");
        setLabel(null);
      } else {
        showToast({
          type: "error",
          title: (data && data.error) || "Couldn't grant control",
          message: "",
          duration: 5000,
        });
      }
    } catch {
      showToast({
        type: "error",
        title: "Couldn't reach the server",
        message: "",
        duration: 4000,
      });
    } finally {
      setSubmitting(false);
    }
  }, [submitting, label]);

  // 1) recognize a pasted grant JSON anywhere on the page
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData("text") ?? "";
      if (!text || text.length > 4000 || !text.includes("mentiko-ui-control")) return;
      let parsed: { type?: string; code?: string; label?: string };
      try {
        parsed = JSON.parse(text.trim());
      } catch {
        return;
      }
      if (parsed?.type !== "mentiko-ui-control" || typeof parsed.code !== "string") return;
      e.preventDefault();
      setCode(parsed.code);
      setLabel(typeof parsed.label === "string" ? parsed.label : "Claude");
      setOpen(true);
    };
    document.addEventListener("paste", onPaste, true);
    return () => document.removeEventListener("paste", onPaste, true);
  }, []);

  // 2) Cmd/Ctrl+Shift+M opens the manual box
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "M" || e.key === "m")) {
        e.preventDefault();
        setLabel(null);
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{ zIndex: FLOATING_SURFACE_Z.kollaborPrompt }}
      role="dialog"
      aria-modal="true"
      aria-label="Grant UI control"
    >
      <div
        className="absolute inset-0 bg-black/40"
        onClick={() => !submitting && setOpen(false)}
      />
      <div className="relative w-[min(92vw,380px)] rounded-md border border-border bg-card p-4 shadow-xl">
        <p className="text-sm font-medium">
          {label ? `Grant UI control to ${label}?` : "Grant UI control to an agent"}
        </p>
        <p className="mt-1 text-xs text-foreground/60">
          Binds <span className="font-medium text-foreground/80">this</span> window so the
          agent can drive it (navigate, highlight, open things).
          {label ? " Detected from your paste." : " Paste the code the agent gave you."}
        </p>
        <input
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && code.trim()) approve(code);
            if (e.key === "Escape") setOpen(false);
          }}
          placeholder="XXXX-XXXX"
          spellCheck={false}
          className="mt-3 w-full rounded-sm bg-muted px-3 py-2 font-mono text-sm outline-none focus:ring-1 focus:ring-foreground/20"
        />
        <div className="mt-3 flex justify-end gap-2">
          <button
            onClick={() => setOpen(false)}
            disabled={submitting}
            className="rounded-sm px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => approve(code)}
            disabled={submitting || !code.trim()}
            className="rounded-sm bg-foreground px-3 py-1.5 text-xs text-background hover:bg-foreground/90 disabled:opacity-50"
          >
            {submitting ? "Granting…" : "Approve"}
          </button>
        </div>
      </div>
    </div>
  );
}
