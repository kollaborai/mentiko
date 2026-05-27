"use client";

import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import { SearchNormalFilled as Search } from "@aliimam/icons";
import { ArrowDown1Filled, ArrowRight1Filled } from "@aliimam/icons";
import { cn } from "@/lib/utils";
import { Input } from "./input";

export interface WorkflowSidebarOption<T extends string = string> {
  value: T;
  label: string;
}

interface WorkflowSidebarPaneProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  patternStyle?: CSSProperties;
}

export function WorkflowSidebarPane({
  children,
  className,
  style,
  patternStyle,
}: WorkflowSidebarPaneProps) {
  return (
    <div
      data-testid="workflow-sidebar-pane"
      data-workflow-sidebar-pane=""
      className={cn(
        "relative flex shrink-0 flex-col overflow-hidden rounded-xl border border-border/60 bg-muted",
        className
      )}
      style={style}
    >
      {patternStyle && (
        <div
          className="absolute inset-0 pointer-events-none z-0"
          style={patternStyle}
        />
      )}
      <div className="relative z-10 flex flex-1 flex-col overflow-hidden">
        {children}
      </div>
    </div>
  );
}

interface WorkflowSidebarFiltersProps {
  children: ReactNode;
  className?: string;
}

export function WorkflowSidebarFilters({
  children,
  className,
}: WorkflowSidebarFiltersProps) {
  return (
    <div
      data-testid="workflow-sidebar-filters"
      data-workflow-sidebar-filters=""
      className={cn("shrink-0 space-y-2 bg-accent p-3", className)}
    >
      {children}
    </div>
  );
}

interface WorkflowSidebarSearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className?: string;
}

export function WorkflowSidebarSearchInput({
  value,
  onChange,
  placeholder,
  className,
}: WorkflowSidebarSearchInputProps) {
  return (
    <div className="relative flex-1 min-w-0">
      <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/80" />
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        data-workflow-sidebar-search=""
        className={cn("h-8 rounded-lg bg-card pl-8 text-xs", className)}
      />
    </div>
  );
}

interface WorkflowSidebarSegmentedControlProps<T extends string = string> {
  options: Array<WorkflowSidebarOption<T>>;
  value: T;
  onChange: (value: T) => void;
  className?: string;
  buttonClassName?: string;
}

