"use client";

import { useState, useEffect } from "react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { MonitorFilled, MobileFilled, GlobalFilled, DangerFilled, SecurityFilled, LockFilled } from "@aliimam/icons";
import { PageBanner } from "@/components/ui/page-banner";
import { useRouter } from "next/navigation";

interface SessionInfo {
  id: string;
  token: string;
  userId: string;
  expiresAt: string;
  ipAddress?: string;
  userAgent?: string;
  createdAt?: string;
  isCurrent?: boolean;
}

function parseUserAgent(ua: string): { browser: string; os: string; device: "desktop" | "mobile" | "unknown" } {
  if (!ua) return { browser: "Unknown", os: "Unknown", device: "unknown" };

  const mobile = /iPhone|iPad|iPod|Android/i.test(ua);

  const browser = /Edg/i.test(ua) ? "Edge"
    : /HeadlessChrome/i.test(ua) ? "Chrome"
    : /Chrome/i.test(ua) && !/Edg/i.test(ua) ? "Chrome"
    : /Firefox/i.test(ua) ? "Firefox"
    : /Safari/i.test(ua) && !/Chrome|Edg/i.test(ua) ? "Safari"
    : "Browser";

  const os = /iPhone|iPad|iPod/i.test(ua) ? "iOS"
    : /Android/i.test(ua) ? "Android"
    : /Windows/i.test(ua) ? "Windows"
    : /Macintosh|Mac OS/i.test(ua) ? "macOS"
    : /Linux/i.test(ua) ? "Linux"
    : "Unknown OS";

  return { browser, os, device: mobile ? "mobile" : "desktop" };
}

