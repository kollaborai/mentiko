"use client";

import { useEffect, useState, useCallback } from "react";
import type { Template } from "@/lib/types";
import { useNamespaceFetch } from "@/lib/use-namespace-fetch";
import { unwrapApiData } from "@/lib/api-client";

const RECENT_SEARCHES_KEY = "global-search-recent";
const MAX_RECENT = 8;

export interface SearchFilter {
  chains: boolean;
  sessions: boolean;
  templates: boolean;
  agents: boolean;
  runs: boolean;
  tasks: boolean;
}

export interface SearchResult {
  id: string;
  type: "chain" | "session" | "template" | "page" | "agent" | "run" | "task";
  title: string;
  description?: string;
  url: string;
  metadata?: Record<string, unknown>;
  section?: "workflows" | "agents" | "activity" | "tasks";
}

export interface RecentSearch {
  query: string;
  timestamp: number;
}

export interface UseGlobalSearchReturn {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  query: string;
  setQuery: (query: string) => void;
  results: SearchResult[];
  loading: boolean;
  filters: SearchFilter;
  setFilters: (filters: SearchFilter) => void;
  recentSearches: RecentSearch[];
  addRecent: (query: string) => void;
  clearRecent: () => void;
  selectedIndex: number;
  setSelectedIndex: (index: number) => void;
}

const PAGES: SearchResult[] = [
  // home
  { id: "page-dashboard", type: "page", title: "Dashboard", url: "/dashboard", description: "Overview and recent activity" },
  { id: "page-updates", type: "page", title: "Updates", url: "/updates", description: "Changelog and release notes" },
  { id: "page-docs", type: "page", title: "Docs", url: "/docs", description: "Guides, architecture, and API reference" },
  { id: "page-docs-getting-started", type: "page", title: "Getting Started", url: "/docs/getting-started", description: "Quick start guide" },
  { id: "page-docs-api", type: "page", title: "API Reference", url: "/docs/api", description: "REST API documentation" },
  { id: "page-docs-architecture", type: "page", title: "Architecture", url: "/docs/architecture", description: "System architecture overview" },
  { id: "page-docs-organization", type: "page", title: "Organizations", url: "/docs/security", description: "Namespace hierarchy, org isolation, and RBAC" },
  { id: "page-docs-namespaces", type: "page", title: "Namespaces", url: "/docs/architecture", description: "Tenant boundary and namespace > org > project hierarchy" },
  // workspace
  { id: "page-runs", type: "page", title: "Runs", url: "/runs", description: "Chain execution history" },
  { id: "page-tasks", type: "page", title: "Tasks", url: "/tasks", description: "Track work items and progress" },
  { id: "page-conversations", type: "page", title: "Conversations", url: "/conversations", description: "Agent sessions and messages" },
  { id: "page-decisions", type: "page", title: "Decisions", url: "/decisions", description: "Decision dashboard" },
  { id: "page-activity", type: "page", title: "Activity", url: "/activity", description: "Activity feed across chains and agents" },
  { id: "page-code", type: "page", title: "Code Editor", url: "/code", description: "Browse and edit workspace files" },
  { id: "page-workspaces", type: "page", title: "Workspaces", url: "/workspaces", description: "Manage project workspaces" },
  { id: "page-new-workspace", type: "page", title: "New Workspace", url: "/workspaces", description: "Add a new project workspace" },
  // workflows
  { id: "page-chains", type: "page", title: "Chains", url: "/chains", description: "Build and manage agent pipelines" },
  { id: "page-agents", type: "page", title: "Agents", url: "/agents", description: "Browse agent definitions" },
  { id: "page-artifacts", type: "page", title: "Artifacts", url: "/artifacts", description: "Agent output artifacts" },
  { id: "page-generation", type: "page", title: "Generation", url: "/generation", description: "AI generation templates" },
  { id: "page-schedules", type: "page", title: "Schedules", url: "/schedules", description: "Automated chain execution" },
  { id: "page-email", type: "page", title: "Email Routes", url: "/email", description: "Inbound and outbound email for agents" },
  { id: "page-webhooks", type: "page", title: "Webhooks", url: "/webhooks", description: "HTTP triggers for chains" },
  { id: "page-events", type: "page", title: "Events", url: "/events", description: "Event log viewer" },
  { id: "page-templates", type: "page", title: "Templates", url: "/marketplace/templates", description: "Reusable chain blueprints" },
  // marketplace
  { id: "page-marketplace", type: "page", title: "Marketplace", url: "/marketplace", description: "Browse community packages" },
  { id: "page-marketplace-templates", type: "page", title: "Marketplace Templates", url: "/marketplace/templates", description: "Complete chain + agent bundles" },
  { id: "page-marketplace-chains", type: "page", title: "Marketplace Chains", url: "/marketplace/chains", description: "Community chain definitions" },
  { id: "page-marketplace-agents", type: "page", title: "Marketplace Agents", url: "/marketplace/agents", description: "Community agent definitions" },
  { id: "page-marketplace-artifacts", type: "page", title: "Marketplace Artifacts", url: "/marketplace/artifacts", description: "Output templates and schemas" },
  // notifications
  { id: "page-notifications", type: "page", title: "Notifications", url: "/notifications", description: "Notification center" },
  // settings
  { id: "page-settings", type: "page", title: "Settings", url: "/settings", description: "Configuration and profiles" },
  { id: "page-settings-account", type: "page", title: "Account Settings", url: "/settings/account", description: "User profile and password" },
  { id: "page-settings-appearance", type: "page", title: "Appearance", url: "/settings/appearance", description: "Theme and display preferences" },
  { id: "page-settings-security", type: "page", title: "Security", url: "/settings/security", description: "2FA, sessions, passwords" },
  { id: "page-settings-notifications", type: "page", title: "Notification Preferences", url: "/settings/notifications", description: "Alert and notification settings" },
  { id: "page-settings-agent-configs", type: "page", title: "Agent Configs", url: "/settings/agent-configs", description: "CLI execution configurations" },
  { id: "page-settings-secrets", type: "page", title: "Secrets", url: "/settings/secrets", description: "Encrypted API keys and credentials" },
  { id: "page-settings-sessions", type: "page", title: "Sessions", url: "/settings/sessions", description: "Active PTY sessions" },
  { id: "page-settings-email", type: "page", title: "Email Settings", url: "/settings/email", description: "Email integration configuration" },
  { id: "page-settings-data", type: "page", title: "Data Management", url: "/settings/data", description: "Data export and management" },
  { id: "page-settings-organization", type: "page", title: "Organization", url: "/settings/organization", description: "Org members and invites" },
  { id: "page-settings-system", type: "page", title: "System", url: "/settings/system", description: "System diagnostics and info" },
  { id: "page-settings-metrics", type: "page", title: "Metrics", url: "/settings/metrics", description: "Usage stats and performance charts" },
  { id: "page-settings-agent-health", type: "page", title: "Agent Health", url: "/settings/agent-health", description: "Agent diagnostics and monitoring" },
  { id: "page-settings-performance", type: "page", title: "Performance", url: "/settings/performance", description: "Performance analysis" },
  { id: "page-settings-pty", type: "page", title: "PTY Settings", url: "/settings/pty", description: "PTY manager configuration" },
];

