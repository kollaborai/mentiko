"use client";

import { useState, useEffect } from "react";
import { authClient, useSession } from "@/lib/auth/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MonitorFilled, MobileFilled, GlobalFilled, DangerFilled, ShieldTickFilled, LockFilled, SecurityFilled, KeyFilled } from "@aliimam/icons";
import { PageBanner } from "@/components/ui/page-banner";

const MIN_PASSWORD_LENGTH = 12;

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
    : /Chrome/i.test(ua) ? "Chrome"
    : /Firefox/i.test(ua) ? "Firefox"
    : /Safari/i.test(ua) ? "Safari"
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
  if (ip === "::1" || ip === "127.0.0.1" || /^[0:]+$/.test(ip) || ip === "::") return "local";
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

function deduplicateSessions(sessions: SessionInfo[]): SessionInfo[] {
  const seen = new Map<string, SessionInfo>();
  for (const s of sessions) {
    const key = s.userAgent || s.id;
    const existing = seen.get(key);
    if (!existing || s.isCurrent) {
      seen.set(key, s);
    } else {
      const existingTime = existing.createdAt ? new Date(existing.createdAt).getTime() : 0;
      const thisTime = s.createdAt ? new Date(s.createdAt).getTime() : 0;
      if (thisTime > existingTime) seen.set(key, s);
    }
  }
  return [...seen.values()].sort((a, b) => (a.isCurrent ? -1 : b.isCurrent ? 1 : 0));
}

