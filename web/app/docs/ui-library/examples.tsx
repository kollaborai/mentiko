"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { RaisedButton } from "@/components/ui/raised-button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { NotificationCard } from "@/components/ui/notification-card";
import { GoalCard } from "@/components/ui/goal-card";
import { TodoItem } from "@/components/ui/todo-item";
import {
  WorkflowSidebarPane,
  WorkflowSidebarFilters,
  WorkflowSidebarSearchInput,
  WorkflowSidebarSectionHeader,
  WorkflowSidebarItem,
} from "@/components/ui/workflow-sidebar";
import { CalendarEventCard } from "@/components/ui/calendar-event-card";
import { Composer } from "@/components/ui/composer";
import { SessionComposer } from "@/components/ui/session-composer";
import { NestedMenu } from "@/components/ui/nested-menu";
import { WaveSpinner } from "@/components/ui/wave-spinner";
import { StatusIndicator } from "@/components/shared/status-indicator";
import { PageBanner } from "@/components/ui/page-banner";
import { DetailHeader } from "@/components/ui/detail-header";
import { SystemStatusWidget } from "@/components/dashboard/system-status-widget";
import { RunDetailPanel } from "@/components/run/run-detail-panel";
import { RunComparison } from "@/components/run/run-comparison";
import { PerformanceTab } from "@/components/run/performance-tab";
import { DataShapesCatalog } from "@/components/docs/data-shapes-catalog";
import { KnowledgeGraph } from "@/components/ui/knowledge-graph";
import {
  LinkFilled,
  BotMessageSquare,
  RouteSquareFilled,
  CategoryFilled,
  ShopFilled,
  MagicStarFilled,
  RotateFilled,
  DocumentTextFilled,
  BoxFilled,
} from "@aliimam/icons";

function ExampleWrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 rounded-md bg-muted/50 p-4">
      <div className="text-[10px] uppercase tracking-[0.16em] text-foreground/40 mb-3">
        Live Example
      </div>
      {children}
    </div>
  );
}

function ButtonExample() {
  return (
    <ExampleWrap>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="default" size="sm">Default</Button>
        <Button variant="secondary" size="sm">Secondary</Button>
        <Button variant="outline" size="sm">Outline</Button>
        <Button variant="ghost" size="sm">Ghost</Button>
        <Button variant="destructive" size="sm">Destructive</Button>
        <Button variant="default" size="sm" loading>Loading</Button>
      </div>
    </ExampleWrap>
  );
}

function RaisedButtonExample() {
  return (
    <ExampleWrap>
      <div className="flex flex-wrap items-center gap-2">
        <RaisedButton>Default</RaisedButton>
        <RaisedButton color="#3b82f6">Blue</RaisedButton>
        <RaisedButton color="#ef4444">Red</RaisedButton>
        <RaisedButton color="#22c55e">Green</RaisedButton>
        <RaisedButton size="sm">Small</RaisedButton>
      </div>
    </ExampleWrap>
  );
}

function CardExample() {
  return (
    <ExampleWrap>
      <Card className="max-w-sm">
        <CardHeader>
          <CardTitle>Agent Config</CardTitle>
          <CardDescription>Configure your agent settings</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Card content goes here. Use for neutral layout structure.
          </p>
        </CardContent>
      </Card>
    </ExampleWrap>
  );
}

function BadgeExample() {
  return (
    <ExampleWrap>
      <div className="flex flex-wrap items-center gap-2">
        <Badge>Default</Badge>
        <Badge variant="secondary">Secondary</Badge>
        <Badge variant="outline">Outline</Badge>
        <Badge variant="destructive">Destructive</Badge>
      </div>
    </ExampleWrap>
  );
}

function InputExample() {
  return (
    <ExampleWrap>
      <div className="flex flex-col gap-2 max-w-xs">
        <Input placeholder="Search agents..." />
        <Input placeholder="Disabled" disabled />
      </div>
    </ExampleWrap>
  );
}

function TextareaExample() {
  return (
    <ExampleWrap>
      <Textarea placeholder="Enter agent prompt..." className="max-w-sm" rows={3} />
    </ExampleWrap>
  );
}