const DEFAULT_FILTERS: SearchFilter = {
  chains: true,
  sessions: true,
  templates: true,
  agents: true,
  runs: true,
  tasks: true,
};

export function useGlobalSearch(): UseGlobalSearchReturn {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState<SearchFilter>(DEFAULT_FILTERS);
  const [recentSearches, setRecentSearches] = useState<RecentSearch[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const { fetchWithNamespace } = useNamespaceFetch();

  // load recent searches from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(RECENT_SEARCHES_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as RecentSearch[];
        setRecentSearches(parsed.slice(0, MAX_RECENT));
      }
    } catch {
      // ignore localStorage errors
    }
  }, []);

  // keyboard shortcut (cmd+k or ctrl+k) and custom event
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsOpen(prev => !prev);
      }
      // escape to close
      if (e.key === "Escape" && isOpen) {
        e.preventDefault();
        setIsOpen(false);
      }
      // arrow keys for navigation
      if (isOpen && results.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSelectedIndex(prev => (prev + 1) % results.length);
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSelectedIndex(prev => (prev - 1 + results.length) % results.length);
        }
        // enter to navigate
        if (e.key === "Enter" && results[selectedIndex]) {
          e.preventDefault();
          window.location.href = results[selectedIndex].url;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, results, selectedIndex]);

  // custom event for programmatic open (e.g. from navbar button)
  useEffect(() => {
    const handleOpenSearch = () => setIsOpen(true);
    window.addEventListener("open-global-search", handleOpenSearch);
    return () => window.removeEventListener("open-global-search", handleOpenSearch);
  }, []);

  // perform search when query or filters change
  useEffect(() => {
    const search = async () => {
      const q = query.toLowerCase().trim();

      if (!q) {
        // show all pages as quick navigation when no query
        setResults(PAGES);
        setLoading(false);
        return;
      }

      setLoading(true);

      try {
        // score and sort matching pages - exact/starts-with matches rank higher
        const scoredPages = PAGES
          .map(p => {
            const titleLower = p.title.toLowerCase();
            let score = 0;
            if (titleLower === q) score = 100;                    // exact match
            else if (titleLower.startsWith(q)) score = 80;       // starts with
            else if (titleLower.includes(q)) score = 60;         // title contains
            else if (p.description?.toLowerCase().includes(q)) score = 30; // desc contains
            return { page: p, score };
          })
          .filter(({ score }) => score > 0)
          .sort((a, b) => b.score - a.score)
          .map(({ page }) => page);

        const searchResults: SearchResult[] = [...scoredPages];

        // use unified search API
        const searchRes = await fetchWithNamespace(`/api/search?q=${encodeURIComponent(query)}`);
        if (searchRes.ok) {
          const raw = await searchRes.json();
          const data = unwrapApiData<{
            chains: Array<{ id: string; name: string; description?: string }>;
            agents: Array<{ id: string; name: string; description?: string; role?: string }>;
            runs: Array<{ id: string; chain: string; goal: string; status: string }>;
            tasks: Array<{ id: string; title: string; description?: string; status: string; issue_type: string }>;
          }>(raw);

          // add chains
          if (filters.chains && data.chains.length > 0) {
            data.chains.slice(0, 5).forEach(c => {
              searchResults.push({
                id: c.id,
                type: "chain",
                title: c.name,
                description: c.description,
                url: `/chains/${c.id}`,
                section: "workflows",
              });
            });
          }

          // add agents
          if (filters.agents && data.agents.length > 0) {
            data.agents.slice(0, 5).forEach(a => {
              searchResults.push({
                id: a.id,
                type: "agent",
                title: a.name,
                description: a.role || a.description,
                url: `/agents/${a.id}`,
                section: "agents",
              });
            });
          }

          // add runs
          if (filters.runs && data.runs.length > 0) {
            data.runs.slice(0, 5).forEach(r => {
              searchResults.push({
                id: r.id,
                type: "run",
                title: r.chain,
                description: r.goal.slice(0, 100),
                url: `/runs?runId=${r.id}`,
                metadata: { status: r.status },
                section: "activity",
              });
            });
          }

          // add tasks
          if (filters.tasks && data.tasks.length > 0) {
            data.tasks.slice(0, 5).forEach(t => {
              searchResults.push({
                id: t.id,
                type: "task",
                title: t.title,
                description: t.description,
                url: `/tasks/${t.id}`,
                metadata: { status: t.status, issue_type: t.issue_type },
                section: "tasks",
              });
            });
          }
        }

        // search sessions (conversations) - still uses separate endpoint
        if (filters.sessions) {
          const sessionsRes = await fetchWithNamespace(`/api/conversations?limit=10`);
          if (sessionsRes.ok) {
            const raw = await sessionsRes.json();
            const data = unwrapApiData<{ conversations: Array<{ sessionId: string; slug?: string; firstMessage?: string }> }>(raw);
            data.conversations
              .filter(s =>
                s.slug?.toLowerCase().includes(q) ||
                s.firstMessage?.toLowerCase().includes(q) ||
                s.sessionId.toLowerCase().includes(q)
              )
              .slice(0, 5)
              .forEach(s => {
                searchResults.push({
                  id: s.sessionId,
                  type: "session",
                  title: s.slug || s.sessionId,
                  description: s.firstMessage?.slice(0, 100),
                  url: `/conversations/${s.sessionId}`,
                  section: "activity",
                });
              });
          }
        }

        // search templates - still uses separate endpoint
        if (filters.templates) {
          const templatesRes = await fetchWithNamespace("/api/templates/list");
          if (templatesRes.ok) {
            const raw = await templatesRes.json();
            const data = unwrapApiData<{ templates: Template[] }>(raw);
            data.templates
              .filter(t =>
                t.name.toLowerCase().includes(q) ||
                t.description?.toLowerCase().includes(q) ||
                t.category.toLowerCase().includes(q) ||
                t.tags.some(tag => tag.toLowerCase().includes(q))
              )
              .slice(0, 5)
              .forEach(t => {
                searchResults.push({
                  id: t.id,
                  type: "template",
                  title: t.name,
                  description: t.description,
                  url: `/marketplace/chains/${t.slug}`,
                  metadata: { category: t.category },
                  section: "workflows",
                });
              });
          }
        }

        setResults(searchResults);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    };

    const debounced = setTimeout(search, 200);
    return () => clearTimeout(debounced);
  }, [query, filters, fetchWithNamespace]);

  // reset selection when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [results]);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => {
    setIsOpen(false);
    setQuery("");
    setResults([]);
    setSelectedIndex(0);
  }, []);

  const toggle = useCallback(() => setIsOpen(prev => !prev), []);

  const addRecent = useCallback((q: string) => {
    if (!q.trim()) return;

    setRecentSearches(prev => {
      const newRecent: RecentSearch[] = [
        { query: q, timestamp: Date.now() },
        ...prev.filter(r => r.query !== q),
      ].slice(0, MAX_RECENT);

      try {
        localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(newRecent));
      } catch {
        // ignore localStorage errors
      }

      return newRecent;
    });
  }, []);

  const clearRecent = useCallback(() => {
    setRecentSearches([]);
    try {
      localStorage.removeItem(RECENT_SEARCHES_KEY);
    } catch {
      // ignore localStorage errors
    }
  }, []);

  return {
    isOpen,
    open,
    close,
    toggle,
    query,
    setQuery,
    results,
    loading,
    filters,
    setFilters,
    recentSearches,
    addRecent,
    clearRecent,
    selectedIndex,
    setSelectedIndex,
  };
}
