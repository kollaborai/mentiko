"use client";

import { PageBanner } from "@/components/ui/page-banner";
import Link from "next/link";
import { ArrowRight, Shield, RouteSquareFilled } from "@aliimam/icons";

const CodeBlock = ({ children }: { children: string }) => (
  <pre className="bg-muted rounded-md p-3 font-mono text-[11px] text-foreground/70 whitespace-pre overflow-x-auto mb-4">
    {children}
  </pre>
);

export default function AuditDocPage() {
  return (
    <div>
      <PageBanner
        title="Audit"
        subtitle="Track security-relevant actions and operational events, from auth sessions to run lifecycle changes."
        icon={Shield}
        sectionColor="#f59e0b"
        actions={[
          { label: "Audit Trail", href: "/settings/audit", icon: Shield, iconColor: "#f59e0b" },
          { label: "Runs", href: "/runs", icon: RouteSquareFilled, iconColor: "#5b9ef5" },
        ]}
      />
      <div className="px-6 pb-6 max-w-3xl">

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Where Audit Logs Live</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Local audit records are written to:
        </p>
        <CodeBlock>{`~/.mentiko/namespaces/{namespace-id}/audit/audit.log`}</CodeBlock>
        <p className="text-xs text-foreground/60 leading-relaxed">
          Use <code className="text-foreground/70">/settings/audit</code> to read and filter these entries from the UI.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Query and Export</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          API surface for log lookup and export:
        </p>
        <CodeBlock>{`GET /api/audit
  type     = chain_start | chain_complete | auth | ... (default: all)
  user     = exact user match
  chain    = chain name
  runId    = run id
  since    = ISO date window
  limit    = max results (default: 100)
  format   = json | csv`}</CodeBlock>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          You can also download CSV directly:
        </p>
        <CodeBlock>{`curl "/api/audit?format=csv&limit=200&user=alice"`}</CodeBlock>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Audit Detail and Explain</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          For run-level inspection and evidence traces, use:
        </p>
        <CodeBlock>{`GET /api/audit/explain
  runId   = required
  agentId = optional
  action  = optional keyword search (e.g., created, modified, deleted)`}</CodeBlock>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Remote Shipping</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Remote shipping is optional and controlled by environment variables:
        </p>
        <div className="bg-card rounded-md p-3 space-y-1 text-xs text-foreground/60">
          <div><code className="text-foreground/70">AUDIT_REMOTE_URL</code> - required target URL (for example <code>s3://bucket/tenants/{`{NAMESPACE_ID}`}/</code>)</div>
          <div><code className="text-foreground/70">AUDIT_REMOTE_ACCESS_KEY</code> - S3 access key id</div>
          <div><code className="text-foreground/70">AUDIT_REMOTE_SECRET_KEY</code> - S3 secret key</div>
          <div><code className="text-foreground/70">AUDIT_S3_ENDPOINT</code> - provider endpoint for S3-compatible stores</div>
          <div>Unset <code className="text-foreground/70">AUDIT_REMOTE_URL</code> to keep shipping disabled.</div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Setting Up Remote Shipping</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Any S3-compatible backend works (AWS S3, Cloudflare R2, Backblaze B2,
          Linode Object Storage, MinIO). Shipping runs as a background process
          on each audit write and is a silent no-op while <code className="text-foreground/70">AUDIT_REMOTE_URL</code> is
          unset, so you can deploy first and enable it later.
        </p>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          1. Create a dedicated audit bucket and generate access keys scoped to
          it (least privilege). For compliance retention, enable object-lock at
          bucket-creation time — it cannot be turned on for an existing bucket.
        </p>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          2. Set the shipping variables on each tenant container:
        </p>
        <CodeBlock>{`AUDIT_S3_ENDPOINT=https://<region>.<provider>.com
AUDIT_REMOTE_URL=s3://<your-audit-bucket>/tenants/{NAMESPACE_ID}/
AUDIT_REMOTE_ACCESS_KEY=<access-key>
AUDIT_REMOTE_SECRET_KEY=<secret-key>`}</CodeBlock>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          <code className="text-foreground/70">{`{NAMESPACE_ID}`}</code> is substituted at runtime.
          AWS S3 can leave the endpoint blank (the SDK resolves it per region).
        </p>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          3. Verify entries land remotely once a container is running:
        </p>
        <CodeBlock>{`rclone ls :s3:<your-audit-bucket>/tenants/default/
# -> 2026/04/22/audit-1713789045000-abc12345.json`}</CodeBlock>
        <p className="text-xs text-foreground/60 leading-relaxed">
          Failed uploads never block local writes — they are recorded in
          <code className="text-foreground/70"> ship-failures.log</code> (see below) with retry detail.
          The <code className="text-foreground/70">scripts/monitor-audit-ship-failures.sh</code> helper
          turns that log into a cron-delivered alert.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Failure Logs and Recovery</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Failed uploads are recorded without blocking local writes:
        </p>
        <CodeBlock>{`~/.mentiko/namespaces/{namespace-id}/audit/ship.log
~/.mentiko/namespaces/{namespace-id}/audit/ship-failures.log`}</CodeBlock>
        <p className="text-xs text-foreground/60 leading-relaxed">
          When remote upload fails, check <code className="text-foreground/70">ship-failures.log</code> first for retry details.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Access Model</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Audit access is restricted. The API is protected by the <code className="text-foreground/70">view_audit</code> named permission,
          currently intended for <code className="text-foreground/70">owner</code> and <code className="text-foreground/70">admin</code> roles.
        </p>
        <div className="bg-card rounded-md p-3 text-xs text-foreground/60">
          <Link href="/docs/environment" className="inline-flex items-center gap-1 text-foreground/70 hover:text-foreground transition-colors">
            environment and shipping variables
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </section>
      </div>
    </div>
  );
}
