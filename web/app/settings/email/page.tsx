"use client";

import { useState, useEffect } from "react";
import { unwrapApiData, getApiErrorMessage } from "@/lib/api-client";
import { TickCircleFilled, CloseCircleFilled, RefreshFilled, SendFilled, SmsFilled, NotificationFilled } from "@aliimam/icons";
import { PageBanner } from "@/components/ui/page-banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface SmtpStatus {
  configured: boolean;
  mode: "resend" | "auth" | "relay" | "none";
  host: string;
  port: number;
  from: string;
  user: string;
  inboundEnabled: boolean;
  emailDomain: string;
}

export default function EmailSettingsPage() {
  const [status, setStatus] = useState<SmtpStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [testTo, setTestTo] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const fetchStatus = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/email/smtp-status");
      setStatus(unwrapApiData<SmtpStatus>(await res.json()));
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchStatus(); }, []);

  const handleTest = async () => {
    if (!testTo) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/email/smtp-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: testTo }),
      });
      const raw = await res.json();
      setTestResult({
        ok: res.ok,
        message: res.ok
          ? (unwrapApiData<{ message?: string }>(raw).message || "Test email sent")
          : getApiErrorMessage(raw, "Test failed")
      });
    } catch {
      setTestResult({ ok: false, message: "Request failed" });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="flex-1 overflow-auto">
      <PageBanner
        title="Email"
        subtitle="Configure SMTP for outbound delivery and set up inbound email routing for your agents."
        icon={SmsFilled}
        sectionColor="#a0927b"
        actions={[
          { label: "Notifications", href: "/settings/notifications", icon: NotificationFilled, iconColor: "#a0927b" },
        ]}
      />
      <div className="px-4 py-3 max-w-4xl mx-auto">
        <div className="space-y-6">
          {/* SMTP status card */}
          <div className="bg-card rounded-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold mb-1">SMTP Configuration</h2>
                <p className="text-xs text-muted-foreground">
                  Configured via environment variables on the server.
                </p>
              </div>
              <button onClick={fetchStatus} className="text-foreground/40 hover:text-foreground transition-colors p-1">
                <RefreshFilled className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              </button>
            </div>

            {loading ? (
              <p className="text-xs text-muted-foreground">Loading...</p>
            ) : !status ? (
              <div className="py-2 px-3 rounded-md bg-destructive/10 border border-destructive/20">
                <p className="text-xs text-destructive">Failed to load SMTP status</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-2 py-2 px-3 rounded-md bg-muted/40">
                  {status.configured ? (
                    <TickCircleFilled className="h-4 w-4 text-green-400 shrink-0" />
                  ) : (
                    <CloseCircleFilled className="h-4 w-4 text-destructive shrink-0" />
                  )}
                  <span className="text-sm font-medium">
                    {status.configured ? "SMTP configured" : "SMTP not configured"}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {[
                    { label: "Host", value: status.host },
                    { label: "Port", value: String(status.port) },
                    { label: "From", value: status.from },
                    { label: "User", value: status.user },
                  ].map(({ label, value }) => (
                    <div key={label} className="space-y-1">
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
                      <p className="text-xs font-mono text-foreground/80">
                        {value || <span className="text-foreground/30 not-italic">not set</span>}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="py-3 px-4 rounded-md bg-muted/40 text-xs text-muted-foreground font-mono space-y-0.5">
                  <p className="not-italic font-sans font-medium text-foreground/60 mb-1.5">Set via .env.local or deployment env:</p>
                  {["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"].map((v) => (
                    <p key={v}>{v}=...</p>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Send test email */}
          {status?.configured && (
            <div className="bg-card rounded-md p-6 space-y-4">
              <div>
                <h2 className="text-sm font-semibold mb-1">Send Test Email</h2>
                <p className="text-xs text-muted-foreground">
                  Verify your SMTP configuration is working.
                </p>
              </div>

              <div className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="test-to">Send to</Label>
                  <Input
                    id="test-to"
                    type="email"
                    value={testTo}
                    onChange={(e) => setTestTo(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full"
                    onKeyDown={(e) => e.key === "Enter" && handleTest()}
                  />
                </div>

                {testResult && (
                  <div className={`flex items-center gap-2 py-2 px-3 rounded-md text-xs ${
                    testResult.ok ? "bg-green-500/10 text-green-400" : "bg-destructive/10 text-destructive"
                  }`}>
                    {testResult.ok
                      ? <TickCircleFilled className="h-3.5 w-3.5 shrink-0" />
                      : <CloseCircleFilled className="h-3.5 w-3.5 shrink-0" />
                    }
                    {testResult.message}
                  </div>
                )}

                <Button size="default" disabled={!testTo || testing} onClick={handleTest}>
                  <SendFilled className="h-3.5 w-3.5 mr-1.5" />
                  {testing ? "Sending..." : "Send test email"}
                </Button>
              </div>
            </div>
          )}

          {/* Inbound routing info */}
          <div className="bg-card rounded-md p-6 space-y-3">
            <h2 className="text-sm font-semibold">Inbound Routing</h2>
            {status?.inboundEnabled ? (
              <>
                <p className="text-xs text-muted-foreground">
                  Inbound email is active. Emails sent to any address{" "}
                  <span className="font-mono text-foreground/70">@{status.emailDomain}</span>{" "}
                  are delivered to your agents.
                </p>
                <p className="text-xs text-muted-foreground">
                  Use the email trigger in a chain to receive and respond to messages.
                </p>
              </>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  To receive inbound email, your domain&apos;s MX records must point to a mail
                  relay that forwards to this server.
                </p>
                <p className="text-xs text-muted-foreground">
                  Set <span className="font-mono text-foreground/70">SMTP_HOST</span> and{" "}
                  <span className="font-mono text-foreground/70">SMTP_FROM</span> in your
                  environment to enable outbound email, then configure MX records for inbound.
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
