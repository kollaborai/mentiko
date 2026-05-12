"use client";

import { PageBanner } from "@/components/ui/page-banner";
import { ArrowRight, Rocket, RouteSquareFilled, Shield } from "@aliimam/icons";
import Link from "next/link";

const CodeBlock = ({ children }: { children: string }) => (
  <pre className="bg-muted rounded-md p-3 font-mono text-[11px] text-foreground/70 whitespace-pre overflow-x-auto mb-4">
    {children}
  </pre>
);

export default function DeploymentDocPage() {
  return (
    <div>
      <PageBanner
        title="Deployment"
        subtitle="Release checklist for the tenant platform, from pre-flight checks to rollback and audit verification."
        icon={Rocket}
        sectionColor="#5b9ef5"
        actions={[
          { label: "Runs", href: "/runs", icon: RouteSquareFilled, iconColor: "#5b9ef5" },
          { label: "Audit", href: "/docs/audit", icon: Shield, iconColor: "#f59e0b" },
        ]}
      />
      <div className="px-6 pb-6 max-w-3xl">

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Pre-Deploy Checks</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Run these before creating images:
        </p>
        <CodeBlock>{`cd web
npm run lint
npm run build
npx tsc --noEmit`}</CodeBlock>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Build Path and Images</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Production images must be built for linux/amd64 and include the standalone Next.js output,
          platform scripts, process manager, and runtime health checks.
        </p>
        <CodeBlock>{`# verify the image architecture before rollout
docker image inspect ghcr.io/<org>/<image>:<sha> --format '{{.Architecture}}'

# expected:
amd64`}</CodeBlock>
        <div className="bg-card rounded-md p-3 text-xs text-foreground/60">
          Image should be tagged with the git SHA (not just latest) and smoke-tested before pushing.
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Post-Start Smoke Suite</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          After startup, confirm both health and critical flows:
        </p>
        <CodeBlock>{`curl -s https://tenant.example.com/api/health
curl -s https://tenant.example.com/api/runtime-env
curl -s "https://tenant.example.com/api/audit?limit=5"`}</CodeBlock>
        <div className="bg-card rounded-md p-3 text-xs text-foreground/60">
          In the UI, verify these pages load in dark mode: /dashboard, /docs/audit, /settings/audit, /marketplace, /links.
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Rollback Steps</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          If a rollout degrades, redeploy the previous known-good platform image and verify health
          before accepting new traffic.
        </p>
        <CodeBlock>{`docker pull ghcr.io/<org>/<image>:<previous-sha>
docker compose -f docker-compose.production.yml up -d --force-recreate
curl -fsS https://tenant.example.com/api/health`}</CodeBlock>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Audit Verification</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Confirm local and remote audit behavior during and after deploy.
        </p>
        <CodeBlock>{`# local
ls -l ~/.mentiko/namespaces/<namespace-id>/audit
curl -s "/api/audit?limit=25&format=csv" > /tmp/audit.csv

# remote shipping checks
tail -f ~/.mentiko/namespaces/<namespace-id>/audit/ship-failures.log`}</CodeBlock>
        <div className="bg-card rounded-md p-3 text-xs text-foreground/60">
          On-call checks should also include one explainable event via
          <Link href="/docs/audit" className="inline-flex items-center gap-1 ml-1 text-foreground/70 hover:text-foreground transition-colors">
            audit docs
            <ArrowRight className="h-3 w-3" />
          </Link>
          .
        </div>
      </section>
      </div>
    </div>
  );
}