export function WorkflowSidebarSegmentedControl<T extends string = string>({
  options,
  value,
  onChange,
  className,
  buttonClassName,
}: WorkflowSidebarSegmentedControlProps<T>) {
  return (
    <div
      data-testid="workflow-sidebar-segmented-control"
      data-workflow-sidebar-control=""
      className={cn("flex items-center gap-1 rounded-xl bg-card p-0.5", className)}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            "flex-1 rounded-lg px-2 py-0.5 text-[10px] capitalize transition-colors",
            value === option.value
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground",
            buttonClassName
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export interface WorkflowSidebarVisibilityOption<T extends string = string> {
  value: T;
  label: string;
  active: boolean;
  count?: number;
}

interface WorkflowSidebarVisibilityToggleGroupProps<T extends string = string> {
  options: Array<WorkflowSidebarVisibilityOption<T>>;
  onToggle: (value: T) => void;
  className?: string;
}

export function WorkflowSidebarVisibilityToggleGroup<T extends string = string>({
  options,
  onToggle,
  className,
}: WorkflowSidebarVisibilityToggleGroupProps<T>) {
  return (
    <div
      data-testid="workflow-sidebar-visibility-toggle"
      data-workflow-sidebar-control=""
      className={cn("grid grid-cols-2 gap-1 rounded-xl bg-card p-0.5", className)}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.active}
          data-testid={`visibility-toggle-${option.value}`}
          onClick={() => onToggle(option.value)}
          className={cn(
            "flex items-center justify-center gap-1.5 rounded-lg px-2 py-1 text-[10px] transition-colors",
            option.active
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <span className="truncate">{option.label}</span>
          {typeof option.count === "number" ? (
            <span className={cn(
              "rounded-full px-1.5 py-0.5 text-[9px]",
              option.active ? "bg-background/15" : "bg-foreground/5 text-foreground/35"
            )}>
              {option.count}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

interface WorkflowSidebarSectionHeaderProps {
  title: string;
  count?: number;
  meta?: ReactNode;
  dotClassName?: string;
  collapsed?: boolean;
  onToggle?: () => void;
  onSelect?: () => void;
  selected?: boolean;
  className?: string;
}

export function WorkflowSidebarSectionHeader({
  title,
  count,
  meta,
  dotClassName,
  collapsed,
  onToggle,
  onSelect,
  selected,
  className,
}: WorkflowSidebarSectionHeaderProps) {
  const chevronIcon = onToggle ? (
    collapsed ? <ArrowRight1Filled className="h-3.5 w-3.5" /> : <ArrowDown1Filled className="h-3.5 w-3.5" />
  ) : null;

  const innerContent = (
    <>
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {dotClassName ? <span className={cn("h-2 w-2 rounded-full flex-shrink-0", dotClassName)} /> : null}
        <span className="text-[9px] font-semibold uppercase tracking-widest text-foreground/25 truncate">
          {title}
        </span>
      </div>
      <div className="flex items-center gap-2 text-foreground/30 flex-shrink-0">
        {meta ? <span className="text-[10px]">{meta}</span> : null}
        {typeof count === "number" ? <span className="text-[10px]">{count}</span> : null}
      </div>
    </>
  );

  // when onSelect exists: outer button = select, chevron span = toggle (no nested buttons)
  if (onSelect) {
    return (
      <div className={cn("flex items-center", className)}>
        <button
          type="button"
          onClick={onSelect}
          className={cn(
            "flex flex-1 items-center justify-between px-2 py-1 text-left rounded-sm transition-colors min-w-0",
            selected ? "bg-accent" : "hover:bg-foreground/5",
          )}
        >
          {innerContent}
        </button>
        {chevronIcon && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggle!(); }}
            className="p-0.5 rounded hover:bg-foreground/5 flex-shrink-0 text-foreground/30"
          >
            {chevronIcon}
          </button>
        )}
      </div>
    );
  }

  // toggle-only: single button wrapping everything
  if (onToggle) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className={cn("flex w-full items-center justify-between px-2 py-1 text-left", className)}
      >
        {innerContent}
        <span className="text-foreground/30">{chevronIcon}</span>
      </button>
    );
  }

  return (
    <div className={cn("flex w-full items-center justify-between px-2 py-1", className)}>
      {innerContent}
    </div>
  );
}

interface WorkflowSidebarItemProps {
  children: ReactNode;
  selected?: boolean;
  onClick?: () => void;
  accentClassName?: string;
  className?: string;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

export function WorkflowSidebarItem({
  children,
  selected = false,
  onClick,
  accentClassName,
  className,
  onMouseEnter,
  onMouseLeave,
}: WorkflowSidebarItemProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!onClick) return;
    const target = event.target as HTMLElement;
    const currentTarget = event.currentTarget as HTMLElement;
    const isNestedInteractive =
      target !== currentTarget &&
      !!target.closest(
        'button, a, input, select, textarea, [role="button"], [role="link"], [contenteditable="true"]'
      );

    if (isNestedInteractive) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onClick();
    }
  };

  return (
    <div
      data-testid="workflow-sidebar-item"
      data-workflow-sidebar-item=""
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={cn(
        "group relative w-full overflow-hidden rounded-xl bg-card px-4 py-3 text-left transition-colors",
        onClick && "cursor-pointer",
        selected ? "bg-accent" : "hover:bg-accent",
        className
      )}
    >
      {accentClassName ? (
        <span className={cn("absolute bottom-4 left-0 top-4 w-1 rounded-r-full", accentClassName)} />
      ) : null}
      {children}
    </div>
  );
}

interface WorkflowSidebarResizeHandleProps {
  onMouseDown: (event: React.MouseEvent) => void;
}

export function WorkflowSidebarResizeHandle({
  onMouseDown,
}: WorkflowSidebarResizeHandleProps) {
  return (
    <div
      onMouseDown={onMouseDown}
      className="absolute right-0 top-0 z-10 h-full w-1 cursor-col-resize hover:bg-foreground/10 active:bg-foreground/15"
    />
  );
}