function SelectExample() {
  return (
    <ExampleWrap>
      <Select>
        <SelectTrigger className="max-w-[200px]">
          <SelectValue placeholder="Select profile..." />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="default">Default profile</SelectItem>
          <SelectItem value="fast">Fast profile</SelectItem>
          <SelectItem value="custom">Custom profile</SelectItem>
        </SelectContent>
      </Select>
    </ExampleWrap>
  );
}

function DialogExample() {
  return (
    <ExampleWrap>
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm">Open Dialog</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Action</DialogTitle>
            <DialogDescription>
              This will start the agent chain. Are you sure?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" size="sm">Cancel</Button>
            </DialogClose>
            <DialogClose asChild>
              <Button size="sm">Confirm</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ExampleWrap>
  );
}

function TabsExample() {
  const [tab, setTab] = useState("overview");
  return (
    <ExampleWrap>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="output">Output</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <p className="text-sm text-muted-foreground p-2">Overview content</p>
        </TabsContent>
        <TabsContent value="output">
          <p className="text-sm text-muted-foreground p-2">Output content</p>
        </TabsContent>
        <TabsContent value="logs">
          <p className="text-sm text-muted-foreground p-2">Log content</p>
        </TabsContent>
      </Tabs>
    </ExampleWrap>
  );
}

function NotificationCardExample() {
  return (
    <ExampleWrap>
      <div className="max-w-md">
        <NotificationCard
          id="demo-notif"
          title="Chain completed"
          body="Data pipeline finished with 3 agents in 2m 14s"
          createdAt={new Date()}
          status="unread"
          actions={[
            { id: "view", label: "View Run", type: "redirect" as const, style: "primary" as const },
          ]}
          onMarkAsRead={() => {}}
          onAction={() => {}}
        />
      </div>
    </ExampleWrap>
  );
}

function GoalCardExample() {
  return (
    <ExampleWrap>
      <div className="grid gap-2 max-w-md">
        <GoalCard title="Deploy v1.0" description="Ship to production" status="in_progress" progress={65} />
        <GoalCard title="Write tests" description="Unit + integration" status="completed" progress={100} />
      </div>
    </ExampleWrap>
  );
}

function TodoItemExample() {
  const [done, setDone] = useState(false);
  return (
    <ExampleWrap>
      <div className="max-w-md space-y-1">
        <TodoItem title="Review PR #42" description="Check for breaking changes" completed={done} onClick={() => setDone(!done)} />
        <TodoItem title="Update docs" completed={true} />
        <TodoItem title="Run integration tests" status="in-progress" />
      </div>
    </ExampleWrap>
  );
}

function WorkflowSidebarExample() {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState("item1");
  return (
    <ExampleWrap>
      <div className="max-w-xs rounded-md overflow-hidden" style={{ height: 200 }}>
        <WorkflowSidebarPane>
          <WorkflowSidebarFilters>
            <WorkflowSidebarSearchInput value={q} onChange={setQ} placeholder="Search..." />
          </WorkflowSidebarFilters>
          <WorkflowSidebarSectionHeader title="Chains" count={3} />
          <div className="space-y-1 p-1">
            <WorkflowSidebarItem selected={selected === "item1"} onClick={() => setSelected("item1")}>
              <span className="text-sm">Data Pipeline</span>
            </WorkflowSidebarItem>
            <WorkflowSidebarItem selected={selected === "item2"} onClick={() => setSelected("item2")}>
              <span className="text-sm">Code Review</span>
            </WorkflowSidebarItem>
            <WorkflowSidebarItem selected={selected === "item3"} onClick={() => setSelected("item3")}>
              <span className="text-sm">Deploy Chain</span>
            </WorkflowSidebarItem>
          </div>
        </WorkflowSidebarPane>
      </div>
    </ExampleWrap>
  );
}

function CalendarEventCardExample() {
  return (
    <ExampleWrap>
      <div className="max-w-md">
        <CalendarEventCard
          id="sched-demo"
          title="Hourly Sync"
          schedule="0 * * * *"
          timezone="America/Los_Angeles"
          status="enabled"
          enabled={true}
          runCount={142}
          onToggle={() => {}}
        />
      </div>
    </ExampleWrap>
  );
}

