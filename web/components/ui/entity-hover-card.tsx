"use client";

import { useState, useEffect, type ReactNode, type ComponentType, type CSSProperties } from "react";
import Link from "next/link";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { unwrapApiData } from "@/lib/api/api-client";
import { WaveSpinner } from "@/components/ui/wave-spinner";
import {
  LinkFilled,
  CpuFilled,
  RouteSquareFilled,
  TaskSquareFilled,
  JudgeFilled,
  SendFilled,
  ClockFilled,
  PeopleFilled,
  BoxFilled,
  MagicStarFilled,
  DirectSendFilled,
  Server,
  ActivityFilled,
  BotMessageSquare,
  MessageCircleFilled,
  MonitorFilled,
  CategoryFilled,
  Webhook,
} from "@aliimam/icons";

// ─── route metadata (static) ───────────────────────────────

type IconComponent = ComponentType<{ className?: string; style?: CSSProperties }>;

interface RouteMeta {
  title: string;
  description: string;
  icon: IconComponent;
  color: string;
}

const ROUTE_META: Record<string, RouteMeta> = {
  "/chains": {
    title: "Chains",
    description: "Agent pipelines that run in sequence. Build multi-step workflows with visual or JSON editing.",
    icon: LinkFilled,
    color: "#b07ee8",
  },
  "/agents": {
    title: "Agents",
    description: "AI agent library with role-based specialization. Browse, create, and generate agents for chains.",
    icon: BotMessageSquare,
    color: "#b07ee8",
  },
  "/runs": {
    title: "Runs",
    description: "Execution history with live output, goal tracking, and agent activity timelines.",
    icon: RouteSquareFilled,
    color: "#5b9ef5",
  },
  "/tasks": {
    title: "Tasks",
    description: "Project issue tracker with epics, dependencies, chain bindings, and auto-run capabilities.",
    icon: TaskSquareFilled,
    color: "#5b9ef5",
  },
  "/decisions": {
    title: "Decisions",
    description: "AI-assisted decision framework. Research options, weigh tradeoffs, and generate execution plans.",
    icon: JudgeFilled,
    color: "#5b9ef5",
  },
  "/events": {
    title: "Events",
    description: "Cross-chain event routing. Map emit events to triggers for automated pipeline orchestration.",
    icon: SendFilled,
    color: "#b07ee8",
  },
  "/webhooks": {
    title: "Webhooks",
    description: "HTTP triggers for chains. Outbound notifications and inbound endpoints for external integrations.",
    icon: Webhook,
    color: "#b07ee8",
  },
  "/links": {
    title: "Links",
    description: "Two-agent collaboration sessions. Define debate, review, or collaboration between AI agents.",
    icon: PeopleFilled,
    color: "#b07ee8",
  },
  "/schedules": {
    title: "Schedules",
    description: "Cron-based chain execution with timezone support, conflict detection, and circuit breakers.",
    icon: ClockFilled,
    color: "#b07ee8",
  },
  "/workspaces": {
    title: "Workspaces",
    description: "Execution environments for chains. Local directories, SSH remotes, or Docker containers.",
    icon: MonitorFilled,
    color: "#f59e0b",
  },
  "/artifacts": {
    title: "Artifacts",
    description: "Output templates that agents produce. Report formats, schemas, and documentation structures.",
    icon: BoxFilled,
    color: "#b07ee8",
  },
  "/activity": {
    title: "Activity",
    description: "System-wide activity feed. Chain runs, agent events, schedule triggers, and errors.",
    icon: ActivityFilled,
    color: "#5b9ef5",
  },
  "/conversations": {
    title: "Conversations",
    description: "AI session history. Browse past interactions with Claude, Codex, Kollabor, and Aider.",
    icon: MessageCircleFilled,
    color: "#5b9ef5",
  },
  "/generation": {
    title: "Generation",
    description: "AI generation templates. Customize prompts for chain, agent, and artifact generation.",
    icon: MagicStarFilled,
    color: "#a855f7",
  },
  "/email": {
    title: "Email",
    description: "Email integration for agents. Inbound routing and outbound notifications.",
    icon: DirectSendFilled,
    color: "#b07ee8",
  },
  "/marketplace/agents": {
    title: "Agent Marketplace",
    description: "Browse and import community-built agents with pre-configured roles and capabilities.",
    icon: BotMessageSquare,
    color: "#5cb88a",
  },
  "/marketplace/chains": {
    title: "Chain Marketplace",
    description: "Browse and import community-built chain templates for common workflows.",
    icon: LinkFilled,
    color: "#5cb88a",
  },
  "/marketplace/artifacts": {
    title: "Artifact Marketplace",
    description: "Browse and import artifact templates for structured agent output.",
    icon: BoxFilled,
    color: "#5cb88a",
  },
  "/templates": {
    title: "Templates",
    description: "Chain templates with bundled agents and artifacts. Complete workflow packages.",
    icon: CategoryFilled,
    color: "#b07ee8",
  },
  "/settings/agent-configs": {
    title: "Agent Configs",
    description: "CLI execution configurations. Model selection, permissions, and runtime settings.",
    icon: CpuFilled,
    color: "#71717a",
  },
  "/settings/run-profiles": {
    title: "Run Profiles",
    description: "Named profiles for execution, model, workspace, retry, and gateway configuration.",
    icon: RouteSquareFilled,
    color: "#71717a",
  },
  "/settings/secrets": {
    title: "Secrets",
    description: "Encrypted API keys and credentials. Injected into agent environments at runtime.",
    icon: BoxFilled,
    color: "#71717a",
  },
  "/docs/chains": {
    title: "Chain Docs",
    description: "Guide to chain execution, JSON format, agent sequencing, and event wiring.",
    icon: LinkFilled,
    color: "#f59e0b",
  },
  "/docs/agents": {
    title: "Agent Docs",
    description: "Guide to agent creation, role configuration, and profile management.",
    icon: BotMessageSquare,
    color: "#f59e0b",
  },
  "/docs/runs": {
    title: "Run Docs",
    description: "Guide to run execution, output capture, and goal tracking.",
    icon: RouteSquareFilled,
    color: "#f59e0b",
  },
  "/docs/tasks": {
    title: "Task Docs",
    description: "Guide to task management, dependencies, chain bindings, and auto-run.",
    icon: TaskSquareFilled,
    color: "#f59e0b",
  },
  "/docs/decisions": {
    title: "Decision Docs",
    description: "Guide to the AI decision framework, guided flow, and plan generation.",
    icon: JudgeFilled,
    color: "#f59e0b",
  },
  "/docs/events": {
    title: "Event Docs",
    description: "Guide to cross-chain event routing and trigger definitions.",
    icon: SendFilled,
    color: "#f59e0b",
  },
  "/docs/webhooks": {
    title: "Webhook Docs",
    description: "Guide to HTTP triggers, inbound endpoints, and payload formats.",
    icon: Webhook,
    color: "#f59e0b",
  },
  "/docs/links": {
    title: "Link Docs",
    description: "Guide to two-agent collaboration sessions and relay configuration.",
    icon: PeopleFilled,
    color: "#f59e0b",
  },
  "/docs/schedules": {
    title: "Schedule Docs",
    description: "Guide to cron scheduling, timezone handling, and circuit breakers.",
    icon: ClockFilled,
    color: "#f59e0b",
  },
  "/docs/workspaces": {
    title: "Workspace Docs",
    description: "Guide to workspace types, SSH remotes, and Docker execution environments.",
    icon: MonitorFilled,
    color: "#f59e0b",
  },
  "/docs/artifacts": {
    title: "Artifact Docs",
    description: "Guide to artifact templates, output formats, and agent-produced content.",
    icon: BoxFilled,
    color: "#f59e0b",
  },
};