function formatIp(ip: string | undefined): string {
  if (!ip) return "";
  // loopback addresses (dev environment)
  if (ip === "::1" || ip === "127.0.0.1" || /^[0:]+$/.test(ip) || ip === "::") {
    return "local";
  }
  // strip IPv4-mapped IPv6 prefix
  if (ip.startsWith("::ffff:")) return ip.slice(7);
  return ip;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

/** Deduplicate sessions by userAgent — keep the most recent per device fingerprint */
function deduplicateSessions(sessions: SessionInfo[]): SessionInfo[] {
  const seen = new Map<string, SessionInfo>();
  for (const s of sessions) {
    const key = s.userAgent || s.id;
    const existing = seen.get(key);
    if (!existing || s.isCurrent) {
      seen.set(key, s);
    } else {
      // keep the more recent one, or current session
      const existingTime = existing.createdAt ? new Date(existing.createdAt).getTime() : 0;
      const thisTime = s.createdAt ? new Date(s.createdAt).getTime() : 0;
      if (thisTime > existingTime) seen.set(key, s);
    }
  }
  // always keep current first
  const all = [...seen.values()];
  return all.sort((a, b) => (a.isCurrent ? -1 : b.isCurrent ? 1 : 0));
}

function SessionRow({
  session,
  onRevoke,
}: {
  session: SessionInfo;
  onRevoke: () => Promise<void>;
}) {
  const [revoking, setRevoking] = useState(false);
  const { browser, os, device } = parseUserAgent(session.userAgent || "");
  const ip = formatIp(session.ipAddress);
  const when = session.createdAt ? timeAgo(session.createdAt) : "";
  const expires = session.expiresAt ? new Date(session.expiresAt).toLocaleDateString() : "";

  const DeviceIcon = device === "mobile" ? MobileFilled : device === "desktop" ? MonitorFilled : GlobalFilled;

  return (
    <div className={`flex items-start justify-between py-3 px-4 rounded-md transition-colors ${
      session.isCurrent
        ? "bg-primary/8 border border-primary/20"
        : "bg-muted/40"
    }`}>
      <div className="flex items-start gap-3">
        <DeviceIcon className={`h-4 w-4 mt-0.5 shrink-0 ${session.isCurrent ? "text-primary/70" : "text-foreground/30"}`} />
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{browser} on {os}</span>
            {session.isCurrent && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary font-medium">
                This session
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
            {ip && <span>{ip}</span>}
            {ip && when && <span>·</span>}
            {when && <span>Signed in {when}</span>}
            {expires && <span>· Expires {expires}</span>}
          </div>
        </div>
      </div>
      {!session.isCurrent && (
        <button
          className="text-xs text-muted-foreground hover:text-destructive transition-colors disabled:opacity-40 shrink-0 mt-0.5"
          disabled={revoking}
          onClick={async () => {
            setRevoking(true);
            try {
              await onRevoke();
            } finally {
              setRevoking(false);
            }
          }}
        >
          {revoking ? "Revoking..." : "Revoke"}
        </button>
      )}
    </div>
  );
}

export default function SessionsPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState("");
  const [confirmSignOutAll, setConfirmSignOutAll] = useState(false);
  const [signingOutAll, setSigningOutAll] = useState(false);

  const loadSessions = async () => {
    setSessionsLoading(true);
    setSessionsError("");
    try {
      const [listRes, currentRes] = await Promise.all([
        authClient.listSessions(),
        authClient.getSession(),
      ]);
      if (listRes?.error) {
        setSessionsError(listRes.error.message || "Failed to load sessions");
      } else {
        const currentToken = currentRes?.data?.session?.token;
        const raw = (listRes?.data || []).map((s: SessionInfo) => ({
          ...s,
          isCurrent: currentToken ? s.token === currentToken : false,
        }));
        setSessions(deduplicateSessions(raw));
      }
    } catch {
      setSessionsError("Failed to load sessions");
    } finally {
      setSessionsLoading(false);
    }
  };

  useEffect(() => {
    loadSessions();
  }, []);

  const handleRevokeSession = async (token: string) => {
    try {
      await authClient.revokeSession({ token });
      setSessions((prev) => prev.filter((s) => s.token !== token));
    } catch {
      setSessionsError("Failed to revoke session");
    }
  };

  const handleRevokeOtherSessions = async () => {
    try {
      await authClient.revokeOtherSessions();
      await loadSessions();
    } catch {
      setSessionsError("Failed to revoke sessions");
    }
  };

  const handleRevokeAllSessions = async () => {
    setSigningOutAll(true);
    try {
      await authClient.revokeSessions();
      router.push("/login");
    } catch {
      setSessionsError("Failed to sign out everywhere");
      setSigningOutAll(false);
      setConfirmSignOutAll(false);
    }
  };

  return (
    <div className="flex-1 overflow-auto">
      <PageBanner
        title="Active Sessions"
        subtitle="Manage devices and browsers currently signed in to your account. Revoke sessions to secure your account."
        icon={SecurityFilled}
        sectionColor="#a0927b"
        actions={[
          { label: "Security", href: "/settings/security", icon: LockFilled, iconColor: "#a0927b" },
        ]}
      />
      <div className="px-4 py-3 max-w-4xl mx-auto">
        <div className="flex items-center justify-end mb-4">
          <Button
            size="sm"
            variant="outline"
            onClick={loadSessions}
            disabled={sessionsLoading}
          >
            {sessionsLoading ? "Refreshing..." : "Refresh"}
          </Button>
        </div>

        <div className="bg-card rounded-md p-6 space-y-6">
          <div>
            <h2 className="text-sm font-semibold mb-1">Devices and Browsers</h2>
            <p className="text-xs text-muted-foreground">
              Manage devices and browsers currently signed in to your account.
            </p>
          </div>

          {sessionsError && (
            <div className="py-3 px-4 rounded-md bg-destructive/10 border border-destructive/20">
              <p className="text-xs text-destructive">{sessionsError}</p>
            </div>
          )}

          {sessions.length === 0 && !sessionsLoading ? (
            <div className="py-8 text-center">
              <p className="text-sm text-muted-foreground">No sessions found</p>
              <Button
                size="sm"
                variant="outline"
                onClick={loadSessions}
                className="mt-4"
              >
                Load sessions
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {sessions.map((s) => (
                <SessionRow
                  key={s.id}
                  session={s}
                  onRevoke={() => handleRevokeSession(s.token)}
                />
              ))}

              <div className="flex flex-wrap gap-3 pt-4 border-t border-foreground/10">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleRevokeOtherSessions}
                >
                  Sign out other devices
                </Button>

                {!confirmSignOutAll ? (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => setConfirmSignOutAll(true)}
                  >
                    Sign out everywhere
                  </Button>
                ) : (
                  <div className="flex items-center gap-2">
                    <DangerFilled className="h-3.5 w-3.5 text-destructive" />
                    <span className="text-xs text-destructive font-medium">Sign out all devices?</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setConfirmSignOutAll(false)}
                      disabled={signingOutAll}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={handleRevokeAllSessions}
                      disabled={signingOutAll}
                    >
                      {signingOutAll ? "Signing out..." : "Yes, sign out all"}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
