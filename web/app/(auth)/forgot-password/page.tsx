"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";

export default function ForgotPasswordPage() {
  return (
    <Suspense>
      <ForgotPasswordForm />
    </Suspense>
  );
}

function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;

    setLoading(true);
    setError("");

    try {
      const result = await authClient.requestPasswordReset({
        email: email.trim(),
        redirectTo: "/reset-password",
      });
      if (result?.error) {
        setSent(true);
        return;
      }
      // always show success — don't reveal if email exists
      setSent(true);
    } catch {
      setSent(true); // same UX on error to prevent enumeration
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-sm">
      <div className="bg-card rounded-md p-6">
        <div className="text-center mb-6">
          <div className="flex items-center justify-center gap-2 mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="-4 -5 32 32" className="h-8 w-8">
              <rect x="-4" y="-5" width="32" height="32" rx="6" fill="white"/>
              <path d="M14.0298 7.04057L11.9145 2.76797L7.37146 2.6136L6.37685 0L13.605 0.246633L17.0205 7.14525L14.0315 7.04412L14.0298 7.04057ZM20.3497 17.9474L12.7883 17.7345L14.2974 15.0961L18.9821 15.2274L21.2769 11.2174L24 11.5669L20.3497 17.9474ZM17.8597 13.9906L16.4783 11.2795L19.0822 7.29785L16.9825 3.17784L18.7231 1.00782L22.0643 7.564L17.8614 13.9924L17.8597 13.9906ZM9.69219 7.20736L5.00755 7.09025L2.72481 11.1073L0 10.7667L3.63307 4.37374L11.1962 4.56359L9.69392 7.20558L9.69219 7.20736ZM4.91603 15.6479L7.09002 19.7288L5.38916 21.9308L1.93049 15.4385L6.01772 8.93378L7.44742 11.6166L4.91603 15.6479ZM10.6074 21.8847L7.07273 15.0499L10.0635 15.0978L12.253 19.3314L16.7995 19.4041L17.8407 22L10.6091 21.8847H10.6074Z" fill="#0a0a0a"/>
            </svg>
            <span className="text-lg font-black tracking-tight font-mono">mentiko</span>
          </div>
          <h1 className="text-lg font-semibold mb-1">Reset your password</h1>
          {!sent && (
            <p className="text-sm text-muted-foreground">
              Enter your email and we&apos;ll send you a reset link.
            </p>
          )}
        </div>

        {sent ? (
          <div className="space-y-4 text-center">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-10 w-10 mx-auto text-primary">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
              <polyline points="22,6 12,13 2,6"/>
            </svg>
            <p className="text-sm text-muted-foreground">
              If an account exists for <span className="font-medium text-foreground">{email}</span>,
              you&apos;ll receive a reset link shortly.
            </p>
            <p className="text-xs text-muted-foreground">Check your spam folder if you don&apos;t see it.</p>
            <Link href="/login" className="block text-sm text-primary hover:underline mt-2">
              Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            {error && (
              <p className="text-xs text-red-400 bg-red-500/10 rounded px-2 py-1 text-center">
                {error}
              </p>
            )}
            <div>
              <label htmlFor="email" className="block text-xs font-medium text-muted-foreground mb-1">
                Email address
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <button
              type="submit"
              disabled={loading || !email.trim()}
              className="w-full bg-primary hover:bg-primary/90 disabled:bg-primary/50 disabled:cursor-not-allowed text-primary-foreground text-sm font-medium py-2 rounded-md transition-colors"
            >
              {loading ? "Sending..." : "Send reset link"}
            </button>
            <div className="text-center">
              <Link href="/login" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                Back to sign in
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