// ─── entity types ──────────────────────────────────────────

type EntityType =
  | "route"
  | "chain"
  | "agent"
  | "run"
  | "task"
  | "decision"
  | "schedule"
  | "link"
  | "workspace";

// ─── card content components ───────────────────────────────

function CardShell({
  icon: Icon,
  color,
  title,
  subtitle,
  children,
  href,
}: {
  icon: IconComponent;
  color: string;
  title: string;
  subtitle?: string;
  children?: ReactNode;
  href?: string;
}) {
  const content = (
    <div className="relative overflow-hidden">
      <div
        className="absolute -right-6 -bottom-6 pointer-events-none"
        style={{ color, opacity: 0.1 }}
      >
        <Icon className="h-40 w-40" />
      </div>
      <div className="relative z-10">
        <div className="flex items-center gap-2 mb-1.5">
          <Icon className="h-4 w-4 shrink-0" style={{ color }} />
          <p className="text-sm font-bold tracking-tight">{title}</p>
        </div>
        {subtitle && (
          <p className="text-[11px] text-foreground/40 mb-1">{subtitle}</p>
        )}
        {children}
      </div>
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block -m-3 p-3 rounded-xl hover:bg-accent/40 transition-colors">
        {content}
      </Link>
    );
  }
  return content;
}

