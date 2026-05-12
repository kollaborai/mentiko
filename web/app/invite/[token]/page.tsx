"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { useNamespaceFetch } from "@/lib/use-namespace-fetch";
import { getApiErrorMessage } from "@/lib/api-client";

interface InviteDetails {
  email: string;
  role: string;
  orgName: string;
  orgSlug: string;
  expiresAt: string;
}

interface SessionData {
  user?: { email: string };
  session?: unknown;
}

export default function InvitePage() {
  const router = useRouter();
  const params = useParams();
  const token = params.token as string;

  const { fetchWithNamespace } = useNamespaceFetch();
  const [invite, setInvite] = useState<InviteDetails | null>(null);
  const [session, setSession] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);

  // fetch invite details + session in parallel
  useEffect(() => {
    async function load() {
      const [inviteRes, sessionRes] = await Promise.all([
        fetchWithNamespace(`/api/invite/${token}`),
        fetch("/api/auth/get-session").catch(() => null),
      ]);

      if (!inviteRes.ok) {
        const data = await inviteRes.json().catch(() => ({}));
        setError(getApiErrorMessage(data, "Invalid invite link"));
        setLoading(false);
        return;
      }

      setInvite(await inviteRes.json());

      if (sessionRes?.ok) {
        const data = await sessionRes.json().catch(() => null);
        if (data?.session) setSession(data);
      }

      setLoading(false);
    }
    load();
  }, [token, fetchWithNamespace]);

  const acceptInvite = useCallback(async () => {
    setAccepting(true);
    setError(null);

    try {
      const res = await fetchWithNamespace(`/api/invite/${token}`, { method: "POST" });
      const data = await res.json();

      if (!res.ok) {
        // already a member is fine, just redirect
        if (res.status === 409) {
          setAccepted(true);
          setTimeout(() => router.push("/dashboard"), 1000);
          return;
        }
        setError(getApiErrorMessage(data, "Failed to accept invite"));
        return;
      }

      setAccepted(true);
      setTimeout(() => router.push("/dashboard"), 1000);
    } catch {
      setError("Network error");
    } finally {
      setAccepting(false);
    }
  }, [token, router, fetchWithNamespace]);

  // auto-accept if logged in with matching email
  useEffect(() => {
    if (
      !loading &&
      invite &&
      session?.user?.email &&
      session.user.email.toLowerCase() === invite.email.toLowerCase() &&
      !accepted &&
      !accepting &&
      !error
    ) {
      acceptInvite();
    }
  }, [loading, invite, session, accepted, accepting, error, acceptInvite]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-sm text-muted-foreground">loading invite...</div>
      </div>
    );
  }

  if (error && !invite) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-full max-w-sm">
          <div className="bg-card rounded-md p-6 text-center space-y-4">
            <div className="text-sm text-red-400">{error}</div>
            <Link
              href="/login"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              go to login
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (accepted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-full max-w-sm">
          <div className="bg-card rounded-md p-6 text-center space-y-3">
            <div className="text-sm text-foreground">
              joined {invite?.orgName || "organization"}
            </div>
            <div className="text-xs text-muted-foreground">
              redirecting to dashboard...
            </div>
          </div>
        </div>
      </div>
    );
  }

  const isLoggedIn = !!session?.session;
  const emailMatch =
    isLoggedIn &&
    session?.user?.email?.toLowerCase() === invite?.email?.toLowerCase();

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm">
        <div className="bg-card rounded-md p-6 space-y-5">
          {/* header */}
          <div className="text-center space-y-1">
            <div className="text-sm font-medium text-foreground">
              join {invite?.orgName}
            </div>
            <div className="text-xs text-muted-foreground">
              you&apos;ve been invited as <span className="text-foreground">{invite?.role}</span>
            </div>
          </div>

          {/* invite details */}
          <div className="bg-muted/50 rounded-md p-3 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">email</span>
              <span className="text-foreground">{invite?.email}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">role</span>
              <span className="text-foreground">{invite?.role}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">expires</span>
              <span className="text-foreground">
                {invite?.expiresAt
                  ? new Date(invite.expiresAt).toLocaleDateString()
                  : "—"}
              </span>
            </div>
          </div>

          {/* error */}
          {error && (
            <div className="text-xs text-red-400 bg-red-500/10 rounded-md px-3 py-2">
              {error}
            </div>
          )}

          {/* actions */}
          {isLoggedIn ? (
            <div className="space-y-3">
              {emailMatch ? (
                <button
                  onClick={acceptInvite}
                  disabled={accepting}
                  className="w-full bg-primary hover:bg-primary/90 disabled:bg-primary/50 text-primary-foreground text-sm font-medium py-2 rounded-md transition-colors"
                >
                  {accepting ? "joining..." : "accept invite"}
                </button>
              ) : (
                <div className="text-center space-y-2">
                  <div className="text-xs text-red-400">
                    signed in as {session?.user?.email} but invite is for{" "}
                    {invite?.email}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    sign out and sign in with the correct email
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <Link
                href={`/signup?redirect=/invite/${token}`}
                className="block w-full bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-medium py-2 rounded-md transition-colors text-center"
              >
                create account
              </Link>
              <Link
                href={`/login?redirect=/invite/${token}`}
                className="block w-full bg-muted hover:bg-accent text-foreground text-sm font-medium py-2 rounded-md transition-colors text-center"
              >
                sign in
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
