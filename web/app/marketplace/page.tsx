"use client";

import Link from "next/link";
import { LinkFilled, BotMessageSquare, BoxFilled, ShopFilled, CategoryFilled } from "@aliimam/icons";
import { PageBanner } from "@/components/ui/page-banner";
import type { ComponentType } from "react";

type IconComponent = ComponentType<{ className?: string }>;

interface Category {
  id: string;
  label: string;
  description: string;
  href: string;
  icon: IconComponent;
  watermarkColor: string;
}

const CATEGORIES: Category[] = [
  {
    id: "templates",
    label: "Templates",
    description: "Complete solution packages with chains, agents, and artifacts.",
    href: "/marketplace/templates",
    icon: CategoryFilled,
    watermarkColor: "#5cb88a",
  },
  {
    id: "chains",
    label: "Chains",
    description: "Community chain definitions for research, development, and automation.",
    href: "/marketplace/chains",
    icon: LinkFilled,
    watermarkColor: "#5cb88a",
  },
  {
    id: "agents",
    label: "Agents",
    description: "Specialized AI agents for any chain or standalone use.",
    href: "/marketplace/agents",
    icon: BotMessageSquare,
    watermarkColor: "#5cb88a",
  },
  {
    id: "artifacts",
    label: "Artifacts",
    description: "Output templates that agents produce — reports, schemas, docs.",
    href: "/marketplace/artifacts",
    icon: BoxFilled,
    watermarkColor: "#5cb88a",
  },
];

export default function MarketplaceOverviewPage() {
  return (
    <div className="h-full flex flex-col">
      <PageBanner
        title="Marketplace"
        subtitle="Discover and install community-built templates, chains, agents, and artifacts. Browse the shared registry to accelerate your workflow development."
        icon={ShopFilled}
        sectionColor="#5cb88a"
        actions={[
          { label: "Chains", href: "/chains", icon: LinkFilled, iconColor: "#b07ee8" },
          { label: "Agents", href: "/agents", icon: BotMessageSquare, iconColor: "#b07ee8" },
          { label: "Templates", href: "/marketplace/templates", icon: CategoryFilled, iconColor: "#5cb88a" },
        ]}
        docs={[
          { label: "Marketplace Guide", href: "/docs/marketplace", icon: ShopFilled },
        ]}
      />

      <div className="flex-1 overflow-y-auto px-4 pb-6">
        <div className="grid gap-3 sm:grid-cols-2 max-w-4xl">
          {CATEGORIES.map((cat) => {
            const WatermarkIcon = cat.icon;
            return (
              <Link
                key={cat.id}
                href={cat.href}
                className="relative block bg-background border border-border/40 rounded-xl p-4 group hover:bg-accent transition-colors overflow-hidden"
              >
                <div
                  className="absolute -right-6 -bottom-6 pointer-events-none"
                  style={{ color: cat.watermarkColor, opacity: 0.1 }}
                >
                  <WatermarkIcon className="h-48 w-48" />
                </div>

                <div className="relative z-10">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <h2 className="text-sm font-bold tracking-tight">{cat.label}</h2>
                  </div>

                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {cat.description}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