function RouteCard({ href }: { href: string }) {
  const meta = ROUTE_META[href];
  if (!meta) return null;
  return (
    <CardShell
      icon={meta.icon}
      color={meta.color}
      title={meta.title}
      href={href}
    >
      <p className="text-xs text-muted-foreground leading-relaxed">
        {meta.description}
      </p>
    </CardShell>
  );
}

// ─── dynamic entity cards ──────────────────────────────────

function useLazyFetch<T>(url: string | null) {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);

  useEffect(() => {
    if (!url || fetched) return;
    setLoading(true);
    setFetched(true);
    fetchWithNamespace(url)
      .then((r) => r.json())
      .then((raw) => {
        const d = unwrapApiData<T>(raw);
        setData(d);
      })
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [url, fetched, fetchWithNamespace]);

  return { data, loading };
}

function LoadingCard() {
  return (
    <div className="flex items-center justify-center py-3">
      <WaveSpinner size="xs" color="primary" animation="ripple" />
    </div>
  );
}

interface ChainData {
  chain?: {
    name?: string;
    description?: string;
    agents?: Array<{ id?: string; name?: string }>;
    status?: string;
  };
}

function ChainCard({ id }: { id: string }) {
  const { data, loading } = useLazyFetch<ChainData>(
    `/api/chains/${encodeURIComponent(id)}`
  );
  if (loading) return <LoadingCard />;
  const chain = data?.chain;
  if (!chain) return <p className="text-xs text-foreground/40">Chain not found</p>;
  const agents = chain.agents || [];
  return (
    <CardShell
      icon={LinkFilled}
      color="#b07ee8"
      title={chain.name || id}
      subtitle={`${agents.length} agent${agents.length !== 1 ? "s" : ""}`}
      href={`/chains?id=${encodeURIComponent(id)}`}
    >
      {chain.description && (
        <p className="text-xs text-foreground/50 mt-1.5 leading-relaxed line-clamp-2">
          {chain.description}
        </p>
      )}
      {agents.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {agents.slice(0, 5).map((a, i) => (
            <span
              key={a.id || i}
              className="text-[10px] rounded-full bg-foreground/5 px-2 py-0.5 text-foreground/60"
            >
              {a.name || a.id || "unnamed"}
            </span>
          ))}
          {agents.length > 5 && (
            <span className="text-[10px] text-foreground/30">
              +{agents.length - 5} more
            </span>
          )}
        </div>
      )}
    </CardShell>
  );
}

interface AgentData {
  agent?: {
    name?: string;
    role?: string;
    model?: string;
    cli?: string;
    description?: string;
  };
}

function AgentCard({ id }: { id: string }) {
  const { data, loading } = useLazyFetch<AgentData>(
    `/api/agents/${encodeURIComponent(id)}`
  );
  if (loading) return <LoadingCard />;
  const agent = data?.agent;
  if (!agent) return <p className="text-xs text-foreground/40">Agent not found</p>;
  const subtitle = [agent.role, agent.model || agent.cli].filter(Boolean).join(" / ");
  return (
    <CardShell
      icon={BotMessageSquare}
      color="#2563eb"
      title={agent.name || id}
      subtitle={subtitle || undefined}
      href={`/agents?id=${encodeURIComponent(id)}`}
    >
      {agent.description && (
        <p className="text-xs text-foreground/50 mt-1.5 leading-relaxed line-clamp-2">
          {agent.description}
        </p>
      )}
    </CardShell>
  );
}

interface RunData {
  run?: {
    id?: string;
    status?: string;
    chain_name?: string;
    started?: string;
    finished?: string;
    agents?: Array<{ id?: string; name?: string; status?: string }>;
    goal?: string;
  };
}

