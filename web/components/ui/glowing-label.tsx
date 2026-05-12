"use client";

import { cn } from "@/lib/utils";

interface GlowingLabelProps {
  children: React.ReactNode;
  className?: string;
}

export function GlowingLabel({ children, className }: GlowingLabelProps) {
  return (
    <div className={cn("glow-label-container", className)}>
      <span className="glow-label-glow" />
      <div className="glow-label-content">
        <span className="text-4xl font-black uppercase tracking-tighter text-foreground">
          {children}
        </span>
      </div>
    </div>
  );
}
