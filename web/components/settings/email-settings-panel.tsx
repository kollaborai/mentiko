"use client";

import { useEffect, useState } from "react";
import { getApiErrorMessage } from "@/lib/api/api-client";
import { copyToClipboard } from "@/lib/ui/copy-to-clipboard";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Setting2Filled,
  SmsFilled,
  NotificationFilled,
  Data2Filled,
  RefreshFilled as RotateCcw,
  CopyFilled as Copy,
  TickCircleFilled as CheckCircle,
  TrashFilled as Trash2,
  SendFilled as Send,
} from "@aliimam/icons";
import { cn } from "@/lib/utils";
import type { EmailInbox } from "@/lib/email/email-types";
import { unwrapApiData } from "@/lib/api/api-client";

interface QuotaDisk {
  usedMb: number;
  quotaMb: number;
  ok: boolean;
}

interface QuotaSends {
  count: number;
  quota: number;
  resetAt: string;
  ok: boolean;
}

interface QuotaData {
  disk: QuotaDisk;
  sends: QuotaSends;
}

interface RotatedSecret {
  inboxId: string;
  secret: string;
}

interface SmtpStatus {
  configured: boolean;
  host: string;
  port: number;
  from: string;
  user: string;
}

export function EmailSettingsPanel() {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [inboxes, setInboxes] = useState<EmailInbox[]>([]);
  const [quota, setQuota] = useState<QuotaData | null>(null);
  const [smtpStatus, setSmtpStatus] = useState<SmtpStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [rotatedSecret, setRotatedSecret] = useState<RotatedSecret | null>(null);
  const [copied, setCopied] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [rotatingId, setRotatingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showSmtpTest, setShowSmtpTest] = useState(false);
  const [smtpTestTo, setSmtpTestTo] = useState("");
  const [smtpTestResult, setSmtpTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [smtpTesting, setSmtpTesting] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [inboxesRes, quotaRes, smtpRes] = await Promise.all([
          fetchWithNamespace("/api/email/inboxes"),
          fetchWithNamespace("/api/email/quota"),
          fetchWithNamespace("/api/email/smtp-status"),
        ]);

        if (inboxesRes.ok) {
          const raw = await inboxesRes.json();
          const data = unwrapApiData<{ inboxes?: EmailInbox[] }>(raw);
          setInboxes(data.inboxes || []);
        }

        if (quotaRes.ok) {
          const raw = await quotaRes.json();
          const data = unwrapApiData<QuotaData>(raw);
          setQuota(data);
        }

        if (smtpRes.ok) {
          const raw = await smtpRes.json();
          const data = unwrapApiData<SmtpStatus>(raw);
          setSmtpStatus(data);
        }
      } catch (_err) {
        console.error("failed to fetch email settings", _err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [fetchWithNamespace]);

  // clear rotated secret after 30s
  useEffect(() => {
    if (rotatedSecret) {
      const timer = setTimeout(() => {
        setRotatedSecret(null);
        setCopied(false);
      }, 30000);
      return () => clearTimeout(timer);
    }
  }, [rotatedSecret]);

  const handleToggleInbox = async (inbox: EmailInbox) => {
    setTogglingId(inbox.id);
    try {
      const res = await fetchWithNamespace(`/api/email/inboxes/${inbox.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !inbox.enabled }),
      });

      if (res.ok) {
        const data = await res.json() as { inbox: EmailInbox };
        setInboxes((prev) =>
          prev.map((i) => (i.id === inbox.id ? data.inbox : i))
        );
      }
    } catch (err) {
      console.error("failed to toggle inbox", err);
    } finally {
      setTogglingId(null);
    }
  };

  const handleRotateSecret = async (inbox: EmailInbox) => {
    setRotatingId(inbox.id);
    try {
      const res = await fetchWithNamespace("/api/email/secret/rotate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inboxId: inbox.id }),
      });

      if (res.ok) {
        const data = await res.json() as { secret: string };
        setRotatedSecret({ inboxId: inbox.id, secret: data.secret });
      }
    } catch (err) {
      console.error("failed to rotate secret", err);
    } finally {
      setRotatingId(null);
    }
  };

  const handleCopySecret = () => {
    if (rotatedSecret) {
      copyToClipboard(rotatedSecret.secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDeleteInbox = async (inboxId: string) => {
    if (!confirm("delete this inbox? this cannot be undone.")) {
      return;
    }

    setDeletingId(inboxId);
    try {
      const res = await fetchWithNamespace(`/api/email/inboxes/${inboxId}`, {
        method: "DELETE",
      });

      if (res.ok) {
        setInboxes((prev) => prev.filter((i) => i.id !== inboxId));
      }
    } catch (err) {
      console.error("failed to delete inbox", err);
    } finally {
      setDeletingId(null);
    }
  };

  const handleSendTestEmail = async () => {
    if (!smtpTestTo) return;
    setSmtpTesting(true);
    setSmtpTestResult(null);
    try {
      const res = await fetchWithNamespace("/api/email/smtp-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: smtpTestTo }),
      });

      const raw = await res.json();
      setSmtpTestResult({
        ok: res.ok,
        message: res.ok
          ? ((raw as { message?: string }).message || "Email sent")
          : getApiErrorMessage(raw, "Unknown error")
      });
    } catch (_err) {
      setSmtpTestResult({ ok: false, message: "Failed to send test email" });
    } finally {
      setSmtpTesting(false);
    }
  };

  const formatResetAt = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="max-w-lg mx-auto space-y-4">
      {/* smtp configuration section */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Setting2Filled className="h-4 w-4 text-foreground/60" />
              <CardTitle className="text-sm">smtp configuration</CardTitle>
              {smtpStatus && (
                <Badge
                  variant={smtpStatus.configured ? undefined : "outline"}
                  className={cn(
                    "text-[10px]",
                    smtpStatus.configured && "bg-foreground text-background"
                  )}
                >
                  {smtpStatus.configured ? "configured" : "not configured"}
                </Badge>
              )}
            </div>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => {
                setShowSmtpTest(!showSmtpTest);
                setSmtpTestResult(null);
              }}
              disabled={!smtpStatus?.configured}
            >
              <Send className="h-3 w-3 mr-1" />
              send test email
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </>
          ) : smtpStatus?.configured ? (
            <>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground">host</p>
                  <p className="font-mono">{smtpStatus.host}</p>
                </div>
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground">port</p>
                  <p className="font-mono">{smtpStatus.port}</p>
                </div>
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground">from</p>
                  <p className="font-mono">{smtpStatus.from || smtpStatus.user}</p>
                </div>
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground">user</p>
                  <p className="font-mono">{smtpStatus.user}</p>
                </div>
              </div>
              {showSmtpTest && (
                <div className="bg-muted rounded-md p-3 space-y-2">
                  <div className="flex gap-2">
                    <Input
                      placeholder="test@example.com"
                      value={smtpTestTo}
                      onChange={(e) => setSmtpTestTo(e.target.value)}
                      className="flex-1 text-sm"
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={handleSendTestEmail}
                      disabled={!smtpTestTo || smtpTesting}
                    >
                      {smtpTesting ? "sending..." : "send"}
                    </Button>
                  </div>
                  {smtpTestResult && (
                    <div className={cn(
                      "flex items-center gap-1.5 text-xs",
                      smtpTestResult.ok ? "text-green-400" : "text-red-400"
                    )}>
                      {smtpTestResult.ok ? (
                        <CheckCircle className="h-3 w-3" />
                      ) : (
                        <span className="text-red-400">✖</span>
                      )}
                      {smtpTestResult.message}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="bg-muted rounded-md p-3">
              <p className="text-sm text-muted-foreground">
                set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and SMTP_FROM environment variables to enable email sending.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* quota section */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Data2Filled className="h-4 w-4 text-foreground/60" />
            <CardTitle className="text-sm">quota</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </>
          ) : quota ? (
            <>
              {/* disk usage */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">disk usage</span>
                  <div className="flex items-center gap-2">
                    {!quota.disk.ok && (
                      <Badge variant="destructive" className="text-[10px]">
                        over quota
                      </Badge>
                    )}
                    <span className="text-muted-foreground">
                      {quota.disk.usedMb} mb / {quota.disk.quotaMb} mb
                    </span>
                  </div>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      quota.disk.ok ? "bg-foreground" : "bg-destructive"
                    )}
                    style={{
                      width: `${Math.min(
                        (quota.disk.usedMb / quota.disk.quotaMb) * 100,
                        100
                      )}%`,
                    }}
                  />
                </div>
              </div>

              {/* send quota */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">sends today</span>
                  <div className="flex items-center gap-2">
                    {!quota.sends.ok && (
                      <Badge variant="destructive" className="text-[10px]">
                        limit reached
                      </Badge>
                    )}
                    <span className="text-muted-foreground">
                      {quota.sends.count} / {quota.sends.quota}
                    </span>
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  resets at {formatResetAt(quota.sends.resetAt)} utc
                </p>
              </div>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">unable to load quota</p>
          )}
        </CardContent>
      </Card>

      {/* inboxes section */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <NotificationFilled className="h-4 w-4 text-foreground/60" />
              <CardTitle className="text-sm">inboxes</CardTitle>
              {inboxes.length > 0 && (
                <Badge className="text-[10px] bg-accent">
                  {inboxes.length}
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : inboxes.length === 0 ? (
            <div className="text-center py-6">
              <SmsFilled className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
              <p className="text-xs text-muted-foreground">
                no inboxes configured. go to the email page to create one.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {inboxes.map((inbox) => {
                const isRotatingThis = rotatingId === inbox.id;
                const showRotatedSecret =
                  rotatedSecret?.inboxId === inbox.id;

                return (
                  <div
                    key={inbox.id}
                    className="bg-accent rounded-md p-3 space-y-3"
                  >
                    {/* inbox info row */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span
                            className={cn(
                              "text-sm font-medium truncate",
                              !inbox.enabled && "text-muted-foreground"
                            )}
                          >
                            {inbox.name}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {inbox.address}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Switch
                          checked={inbox.enabled}
                          onCheckedChange={() => handleToggleInbox(inbox)}
                          disabled={togglingId === inbox.id}
                        />
                      </div>
                    </div>

                    {/* rotated secret display */}
                    {showRotatedSecret && (
                      <div className="bg-card rounded-md p-2 space-y-2">
                        <div className="flex items-center gap-2">
                          <CheckCircle className="h-3 w-3 text-green-400" />
                          <span className="text-[10px] text-green-400">
                            new secret (shows for 30s)
                          </span>
                        </div>
                        <div className="flex gap-1">
                          <Input
                            readOnly
                            value={rotatedSecret.secret}
                            className="text-[10px] h-7"
                          />
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={handleCopySecret}
                          >
                            {copied ? (
                              <CheckCircle className="h-3 w-3" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* action buttons */}
                    <div className="flex items-center justify-between">
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => handleRotateSecret(inbox)}
                        disabled={isRotatingThis || showRotatedSecret}
                      >
                        {isRotatingThis ? (
                          <>
                            <RotateCcw className="h-3 w-3 mr-1 animate-spin" />
                            rotating...
                          </>
                        ) : (
                          <>
                            <RotateCcw className="h-3 w-3 mr-1" />
                            rotate secret
                          </>
                        )}
                      </Button>

                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => handleDeleteInbox(inbox.id)}
                        disabled={deletingId === inbox.id}
                        className="text-foreground/40 hover:text-red-400"
                      >
                        {deletingId === inbox.id ? (
                          <>
                            deleting...
                          </>
                        ) : (
                          <>
                            <Trash2 className="h-3 w-3 mr-1" />
                            delete
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