function ComposerExample() {
  const [messages, setMessages] = useState([
    { role: "user", text: "run the data pipeline" },
    { role: "agent", text: "Starting chain with 3 agents..." },
  ]);
  return (
    <ExampleWrap>
      <div className="rounded-md bg-card p-3">
        <div className="space-y-2 mb-3">
          {messages.map((m, i) => (
            <div
              key={i}
              className={`text-xs font-mono px-2 py-1.5 rounded ${
                m.role === "user"
                  ? "bg-foreground/5 text-foreground/80"
                  : "text-muted-foreground"
              }`}
            >
              <span className="text-foreground/40 mr-1.5">{m.role === "user" ? "you" : "agent"}</span>
              {m.text}
            </div>
          ))}
        </div>
        <Composer
          placeholder="Send a message to the agent..."
          onSubmit={(text) => {
            setMessages((prev) => [...prev, { role: "user", text }]);
            setTimeout(() => {
              setMessages((prev) => [...prev, { role: "agent", text: "Got it, processing..." }]);
            }, 500);
          }}
        />
      </div>
    </ExampleWrap>
  );
}

function SessionComposerExample() {
  return (
    <ExampleWrap>
      <SessionComposer online sessionName="claude-main" onSubmit={() => {}} />
    </ExampleWrap>
  );
}

function NestedMenuExample() {
  const [val, setVal] = useState("general");
  return (
    <ExampleWrap>
      <div className="max-w-xs">
        <NestedMenu
          items={[
            { id: "general", label: "General" },
            {
              id: "settings",
              label: "Settings",
              children: [
                { id: "profile", label: "Profile" },
                { id: "security", label: "Security" },
              ],
            },
            { id: "billing", label: "Billing" },
          ]}
          value={val}
          onChange={setVal}
        />
      </div>
    </ExampleWrap>
  );
}

function WaveSpinnerExample() {
  return (
    <ExampleWrap>
      <div className="flex items-center gap-6">
        <div className="text-center">
          <WaveSpinner color="primary" size="sm" />
          <p className="text-xs text-muted-foreground mt-2">sm</p>
        </div>
        <div className="text-center">
          <WaveSpinner color="cyan" size="md" />
          <p className="text-xs text-muted-foreground mt-2">md</p>
        </div>
        <div className="text-center">
          <WaveSpinner color="emerald" size="lg" pattern="diamond" />
          <p className="text-xs text-muted-foreground mt-2">lg diamond</p>
        </div>
      </div>
    </ExampleWrap>
  );
}

function StatusIndicatorExample() {
  return (
    <ExampleWrap>
      <div className="flex flex-wrap items-center gap-4">
        <StatusIndicator variant="success" label="Active" dotSize="sm" />
        <StatusIndicator variant="processing" label="Running" dotSize="sm" />
        <StatusIndicator variant="success" label="Completed" dotSize="sm" />
        <StatusIndicator variant="error" label="Error" dotSize="sm" />
        <StatusIndicator variant="info" label="Pending" dotSize="sm" />
        <StatusIndicator variant="neutral" label="Idle" dotSize="sm" />
      </div>
    </ExampleWrap>
  );
}

// ── Dashboard Widget Examples ──

function SystemStatusWidgetExample() {
  return (
    <ExampleWrap>
      <div className="grid grid-cols-2 gap-2">
        <SystemStatusWidget />
      </div>
    </ExampleWrap>
  );
}

function DashboardStatsExample() {
  const stats = [
    { label: "Chains", value: 12, color: "text-sky-400" },
    { label: "Running", value: 3, color: "text-emerald-400" },
    { label: "Completed", value: 847, color: "text-foreground/70" },
    { label: "Failed", value: 4, color: "text-red-400" },
    { label: "Agents", value: 18, color: "text-violet-400" },
  ];
  return (
    <ExampleWrap>
      <div className="grid grid-cols-5 gap-2">
        {stats.map((s) => (
          <div key={s.label} className="rounded-md bg-card p-3 text-center">
            <div className={`text-2xl font-bold tabular-nums ${s.color}`}>{s.value}</div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mt-1">{s.label}</div>
          </div>
        ))}
      </div>
    </ExampleWrap>
  );
}

