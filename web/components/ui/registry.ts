export type UiLibraryStatus = "approved" | "provisional" | "planned";
export type UiLibrarySource = "gaia-derived" | "shared-app" | "radix-base";

export interface UiLibraryComponentDefinition {
  id: string;
  name: string;
  path: string;
  status: UiLibraryStatus;
  source: UiLibrarySource;
  description: string;
  usage: string;
  notes?: string;
}

export interface UiLibraryGroup {
  id: string;
  title: string;
  description: string;
  components: UiLibraryComponentDefinition[];
}

export const UI_LIBRARY_GROUPS: UiLibraryGroup[] = [
  {
    id: "foundations",
    title: "Foundations",
    description:
      "Core building blocks every workflow page should reach for before inventing local variants.",
    components: [
      {
        id: "button",
        name: "Button",
        path: "@/components/ui/button",
        status: "approved",
        source: "radix-base",
        description: "Default product button with standard variants and loading support.",
        usage: "Secondary actions, ghost actions, compact toolbar controls.",
      },
      {
        id: "raised-button",
        name: "RaisedButton",
        path: "@/components/ui/raised-button",
        status: "approved",
        source: "gaia-derived",
        description: "Gaia-style emphasis button for a single strong primary action.",
        usage: "One primary CTA per panel or page header.",
        notes: "Do not stack multiple RaisedButtons in the same dense surface.",
      },
      {
        id: "card",
        name: "Card",
        path: "@/components/ui/card",
        status: "approved",
        source: "shared-app",
        description: "Base card shell for neutral layout structure and content grouping.",
        usage: "Neutral sections, docs blocks, low-emphasis panels.",
      },
      {
        id: "badge",
        name: "Badge",
        path: "@/components/ui/badge",
        status: "approved",
        source: "shared-app",
        description: "Compact status and metadata label.",
        usage: "Status, type, count, and metadata chips.",
      },
      {
        id: "input",
        name: "Input",
        path: "@/components/ui/input",
        status: "approved",
        source: "shared-app",
        description: "Compact text input aligned with mentiko field styling.",
        usage: "Search, filters, and short form fields.",
      },
      {
        id: "textarea",
        name: "Textarea",
        path: "@/components/ui/textarea",
        status: "approved",
        source: "shared-app",
        description: "Shared multiline field for prompts, notes, and summaries.",
        usage: "Authoring and review flows.",
      },
      {
        id: "select",
        name: "Select",
        path: "@/components/ui/select",
        status: "approved",
        source: "shared-app",
        description: "Shared select menu with compact trigger styling.",
        usage: "Controlled selections in forms and filters.",
      },
      {
        id: "dialog",
        name: "Dialog / AlertDialog",
        path: "@/components/ui/dialog",
        status: "approved",
        source: "radix-base",
        description: "Modal primitives for edits, confirmations, and focused flows.",
        usage: "Create, edit, confirm, and destructive actions.",
      },
      {
        id: "tabs",
        name: "Tabs",
        path: "@/components/ui/tabs",
        status: "approved",
        source: "shared-app",
        description: "Compact tab primitive for content switching inside a page.",
        usage: "Detail panes, comparison surfaces, and subviews.",
      },
    ],
  },
  {
    id: "page-chrome",
    title: "Page Chrome",
    description:
      "Structural components that define the page shell, header, and navigation patterns.",
    components: [
      {
        id: "page-banner",
        name: "PageBanner",
        path: "@/components/ui/page-banner",
        status: "approved",
        source: "shared-app",
        description: "Full-width page header with pattern background, watermark identity icon, title, subtitle, and charm buttons. Supersedes PageHeader.",
        usage: "Every workflow and docs page. Required for all new pages.",
        notes: "Props: title, subtitle, icon, sectionColor, actions (charms), docs (doc links), children. See DESIGN_SYSTEM.md for full anatomy.",
      },
    ],
  },
  {
    id: "workflow",
    title: "Workflow Surfaces",
    description:
      "Higher-level shared components that establish the product's reusable visual language.",
    components: [
      {
        id: "notification-card",
        name: "NotificationCard",
        path: "@/components/ui/notification-card",
        status: "approved",
        source: "gaia-derived",
        description: "Shared notification surface with dense metadata and action affordances.",
        usage: "Notifications center and alert feeds.",
      },
      {
        id: "goal-card",
        name: "GoalCard",
        path: "@/components/ui/goal-card",
        status: "provisional",
        source: "gaia-derived",
        description: "Goal-oriented status card intended for progress and outcome summaries.",
        usage: "Chain goals, roadmap-style summaries, progress overviews.",
        notes: "Needs stricter alignment before becoming the default workflow summary surface.",
      },
      {
        id: "todo-item",
        name: "TodoItem",
        path: "@/components/ui/todo-item",
        status: "provisional",
        source: "gaia-derived",
        description: "Checklist row for steps and task-like subitems.",
        usage: "Agent checklists, workflow steps, compact action lists.",
        notes: "Current local API drift should be reduced before broad reuse.",
      },
      {
        id: "workflow-card",
        name: "WorkflowCard",
        path: "@/components/ui/workflow-card",
        status: "approved",
        source: "gaia-derived",
        description: "Shared summary card for runs, chains, and execution status.",
        usage: "List/detail shells and workflow overviews.",
      },
      {
        id: "workflow-sidebar",
        name: "WorkflowSidebar",
        path: "@/components/ui/workflow-sidebar",
        status: "approved",
        source: "shared-app",
        description: "Dense split-pane sidebar primitives based on the decisions workflow model.",
        usage: "Workflow list panes, search/filter strips, grouped rows, and resizable sidebars.",
      },
      {
        id: "calendar-event-card",
        name: "CalendarEventCard",
        path: "@/components/ui/calendar-event-card",
        status: "approved",
        source: "gaia-derived",
        description: "Schedule and event card with compact timing metadata.",
        usage: "Schedules, recurring tasks, event-driven pages.",
      },
      {
        id: "chat-composer",
        name: "ChatComposer / Composer",
        path: "@/components/ui/chat-composer",
        status: "approved",
        source: "gaia-derived",
        description: "Input surface for prompt-like authoring with actions.",
        usage: "Conversation, prompting, and intake-style flows.",
      },
      {
        id: "nested-menu",
        name: "NestedMenu",
        path: "@/components/ui/nested-menu",
        status: "approved",
        source: "gaia-derived",
        description: "Structured navigation primitive for settings-style sidebars.",
        usage: "Hierarchical settings and grouped navigation.",
      },
    ],
  },
  {
    id: "specialized",
    title: "Specialized and Limited-Use",
    description:
      "Components that are real shared primitives, but should only be used with clear product justification.",
    components: [
      {
        id: "holo-card",
        name: "HoloCard",
        path: "@/components/ui/holo-card",
        status: "provisional",
        source: "gaia-derived",
        description: "Tall, feature-card surface with holographic treatment and optional tilt/flip behavior.",
        usage: "Rare featured objects where the card itself is the content.",
        notes: "Not for normal workflow headers or dense decision/detail panes.",
      },
      {
        id: "wave-spinner",
        name: "WaveSpinner",
        path: "@/components/ui/wave-spinner",
        status: "approved",
        source: "shared-app",
        description: "Brand loading indicator for waiting and empty states.",
        usage: "Loading states and async transitions.",
      },
      {
        id: "status-indicator",
        name: "StatusIndicator",
        path: "@/components/ui/status-indicator",
        status: "approved",
        source: "shared-app",
        description: "Compact state indicator for online/offline or workflow signals.",
        usage: "Inline system and runtime state display.",
      },
      {
        id: "knowledge-graph",
        name: "KnowledgeGraph",
        path: "@/components/ui/knowledge-graph",
        status: "planned",
        source: "shared-app",
        description: "Graph visualization surface that needs stronger shared API boundaries.",
        usage: "Structured relationship exploration when a shared graph primitive is required.",
        notes: "Keep local until a cleaner contract exists.",
      },
    ],
  },
  {
    id: "dashboard",
    title: "Dashboard Widgets",
    description:
      "Data-driven widgets used on the dashboard. These poll APIs and display live system state.",
    components: [
      {
        id: "dashboard-stats",
        name: "DashboardStats",
        path: "@/components/dashboard-stats",
        status: "approved",
        source: "shared-app",
        description: "Stat cards grid showing chain, run, and agent counts with polling indicator.",
        usage: "Dashboard overview row, system health summaries.",
      },
      {
        id: "active-chains",
        name: "ActiveChains",
        path: "@/components/active-chains",
        status: "approved",
        source: "shared-app",
        description: "Live list of recent runs with status badges, goals, and relative timestamps.",
        usage: "Dashboard main panel, run monitoring views.",
      },
      {
        id: "recent-runs",
        name: "RecentRuns",
        path: "@/components/recent-runs",
        status: "approved",
        source: "shared-app",
        description: "Compact list of 5 most recent runs with status icons and cost display.",
        usage: "Dashboard sidebar, workspace overview.",
      },
      {
        id: "activity-feed",
        name: "ActivityFeed",
        path: "@/components/activity-feed",
        status: "approved",
        source: "shared-app",
        description: "Blended feed of events and runs with polling, status badges, and timestamps.",
        usage: "Dashboard activity panel, notification context.",
      },
      {
        id: "quick-actions",
        name: "QuickActions",
        path: "@/components/quick-actions",
        status: "approved",
        source: "shared-app",
        description: "Action button grid with 8 shortcuts and emergency stop.",
        usage: "Dashboard sidebar, command palette surface.",
      },
      {
        id: "runs-chart",
        name: "RunsChart / TopAgents",
        path: "@/components/dashboard-metrics",
        status: "approved",
        source: "shared-app",
        description: "Bar charts for 7-day run history and top 5 agents by usage.",
        usage: "Dashboard metrics section, analytics views.",
      },
      {
        id: "updates-widget",
        name: "UpdatesWidget",
        path: "@/components/updates-widget",
        status: "approved",
        source: "shared-app",
        description: "Changelog preview showing 3 most recent releases.",
        usage: "Dashboard footer, what's new section.",
      },
    ],
  },
];

export const UI_LIBRARY_RULES = [
  "Import from shared ui primitives before building page-local chrome.",
  "Use Gaia as a component reference, not permission to redesign the whole page.",
  "Normal workflow pages get a neutral header, not a hero surface.",
  "One featured visual surface per page view is the maximum.",
  "Do not put internal design-system language like 'Gaia' in user-facing copy.",
  "If a pattern will be reused, create a shared component before styling a one-off page version.",
];