function RunCard({ id }: { id: string }) {
  const { data, loading } = useLazyFetch<RunData>(
    `/api/runs/${encodeURIComponent(id)}`
  );
  if (loading) return <LoadingCard />;
  const run = data?.run;
  if (!run) return <p className="text-xs text-foreground/40">Run not found</p>;

  const statusColor =
    run.status === "running"
      ? "text-green-400"
      : run.status === "complete"
      ? "text-foreground/60"
      : run.status === "failed"
      ? "text-red-400"
      : "text-foreground/40";

  let duration = "";
  if (run.started) {
    const start = new Date(run.started).getTime();
    const end = run.finished ? new Date(run.finished).getTime() : Date.now();
    const secs = Math.round((end - start) / 1000);
    if (secs < 60) duration = `${secs}s`;
    else if (secs < 3600) duration = `${Math.round(secs / 60)}m`;
    else duration = `${Math.round(secs / 3600)}h`;
  }

  return (
    <CardShell
      icon={RouteSquareFilled}
      color="#5b9ef5"
      title={run.chain_name || `Run ${(run.id || id).slice(0, 8)}`}
      subtitle={run.goal ? run.goal.slice(0, 80) : undefined}
      href={`/runs?id=${encodeURIComponent(id)}`}
    >
      <div className="flex items-center gap-2 mt-1.5">
        <span className={`text-[10px] font-medium ${statusColor}`}>
          {run.status || "unknown"}
        </span>
        {duration && (
          <span className="text-[10px] text-foreground/30">{duration}</span>
        )}
        {run.agents && run.agents.length > 0 && (
          <span className="text-[10px] text-foreground/30">
            {run.agents.length} agent{run.agents.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>
    </CardShell>
  );
}

interface TaskData {
  issue?: {
    id?: string;
    title?: string;
    type?: string;
    priority?: number;
    status?: string;
    assignee?: string;
    description?: string;
  };
}

function TaskCard({ id }: { id: string }) {
  const { data, loading } = useLazyFetch<TaskData>(
    `/api/tasks/${encodeURIComponent(id)}`
  );
  if (loading) return <LoadingCard />;
  const task = data?.issue;
  if (!task) return <p className="text-xs text-foreground/40">Task not found</p>;

  const typeColors: Record<string, string> = {
    feature: "bg-blue-400/20 text-blue-400",
    task: "bg-foreground/10 text-foreground/60",
    bug: "bg-red-400/20 text-red-400",
    chore: "bg-amber-400/20 text-amber-400",
    epic: "bg-purple-400/20 text-purple-400",
  };

  return (
    <CardShell
      icon={TaskSquareFilled}
      color="#5b9ef5"
      title={task.title || id}
      href={`/tasks?task=${encodeURIComponent(id)}`}
    >
      <div className="flex items-center gap-1.5 mt-1.5">
        {task.type && (
          <span className={`text-[10px] rounded-full px-2 py-0.5 uppercase ${typeColors[task.type] || "bg-foreground/10 text-foreground/60"}`}>
            {task.type}
          </span>
        )}
        {task.priority !== undefined && (
          <span className="text-[10px] text-foreground/40">
            P{task.priority}
          </span>
        )}
        {task.status && (
          <span className="text-[10px] text-foreground/40">
            {task.status}
          </span>
        )}
      </div>
      {task.description && (
        <p className="text-xs text-foreground/50 mt-1.5 leading-relaxed line-clamp-2">
          {task.description}
        </p>
      )}
    </CardShell>
  );
}

interface DecisionData {
  decision?: {
    id?: string;
    title?: string;
    status?: string;
    options?: Array<{ id?: string; label?: string }>;
    description?: string;
  };
}

function DecisionCard({ id }: { id: string }) {
  const { data, loading } = useLazyFetch<DecisionData>(
    `/api/decisions/${encodeURIComponent(id)}`
  );
  if (loading) return <LoadingCard />;
  const d = data?.decision;
  if (!d) return <p className="text-xs text-foreground/40">Decision not found</p>;
  const optCount = d.options?.length || 0;
  return (
    <CardShell
      icon={JudgeFilled}
      color="#5b9ef5"
      title={d.title || id}
      subtitle={`${d.status || "unknown"} / ${optCount} option${optCount !== 1 ? "s" : ""}`}
      href={`/decisions?id=${encodeURIComponent(id)}`}
    >
      {d.description && (
        <p className="text-xs text-foreground/50 mt-1.5 leading-relaxed line-clamp-2">
          {d.description}
        </p>
      )}
    </CardShell>
  );
}

interface ScheduleData {
  schedule?: {
    id?: string;
    name?: string;
    cron?: string;
    chain_name?: string;
    enabled?: boolean;
    next_run?: string;
  };
}

function ScheduleCard({ id }: { id: string }) {
  const { data, loading } = useLazyFetch<ScheduleData>(
    `/api/schedules/${encodeURIComponent(id)}`
  );
  if (loading) return <LoadingCard />;
  const s = data?.schedule;
  if (!s) return <p className="text-xs text-foreground/40">Schedule not found</p>;
  return (
    <CardShell
      icon={ClockFilled}
      color="#b07ee8"
      title={s.name || id}
      subtitle={s.cron || undefined}
      href={`/schedules?id=${encodeURIComponent(id)}`}
    >
      <div className="flex items-center gap-2 mt-1.5">
        {s.chain_name && (
          <span className="text-[10px] rounded-full bg-foreground/5 px-2 py-0.5 text-foreground/60">
            {s.chain_name}
          </span>
        )}
        <span className={`text-[10px] ${s.enabled ? "text-green-400" : "text-foreground/30"}`}>
          {s.enabled ? "active" : "paused"}
        </span>
      </div>
    </CardShell>
  );
}

interface LinkData {
  link?: {
    id?: string;
    name?: string;
    description?: string;
    config?: { mode?: string };
    agents?: {
      agent1?: { name?: string };
      agent2?: { name?: string };
    };
  };
}

function LinkCard({ id }: { id: string }) {
  const { data, loading } = useLazyFetch<LinkData>(
    `/api/links/${encodeURIComponent(id)}`
  );
  if (loading) return <LoadingCard />;
  const l = data?.link;
  if (!l) return <p className="text-xs text-foreground/40">Link not found</p>;
  const mode = l.config?.mode || "collaboration";
  const a1 = l.agents?.agent1?.name || "Agent 1";
  const a2 = l.agents?.agent2?.name || "Agent 2";
  return (
    <CardShell
      icon={PeopleFilled}
      color="#b07ee8"
      title={l.name || id}
      subtitle={mode}
      href={`/links?id=${encodeURIComponent(id)}`}
    >
      <div className="flex items-center gap-1.5 mt-1.5">
        <span className="text-[10px] rounded-full bg-foreground/5 px-2 py-0.5 text-foreground/60">
          {a1}
        </span>
        <span className="text-[10px] text-foreground/20">x</span>
        <span className="text-[10px] rounded-full bg-foreground/5 px-2 py-0.5 text-foreground/60">
          {a2}
        </span>
      </div>
      {l.description && (
        <p className="text-xs text-foreground/50 mt-1.5 leading-relaxed line-clamp-2">
          {l.description}
        </p>
      )}
    </CardShell>
  );
}

interface WorkspaceData {
  workspace?: {
    id?: string;
    name?: string;
    type?: string;
    path?: string;
    host?: string;
  };
}

function WorkspaceCard({ id }: { id: string }) {
  const { data, loading } = useLazyFetch<WorkspaceData>(
    `/api/workspaces/${encodeURIComponent(id)}`
  );
  if (loading) return <LoadingCard />;
  const w = data?.workspace;
  if (!w) return <p className="text-xs text-foreground/40">Workspace not found</p>;
  const subtitle = w.type === "ssh" && w.host
    ? `ssh / ${w.host}`
    : w.type || "local";
  return (
    <CardShell
      icon={Server}
      color="#f59e0b"
      title={w.name || id}
      subtitle={subtitle}
      href={`/workspaces?id=${encodeURIComponent(id)}`}
    >
      {w.path && (
        <p className="text-[10px] text-foreground/30 mt-1 font-mono truncate">
          {w.path}
        </p>
      )}
    </CardShell>
  );
}

// ─── main component ────────────────────────────────────────

interface EntityHoverCardProps {
  type: EntityType;
  id?: string;
  href?: string;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
}

function EntityCardContent({ type, id, href }: { type: EntityType; id?: string; href?: string }) {
  if (type === "route" && href) return <RouteCard href={href} />;
  if (!id) return null;
  switch (type) {
    case "chain": return <ChainCard id={id} />;
    case "agent": return <AgentCard id={id} />;
    case "run": return <RunCard id={id} />;
    case "task": return <TaskCard id={id} />;
    case "decision": return <DecisionCard id={id} />;
    case "schedule": return <ScheduleCard id={id} />;
    case "link": return <LinkCard id={id} />;
    case "workspace": return <WorkspaceCard id={id} />;
    default: return null;
  }
}

export function EntityHoverCard({
  type,
  id,
  href,
  children,
  side = "bottom",
  align = "start",
}: EntityHoverCardProps) {
  // for route type, check if we have metadata
  if (type === "route" && href && !ROUTE_META[href]) {
    return <>{children}</>;
  }

  return (
    <HoverCard openDelay={200} closeDelay={100}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent side={side} align={align} className="w-80 p-4 bg-background border border-border/40 rounded-xl overflow-hidden">
        <EntityCardContent type={type} id={id} href={href} />
      </HoverCardContent>
    </HoverCard>
  );
}

// export route meta for external use (e.g. checking if a route has metadata)
export function hasRouteMeta(href: string): boolean {
  return href in ROUTE_META;
}

export { ROUTE_META };
export type { EntityType, RouteMeta };