function ActiveChainsExample() {
  const runs = [
    { name: "Data Pipeline", status: "running", goal: "Extract and transform Q1 data", time: "2m ago" },
    { name: "Code Review", status: "completed", goal: "Review PR #142 changes", time: "8m ago" },
    { name: "Deploy Staging", status: "failed", goal: "Deploy to staging env", time: "14m ago" },
  ];
  const statusDot: Record<string, string> = {
    running: "bg-emerald-400 animate-pulse",
    completed: "bg-foreground/30",
    failed: "bg-red-400",
  };
  return (
    <ExampleWrap>
      <div className="rounded-md bg-card p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase tracking-widest text-foreground/40">Active Chains</span>
          <span className="text-[10px] text-foreground/30">polling</span>
        </div>
        {runs.map((r) => (
          <div key={r.name} className="flex items-center gap-2 rounded bg-muted/50 px-2 py-1.5">
            <div className={`h-1.5 w-1.5 rounded-full shrink-0 ${statusDot[r.status]}`} />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium truncate">{r.name}</div>
              <div className="text-[10px] text-muted-foreground truncate">{r.goal}</div>
            </div>
            <span className="text-[10px] text-foreground/30 shrink-0">{r.time}</span>
          </div>
        ))}
      </div>
    </ExampleWrap>
  );
}

function RecentRunsExample() {
  const runs = [
    { name: "Data Pipeline", status: "completed", cost: "$0.12", time: "3m ago" },
    { name: "Test Suite", status: "completed", cost: "$0.08", time: "12m ago" },
    { name: "Deploy Prod", status: "failed", cost: "$0.04", time: "18m ago" },
    { name: "Lint Fix", status: "completed", cost: "$0.02", time: "25m ago" },
    { name: "DB Migration", status: "completed", cost: "$0.06", time: "1h ago" },
  ];
  const statusIcon: Record<string, string> = { completed: "text-emerald-400", failed: "text-red-400" };
  return (
    <ExampleWrap>
      <div className="rounded-md bg-card p-3 space-y-1.5">
        <span className="text-xs uppercase tracking-widest text-foreground/40">Recent Runs</span>
        {runs.map((r) => (
          <div key={r.name + r.time} className="flex items-center gap-2 text-xs py-0.5">
            <span className={`${statusIcon[r.status]}`}>{r.status === "completed" ? "+" : "x"}</span>
            <span className="flex-1 truncate">{r.name}</span>
            <span className="text-muted-foreground font-mono">{r.cost}</span>
            <span className="text-foreground/30">{r.time}</span>
          </div>
        ))}
      </div>
    </ExampleWrap>
  );
}

function ActivityFeedExample() {
  const items = [
    { type: "event", label: "agent.completed", source: "extractor", time: "1m ago" },
    { type: "run", label: "Data Pipeline started", source: "chain-runner", time: "2m ago" },
    { type: "event", label: "chain.triggered", source: "scheduler", time: "5m ago" },
  ];
  return (
    <ExampleWrap>
      <div className="rounded-md bg-card p-3 space-y-2">
        <span className="text-xs uppercase tracking-widest text-foreground/40">Activity</span>
        {items.map((item, i) => (
          <div key={i} className="flex items-start gap-2 text-xs">
            <span className={`mt-0.5 h-1.5 w-1.5 rounded-full shrink-0 ${item.type === "event" ? "bg-sky-400" : "bg-violet-400"}`} />
            <div className="flex-1 min-w-0">
              <span className="font-mono text-foreground/80">{item.label}</span>
              <span className="text-foreground/30 ml-1.5">{item.source}</span>
            </div>
            <span className="text-foreground/30 shrink-0">{item.time}</span>
          </div>
        ))}
      </div>
    </ExampleWrap>
  );
}

function QuickActionsExample() {
  const actions = [
    { label: "New Chain", key: "n" },
    { label: "Run Chain", key: "r" },
    { label: "View Runs", key: "v" },
    { label: "Schedules", key: "s" },
  ];
  return (
    <ExampleWrap>
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => (
          <button
            key={a.label}
            className="flex items-center gap-1.5 rounded-md bg-card px-3 py-1.5 text-xs text-foreground/70 hover:bg-accent transition-colors"
          >
            {a.label}
            <kbd className="ml-1 rounded bg-muted px-1 py-0.5 text-[9px] font-mono text-foreground/30">{a.key}</kbd>
          </button>
        ))}
        <button className="flex items-center gap-1.5 rounded-md bg-red-500/10 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/20 transition-colors">
          Stop All
        </button>
      </div>
    </ExampleWrap>
  );
}

