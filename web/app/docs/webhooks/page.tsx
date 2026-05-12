"use client";

import { PageBanner } from "@/components/ui/page-banner";
import { Webhook, SendFilled, LinkFilled } from "@aliimam/icons";

const CodeBlock = ({ children }: { children: string }) => (
  <pre className="bg-muted rounded-md p-3 font-mono text-[11px] text-foreground/70 whitespace-pre overflow-x-auto mb-4">
    {children}
  </pre>
);

export default function WebhooksDocPage() {
  return (
    <div>
      <PageBanner
        title="Webhooks"
        subtitle="HTTP-based integration with chains. Outbound webhooks notify external services of events. Inbound webhooks let external services trigger chains."
        icon={Webhook}
        sectionColor="#f59e0b"
        actions={[
          { label: "Webhooks", href: "/webhooks", icon: Webhook, iconColor: "#b07ee8" },
          { label: "Events", href: "/events", icon: SendFilled, iconColor: "#b07ee8" },
          { label: "Chains", href: "/chains", icon: LinkFilled, iconColor: "#b07ee8" },
        ]}
      />
      <div className="px-6 pb-6 max-w-3xl">

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Outbound Webhooks</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Outbound webhooks fire HTTP POST requests to external URLs when chain
          events occur. Configure which events trigger the webhook and optionally
          sign payloads with an HMAC secret.
        </p>
        <CodeBlock>{`// webhook payload (sent to your URL)
POST https://your-endpoint.com/hook
Content-Type: application/json

{
  "event": "chain_complete",
  "timestamp": "2026-04-14T10:30:00Z",
  "data": {
    "chainId": "my-chain",
    "runId": "run-xyz789",
    "status": "complete",
    "workspace": "my-workspace"
  },
  "signature": "sha256=..."  // HMAC-SHA256 if secret configured
}`}</CodeBlock>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Available Events</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Subscribe outbound webhooks to these chain events:
        </p>
        <div className="bg-card rounded-md p-3 space-y-1 text-xs text-foreground/60 mb-3">
          <div><span className="text-foreground/70">chain_started</span> - chain execution started</div>
          <div><span className="text-foreground/70">chain_complete</span> - chain finished successfully</div>
          <div><span className="text-foreground/70">chain_error</span> - chain failed or timed out</div>
          <div><span className="text-foreground/70">agent_started</span> - agent launched</div>
          <div><span className="text-foreground/70">agent_complete</span> - agent finished</div>
          <div><span className="text-foreground/70">agent_error</span> - agent failed</div>
          <div><span className="text-foreground/70">agent_timeout</span> - agent exceeded timeout</div>
          <div><span className="text-foreground/70">webhook_triggered</span> - chain triggered via webhook</div>
          <div><span className="text-foreground/70">schedule_triggered</span> - chain triggered by schedule</div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Signature Verification</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Outbound webhooks sign payloads with HMAC-SHA256 when a secret is configured.
          Verify the signature to ensure the payload came from this system.
        </p>
        <CodeBlock>{`// signature header sent with webhook
X-Webhook-Signature: sha256=<hex_digest>

// verification (node.js)
const crypto = require('crypto');
const payload = JSON.stringify(req.body);
const signature = req.headers['x-webhook-signature'];
const hmac = crypto.createHmac('sha256', secret);
hmac.update(payload);
const expected = "sha256=" + hmac.digest('hex');
if (signature !== expected) {
  throw new Error('Invalid signature');
}`}</CodeBlock>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Inbound Webhooks</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Inbound webhooks provide unique tokens that trigger chains or schedules when called.
          The token acts as authentication and is shown only once at creation.
        </p>
        <CodeBlock>{`// endpoint format
POST /api/webhooks/inbound/{token}
Content-Type: application/json

// token format (shown at creation, never stored plaintext)
mwh_0a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p

// example: trigger from curl
curl -X POST https://your-mentiko.com/api/webhooks/inbound/mwh_... \\
  -H "Content-Type: application/json" \\
  -d '{"ref": "refs/heads/main", "repository": "my-repo"}'

// response
{
  "ok": true,
  "runId": "run-xyz789"
}`}</CodeBlock>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Query params <code className="text-foreground/70">?ns=default&amp;org=default</code> optionally
          specify the namespace and org. The token is hashed server-side (SHA-256)
          — only the first 12 chars are shown for preview.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Webhook Delivery</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Outbound webhook delivery is tracked with status and retry logic.
        </p>
        <div className="bg-card rounded-md p-3 text-xs text-foreground/60 space-y-1 mb-3">
          <div><span className="text-foreground/70">pending</span> - queued for delivery</div>
          <div><span className="text-foreground/70">delivered</span> - 2xx response received</div>
          <div><span className="text-foreground/70">failed</span> - 4xx/5xx response or timeout</div>
        </div>
        <p className="text-xs text-foreground/60 leading-relaxed">
          Failed deliveries are retried up to 3 times with exponential backoff.
          After final failure, the delivery is marked as failed.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Test Fire</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Test outbound webhooks from the detail panel. Click &quot;Test&quot; to send a
          sample payload to the configured URL and see the response status immediately.
        </p>
        <div className="bg-card rounded-md p-3 text-xs text-foreground/60 space-y-1">
          <div>Sends sample payload to configured URL</div>
          <div>Shows response status code and message</div>
          <div>Useful for debugging endpoint issues before going live</div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Delivery History</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          View recent webhook deliveries in the detail panel with status and
          HTTP response code.
        </p>
        <CodeBlock>{`// delivery record (shown in detail panel)
{
  "id": "del-xyz789",
  "status": "delivered",
  "httpCode": 200,
  "timestamp": "2026-04-14T10:30:00Z"
}`}</CodeBlock>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Storage</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Webhooks are stored at the org level as JSON files:
        </p>
        <CodeBlock>{`// storage paths (default org collapses to namespace root)
namespaces/{id}/webhooks.json            // outbound configs
namespaces/{id}/inbound-webhooks.json    // inbound configs
namespaces/{id}/webhook-deliveries/      // delivery history`}</CodeBlock>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">API Endpoints</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Manage webhooks via API:
        </p>
        <CodeBlock>{`// Outbound
GET    /api/webhooks/config              # list outbound webhooks
POST   /api/webhooks/config              # create outbound webhook
PUT    /api/webhooks/config              # update outbound webhook
DELETE /api/webhooks/config/{id}         # delete outbound webhook
POST   /api/webhooks/config/{id}/test    # test fire

// Inbound
GET    /api/webhooks/inbound/config      # list inbound endpoints
POST   /api/webhooks/inbound/config      # create inbound endpoint
PATCH  /api/webhooks/inbound/config/{id} # update (regenerate token)
DELETE /api/webhooks/inbound/config/{id} # delete inbound endpoint

// Receive (no auth — token IS the auth)
POST   /api/webhooks/inbound/{token}     # trigger chain

// GitHub integration
POST   /api/webhooks/github              # GitHub webhook receiver`}</CodeBlock>
      </section>
      </div>
    </div>
  );
}
