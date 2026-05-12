"use client";

import { PageBanner } from "@/components/ui/page-banner";
import Link from "next/link";
import { ArrowRight, MonitorFilled, Shield, Rocket } from "@aliimam/icons";

const CodeBlock = ({ children }: { children: string }) => (
  <pre className="bg-muted rounded-md p-3 font-mono text-[11px] text-foreground/70 whitespace-pre overflow-x-auto mb-4">
    {children}
  </pre>
);

export default function EnvironmentDocPage() {
  return (
    <div>
      <PageBanner
        title="Environment"
        subtitle="Run-time variables for tenant/namespace deployment, with a release-focused checklist for reliability and auditability."
        icon={MonitorFilled}
        sectionColor="#5b9ef5"
        actions={[
          { label: "Deployment", href: "/docs/deployment", icon: Rocket, iconColor: "#5b9ef5" },
          { label: "Audit", href: "/docs/audit", icon: Shield, iconColor: "#f59e0b" },
        ]}
      />
      <div className="px-6 pb-6 max-w-3xl">

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Core Runtime</h2>
        <div className="bg-card rounded-md p-3 space-y-2 text-xs text-foreground/60 mb-3">
          <div><code className="text-foreground/70">MENTIKO_GLOBAL_ROOT</code> - data root (default <code>~/.mentiko</code>)</div>
          <div><code className="text-foreground/70">MENTIKO_CODE_ROOT</code> - code checkout root for binaries and scripts</div>
          <div><code className="text-foreground/70">NAMESPACE_ID</code> - namespace namespace-id</div>
          <div><code className="text-foreground/70">ORG_ID</code> - org identifier</div>
          <div><code className="text-foreground/70">DATABASE_URL</code> - optional postgres, sqlite fallback uses <code>~/.mentiko/data/auth.db</code></div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Authentication and Security</h2>
        <div className="bg-card rounded-md p-3 space-y-2 text-xs text-foreground/60 mb-3">
          <div><code className="text-foreground/70">BETTER_AUTH_SECRET</code> - required for production sessions</div>
          <div><code className="text-foreground/70">BETTER_AUTH_URL</code> - canonical site URL for callbacks</div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Marketplace Sync</h2>
        <div className="bg-card rounded-md p-3 space-y-2 text-xs text-foreground/60 mb-3">
          <div><code className="text-foreground/70">MARKETPLACE_URL</code> - git URL for marketplace repo</div>
          <div><code className="text-foreground/70">MARKETPLACE_AUTO_SYNC</code> - false disables background marketplace refresh</div>
          <div><code className="text-foreground/70">MARKETPLACE_SYNC_INTERVAL</code> - refresh interval in ms</div>
          <div><code className="text-foreground/70">MARKETPLACE_SYNC_TIMEOUT</code> - sync command timeout in ms</div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Audit Shipping</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Include all four in tenant containers when shipping is enabled:
        </p>
        <div className="bg-card rounded-md p-3 space-y-2 text-xs text-foreground/60 mb-3">
          <div><code className="text-foreground/70">AUDIT_REMOTE_URL</code> - remote destination prefix</div>
          <div><code className="text-foreground/70">AUDIT_REMOTE_ACCESS_KEY</code> - S3 access key</div>
          <div><code className="text-foreground/70">AUDIT_REMOTE_SECRET_KEY</code> - S3 secret key</div>
          <div><code className="text-foreground/70">AUDIT_S3_ENDPOINT</code> - provider endpoint URL</div>
        </div>
        <CodeBlock>{`AUDIT_REMOTE_URL=s3://mentiko-audit/prod/default/
AUDIT_REMOTE_ACCESS_KEY=...
AUDIT_REMOTE_SECRET_KEY=...
AUDIT_S3_ENDPOINT=https://us-east-1.linodeobjects.com`}</CodeBlock>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Minimal Release Profile</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          A compact production-safe baseline:
        </p>
        <CodeBlock>{`BETTER_AUTH_SECRET=...
MENTIKO_GLOBAL_ROOT=~/.mentiko
NAMESPACE_ID=default
ORG_ID=default
AUDIT_REMOTE_URL=
MARKETPLACE_AUTO_SYNC=true
MARKETPLACE_SYNC_INTERVAL=86400000`}</CodeBlock>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Audit Docs and Runbooks</h2>
        <p className="text-xs text-foreground/60 leading-relaxed">
          For shipping setup and retention hardening, follow
          <span className="text-foreground"> docs/AUDIT_SETUP.md</span>.
          Pair that with <Link href="/docs/deployment" className="inline-flex items-center gap-1 ml-1 text-foreground/70 hover:text-foreground transition-colors">
            deployment readiness
            <ArrowRight className="h-3 w-3" />
          </Link>.
        </p>
      </section>
      </div>
    </div>
  );
}
