"use client";

import { Suspense, useState, useEffect, FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { signIn, isMockOAuth, authClient } from "@/lib/auth/auth-client";
import { ONBOARDING_DISMISSED_KEY, OPEN_WELCOME_PANEL_KEY } from "@/lib/system/onboarding-storage";
import { LiquidMetalBorder } from "@/components/ui/liquid-metal-border";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawRedirect = searchParams.get("redirect") || "/dashboard";
  const redirectTo = /^\/[^/]/.test(rawRedirect) ? rawRedirect : "/dashboard";
  const signupHref = redirectTo !== "/dashboard" ? `/signup?redirect=${encodeURIComponent(redirectTo)}` : "/signup";
  const createdAccount = searchParams.get("created") === "1";
  const emailParam = searchParams.get("email") || "";
  const [email, setEmail] = useState(emailParam);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [providers, setProviders] = useState<{
    github: boolean;
    google: boolean;
    microsoft: boolean;
    publicEmailSignup?: boolean;
  } | null>(null);

  // redirect to dashboard if already authenticated
  useEffect(() => {
    fetch("/api/auth/get-session")
      .then((r) => r.json())
      .then((data) => {
        if (data?.session) router.replace(redirectTo);
      })
      .catch(() => {});
  }, [router, redirectTo]);

  useEffect(() => {
    fetch("/api/auth/providers")
      .then((r) => r.json())
      .then(setProviders)
      .catch(() => {});
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const result = await signIn.email({ email, password });
      if (result.error) {
        setError(result.error.message || "Invalid credentials");
      } else {
        if (createdAccount && redirectTo === "/dashboard") {
          localStorage.setItem(OPEN_WELCOME_PANEL_KEY, "true");
          localStorage.removeItem(ONBOARDING_DISMISSED_KEY);
        }
        router.push(redirectTo);
        router.refresh();
      }
    } catch {
      setError("Connection failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleOAuth(provider: "github" | "google" | "microsoft") {
    setError("");
    try {
      const callbackURL = redirectTo;
      if (isMockOAuth) {
        await authClient.signIn.oauth2({
          providerId: provider,
          callbackURL,
        });
      } else {
        await signIn.social({
          provider,
          callbackURL,
        });
      }
    } catch {
      setError(`Failed to connect to ${provider}`);
    }
  }

  return (
    <div className="w-full max-w-md">
      <LiquidMetalBorder className="bg-card rounded-md p-6 lm-card" radius={8} borderWidth={2}>
        <div className="text-center mb-5">
          <div className="flex items-center justify-center gap-2 mb-2">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="-4 -5 32 32" className="h-6 w-6">
              <rect x="-4" y="-5" width="32" height="32" rx="6" fill="white"/>
              <path d="M14.0298 7.04057L11.9145 2.76797L7.37146 2.6136L6.37685 0L13.605 0.246633L17.0205 7.14525L14.0315 7.04412L14.0298 7.04057ZM20.3497 17.9474L12.7883 17.7345L14.2974 15.0961L18.9821 15.2274L21.2769 11.2174L24 11.5669L20.3497 17.9474ZM17.8597 13.9906L16.4783 11.2795L19.0822 7.29785L16.9825 3.17784L18.7231 1.00782L22.0643 7.564L17.8614 13.9924L17.8597 13.9906ZM9.69219 7.20736L5.00755 7.09025L2.72481 11.1073L0 10.7667L3.63307 4.37374L11.1962 4.56359L9.69392 7.20558L9.69219 7.20736ZM4.91603 15.6479L7.09002 19.7288L5.38916 21.9308L1.93049 15.4385L6.01772 8.93378L7.44742 11.6166L4.91603 15.6479ZM10.6074 21.8847L7.07273 15.0499L10.0635 15.0978L12.253 19.3314L16.7995 19.4041L17.8407 22L10.6091 21.8847H10.6074Z" fill="#0a0a0a"/>
            </svg>
            <span className="text-sm font-black tracking-tight font-mono">mentiko</span>
          </div>
          <h1 className="text-base font-semibold tracking-tight">Sign in to Mentiko</h1>
          <p className="mt-1 text-xs text-foreground/50">
            Use the account for this Mentiko instance.
          </p>
        </div>

        {providers !== null && providers.publicEmailSignup !== false && (
          <div className="mb-5 bg-muted/70 rounded-md px-3 py-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Fresh install?</p>
            <p className="mt-1 leading-relaxed">
              Create the first account to set up this workspace. The first user becomes the workspace owner.
            </p>
            <Link
              href={signupHref}
              className="mt-3 inline-flex w-full items-center justify-center rounded-md bg-background px-3 py-2 text-xs font-medium text-foreground hover:bg-accent transition-colors"
            >
              Create first account
            </Link>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          {createdAccount && (
            <p className="text-xs text-green-400 bg-green-500/10 rounded px-2 py-1">
              Account created. Sign in with your new email and password.
            </p>
          )}

          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            autoComplete="email"
            className="w-full bg-background rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground"
            disabled={loading}
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoComplete="current-password"
            className="w-full bg-background rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground"
            disabled={loading}
          />

          {error && (
            <p className="text-xs text-red-400 bg-red-500/10 rounded px-2 py-1">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !email || !password}
            className="w-full bg-primary hover:bg-primary/90 disabled:bg-primary/50 disabled:cursor-not-allowed text-primary-foreground text-sm font-medium py-2 rounded-md transition-colors"
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>

          <div className="text-center">
            <Link href="/forgot-password" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              Forgot password?
            </Link>
          </div>
        </form>

        {providers && (providers.github || providers.google || providers.microsoft) && (
          <>
            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-foreground/10" />
              </div>
              <div className="relative flex justify-center text-[10px]">
                <span className="bg-card px-2 text-muted-foreground">or continue with</span>
              </div>
            </div>

            <div className={`grid gap-2 ${[providers.github, providers.google, providers.microsoft].filter(Boolean).length === 1 ? "grid-cols-1" : [providers.github, providers.google, providers.microsoft].filter(Boolean).length === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
              {providers.github && (
                <button
                  onClick={() => handleOAuth("github")}
                  className="flex items-center justify-center gap-1.5 bg-background hover:bg-accent rounded-md py-2 text-xs transition-colors"
                >
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                  </svg>
                  GitHub
                </button>
              )}
              {providers.google && (
                <button
                  onClick={() => handleOAuth("google")}
                  className="flex items-center justify-center gap-1.5 bg-background hover:bg-accent rounded-md py-2 text-xs transition-colors"
                >
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  Google
                </button>
              )}
              {providers.microsoft && (
                <button
                  onClick={() => handleOAuth("microsoft")}
                  className="flex items-center justify-center gap-1.5 bg-background hover:bg-accent rounded-md py-2 text-xs transition-colors"
                >
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24">
                    <rect fill="#F25022" x="1" y="1" width="10" height="10"/>
                    <rect fill="#7FBA00" x="13" y="1" width="10" height="10"/>
                    <rect fill="#00A4EF" x="1" y="13" width="10" height="10"/>
                    <rect fill="#FFB900" x="13" y="13" width="10" height="10"/>
                  </svg>
                  Microsoft
                </button>
              )}
            </div>
          </>
        )}

        {providers !== null && providers.publicEmailSignup !== false && (
          <div className="mt-4 text-center">
            <Link
              href={signupHref}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Need another account? <span className="text-primary">Sign up</span>
            </Link>
          </div>
        )}
      </LiquidMetalBorder>
    </div>
  );
}
