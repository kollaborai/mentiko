"use client";

import { ReactNode } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface EmptyStateAction {
  label: string;
  href?: string;
  onClick?: () => void;
  variant?: "default" | "outline" | "ghost";
}

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: EmptyStateAction;
  secondaryAction?: EmptyStateAction;
  /** Optional third action (e.g. a launchpad shortcut). Rendered after the secondary. */
  tertiaryAction?: EmptyStateAction;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  tertiaryAction,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center py-14 px-6 gap-3",
        className
      )}
    >
      {icon && (
        <div className="text-muted-foreground/30 mb-1">{icon}</div>
      )}
      <p className="text-sm font-medium text-foreground/70">{title}</p>
      {description && (
        <p className="text-xs text-muted-foreground max-w-xs">{description}</p>
      )}
      {(action || secondaryAction || tertiaryAction) && (
        <div className="flex flex-wrap items-center justify-center gap-2 mt-1">
          {action && (
            action.href ? (
              <Link href={action.href}>
                <Button size="sm" variant={action.variant ?? "default"}>
                  {action.label}
                </Button>
              </Link>
            ) : (
              <Button size="sm" variant={action.variant ?? "default"} onClick={action.onClick}>
                {action.label}
              </Button>
            )
          )}
          {secondaryAction && (
            secondaryAction.href ? (
              <Link href={secondaryAction.href}>
                <Button size="sm" variant={secondaryAction.variant ?? "outline"}>
                  {secondaryAction.label}
                </Button>
              </Link>
            ) : (
              <Button size="sm" variant={secondaryAction.variant ?? "outline"} onClick={secondaryAction.onClick}>
                {secondaryAction.label}
              </Button>
            )
          )}
          {tertiaryAction && (
            tertiaryAction.href ? (
              <Link href={tertiaryAction.href}>
                <Button size="sm" variant={tertiaryAction.variant ?? "ghost"}>
                  {tertiaryAction.label}
                </Button>
              </Link>
            ) : (
              <Button size="sm" variant={tertiaryAction.variant ?? "ghost"} onClick={tertiaryAction.onClick}>
                {tertiaryAction.label}
              </Button>
            )
          )}
        </div>
      )}
    </div>
  );
}
