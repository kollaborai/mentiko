"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { unwrapApiData, getApiErrorMessage } from "@/lib/api/api-client";

type TokenState =
  | { status: "loading" }
  | { status: "valid"; email: string; namespaceId: string }
  | { status: "expired" }
  | { status: "invalid" }
  | { status: "unsubscribed"; email: string }
  | { status: "resubscribed"; email: string };

export default function UnsubscribePage() {
  const params = useParams();
  const token = params.token as string;

  const [state, setState] = useState<TokenState>({ status: "loading" });
  const [actionInProgress, setActionInProgress] = useState(false);

  // validate token on mount
  useEffect(() => {
    async function validate() {
      try {
        const res = await fetch(`/api/unsubscribe/${token}`);
        if (res.ok) {
          const data = unwrapApiData<{ email: string; namespaceId: string }>(await res.json());
          setState({ status: "valid", email: data.email, namespaceId: data.namespaceId });
        } else {
          const raw = await res.json().catch(() => ({}));
          if (raw.reason === "expired") {
            setState({ status: "expired" });
          } else {
            setState({ status: "invalid" });
          }
        }
      } catch {
        setState({ status: "invalid" });
      }
    }
    validate();
  }, [token]);

  const handleUnsubscribe = async () => {
    if (state.status !== "valid") return;
    setActionInProgress(true);

    try {
      const res = await fetch("/api/email/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });

      if (res.ok) {
        setState({ status: "unsubscribed", email: state.email });
      } else {
        const raw = await res.json().catch(() => ({}));
        // if expired due to timing race, show expired state
        if (getApiErrorMessage(raw, "").toLowerCase().includes("expired")) {
          setState({ status: "expired" });
        }
      }
    } catch {
      // network error - stay on valid state but show alert via ui
      alert("Network error. Please try again.");
    } finally {
      setActionInProgress(false);
    }
  };

  const handleResubscribe = async () => {
    if (state.status !== "unsubscribed") return;
    setActionInProgress(true);

    try {
      const res = await fetch("/api/email/resubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });

      if (res.ok) {
        setState({ status: "resubscribed", email: state.email });
      } else {
        const raw = await res.json().catch(() => ({}));
        alert(getApiErrorMessage(raw, "Failed to resubscribe"));
      }
    } catch {
      alert("Network error. Please try again.");
    } finally {
      setActionInProgress(false);
    }
  };

  // loading state
  if (state.status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-sm text-muted-foreground">loading...</div>
      </div>
    );
  }

  // invalid token (404-like)
  if (state.status === "invalid") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-full max-w-sm">
          <div className="bg-card rounded-md p-6 text-center space-y-4">
            <div className="text-sm text-foreground">
              invalid unsubscribe link
            </div>
            <div className="text-xs text-muted-foreground">
              this link may have been corrupted or already used
            </div>
            <Link
              href="/"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              go to home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // expired link
  if (state.status === "expired") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-full max-w-sm">
          <div className="bg-card rounded-md p-6 text-center space-y-4">
            <div className="text-sm text-foreground">
              unsubscribe link expired
            </div>
            <div className="text-xs text-muted-foreground">
              unsubscribe links are valid for 30 days.
              contact support to manage your email preferences.
            </div>
            <Link
              href="/"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              go to home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // unsubscribed state
  if (state.status === "unsubscribed") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-full max-w-sm">
          <div className="bg-card rounded-md p-6 text-center space-y-4">
            <div className="text-sm text-foreground">
              you have been unsubscribed
            </div>
            <div className="text-xs text-muted-foreground">
              {state.email} will no longer receive emails from us.
            </div>
            <button
              onClick={handleResubscribe}
              disabled={actionInProgress}
              className="w-full bg-muted hover:bg-accent text-foreground text-sm font-medium py-2 rounded-md transition-colors disabled:opacity-50"
            >
              {actionInProgress ? "processing..." : "resubscribe"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // resubscribed state
  if (state.status === "resubscribed") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-full max-w-sm">
          <div className="bg-card rounded-md p-6 text-center space-y-4">
            <div className="text-sm text-foreground">
              you have been resubscribed
            </div>
            <div className="text-xs text-muted-foreground">
              {state.email} will receive emails again.
            </div>
            <Link
              href="/"
              className="block w-full bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-medium py-2 rounded-md transition-colors text-center"
            >
              continue
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // valid token - show confirmation
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm">
        <div className="bg-card rounded-md p-6 text-center space-y-5">
          <div className="space-y-2">
            <div className="text-sm font-medium text-foreground">
              unsubscribe from emails
            </div>
            <div className="text-xs text-muted-foreground">
              click below to stop receiving emails at{" "}
              <span className="text-foreground">{state.email}</span>
            </div>
          </div>

          <button
            onClick={handleUnsubscribe}
            disabled={actionInProgress}
            className="w-full bg-primary hover:bg-primary/90 disabled:bg-primary/50 text-primary-foreground text-sm font-medium py-2 rounded-md transition-colors"
          >
            {actionInProgress ? "processing..." : "unsubscribe"}
          </button>

          <div className="text-xs text-muted-foreground">
            this action is permanent. you can resubscribe at any time.
          </div>
        </div>
      </div>
    </div>
  );
}