function RunsChartExample() {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const values = [4, 7, 3, 12, 8, 2, 6];
  const max = Math.max(...values);
  return (
    <ExampleWrap>
      <div className="rounded-md bg-card p-3">
        <span className="text-xs uppercase tracking-widest text-foreground/40">Runs (7d)</span>
        <div className="flex items-end gap-1.5 mt-3" style={{ height: 64 }}>
          {days.map((d, i) => (
            <div key={d} className="flex-1 flex flex-col items-end justify-end gap-1" style={{ height: "100%" }}>
              <div
                className="w-full rounded-sm bg-sky-400/60"
                style={{ height: Math.round((values[i] / max) * 52), minHeight: 2 }}
              />
              <span className="text-[9px] text-foreground/30 w-full text-center">{d}</span>
            </div>
          ))}
        </div>
      </div>
    </ExampleWrap>
  );
}

function UpdatesWidgetExample() {
  return (
    <ExampleWrap>
      <div className="rounded-md bg-card p-3 space-y-2">
        <span className="text-xs uppercase tracking-widest text-foreground/40">Updates</span>
        {[
          { ver: "v0.28", title: "Guided decision flow", date: "Mar 15" },
          { ver: "v0.27", title: "Secrets vault", date: "Mar 12" },
          { ver: "v0.26", title: "Schedule system", date: "Mar 10" },
        ].map((r) => (
          <div key={r.ver} className="flex items-center gap-2 text-xs">
            <span className="font-mono text-foreground/50">{r.ver}</span>
            <span className="flex-1 truncate">{r.title}</span>
            <span className="text-foreground/30">{r.date}</span>
          </div>
        ))}
      </div>
    </ExampleWrap>
  );
}

function PageBannerExample() {
  return (
    <ExampleWrap>
      <div className="rounded-md overflow-hidden bg-background">
        <PageBanner
          title="Chains"
          subtitle="Define agent workflows as visual pipelines. Build multi-agent chains with triggers, event routing, and branching logic."
          icon={LinkFilled}
          sectionColor="#b07ee8"
          actions={[
            { label: "Agents", href: "/agents", icon: BotMessageSquare, iconColor: "#b07ee8" },
            { label: "Runs", href: "/runs", icon: RouteSquareFilled, iconColor: "#5b9ef5" },
            { label: "Templates", href: "/marketplace/templates", icon: CategoryFilled, iconColor: "#5cb88a" },
            { label: "Marketplace", href: "/marketplace/chains", icon: LinkFilled, iconColor: "#5cb88a" },
          ]}
          docs={[
            { label: "Chains Guide", href: "/docs/chains", icon: LinkFilled },
          ]}
        />
      </div>
    </ExampleWrap>
  );
}

function CharmSystemExample() {
  return (
    <ExampleWrap>
      <div className="flex flex-col gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-[0.16em] text-foreground/40 mb-2">Action Charms (destination section colors)</div>
          <div className="flex items-center gap-1">
            <span className="inline-flex items-center justify-center p-1 rounded-md text-foreground/40 hover:text-foreground/60 hover:bg-foreground/5 cursor-pointer" style={{ color: "#b07ee8" }}>
              <BotMessageSquare className="h-4 w-4" />
            </span>
            <span className="inline-flex items-center justify-center p-1 rounded-md text-foreground/40 hover:text-foreground/60 hover:bg-foreground/5 cursor-pointer" style={{ color: "#5b9ef5" }}>
              <RouteSquareFilled className="h-4 w-4" />
            </span>
            <span className="inline-flex items-center justify-center p-1 rounded-md text-foreground/40 hover:text-foreground/60 hover:bg-foreground/5 cursor-pointer" style={{ color: "#5cb88a" }}>
              <ShopFilled className="h-4 w-4" />
            </span>
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.16em] text-foreground/40 mb-2">Doc Charms (always amber)</div>
          <div className="flex items-center gap-1">
            <span className="inline-flex items-center justify-center p-1 rounded-md cursor-pointer hover:bg-foreground/5" style={{ color: "#f59e0b" }}>
              <LinkFilled className="h-4 w-4 opacity-50" />
            </span>
            <span className="inline-flex items-center justify-center p-1 rounded-md cursor-pointer hover:bg-foreground/5" style={{ color: "#f59e0b" }}>
              <DocumentTextFilled className="h-4 w-4 opacity-50" />
            </span>
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.16em] text-foreground/40 mb-2">Generate Charm (always purple)</div>
          <div className="flex items-center gap-1">
            <span className="inline-flex items-center justify-center p-1 rounded-md cursor-pointer text-purple-400 hover:text-purple-300 hover:bg-purple-500/10">
              <MagicStarFilled className="h-4 w-4" />
            </span>
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.16em] text-foreground/40 mb-2">Combined (actions | divider | docs)</div>
          <div className="flex items-center gap-1">
            <span className="inline-flex items-center justify-center p-1 rounded-md cursor-pointer" style={{ color: "#b07ee8" }}>
              <BotMessageSquare className="h-4 w-4" />
            </span>
            <span className="inline-flex items-center justify-center p-1 rounded-md cursor-pointer" style={{ color: "#5b9ef5" }}>
              <RouteSquareFilled className="h-4 w-4" />
            </span>
            <span className="inline-flex items-center justify-center p-1 rounded-md cursor-pointer text-purple-400">
              <MagicStarFilled className="h-4 w-4" />
            </span>
            <span className="w-px h-4 bg-foreground/10 mx-1" />
            <span className="inline-flex items-center justify-center p-1 rounded-md cursor-pointer" style={{ color: "#f59e0b" }}>
              <LinkFilled className="h-4 w-4 opacity-50" />
            </span>
          </div>
        </div>
      </div>
    </ExampleWrap>
  );
}