function SessionRow({ session, onRevoke }: { session: SessionInfo; onRevoke: () => Promise<void> }) {
  const [revoking, setRevoking] = useState(false);
  const { browser, os, device } = parseUserAgent(session.userAgent || "");
  const ip = formatIp(session.ipAddress);
  const when = session.createdAt ? timeAgo(session.createdAt) : "";
  const DeviceIcon = device === "mobile" ? MobileFilled : device === "desktop" ? MonitorFilled : GlobalFilled;

  return (
    <div className={`flex items-start justify-between py-3 px-4 rounded-md transition-colors ${
      session.isCurrent ? "bg-primary/8 border border-primary/20" : "bg-muted/40"
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
          </div>
        </div>
      </div>
      {!session.isCurrent && (
        <button
          className="text-xs text-muted-foreground hover:text-destructive transition-colors disabled:opacity-40 shrink-0 mt-0.5"
          disabled={revoking}
          onClick={async () => {
            setRevoking(true);
            try { await onRevoke(); } finally { setRevoking(false); }
          }}
        >
          {revoking ? "Revoking..." : "Revoke"}
        </button>
      )}
    </div>
  );
}

export default function SecurityPage() {
  const { data: session } = useSession();

  // password change
  const [pwCurrent, setPwCurrent] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [pwError, setPwError] = useState("");
  const [pwStatus, setPwStatus] = useState<"idle" | "loading" | "done" | "error">("idle");

  const handleChangePassword = async () => {
    setPwError("");
    if (pwNew.length < MIN_PASSWORD_LENGTH) {
      setPwError(`New password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      return;
    }
    if (pwNew !== pwConfirm) {
      setPwError("Passwords don't match");
      return;
    }
    setPwStatus("loading");
    try {
      const res = await authClient.changePassword({
        currentPassword: pwCurrent,
        newPassword: pwNew,
        revokeOtherSessions: true,
      });
      if (res?.error) {
        setPwError(res.error.message || "Wrong current password");
        setPwStatus("error");
      } else {
        setPwStatus("done");
        setPwCurrent("");
        setPwNew("");
        setPwConfirm("");
        setTimeout(() => setPwStatus("idle"), 3000);
      }
    } catch {
      setPwError("Failed to change password");
      setPwStatus("error");
    }
  };

  // sessions
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

  useEffect(() => { loadSessions(); }, []);

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
      setSessionsError("Failed to sign out other devices");
    }
  };

  const handleRevokeAllSessions = async () => {
    setSigningOutAll(true);
    try {
      await authClient.revokeSessions();
      window.location.href = "/";
    } catch {
      setSessionsError("Failed to sign out all devices");
      setSigningOutAll(false);
    }
  };

  // email change
  const [emailNew, setEmailNew] = useState("");
  const [emailError, setEmailError] = useState("");
  const [emailStatus, setEmailStatus] = useState<"idle" | "loading" | "sent" | "error">("idle");

  const handleChangeEmail = async () => {
    setEmailError("");
    setEmailStatus("loading");
    try {
      const res = await authClient.changeEmail({
        newEmail: emailNew,
        callbackURL: "/settings/security?emailChanged=1",
      });
      if (res?.error) {
        setEmailError(res.error.message || "Failed to initiate email change");
        setEmailStatus("error");
      } else {
        setEmailStatus("sent");
      }
    } catch {
      setEmailError("Failed to initiate email change");
      setEmailStatus("error");
    }
  };

  return (
    <div className="flex-1 overflow-auto">
      <PageBanner
        title="Security"
        subtitle="Manage your password, change your email address, and review active sessions across all your devices."
        icon={LockFilled}
        sectionColor="#a0927b"
        actions={[
          { label: "Sessions", href: "/settings/sessions", icon: SecurityFilled, iconColor: "#a0927b" },
          { label: "SSH Keys", href: "/settings/ssh-keys", icon: KeyFilled, iconColor: "#a0927b" },
          { label: "Secrets", href: "/settings/secrets", icon: ShieldTickFilled, iconColor: "#a0927b" },
        ]}
      />
      <div className="px-4 py-3 max-w-4xl mx-auto">
        <div className="space-y-6">
          {/* change password */}
          <div className="bg-card rounded-md p-6 space-y-4">
            <div>
              <h2 className="text-sm font-semibold mb-1">Change Password</h2>
              <p className="text-xs text-muted-foreground">
                Use a strong password of at least {MIN_PASSWORD_LENGTH} characters.
              </p>
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="current-password">Current Password</Label>
                <Input
                  id="current-password"
                  type="password"
                  value={pwCurrent}
                  onChange={(e) => setPwCurrent(e.target.value)}
                  placeholder="Enter current password"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="new-password">New Password</Label>
                <Input
                  id="new-password"
                  type="password"
                  value={pwNew}
                  onChange={(e) => setPwNew(e.target.value)}
                  placeholder={`Min ${MIN_PASSWORD_LENGTH} characters`}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="confirm-password">Confirm New Password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  value={pwConfirm}
                  onChange={(e) => setPwConfirm(e.target.value)}
                  placeholder="Confirm new password"
                />
              </div>

              {pwError && <p className="text-xs text-destructive">{pwError}</p>}
              {pwStatus === "done" && (
                <p className="text-xs text-green-500">Password changed. Other sessions have been revoked.</p>
              )}

              <Button
                size="sm"
                disabled={!pwCurrent || !pwNew || !pwConfirm || pwStatus === "loading"}
                onClick={handleChangePassword}
              >
                {pwStatus === "loading" ? "Changing..." : "Change Password"}
              </Button>
            </div>
          </div>

          {/* change email */}
          <div className="bg-card rounded-md p-6 space-y-4">
            <div className="flex items-center gap-2">
              <ShieldTickFilled className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">Change Email</h2>
            </div>
            <p className="text-xs text-muted-foreground">
              A verification link will be sent to the new address.
            </p>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Current Email</Label>
                <Input value={session?.user?.email || ""} disabled className="bg-muted" />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="new-email">New Email</Label>
                <Input
                  id="new-email"
                  type="email"
                  value={emailNew}
                  onChange={(e) => setEmailNew(e.target.value)}
                  placeholder="Enter new email address"
                  disabled={emailStatus === "sent"}
                />
              </div>

              {emailError && <p className="text-xs text-destructive">{emailError}</p>}

              {emailStatus === "sent" ? (
                <p className="text-xs text-green-500">Verification email sent to {emailNew}</p>
              ) : (
                <Button
                  size="sm"
                  disabled={!emailNew || emailStatus === "loading"}
                  onClick={handleChangeEmail}
                >
                  {emailStatus === "loading" ? "Sending..." : "Send Verification"}
                </Button>
              )}
            </div>
          </div>

          {/* active sessions inline */}
          <div className="bg-card rounded-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldTickFilled className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold">Active Sessions</h2>
              </div>
              <button
                className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
                onClick={loadSessions}
                disabled={sessionsLoading}
              >
                {sessionsLoading ? "Loading..." : "Refresh"}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Devices and browsers signed in to your account.
            </p>

            {sessionsError && (
              <p className="text-xs text-destructive">{sessionsError}</p>
            )}

            {sessions.length === 0 && !sessionsLoading ? (
              <p className="text-sm text-muted-foreground py-2">No sessions found</p>
            ) : (
              <div className="space-y-2">
                {sessions.map((s) => (
                  <SessionRow
                    key={s.id}
                    session={s}
                    onRevoke={() => handleRevokeSession(s.token)}
                  />
                ))}
                <div className="flex flex-wrap gap-3 pt-3 border-t border-foreground/10">
                  <Button size="sm" variant="outline" onClick={handleRevokeOtherSessions}>
                    Sign out other devices
                  </Button>
                  {!confirmSignOutAll ? (
                    <Button size="sm" variant="destructive" onClick={() => setConfirmSignOutAll(true)}>
                      Sign out everywhere
                    </Button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <DangerFilled className="h-3.5 w-3.5 text-destructive" />
                      <span className="text-xs text-destructive font-medium">Sign out all devices?</span>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmSignOutAll(false)} disabled={signingOutAll}>
                        Cancel
                      </Button>
                      <Button size="sm" variant="destructive" onClick={handleRevokeAllSessions} disabled={signingOutAll}>
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
    </div>
  );
}
