"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { authClient, useSession } from "@/lib/auth/auth-client";

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmailForm />
    </Suspense>
  );
}

function VerifyEmailForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawRedirect = searchParams.get("redirect") || "/dashboard";
  const redirectTo = /^\/[^/]/.test(rawRedirect) ? rawRedirect : "/dashboard";
  const emailParam = searchParams.get("email");
  const { data: session } = useSession();

  const [email, setEmail] = useState(emailParam || session?.user?.email || "");
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!emailParam && session?.user?.email) {
      setEmail(session.user.email);
    }
  }, [emailParam, session]);

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  async function handleResend() {
    if (countdown > 0 || !email) return;

    setLoading(true);
    setError("");

    try {
      await authClient.sendVerificationEmail({
        email,
        callbackURL: `/email-verified?redirect=${encodeURIComponent(redirectTo)}`,
      });
      setCountdown(60);
    } catch {
      setError("Failed to resend verification email");
    } finally {
      setLoading(false);
    }
  }

  const isVerified = session?.user?.emailVerified;

  if (isVerified) {
    router.push(redirectTo);
    return null;
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
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-12 w-12 mx-auto mb-4 text-primary">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
            <polyline points="22,6 12,13 2,6"/>
          </svg>
          <h1 className="text-lg font-semibold mb-2">Check your email</h1>
          <p className="text-sm text-muted-foreground">
            We sent a verification link to<br />
            <span className="font-medium text-foreground">{email || "your email"}</span>
          </p>
        </div>

        <div className="space-y-3">
          <p className="text-xs text-muted-foreground text-center">
            Click the link in the email to verify your account
          </p>

          <p className="bg-muted/70 rounded-md px-3 py-2 text-[11px] text-muted-foreground leading-relaxed">
            Running locally without SMTP? Mentiko prints the verification
            message to the dev server logs so you can complete setup.
          </p>

          {error && (
            <p className="text-xs text-red-400 bg-red-500/10 rounded px-2 py-1 text-center">
              {error}
            </p>
          )}

          {email && (
            <button
              onClick={handleResend}
              disabled={loading || countdown > 0}
              className="w-full bg-primary hover:bg-primary/90 disabled:bg-primary/50 disabled:cursor-not-allowed text-primary-foreground text-sm font-medium py-2 rounded-md transition-colors"
            >
              {loading
                ? "Sending..."
                : countdown > 0
                ? `Resend in ${countdown}s`
                : "Resend verification email"}
            </button>
          )}

          <div className="text-center">
            <Link
              href={redirectTo !== "/dashboard" ? `/login?redirect=${encodeURIComponent(redirectTo)}` : "/login"}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Back to sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