function CardWatermarkExample() {
  return (
    <ExampleWrap>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="relative overflow-hidden rounded-md bg-card p-6" style={{ minHeight: 140 }}>
          <div>
            <h3 className="text-sm font-semibold">Chain Builder</h3>
            <p className="mt-1 text-xs text-muted-foreground">Visual pipeline editor with drag-and-drop.</p>
          </div>
          <div className="absolute -bottom-8 -right-8 pointer-events-none" style={{ color: "#b07ee8", opacity: 0.1 }}>
            <LinkFilled className="h-48 w-48" />
          </div>
        </div>
        <div className="relative overflow-hidden rounded-md bg-card p-6" style={{ minHeight: 140 }}>
          <div>
            <h3 className="text-sm font-semibold">Artifact Browser</h3>
            <p className="mt-1 text-xs text-muted-foreground">Browse and manage agent output artifacts.</p>
          </div>
          <div className="absolute -bottom-8 -right-8 pointer-events-none" style={{ color: "#b07ee8", opacity: 0.1 }}>
            <BoxFilled className="h-48 w-48" />
          </div>
        </div>
      </div>
    </ExampleWrap>
  );
}

function GenerateButtonExample() {
  const [generating, setGenerating] = useState(false);
  return (
    <ExampleWrap>
      <div className="flex flex-wrap items-center gap-3">
        <div className="text-center">
          <Button
            variant="ghost"
            size="sm"
            className="bg-purple-500/10 text-purple-400 hover:bg-purple-500/20"
            onClick={() => {
              setGenerating(true);
              setTimeout(() => setGenerating(false), 2000);
            }}
            disabled={generating}
          >
            {generating
              ? <RotateFilled className="h-4 w-4 animate-spin mr-1.5" />
              : <MagicStarFilled className="h-4 w-4 mr-1.5" />}
            Generate
          </Button>
          <p className="text-[10px] text-muted-foreground mt-2">standalone button</p>
        </div>
        <div className="text-center">
          <span className="inline-flex items-center justify-center p-1 rounded-md cursor-pointer text-purple-400 hover:text-purple-300 hover:bg-purple-500/10">
            <MagicStarFilled className="h-4 w-4" />
          </span>
          <p className="text-[10px] text-muted-foreground mt-2">charm (icon-only)</p>
        </div>
      </div>
    </ExampleWrap>
  );
}

function DetailHeaderExample() {
  return (
    <ExampleWrap>
      <DetailHeader>
        <div className="min-w-0">
          <div className="text-sm font-medium">Data Pipeline</div>
          <div className="text-[10px] text-muted-foreground">Run detail · 3 agents</div>
        </div>
        <Badge variant="secondary">Running</Badge>
      </DetailHeader>
    </ExampleWrap>
  );
}

