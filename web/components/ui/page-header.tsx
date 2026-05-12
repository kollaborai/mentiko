"use client";

import type { ReactNode } from "react";
import { Button } from "./button";
import { DocLink } from "./doc-link";
import { cn } from "@/lib/utils";

export interface PageHeaderViewOption {
  icon: React.ComponentType<{ className?: string }>;
  value: string;
  label: string;
}

interface PageHeaderProps {
  title: string;
  description?: string;
  helpHref?: string;
  views?: PageHeaderViewOption[];
  activeView?: string;
  onViewChange?: (value: string) => void;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  description,
  helpHref,
  views,
  activeView,
  onViewChange,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn("shrink-0 space-y-1 px-4 py-3", className)}>
      {/* row 1: title + help */}
      <div className="flex items-center gap-1.5">
        <h1 className="text-xl font-semibold leading-7 tracking-normal text-foreground">
          {title}
        </h1>
        {helpHref ? <DocLink href={helpHref} label={title} /> : null}
      </div>

      {/* row 2: description */}
      {description ? (
        <p className="text-xs text-foreground/50">{description}</p>
      ) : null}

      {/* row 3: toolbar */}
      {(views?.length || actions) ? (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {/* view toggle group */}
          {views?.length ? (
            <div className="flex items-center rounded-md bg-muted p-0.5">
              {views.map((v) => (
                <Button
                  key={v.value}
                  size="sm"
                  variant={activeView === v.value ? "secondary" : "ghost"}
                  onClick={() => onViewChange?.(v.value)}
                  title={v.label}
                  className="h-7 w-7 p-0"
                >
                  <v.icon className="h-3.5 w-3.5" />
                </Button>
              ))}
            </div>
          ) : null}

          {/* action buttons */}
          {actions ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {actions}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
