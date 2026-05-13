"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";

const MIN_LEN = 12;

export default function WelcomeSetPasswordPage() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (newPassword.length < MIN_LEN) {
      setError(`Use at least ${MIN_LEN} characters`);
      return;
    }
    if (newPassword !== confirm) {
      setError("New passwords do not match");
      return;
    }
    setLoading(true);
    try {
      const res = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: false,
      });
      if (res?.error) {
        setError(res.error.message || "Could not update password");
        setLoading(false);
        return;
      }
      const done = await fetch("/api/account/finish-password-setup", { method: "POST" });
      if (!done.ok) {
        setError("Password updated but flag clear failed — contact support.");
        setLoading(false);
        return;
      }
      // Force a fresh session fetch so the gate sees mustChangePassword=false
      // before we navigate. Without this, the cached cookie (TTL ~5min) still
      // has the old value and the gate bounces the user back immediately.
      await authClient.getSession({ disableCookieCache: true });
      router.replace("/dashboard");
      router.refresh();
    } catch {
      setError("Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="bg-card rounded-md p-6 space-y-5">
          <div className="text-center space-y-1">
            <div className="flex items-center justify-center gap-2 mb-2">
              <span className="text-sm font-black tracking-tight font-mono">mentiko</span>
            </div>
            <h1 className="text-base font-semibold tracking-tight">Choose your password</h1>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Your instance used a one-time setup password from email. Set a strong password you{" "}
              will use from now on.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            {error && (
              <div className="text-xs text-red-400 bg-red-500/10 rounded-md px-3 py-2">{error}</div>
            )}
            <div>
              <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                current password
              </label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                className="mt-1 w-full bg-background rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                disabled={loading}
                required
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                new password
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                className="mt-1 w-full bg-background rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                disabled={loading}
                required
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                confirm new password
              </label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                className="mt-1 w-full bg-background rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                disabled={loading}
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-medium py-2 rounded-md transition-colors disabled:opacity-50"
            >
              {loading ? "Saving…" : "Continue"}
            </button>
          </form>

          <p className="text-[10px] text-center text-muted-foreground">
            Wrong place?{" "}
            <Link href="/login" className="text-primary hover:underline">
              Sign out and go back
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