function KnowledgeGraphExample() {
  return (
    <ExampleWrap>
      <KnowledgeGraph
        className="h-64 w-full rounded-md bg-card"
        nodes={[
          { id: "chain", label: "Data Pipeline", type: "chain", size: 28 },
          { id: "research", label: "Researcher", type: "agent" },
          { id: "writer", label: "Writer", type: "agent" },
          { id: "artifact", label: "Report", type: "artifact" },
        ]}
        links={[
          { source: "chain", target: "research", label: "runs" },
          { source: "chain", target: "writer", label: "runs" },
          { source: "writer", target: "artifact", label: "produces" },
        ]}
        centerNodeId="chain"
        showLegend
        showLinkLabels
        zoomToFit
      />
    </ExampleWrap>
  );
}

function NotUsedExample() {
  return (
    <ExampleWrap>
      <div className="rounded-md border border-red-400/20 bg-red-400/5 p-3 text-xs text-foreground/60">
        Not rendered in production. This registry entry is retained only to make the audit decision visible.
      </div>
    </ExampleWrap>
  );
}

function RunDetailPanelExample() {
  return (
    <ExampleWrap>
      <div className="h-[360px] overflow-hidden rounded-md bg-card">
        <RunDetailPanel runId="ui-library-example-run" embedded />
      </div>
    </ExampleWrap>
  );
}

function RunComparisonExample() {
  return (
    <ExampleWrap>
      <RunComparison
        currentRun={{
          id: "ui-library-example-run",
          chain: "Data Pipeline",
          chainId: "ui-library-example-chain",
          goal: "Compare pipeline performance",
          started: "2026-07-27T12:00:00.000Z",
          status: "completed",
          agents: [],
        }}
        currentPerf={{ summary: { total_tokens: 1200, total_cost_usd: 0.12, total_duration_ms: 120000, total_api_calls: 8 } }}
        onClose={() => {}}
      />
    </ExampleWrap>
  );
}

function PerformanceTabExample() {
  return (
    <ExampleWrap>
      <div className="max-h-[420px] overflow-auto rounded-md bg-card">
        <PerformanceTab runId="ui-library-example-run" chainId="ui-library-example-chain" />
      </div>
    </ExampleWrap>
  );
}

function DataShapesCatalogExample() {
  return (
    <ExampleWrap>
      <div className="h-[420px] overflow-hidden rounded-md bg-card">
        <DataShapesCatalog />
      </div>
    </ExampleWrap>
  );
}

const EXAMPLES: Record<string, React.FC> = {
  button: ButtonExample,
  "raised-button": RaisedButtonExample,
  card: CardExample,
  badge: BadgeExample,
  input: InputExample,
  textarea: TextareaExample,
  select: SelectExample,
  dialog: DialogExample,
  tabs: TabsExample,
  "notification-card": NotificationCardExample,
  "goal-card": GoalCardExample,
  "todo-item": TodoItemExample,
  "workflow-card": NotUsedExample,
  "workflow-sidebar": WorkflowSidebarExample,
  "calendar-event-card": CalendarEventCardExample,
  composer: ComposerExample,
  "session-composer": SessionComposerExample,
  "nested-menu": NestedMenuExample,
  "wave-spinner": WaveSpinnerExample,
  "status-indicator": StatusIndicatorExample,
  "knowledge-graph": KnowledgeGraphExample,
  "dashboard-stats": DashboardStatsExample,
  "system-status-widget": SystemStatusWidgetExample,
  "active-chains": ActiveChainsExample,
  "recent-runs": RecentRunsExample,
  "activity-feed": ActivityFeedExample,
  "quick-actions": QuickActionsExample,
  "runs-chart": RunsChartExample,
  "updates-widget": UpdatesWidgetExample,
  "page-banner": PageBannerExample,
  "detail-header": DetailHeaderExample,
  "run-detail-panel": RunDetailPanelExample,
  "run-comparison": RunComparisonExample,
  "performance-tab": PerformanceTabExample,
  "data-shapes-catalog": DataShapesCatalogExample,
  "charm-system": CharmSystemExample,
  "card-watermark": CardWatermarkExample,
  "generate-button": GenerateButtonExample,
};

export function ComponentExample({ id }: { id: string }) {
  const Example = EXAMPLES[id];
  if (!Example) return null;
  return <Example />;
}
