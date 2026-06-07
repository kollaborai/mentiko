"use client";

import { PageBanner } from "@/components/ui/page-banner";
import Link from "next/link";
import { ArrowRight, PeopleFilled, RouteSquareFilled, MonitorFilled } from "@aliimam/icons";

const CodeBlock = ({ children }: { children: string }) => (
  <pre className="bg-muted rounded-md p-3 font-mono text-[11px] text-foreground/70 whitespace-pre overflow-x-auto mb-4">
    {children}
  </pre>
);

export default function LinksDocPage() {
  return (
    <div>
      <PageBanner
        title="Links"
        subtitle="Operator and UX guide for two-peer collaboration, escalation flow, and live terminal-backed pair runs."
        icon={PeopleFilled}
        sectionColor="#5cb88a"
        actions={[
          { label: "Links", href: "/links", icon: PeopleFilled, iconColor: "#5cb88a" },
          { label: "Runs", href: "/runs", icon: RouteSquareFilled, iconColor: "#5b9ef5" },
        ]}
      />
      <div className="px-6 pb-6 max-w-3xl">

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">What Links Covers</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Links are preconfigured dual-agent collaboration sessions. A run has multiple rounds of input/output between two agents with optional human moderation.
        </p>
        <div className="bg-card rounded-md p-3 space-y-1 text-xs text-foreground/60 mb-3">
          <div><span className="text-foreground/70">Debate</span> - adversarial reasoning for conflict checks.</div>
          <div><span className="text-foreground/70">Collaboration</span> - complementary perspective pairing.</div>
          <div><span className="text-foreground/70">Review</span> - one agent critiques and improves outputs.</div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Primary APIs</h2>
        <CodeBlock>{`GET /api/links/list                    # list available links
GET /api/links/{id}                   # read link definition
POST /api/links/run                   # launch a link run
POST /api/links/generate               # generate link proposal from prompt
POST /api/links/generate/apply         # persist a generated link`}</CodeBlock>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Live Run Controls</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Once a run is active, monitor terminal and transcripts:
        </p>
        <CodeBlock>{`GET  /api/links/runs/{runId}/transcript   # live peer transcript
POST /api/links/runs/{runId}/reply       # inject human reply
POST /api/links/runs/{runId}/escalate    # record escalation and mark run stalled
POST /api/links/runs/{runId}/stop        # stop all link sessions`}</CodeBlock>
        <p className="text-xs text-foreground/60 leading-relaxed">
          These routes pair with live terminal output exposed by the PTY stack for real-time visibility.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Terminal and Agent View</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Each run is wired to terminal sessions and workspace context. If a run stalls, use escalate
          to record the handoff, then reply to recover context. Use stop only when the link run should terminate.
        </p>
        <CodeBlock>{`# open a link run in terminal mode
runId=run-...
curl -H "Authorization: Bearer <token>" "/api/links/runs/${"{runId}"}/transcript"`}</CodeBlock>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Troubleshooting Path</h2>
        <div className="bg-card rounded-md p-3 text-xs text-foreground/60">
          <div>Missing transcript output usually means terminal logging is delayed; verify link run files exist under namespace runs.</div>
          <div>For permission failures, check org-level chain/manage permissions and membership.</div>
          <div className="mt-2">
            For broader orchestration guidance, open
            <Link href="/docs/deployment" className="inline-flex items-center gap-1 ml-1 text-foreground/70 hover:text-foreground transition-colors">
              deployment docs
              <ArrowRight className="h-3 w-3" />
            </Link>
            .
          </div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Related Runtime Route</h2>
        <Link
          href="/links"
          className="inline-flex items-center gap-1 text-xs text-foreground/70 hover:text-foreground transition-colors"
        >
          Open links workspace
          <MonitorFilled className="h-3 w-3" />
        </Link>
      </section>
      </div>
    </div>
  );
}
