"use client";

import Link from "next/link";
import {
  Calendar,
  MagicStarFilled,
  JudgeFilled,
  LinkFilled,
  BotMessageSquare,
  NotificationFilled,
  ClockFilled,
  RouteSquareFilled,
  TaskSquareFilled,
  Webhook,
  BoxFilled,
  PeopleFilled,
  ShieldTickFilled,
  MonitorFilled,
  CardFilled,
  HomeFilled,
  DocumentTextFilled,
} from "@aliimam/icons";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useEffect, useState, type ComponentType } from "react";
import { releases, markUpdatesRead, getUnseenCount, type Release } from "@/lib/releases";
import { PageBanner } from "@/components/ui/page-banner";

const getCategoryColor = (category: Release["category"]) => {
  switch (category) {
    case "new":
      return "bg-green-500/20 text-green-400";
    case "fix":
      return "bg-blue-500/20 text-blue-400";
    case "improvement":
      return "bg-amber-500/20 text-amber-400";
    case "security":
      return "bg-red-500/20 text-red-400";
    default:
      return "bg-muted text-foreground";
  }
};

type IconComponent = ComponentType<{ className?: string }>;

interface CardWatermark {
  icon: IconComponent;
  color: string;
}

const KEYWORD_WATERMARKS: { pattern: RegExp; icon: IconComponent; color: string }[] = [
  { pattern: /decision/i, icon: JudgeFilled, color: "#5b9ef5" },
  { pattern: /chain/i, icon: LinkFilled, color: "#b07ee8" },
  { pattern: /agent/i, icon: BotMessageSquare, color: "#b07ee8" },
  { pattern: /notification/i, icon: NotificationFilled, color: "#f59e0b" },
  { pattern: /schedule|cron/i, icon: ClockFilled, color: "#5b9ef5" },
  { pattern: /\brun\b|execution|orchestrat/i, icon: RouteSquareFilled, color: "#5b9ef5" },
  { pattern: /task/i, icon: TaskSquareFilled, color: "#5b9ef5" },
  { pattern: /webhook/i, icon: Webhook, color: "#b07ee8" },
  { pattern: /artifact/i, icon: BoxFilled, color: "#b07ee8" },
  { pattern: /marketplace/i, icon: PeopleFilled, color: "#b07ee8" },
  { pattern: /secret|encrypt|vault|security/i, icon: ShieldTickFilled, color: "#a0927b" },
  { pattern: /workspace|pty|terminal|editor/i, icon: MonitorFilled, color: "#f59e0b" },
  { pattern: /billing|stripe|subscription/i, icon: CardFilled, color: "#a0927b" },
  { pattern: /design|theme|navigation|ui/i, icon: MagicStarFilled, color: "#f59e0b" },
  { pattern: /email|smtp/i, icon: DocumentTextFilled, color: "#5b9ef5" },
  { pattern: /auth|login|signup|multi-tenant/i, icon: ShieldTickFilled, color: "#a0927b" },
  { pattern: /doc/i, icon: DocumentTextFilled, color: "#f59e0b" },
  { pattern: /config|profile|setting/i, icon: MonitorFilled, color: "#f59e0b" },
];

function getCardWatermark(title: string, description: string): CardWatermark {
  const text = `${title} ${description}`;
  for (const entry of KEYWORD_WATERMARKS) {
    if (entry.pattern.test(text)) {
      return { icon: entry.icon, color: entry.color };
    }
  }
  return { icon: MagicStarFilled, color: "#f59e0b" };
}

export default function UpdatesPage() {
  // capture unseen count BEFORE marking as read so we can show badges
  const [unseenCount, setUnseenCount] = useState(0);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUnseenCount(getUnseenCount());
    markUpdatesRead();
  }, []);

  return (
    <div className="h-full flex flex-col">
      <PageBanner
        title="Updates"
        subtitle="Platform changelog and release notes. See what's new in mentiko."
        icon={MagicStarFilled}
        sectionColor="#f59e0b"
        actions={[
          { label: "Dashboard", href: "/dashboard", icon: HomeFilled },
          { label: "Chains", href: "/chains", icon: LinkFilled, iconColor: "#b07ee8" },
          { label: "Runs", href: "/runs", icon: RouteSquareFilled, iconColor: "#5b9ef5" },
        ]}
        docs={[
          { label: "Documentation", href: "/docs", icon: DocumentTextFilled },
        ]}
      >
        <div className="mt-3 flex flex-col gap-2 text-xs">
          <div className="flex items-center gap-2 text-foreground/40">
            <span>Contributors</span>
            <a
              href="https://github.com/maarco"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-foreground/60 hover:text-foreground transition-colors"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- GitHub avatar is a tiny external badge; raw img avoids broad remote image config. */}
              <img
                src="https://github.com/maarco.png"
                alt="Marco Almazan"
                className="h-5 w-5 rounded-full"
              />
              <span>Marco Almazan</span>
            </a>
          </div>
          <div className="flex items-center gap-2 flex-wrap text-foreground/40">
            <span>Built with</span>
            <a
              href="https://claude.ai/claude-code"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground/60 hover:text-foreground transition-colors"
            >
              Claude Code
            </a>
            <span className="text-foreground/20">·</span>
            <a
              href="https://openai.com/index/introducing-codex"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground/60 hover:text-foreground transition-colors"
            >
              Codex
            </a>
            <span className="text-foreground/20">·</span>
            <a
              href="https://ui.heygaia.io"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground/60 hover:text-foreground transition-colors"
            >
              Gaia UI
            </a>
            <span className="text-foreground/20">·</span>
            <a
              href="https://aliimam.in"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground/60 hover:text-foreground transition-colors"
            >
              @aliimam/icons
            </a>
            <span className="text-foreground/20">·</span>
            <a
              href="https://ui.shadcn.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground/60 hover:text-foreground transition-colors"
            >
              shadcn/ui
            </a>
          </div>
        </div>
      </PageBanner>

      <div className="flex-1 overflow-y-auto px-4 pb-6">
        <div className="grid gap-3 sm:grid-cols-2 max-w-4xl">
          {releases.map((release, index) => {
            const isUnseen = index < unseenCount;
            const watermark = getCardWatermark(release.title, release.description);
            const WatermarkIcon = watermark.icon;
            return (
              <Link
                key={release.version}
                href={release.docsHref || "/docs"}
                className="relative block bg-background border border-border/40 rounded-xl p-4 group hover:bg-accent transition-colors overflow-hidden"
              >
                {/* watermark icon */}
                <div
                  className="absolute -right-6 -bottom-6 pointer-events-none"
                  style={{ color: watermark.color, opacity: 0.1 }}
                >
                  <WatermarkIcon className="h-48 w-48" />
                </div>

                <div className="relative z-10">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <h2 className="text-sm font-bold tracking-tight">{release.title}</h2>
                    <div className="flex items-center gap-1 shrink-0">
                      {isUnseen && (
                        <Badge className="text-[10px] px-1.5 py-0 bg-blue-500/20 text-blue-400">
                          new
                        </Badge>
                      )}
                      <Badge
                        className={cn(
                          "text-[10px] px-1.5 py-0",
                          getCategoryColor(release.category)
                        )}
                      >
                        {release.category}
                      </Badge>
                    </div>
                  </div>

                  <p className="text-xs text-muted-foreground leading-relaxed mb-2">
                    {release.description}
                  </p>

                  <div className="flex items-center gap-1.5 text-[10px] text-foreground/40">
                    <Calendar className="h-3 w-3" />
                    <span>{release.date}</span>
                    <span className="text-foreground/20">·</span>
                    <span className="font-mono">{release.version}</span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
