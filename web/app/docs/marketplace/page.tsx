"use client";

import { PageBanner } from "@/components/ui/page-banner";
import { ShopFilled, CategoryFilled, LinkFilled, BotMessageSquare, BoxFilled, ComponentFilled } from "@aliimam/icons";
import { ArrowRight, MonitorFilled } from "@aliimam/icons";
import Link from "next/link";

const CodeBlock = ({ children }: { children: string }) => (
  <pre className="bg-muted rounded-md p-3 font-mono text-[11px] text-foreground/70 whitespace-pre overflow-x-auto mb-4">
    {children}
  </pre>
);

export default function MarketplaceDocPage() {
  return (
    <div>
      <PageBanner
        title="Marketplace"
        subtitle="Shared marketplace runtime for templates, chains, agents, artifacts, and plugins, with optional runtime sync."
        icon={ShopFilled}
        sectionColor="#5cb88a"
        actions={[
          { label: "Marketplace", href: "/marketplace", icon: ShopFilled, iconColor: "#5cb88a" },
          { label: "Templates", href: "/marketplace/templates", icon: CategoryFilled, iconColor: "#5cb88a" },
          { label: "Agents", href: "/marketplace/agents", icon: BotMessageSquare, iconColor: "#5cb88a" },
        ]}
      />
      <div className="px-6 pb-6 max-w-3xl">

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Content Types</h2>
        <div className="bg-card rounded-md p-3 text-xs text-foreground/60 space-y-1 mb-3">
          <div><strong className="text-foreground/80">Templates</strong> - packaged chain + artifact definitions for import.</div>
          <div><strong className="text-foreground/80">Chains</strong> - reusable JSON chain definitions.</div>
          <div><strong className="text-foreground/80">Agents</strong> - standalone agents and prompt/spec definitions.</div>
          <div><strong className="text-foreground/80">Artifacts</strong> - output templates and schema examples.</div>
          <div><strong className="text-foreground/80">Plugins</strong> - tool/runner extension packs.</div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Where It Lives on Disk</h2>
        <CodeBlock>{`~/.mentiko/marketplace/
├── templates/        # community template packages
├── chains/           # community chain packages
├── agents/           # standalone agent packages
├── artifacts/        # artifact schema examples
└── plugins/          # plugin extension packs`}</CodeBlock>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Sync Variables and Endpoints</h2>
        <div className="bg-card rounded-md p-3 text-xs text-foreground/60 space-y-1 mb-3">
          <div><code className="text-foreground/70">MARKETPLACE_URL</code> - source git URL (default GitHub repo).</div>
          <div><code className="text-foreground/70">MARKETPLACE_AUTO_SYNC</code> - background sync toggle.</div>
          <div><code className="text-foreground/70">MARKETPLACE_SYNC_INTERVAL</code> - interval in ms.</div>
          <div><code className="text-foreground/70">MARKETPLACE_SYNC_TIMEOUT</code> - timeout in ms.</div>
        </div>
        <CodeBlock>{`POST /api/marketplace/sync     # set url / force clone
POST /api/marketplace/refresh  # immediate refresh
GET  /api/marketplace/chains
GET  /api/agents/marketplace
GET  /api/marketplace/artifacts
GET  /api/marketplace/plugins`}</CodeBlock>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Common Operations</h2>
        <div className="bg-card rounded-md p-3 space-y-1 text-xs text-foreground/60">
          <div>Install a template from <code className="text-foreground/70">/marketplace/templates</code>.</div>
          <div>Install a chain from <code className="text-foreground/70">/marketplace/chains</code>.</div>
          <div>Browse and import standalone agents from <code className="text-foreground/70">/marketplace/agents</code>.</div>
          <div>Publish and sync internal items through org/private workflows.</div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Navigation Map</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            <Link href="/marketplace/templates" className="inline-flex items-center justify-between bg-card rounded-md px-3 py-2 border border-border/40 hover:border-foreground/30 transition-colors">
              <span className="inline-flex items-center gap-1"><CategoryFilled className="h-3 w-3" /> Templates</span>
              <ArrowRight className="h-3 w-3 text-foreground/40" />
            </Link>
          <Link href="/marketplace/chains" className="inline-flex items-center justify-between bg-card rounded-md px-3 py-2 border border-border/40 hover:border-foreground/30 transition-colors">
            <span className="inline-flex items-center gap-1"><LinkFilled className="h-3 w-3" /> Chains</span>
            <ArrowRight className="h-3 w-3 text-foreground/40" />
            </Link>
          <Link href="/marketplace/agents" className="inline-flex items-center justify-between bg-card rounded-md px-3 py-2 border border-border/40 hover:border-foreground/30 transition-colors">
            <span className="inline-flex items-center gap-1"><BotMessageSquare className="h-3 w-3" /> Agents</span>
            <ArrowRight className="h-3 w-3 text-foreground/40" />
            </Link>
          <Link href="/marketplace/artifacts" className="inline-flex items-center justify-between bg-card rounded-md px-3 py-2 border border-border/40 hover:border-foreground/30 transition-colors">
            <span className="inline-flex items-center gap-1"><BoxFilled className="h-3 w-3" /> Artifacts</span>
            <ArrowRight className="h-3 w-3 text-foreground/40" />
            </Link>
          <Link href="/marketplace/plugins" className="inline-flex items-center justify-between bg-card rounded-md px-3 py-2 border border-border/40 hover:border-foreground/30 transition-colors">
            <span className="inline-flex items-center gap-1"><ComponentFilled className="h-3 w-3" /> Plugins</span>
            <ArrowRight className="h-3 w-3 text-foreground/40" />
            </Link>
          <Link href="/docs/deployment" className="inline-flex items-center justify-between bg-card rounded-md px-3 py-2 border border-border/40 hover:border-foreground/30 transition-colors">
            <span className="inline-flex items-center gap-1"><MonitorFilled className="h-3 w-3" /> Deployment</span>
            <ArrowRight className="h-3 w-3 text-foreground/40" />
          </Link>
        </div>
      </section>
      </div>
    </div>
  );
}
