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
          Outbound webhooks configured from the Webhooks page fire on chain
          lifecycle events. Chain metadata webhooks still work for compatibility.
          Signing secrets are encrypted at rest and never returned by the API.
        </p>
        <CodeBlock>{`// webhook payload (sent to your URL)
POST https://your-endpoint.com/hook
Content-Type: application/json

{
  "event": "completed",
  "timestamp": "2026-04-14T10:30:00Z",
  "chainId": "my-chain",
  "runId": "run-xyz789",
  "chain": {
    "name": "My Chain",
    "version": "1.0.0"
  },
  "data": { "status": "complete" },
  "signature": "sha256=..."  // HMAC-SHA256 if secret configured
}`}</CodeBlock>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Available Events</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Org-level outbound webhooks support chain, run, agent, and schedule
          event names. Runtime chain events also match the short aliases
          started, completed, and failed.
        </p>
        <div className="bg-card rounded-md p-3 space-y-1 text-xs text-foreground/60 mb-3">
          <div><span className="text-foreground/70">UI subscriptions</span> - push, pull_request, pull_request_review, issues, issue_comment, deployment, deployment_status, release, star, fork, ping, custom</div>
          <div><span className="text-foreground/70">Org-level outbound</span> - chain_started, chain_complete, chain_failed, agent_started, agent_complete, agent_error, run_started, run_complete, run_failed, schedule_triggered</div>
          <div><span className="text-foreground/70">Chain metadata</span> - started, completed, failed</div>
          <div><span className="text-foreground/70">Shell sender</span> - agent_started, agent_complete, agent_error, chain_started, chain_complete, chain_error</div>
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
mwh_0a1b2c3d4e5f6789abcdef0123456789abcdef0123456789abcdef

// example: trigger from curl
curl -X POST https://your-mentiko.com/api/webhooks/inbound/mwh_... \\
  -H "Content-Type: application/json" \\
  -d '{"ref": "refs/heads/main", "repository": "my-repo"}'

// response
{
  "ok": true,
  "runId": "run-xyz789",
  "triggerId": "trig_abc",
  "statusToken": "mws_...",
  "statusUrl": "/api/webhooks/inbound/triggers/trig_abc"
}`}</CodeBlock>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Query params <code className="text-foreground/70">?ns=default&amp;org=default</code> optionally
          specify the namespace and org. The token is hashed server-side (SHA-256)
          — only the first 12 chars are shown for preview. Configure optional
          run defaults for goal, workspace, profile, executor, and payload mode
          when creating the inbound endpoint.
        </p>
        <p className="text-xs text-foreground/60 leading-relaxed">
          <span className="text-foreground/70">Idempotency:</span> send an{" "}
          <code className="text-foreground/70">Idempotency-Key</code> header (or set an
          idempotency key path like <code className="text-foreground/70">delivery.id</code> on
          the endpoint to read it from the payload). A repeated key returns the original
          trigger and run instead of starting a duplicate — retries after a failed start
          still re-run. Requests without a key behave exactly as before.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Webhook Delivery</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Outbound webhook delivery is tracked with status, HTTP code, and error
          message when the endpoint rejects or times out.
        </p>
        <div className="bg-card rounded-md p-3 text-xs text-foreground/60 space-y-1 mb-3">
          <div><span className="text-foreground/70">pending</span> - queued for delivery</div>
          <div><span className="text-foreground/70">delivered</span> - 2xx response received</div>
          <div><span className="text-foreground/70">failed</span> - 4xx/5xx response or timeout</div>
        </div>
        <p className="text-xs text-foreground/60 leading-relaxed">
          Delivery records are stored in the org-level delivery log and shown in
          the Webhooks detail panel.
        </p>
        <p className="text-xs text-foreground/60 leading-relaxed mt-3">
          <span className="text-foreground/70">Scope:</span> outbound webhooks fire for all
          chains by default, or you can scope one to a selected list of chain ids when
          creating it. Only chain events from a chain in the list will deliver.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Test Fire</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Test outbound webhooks from the detail panel. Click &quot;Test&quot; to send a
          sample payload to the configured URL and see the response status immediately.
        </p>
        <div className="bg-card rounded-md p-3 text-xs text-foreground/60 space-y-1">
          <div>UI subscriptions test with <code className="text-foreground/70">POST /api/webhooks/{'{id}'}</code></div>
          <div>Outbound config test with <code className="text-foreground/70">POST /api/webhooks/config/{'{id}'}/test</code></div>
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
          Webhooks are stored at the org level, but each path uses different files:
        </p>
        <CodeBlock>{`// storage paths (default org collapses to namespace root)
namespaces/{id}/webhooks/subscriptions.json          // UI subscriptions
namespaces/{id}/webhooks/events.jsonl                // UI event log
namespaces/{id}/inbound-webhooks.json                // inbound token configs
namespaces/{id}/inbound-webhook-triggers.json        // inbound trigger status
namespaces/{id}/mentiko-webhooks.json                // outbound configs
namespaces/{id}/mentiko-webhook-deliveries.jsonl     // outbound delivery log`}</CodeBlock>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">API Endpoints</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Manage webhooks via API:
        </p>
        <CodeBlock>{`// UI subscriptions
GET    /api/webhooks                     # list subscriptions
POST   /api/webhooks                     # create subscription
POST   /api/webhooks/{id}                # test subscription
DELETE /api/webhooks/{id}                # delete subscription
POST   /api/webhooks/{id}/receive        # receive external event

// Outbound config
GET    /api/webhooks/config              # list outbound webhooks
POST   /api/webhooks/config              # create outbound webhook
PUT    /api/webhooks/config              # update outbound webhook
GET    /api/webhooks/config/{id}         # read outbound webhook
POST   /api/webhooks/config/{id}/test    # send test delivery
DELETE /api/webhooks/config/{id}         # delete outbound webhook

// Inbound
GET    /api/webhooks/inbound/config      # list inbound endpoints
POST   /api/webhooks/inbound/config      # create inbound endpoint
PATCH  /api/webhooks/inbound/config/{id} # update or regenerate token
DELETE /api/webhooks/inbound/config/{id} # delete inbound endpoint

// Receive (no auth — token IS the auth)
POST   /api/webhooks/inbound/{token}     # trigger chain
GET    /api/webhooks/inbound/triggers/{id}?token=mws_...
                                            # check trigger and current run status

// GitHub integration
POST   /api/webhooks/github              # GitHub webhook receiver`}</CodeBlock>
      </section>
      </div>
    </div>
  );
}
