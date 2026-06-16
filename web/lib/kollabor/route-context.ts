/**
 * route-context.ts — maps the current app route to a short, human-readable
 * description the Kollabor assistant can use to give contextual help.
 *
 * The floating bar already knows the pathname via usePathname(); this module
 * turns that pathname into { routeLabel, routeHelp } so the model receives
 * "The user is currently on <label>: <help>" as part of a turn.
 *
 * Descriptions are intentionally terse, present-tense, and feature-focused —
 * they are prompt context, not UI copy. Keep them to one clause each.
 *
 * No React, no client state: pure functions so they can be unit-tested and
 * reused from anywhere (the bar, future server context builders, etc.).
 */

export interface RouteContextEntry {
  /** Short human label for the screen, e.g. "Runs". */
  routeLabel: string;
  /** One-clause description of what the screen is for. */
  routeHelp: string;
}

/**
 * Exact-match table, checked first. Keys are normalized pathnames (no trailing
 * slash, no query string). Most top-level app surfaces live here.
 */
const EXACT_ROUTES: Record<string, RouteContextEntry> = {
  "/": {
    routeLabel: "Dashboard",
    routeHelp: "the home overview with recent runs, quick actions, and getting-started steps",
  },
  "/chains": {
    routeLabel: "Chains",
    routeHelp: "agent pipelines that run a sequence of agents, each passing output to the next",
  },
  "/chains/new": {
    routeLabel: "New chain",
    routeHelp: "the visual builder for assembling a new agent pipeline from scratch",
  },
  "/runs": {
    routeLabel: "Runs",
    routeHelp: "the history of every chain execution, with live streaming agent output and status",
  },
  "/code": {
    routeLabel: "Code workspace",
    routeHelp: "the in-browser workspace terminal and file editor backed by a real PTY session",
  },
  "/tasks": {
    routeLabel: "Tasks",
    routeHelp: "the task board tracking epics, tasks, and chores across the workspace",
  },
  "/schedules": {
    routeLabel: "Schedules",
    routeHelp: "cron-style triggers that run chains automatically on a recurring schedule",
  },
  "/agents": {
    routeLabel: "Agents",
    routeHelp: "the agents available to use in chains, including built-ins and custom ones",
  },
  "/agents/marketplace": {
    routeLabel: "Agent marketplace",
    routeHelp: "the catalog of community agents and chain templates that can be installed",
  },
  "/conversations": {
    routeLabel: "Conversations",
    routeHelp: "saved chat threads with agents, separate from chain runs",
  },
  "/templates": {
    routeLabel: "Templates",
    routeHelp: "reusable chain definitions that can be cloned as a starting point",
  },
  "/secrets": {
    routeLabel: "Secrets vault",
    routeHelp: "encrypted credentials and API keys that agents reference at run time",
  },
  "/settings": {
    routeLabel: "Settings",
    routeHelp: "workspace and account configuration",
  },
  "/settings/agent-profiles": {
    routeLabel: "Agent profiles",
    routeHelp: "the model/provider profiles (API keys, models) agents authenticate with",
  },
  "/settings/agent-configs": {
    routeLabel: "Agent setup",
    routeHelp: "the Kollab CLI and provider-profile setup for running agents locally",
  },
  "/welcome": {
    routeLabel: "Welcome",
    routeHelp: "the first-run onboarding flow that walks a new user through initial setup",
  },
};

/**
 * Prefix table, checked when no exact match is found. Keys are leading path
 * segments; the first matching prefix wins, so order longest-first below.
 * Covers dynamic detail routes (e.g. /runs/<id>, /chains/<id>) without
 * enumerating every id.
 */
const PREFIX_ROUTES: Array<{ prefix: string; entry: RouteContextEntry }> = [
  {
    prefix: "/agents/marketplace",
    entry: {
      routeLabel: "Agent marketplace",
      routeHelp: "the catalog of community agents and chain templates that can be installed",
    },
  },
  {
    prefix: "/chains",
    entry: {
      routeLabel: "Chain detail",
      routeHelp: "a single agent pipeline's editor and configuration",
    },
  },
  {
    prefix: "/runs",
    entry: {
      routeLabel: "Run detail",
      routeHelp: "a single chain execution with its live agent output, timeline, and status",
    },
  },
  {
    prefix: "/code",
    entry: {
      routeLabel: "Code workspace",
      routeHelp: "the in-browser workspace terminal and file editor backed by a real PTY session",
    },
  },
  {
    prefix: "/tasks",
    entry: {
      routeLabel: "Task detail",
      routeHelp: "a single task or epic with its description, status, and linked runs",
    },
  },
  {
    prefix: "/schedules",
    entry: {
      routeLabel: "Schedules",
      routeHelp: "cron-style triggers that run chains automatically on a recurring schedule",
    },
  },
  {
    prefix: "/agents",
    entry: {
      routeLabel: "Agent detail",
      routeHelp: "a single agent's prompt, tools, and configuration",
    },
  },
  {
    prefix: "/conversations",
    entry: {
      routeLabel: "Conversation",
      routeHelp: "a saved chat thread with an agent",
    },
  },
  {
    prefix: "/templates",
    entry: {
      routeLabel: "Templates",
      routeHelp: "reusable chain definitions that can be cloned as a starting point",
    },
  },
  {
    prefix: "/settings",
    entry: {
      routeLabel: "Settings",
      routeHelp: "workspace and account configuration",
    },
  },
];

const DEFAULT_ENTRY: RouteContextEntry = {
  routeLabel: "Mentiko",
  routeHelp: "the Mentiko agent-orchestration app for building and running agent chains",
};

/** Strip query string, hash, and any trailing slash (keeping root "/"). */
function normalizePathname(pathname: string): string {
  if (!pathname) return "/";
  let path = pathname.split("?")[0].split("#")[0];
  if (path.length > 1 && path.endsWith("/")) {
    path = path.replace(/\/+$/, "");
  }
  return path || "/";
}

/**
 * Resolve a pathname to its { routeLabel, routeHelp }. Exact matches win, then
 * the longest matching prefix, then a sensible default. Never throws.
 */
export function getRouteContext(pathname: string | null | undefined): RouteContextEntry {
  const path = normalizePathname(pathname ?? "/");

  const exact = EXACT_ROUTES[path];
  if (exact) return exact;

  for (const { prefix, entry } of PREFIX_ROUTES) {
    if (path === prefix || path.startsWith(`${prefix}/`)) {
      return entry;
    }
  }

  return DEFAULT_ENTRY;
}
