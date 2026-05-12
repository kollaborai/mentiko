"use client";

import { SearchNormalFilled as Search } from "@aliimam/icons";
import { ArrowDown1Filled } from "@aliimam/icons";
import { AgentAvatar } from "./agent-avatar";
import { useMemo, memo } from "react";
import { cn } from "@/lib/utils";
import type { RegistryAgent } from "@/app/api/agents/registry/route";

function formatRelativeTime(isoString: string | null): string | null {
  if (!isoString) return null;
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  const diffWeeks = Math.floor(diffDays / 7);
  if (diffWeeks < 4) return `${diffWeeks}w ago`;
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) return `${diffMonths}mo ago`;
  const diffYears = Math.floor(diffDays / 365);
  return `${diffYears}y ago`;
}

interface AgentRegistryListProps {
  agents: RegistryAgent[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  search: string;
  onSearchChange: (v: string) => void;
  roleFilter: string;
  onRoleFilterChange: (v: string) => void;
  roles: string[];
  sortBy: "name" | "role" | "chains";
  onSortChange: (v: "name" | "role" | "chains") => void;
}

function truncateRole(role: string, max = 32): string {
  if (role.length <= max) return role;
  return role.slice(0, max - 1) + "\u2026";
}

export function AgentRegistryList({
  agents,
  selectedId,
  onSelect,
  search,
  onSearchChange,
  roleFilter,
  onRoleFilterChange,
  roles,
  sortBy,
  onSortChange,
}: AgentRegistryListProps) {
  // split agents into standalone and chain-extracted groups
  const standaloneAgents = useMemo(
    () => agents.filter((a) => a.source === "standalone"),
    [agents]
  );
  const chainAgents = useMemo(
    () => agents.filter((a) => a.source === "chain"),
    [agents]
  );

  return (
    <div className="flex flex-col h-full">
      {/* search + filter row */}
      <div className="p-2 space-y-1.5">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-foreground/30" />
          <input
            type="text"
            placeholder="Search agents..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full bg-muted pl-8 pr-3 py-1.5 text-xs rounded-md outline-none placeholder:text-foreground/30 focus:ring-1 focus:ring-foreground/10"
          />
        </div>

        <div className="flex gap-1.5">
          {/* role dropdown - only show when there are multiple roles */}
          {roles.length > 1 && (
            <div className="relative flex-1">
              <select
                value={roleFilter}
                onChange={(e) => onRoleFilterChange(e.target.value)}
                className="w-full appearance-none bg-muted text-xs text-foreground/70 pl-2.5 pr-7 py-1.5 rounded-md outline-none cursor-pointer focus:ring-1 focus:ring-foreground/10"
              >
                <option value="all">All roles</option>
                {roles.map((role) => (
                  <option key={role} value={role}>
                    {truncateRole(role, 48)}
                  </option>
                ))}
              </select>
              <ArrowDown1Filled className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-foreground/30 pointer-events-none" />
            </div>
          )}
          {/* sort dropdown */}
          <div className="relative">
            <select
              value={sortBy}
              onChange={(e) => onSortChange(e.target.value as "name" | "role" | "chains")}
              className="appearance-none bg-muted text-xs text-foreground/70 pl-2.5 pr-6 py-1.5 rounded-md outline-none cursor-pointer focus:ring-1 focus:ring-foreground/10"
            >
              <option value="name">Name</option>
              <option value="role">Role</option>
              <option value="chains">Chains</option>
            </select>
            <ArrowDown1Filled className="absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-foreground/30 pointer-events-none" />
          </div>
        </div>
      </div>

      {/* list */}
      <div className="flex-1 overflow-y-auto">
        {agents.length === 0 ? (
          <div className="text-center py-12 text-xs text-foreground/30">
            {search || roleFilter !== "all"
              ? "No agents match filters"
              : "No agents found"}
          </div>
        ) : (
          <>
            {/* standalone agents section */}
            {standaloneAgents.length > 0 && (
              <>
                <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-foreground/30">
                  Standalone ({standaloneAgents.length})
                </div>
                {standaloneAgents.map((agent) => (
                  <AgentRow
                    key={agent.id}
                    agent={agent}
                    selected={selectedId === agent.id}
                    onSelect={onSelect}
                  />
                ))}
              </>
            )}

            {/* chain agents section */}
            {chainAgents.length > 0 && (
              <>
                <div className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-wider text-foreground/30">
                  Chain-extracted ({chainAgents.length})
                </div>
                {chainAgents.map((agent) => (
                  <AgentRow
                    key={agent.id}
                    agent={agent}
                    selected={selectedId === agent.id}
                    onSelect={onSelect}
                  />
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

const AgentRow = memo(function AgentRow({
  agent,
  selected,
  onSelect,
}: {
  agent: RegistryAgent;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const lastUsed = formatRelativeTime(agent.lastUsedAt);
  const hasUsage = agent.runCount > 0 || lastUsed;

  return (
    <button
      onClick={() => onSelect(agent.id)}
      className={cn(
        "w-full text-left px-3 py-2 transition-colors",
        selected ? "bg-accent" : "hover:bg-accent/50"
      )}
    >
      <div className="flex items-center gap-2.5">
        <AgentAvatar seed={agent.id} size={28} />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate leading-tight">
            {agent.name}
          </div>
          <div className="text-[10px] text-foreground/40 truncate leading-tight mt-0.5">
            {agent.role || agent.id}
          </div>
          {hasUsage && (
            <div className="text-[10px] text-foreground/30 truncate leading-tight">
              {agent.runCount > 0 && `${agent.runCount} run${agent.runCount > 1 ? "s" : ""}`}
              {agent.runCount > 0 && lastUsed && " · "}
              {lastUsed && `last used ${lastUsed}`}
            </div>
          )}
        </div>
        {agent.chains.length > 0 && (
          <span className="text-[10px] text-foreground/25 shrink-0 tabular-nums">
            {agent.chains.length}
          </span>
        )}
      </div>
    </button>
  );
});
