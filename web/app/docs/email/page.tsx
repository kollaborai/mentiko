"use client";

import { PageBanner } from "@/components/ui/page-banner";
import { DirectSendFilled, LinkFilled, Webhook } from "@aliimam/icons";

const CodeBlock = ({ children }: { children: string }) => (
  <pre className="bg-muted rounded-md p-3 font-mono text-[11px] text-foreground/70 whitespace-pre overflow-x-auto mb-4">
    {children}
  </pre>
);

export default function EmailDocPage() {
  return (
    <div>
      <PageBanner
        title="Email"
        subtitle="Email routing for agent workflows. Configure inbound and outbound email triggers, handle bounces, and track reputation with suppression lists."
        icon={DirectSendFilled}
        sectionColor="#f59e0b"
        actions={[
          { label: "Email", href: "/email", icon: DirectSendFilled, iconColor: "#b07ee8" },
          { label: "Chains", href: "/chains", icon: LinkFilled, iconColor: "#b07ee8" },
          { label: "Webhooks", href: "/webhooks", icon: Webhook, iconColor: "#b07ee8" },
        ]}
      />
      <div className="px-6 pb-6 max-w-3xl">

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Email Inboxes</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Email inboxes receive and process incoming messages. Each inbox has an
          address, optional linked chain, and authentication configuration.
        </p>
        <CodeBlock>{`{
  "id": "inbox-abc123",
  "name": "Support Inbox",
  "address": "support@example.com",
  "folder": "support",
  "chainId": "chain-abc123",
  "enabled": true,
  "allowAttachments": false,
  "source": "custom|haraka|resend|postmark|sendgrid",
  "secretVersion": 1
}

// Supported sources:
// - custom: generic Bearer token (derived HMAC secret)
// - haraka: shared HARAKA_API_KEY or derived per-inbox HMAC secret
// - resend: Svix signature verification (X-Svix-Signature)
// - postmark: HMAC-SHA256 signature (X-Postmark-Signature)
// - sendgrid: ECDSA-SHA256 (P-256) signature verification`}</CodeBlock>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Inbound Email Authentication</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Inbound emails are authenticated based on their source. Each source has
          different signature verification requirements:
        </p>
        <CodeBlock>{`// haraka source: checks shared key first, then per-inbox derived secret
Authorization: Bearer {HARAKA_API_KEY}
// or:
Authorization: Bearer {deriveInboundSecret(namespaceId, secretVersion)}

// custom source: per-inbox derived secret only
Authorization: Bearer {deriveInboundSecret(namespaceId, secretVersion)}

// Resend webhook signature
X-Svix-Signature: {hmac_sha256(secret, body)}

// Postmark webhook signature
X-Postmark-Signature: {hmac_sha256(secret, body)}
`}</CodeBlock>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          The derived HMAC secret is computed from the namespace ID and secret version.
          When secretVersion is incremented, the previous version&apos;s secret is accepted for 24 hours
          to allow graceful rotation without dropped webhooks.
        </p>
        <p className="text-xs text-foreground/60 leading-relaxed">
          Auth failures are rate-limited: 5 failures within 5 minutes triggers a 1-hour block per IP.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Outbound Email</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Send emails via the POST /api/email/send endpoint. Requires authentication
          and an outbound transport to be configured. Transport mode is determined
          from environment variables:
        </p>
        <CodeBlock>{`// Send email via API
POST /api/email/send
Content-Type: application/json

{
  "to": "user@example.com",
  "subject": "Your report is ready",
  "text": "Report available at https://...",
  "html": "<p>Report available at <a href=\\"...\\">here</a></p>",
  "type": "transactional"   // or "bulk"
}

// Transport modes (resolved from env vars, in priority order):
// 1. resend:  RESEND_API_KEY → smtp.resend.com:465
// 2. auth:    SMTP_HOST + SMTP_USER + SMTP_PASS → SMTP with credentials
// 3. relay:   SMTP_HOST + SMTP_FROM → IP-based relay, no auth
// 4. none:    no config → queued only, not delivered until configured
`}</CodeBlock>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Bulk emails require <code className="text-foreground/70 bg-muted px-1 rounded">type: &quot;bulk&quot;</code> and a physical address configured
          in org settings. Bulk sends automatically add List-Unsubscribe headers and
          set Precedence: bulk.
        </p>
        <p className="text-xs text-foreground/60 leading-relaxed">
          VERP return-path for bounce tracking: <code className="text-foreground/70 bg-muted px-1 rounded">bounces-{"{sendId}"}@{"{fromDomain}"}</code>
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Bounce Handling</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Bounced emails are reported to the POST /api/email/bounce endpoint by the
          sending infrastructure. Hard bounces are automatically suppressed.
        </p>
        <CodeBlock>{`// bounce notification (sent by haraka or other MTA)
POST /api/email/bounce
Authorization: Bearer <token>:v{version}:{namespaceId}:{hmac_signature}

{
  "outboundId": "send-abc123",
  "recipient": "bad@example.com",
  "bounceType": "hard",      // hard | soft | auto_reply | vacation
  "action": "failed",        // failed | delayed | relayed | delivered
  "diagnosticCode": "smtp; 550 5.1.1 User unknown"
}

// hard bounce → recipient auto-added to suppression list`}</CodeBlock>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Suppression Lists</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Suppressed email addresses are never sent to. Addresses are added automatically
          on hard bounces or can be added manually.
        </p>
        <div className="bg-card rounded-md p-3 text-xs text-foreground/60 space-y-1 mb-3">
          <div>View suppressed addresses in email settings</div>
          <div>Unsuppress to re-enable sending (use with caution)</div>
          <div>Export suppression list for external tools</div>
        </div>
        <p className="text-xs text-foreground/60 leading-relaxed">
          Suppressions are stored per-org at <code className="text-foreground/70 bg-muted px-1 rounded">emails/config/suppressions.json</code>.
          Each org maintains its own list.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Send Quotas</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Daily send quota is configured per org in org settings. Quota is decremented
          when a message is enqueued, not when delivered, to prevent overrun from
          concurrent requests.
        </p>
        <div className="bg-card rounded-md p-3 text-xs text-foreground/60 space-y-1">
          <div>Quota exceeded → 429 response with quota details</div>
          <div>Quota resets at the start of each day</div>
          <div>Zero quota = unlimited</div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Email Storage</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Emails and configuration are stored under the org&apos;s emails directory:
        </p>
        <CodeBlock>{`// storage paths (default org)
namespaces/{id}/emails/
  inbound/{emailId}.json           // received emails
  outbound/{emailId}.json          // sent emails (outbound queue entries)
  config/suppressions.json         // suppressed addresses

// outbound queue entry
{
  "id": "send-abc123",
  "to": ["user@example.com"],
  "from": "noreply@example.com",
  "subject": "Your report is ready",
  "type": "transactional",
  "status": "queued|sent|failed",
  "createdAt": "2026-03-16T10:30:00Z"
}`}</CodeBlock>
      </section>
      </div>
    </div>
  );
}
