"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { TaskSquareFilled, RouteSquareFilled, LinkFilled } from "@aliimam/icons";
import { useWorkspace } from "@/lib/ui-context/workspace-context";
import { PageBanner } from "@/components/ui/page-banner";
import { TaskFilters } from "@/components/task/task-filters";
import { TaskListItem } from "@/components/task/task-list-item";
import { EpicGroupHeader } from "@/components/task/epic-group-header";
import { TaskDetail } from "@/components/task/task-detail";
import { TaskGenerateDialog } from "@/components/task/task-generate-dialog";
import { TaskEditDialog } from "@/components/task/task-edit-dialog";
import { TaskOverview } from "@/components/task/task-overview";
import { TaskTreeView } from "@/components/task/task-tree-view";
import { toTask, groupByEpic, priorityOrder } from "@/lib/tasks/task-transforms";
import { buildTaskListQuery } from "@/lib/tasks/task-filter-query";
import { sortTasksByDependencyOrder } from "@/lib/tasks/task-ordering";
import { WaveSpinner } from "@/components/ui/wave-spinner";
import { EmptyState } from "@/components/common/empty-state";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { unwrapApiData, getApiErrorMessage } from "@/lib/api/api-client";
import {
  WorkflowSidebarPane,
  WorkflowSidebarResizeHandle,
  WorkflowSidebarSegmentedControl,
} from "@/components/ui/workflow-sidebar";
import type {
  TaskRecord,
  EpicStatus,
  TaskComment,
  Task,
  TaskFilterStatus,
  TaskFilterType,
  TaskSortBy,
} from "@/lib/tasks/task-types";

export default function TasksPage() {
  return (
    <Suspense fallback={
      <div className="h-full flex items-center justify-center">
        <WaveSpinner size="sm" color="primary" animation="ripple" />
      </div>
    }>
      <TasksPageContent />
    </Suspense>
  );
}

function TasksPageContent() {
  const { workspacePath, workspaceReady } = useWorkspace();
  const searchParams = useSearchParams();
  const { fetchWithNamespace } = useNamespaceFetch();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [epics, setEpics] = useState<EpicStatus[]>([]);
  const [selected, setSelected] = useState<Task | null>(null);
  const [children, setChildren] = useState<Task[]>([]);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [mobileView, setMobileView] = useState<"list" | "detail">("list");
  const [loading, setLoading] = useState(true);
  const [collapsedEpics, setCollapsedEpics] = useState<Set<string>>(new Set());
  const [showGenerate, setShowGenerate] = useState(false);
  const [generateMode, setGenerateMode] = useState<"task" | "decision" | "manual">("task");
  const [showEdit, setShowEdit] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "tree" | "overview">(
    (searchParams.get("view") as "list" | "tree" | "overview") || "list"
  );
  const [depInfo, setDepInfo] = useState<Map<string, { blockedBy: string[]; blocks: string[] }>>(new Map());

  // bulk select mode
  const [selectMode, setSelectMode] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());

  // sidebar width (persisted)
  const SIDEBAR_KEY = "tasks-sidebar-width";
  const MIN_W = 280;
  const MAX_W = 700;
  const DEFAULT_W = 420;
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_W);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(DEFAULT_W);
  const autoSelectDone = useRef(false);
  const createTriggered = useRef(false);

  // handle ?create=true query param
  useEffect(() => {
    if (createTriggered.current) return;
    if (searchParams.get("create") === "true") {
      createTriggered.current = true;
      setGenerateMode("manual");
      setShowGenerate(true);
      setSelected(null);
      setChildren([]);
      setComments([]);
      setMobileView("detail");
      // clear the param from URL
      const url = new URL(window.location.href);
      url.searchParams.delete("create");
      window.history.replaceState({}, "", url.toString());
    }
  }, [searchParams]);

  // restore persisted width
  useEffect(() => {
    const saved = localStorage.getItem(SIDEBAR_KEY);
    if (saved) {
      const w = parseInt(saved, 10);
      if (w >= MIN_W && w <= MAX_W) setSidebarWidth(w);
    }
  }, []);

  const onDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      startX.current = e.clientX;
      startW.current = sidebarWidth;

      const onMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const delta = ev.clientX - startX.current;
        const next = Math.min(MAX_W, Math.max(MIN_W, startW.current + delta));
        setSidebarWidth(next);
      };

      const onUp = () => {
        dragging.current = false;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        // persist
        setSidebarWidth((w) => {
          localStorage.setItem(SIDEBAR_KEY, String(w));
          return w;
        });
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [sidebarWidth]
  );

  // filters (read initial values from URL)
  const [searchQuery, setSearchQuery] = useState(searchParams.get("q") || "");
  const [filterStatus, setFilterStatus] = useState<TaskFilterStatus>(
    (searchParams.get("status") as TaskFilterStatus) || "all"
  );
  const [filterType, setFilterType] = useState<TaskFilterType>(
    (searchParams.get("type") as TaskFilterType) || "all"
  );
  const [sortBy, setSortBy] = useState<TaskSortBy>(
    (searchParams.get("sort") as TaskSortBy) || "priority"
  );

  // sync filter state to URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sync = (key: string, value: string, def: string) => {
      if (value === def) params.delete(key);
      else params.set(key, value);
    };
    sync("view", viewMode, "list");
    sync("status", filterStatus, "all");
    sync("type", filterType, "all");
    sync("sort", sortBy, "priority");
    sync("q", searchQuery, "");
    const qs = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, [viewMode, filterStatus, filterType, sortBy, searchQuery]);

  // fetch all tasks
  const fetchTasks = useCallback(async () => {
    try {
      const params = buildTaskListQuery({
        status: filterStatus,
        type: filterType,
        query: searchQuery,
        workspacePath,
      });

      const res = await fetchWithNamespace(`/api/tasks?${params}`);
      const raw = await res.json();
      const data = unwrapApiData<{ tasks?: TaskRecord[]; issues?: TaskRecord[] }>(raw);
      const issues: TaskRecord[] = data.tasks || data.issues || [];
      setTasks(issues.map(toTask));
    } catch {
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [filterStatus, filterType, searchQuery, workspacePath, fetchWithNamespace]);

  // fetch epics
  const fetchEpics = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (workspacePath) params.set("workspace", workspacePath);
      const res = await fetchWithNamespace(`/api/tasks/epics?${params}`);
      const raw = await res.json();
      const data = unwrapApiData<{ epics?: EpicStatus[] }>(raw);
      setEpics(data.epics || []);
    } catch {
      setEpics([]);
    }
  }, [workspacePath, fetchWithNamespace]);

  // fetch dependency info (for ready filter + bidirectional indicators)
  const fetchDepInfo = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (workspacePath) params.set("workspace", workspacePath);
      const res = await fetchWithNamespace(`/api/tasks/graph?${params}`);
      const raw = await res.json();
      const data = unwrapApiData<{ deps?: Array<{ from: string; to: string }>; nodes?: Array<{ id: string }> }>(raw);

      // build dep maps from graph data
      const blockedBy = new Map<string, string[]>();
      const blocks = new Map<string, string[]>();

      for (const dep of data.deps || []) {
        // dep.from blocks dep.to
        const blocked = blockedBy.get(dep.to) || [];
        blocked.push(dep.from);
        blockedBy.set(dep.to, blocked);

        const blocking = blocks.get(dep.from) || [];
        blocking.push(dep.to);
        blocks.set(dep.from, blocking);
      }

      // combine into single map for easy lookup
      const info = new Map<string, { blockedBy: string[]; blocks: string[] }>();
      for (const node of data.nodes || []) {
        info.set(node.id, {
          blockedBy: blockedBy.get(node.id) || [],
          blocks: blocks.get(node.id) || [],
        });
      }
      setDepInfo(info);
    } catch {
      setDepInfo(new Map());
    }
  }, [workspacePath, fetchWithNamespace]);

  useEffect(() => {
    if (!workspaceReady) return;
    setSelected(null);
    setChildren([]);
    setComments([]);
    fetchTasks();
    fetchEpics();
    fetchDepInfo();
  }, [fetchTasks, fetchEpics, fetchDepInfo, workspaceReady]);

  // load detail data when selection changes
  const loadDetail = useCallback(async (task: Task) => {
    const id = encodeURIComponent(task.id);
    const wsParam = workspacePath ? `?workspace=${encodeURIComponent(workspacePath)}` : "";

    // fetch full detail + children + comments in parallel
    const [detailRes, childRes, commentRes] = await Promise.all([
      fetchWithNamespace(`/api/tasks/${id}${wsParam}`).catch(() => null),
      fetchWithNamespace(`/api/tasks/${id}/deps${wsParam}`).catch(() => null),
      fetchWithNamespace(`/api/tasks/${id}/comments${wsParam}`).catch(() => null),
    ]);

    // merge full detail (has acceptance, design, notes, etc.) with list data
    // detail endpoint doesn't return counts, so we preserve them from the list version
    if (detailRes?.ok) {
      const raw = await detailRes.json();
      const data = unwrapApiData<{ issue?: TaskRecord }>(raw);
      if (data.issue) {
        const detail = toTask(data.issue);
        const mergedDetail = {
          ...task,
          ...detail,
          // preserve counts from list data if show didn't include them
          dependencyCount: detail.dependencyCount || task.dependencyCount,
          dependentCount: detail.dependentCount || task.dependentCount,
          commentCount: detail.commentCount || task.commentCount,
        };
        setSelected((prev) =>
          prev && prev.id === task.id
            ? {
                ...prev,
                ...mergedDetail,
                // preserve counts from list data if show didn't include them
                dependencyCount: detail.dependencyCount || prev.dependencyCount,
                dependentCount: detail.dependentCount || prev.dependentCount,
                commentCount: detail.commentCount || prev.commentCount,
              }
            : mergedDetail
        );
        setTasks((current) =>
          current.map((item) =>
            item.id === detail.id ? { ...item, ...mergedDetail } : item
          )
        );
      }
    }

    if (childRes?.ok) {
      const raw = await childRes.json();
      const data = unwrapApiData<{ children?: TaskRecord[] }>(raw);
      const childIssues: TaskRecord[] = data.children || [];
      setChildren(childIssues.map(toTask));
    } else {
      setChildren([]);
    }

    if (commentRes?.ok) {
      const raw = await commentRes.json();
      const data = unwrapApiData<{ comments?: TaskComment[] }>(raw);
      setComments(data.comments || []);
    } else {
      setComments([]);
    }
  }, [workspacePath, fetchWithNamespace]);

  const refreshSelectedTask = useCallback(async () => {
    if (!selected) return;
    await loadDetail(selected);
  }, [loadDetail, selected]);

  const handleSelect = useCallback(
    (task: Task) => {
      if (selectMode) {
        setSelectedTaskIds((prev) => {
          const next = new Set(prev);
          if (next.has(task.id)) next.delete(task.id);
          else next.add(task.id);
          return next;
        });
        return;
      }
      setSelected(task);
      setChildren([]);
      setComments([]);
      setShowGenerate(false);
      setMobileView("detail");
      loadDetail(task);
    },
    [loadDetail, selectMode]
  );

  const handleBack = useCallback(() => {
    setMobileView("list");
  }, []);

  // apply client-side type filter + sort
  const filtered = tasks
    .filter((t) => {
      if (filterType !== "all" && t.type !== filterType) return false;

      // ready filter: show tasks that are not closed and have no open blockers
      if (filterStatus === "ready") {
        if (t.status === "closed") return false;
        const info = depInfo.get(t.id);
        if (!info || info.blockedBy.length === 0) return true;
        // check if all blockers are closed
        return info.blockedBy.every(blockerId => {
          const blocker = tasks.find(task => task.id === blockerId);
          return blocker?.status === "closed";
        });
      }

      return true;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case "priority":
          return priorityOrder(a.priority) - priorityOrder(b.priority);
        case "updated":
          return (
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
          );
        case "created":
          return (
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          );
        case "title":
          return a.title.localeCompare(b.title);
        case "type":
          return a.type.localeCompare(b.type);
        default:
          return 0;
      }
    });

  const shouldShowMatchingEpics = filterType === "all" || filterType === "epic" || searchQuery.trim().length > 0;
  const groups = groupByEpic(filtered, epics, { includeEpics: shouldShowMatchingEpics }).map((group) =>
    group.epic
      ? { ...group, tasks: sortTasksByDependencyOrder(group.tasks, depInfo) }
      : group
  );

  // actions
  const wsParam = workspacePath ? `?workspace=${encodeURIComponent(workspacePath)}` : "";

  const updateTaskBinding = useCallback(
    (taskId: string, updater: (binding: Task["chainBinding"]) => Task["chainBinding"]) => {
      setTasks((items) =>
        items.map((item) =>
          item.id === taskId ? { ...item, chainBinding: updater(item.chainBinding) } : item
        )
      );
      setSelected((prev) =>
        prev?.id === taskId ? { ...prev, chainBinding: updater(prev.chainBinding) } : prev
      );
    },
    []
  );

  const handleToggleComplete = useCallback(
    async (task: Task) => {
      const id = encodeURIComponent(task.id);
      if (task.completed) {
        await fetchWithNamespace(`/api/tasks/${id}${wsParam}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "open" }),
        });
      } else {
        await fetchWithNamespace(`/api/tasks/${id}/close${wsParam}`, { method: "POST" });
      }
      fetchTasks();
      fetchDepInfo();
    },
    [fetchTasks, fetchDepInfo, wsParam, fetchWithNamespace]
  );

  const handleClose = useCallback(async () => {
    if (!selected) return;
    const id = encodeURIComponent(selected.id);
    await fetchWithNamespace(`/api/tasks/${id}/close${wsParam}`, { method: "POST" });
    fetchTasks();
    fetchDepInfo();
    setSelected((prev) => (prev ? { ...prev, completed: true, status: "closed" } : null));
  }, [selected, fetchTasks, fetchDepInfo, wsParam, fetchWithNamespace]);

  const handleReopen = useCallback(async () => {
    if (!selected) return;
    const id = encodeURIComponent(selected.id);
    await fetchWithNamespace(`/api/tasks/${id}${wsParam}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "open" }),
    });
    fetchTasks();
    fetchDepInfo();
    setSelected((prev) => (prev ? { ...prev, completed: false, status: "open" } : null));
  }, [selected, fetchTasks, fetchDepInfo, wsParam, fetchWithNamespace]);

  const handleAssignChain = useCallback(
    async (chainId: string, chainName: string) => {
      if (!selected) return;
      const id = encodeURIComponent(selected.id);
      const metadata = {
        chain_id: chainId,
        chain_name: chainName,
        auto_run: true,
        auto_run_retries: 0,
        last_run_error: undefined,
      };
      await fetchWithNamespace(`/api/tasks/${id}${wsParam}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metadata: JSON.stringify(metadata) }),
      });
      updateTaskBinding(selected.id, () => ({
        chain_id: chainId,
        chain_name: chainName,
        auto_run: true,
        auto_run_retries: 0,
      }));
    },
    [selected, wsParam, fetchWithNamespace, updateTaskBinding]
  );

  const handleRemoveChain = useCallback(async () => {
    if (!selected) return;
    const id = encodeURIComponent(selected.id);
    await fetchWithNamespace(`/api/tasks/${id}${wsParam}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metadata: "{}" }),
    });
    setSelected((prev) => (prev ? { ...prev, chainBinding: undefined } : null));
  }, [selected, wsParam, fetchWithNamespace]);

  const handleClearMetadata = useCallback(async () => {
    if (!selected) return;
    const id = encodeURIComponent(selected.id);

    // preserve chain assignment but clear job metadata
    const currentMetadata = selected.chainBinding;
    const preservedMetadata: Record<string, unknown> = {};
    if (currentMetadata?.chain_id) preservedMetadata.chain_id = currentMetadata.chain_id;
    if (currentMetadata?.chain_name) preservedMetadata.chain_name = currentMetadata.chain_name;
    if (currentMetadata?.auto_run !== undefined) preservedMetadata.auto_run = currentMetadata.auto_run;
    if (currentMetadata?.run_config) preservedMetadata.run_config = currentMetadata.run_config;
    if (currentMetadata?.last_run_id) preservedMetadata.last_run_id = currentMetadata.last_run_id;
    if (currentMetadata?.last_run_status) preservedMetadata.last_run_status = currentMetadata.last_run_status;
    if (currentMetadata?.last_run_error) preservedMetadata.last_run_error = currentMetadata.last_run_error;
    if (currentMetadata?.auto_run_retries !== undefined) preservedMetadata.auto_run_retries = currentMetadata.auto_run_retries;

    await fetchWithNamespace(`/api/tasks/${id}${wsParam}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metadata: JSON.stringify(preservedMetadata) }),
    });

    setSelected((prev) => (prev ? { ...prev, chainBinding: Object.keys(preservedMetadata).length > 0 ? (preservedMetadata as unknown) as Task["chainBinding"] : undefined } : null));
  }, [selected, wsParam, fetchWithNamespace]);

  const handleRunChain = useCallback(async () => {
    if (!selected) return;
    const id = encodeURIComponent(selected.id);
    const res = await fetchWithNamespace(`/api/tasks/${id}/run-chain${wsParam}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(workspacePath ? { workspacePath } : {}),
    });
    const data = await res.json();
    if (res.ok) {
      const runId = data.runId || data.data?.runId;
      updateTaskBinding(selected.id, (binding) =>
        binding
          ? {
              ...binding,
              last_run_id: runId,
              last_run_status: "running",
              last_run_error: undefined,
              auto_run_retries: 0,
            }
          : binding
      );
    } else {
      const msg = typeof data.error === "string" ? data.error : data.error?.message || `Chain run failed (${res.status})`;
      throw new Error(msg);
    }
  }, [selected, workspacePath, wsParam, fetchWithNamespace, updateTaskBinding]);

  const handleToggleAutoRun = useCallback(
    async (autoRun: boolean) => {
      if (!selected) return;
      const id = encodeURIComponent(selected.id);

      // use the auto-run endpoint which propagates to children (for epics)
      const res = await fetchWithNamespace(`/api/tasks/${id}/auto-run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auto_run: autoRun }),
      });

      if (!res.ok) {
        // fall back to direct metadata patch for non-epic tasks
        const metadata = {
          ...selected.chainBinding,
          auto_run: autoRun,
          ...(autoRun ? { auto_run_retries: 0, last_run_error: undefined } : {}),
        };
        await fetchWithNamespace(`/api/tasks/${id}${wsParam}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ metadata: JSON.stringify(metadata) }),
        });
      }

      updateTaskBinding(selected.id, (binding) =>
        binding
          ? {
              ...binding,
              auto_run: autoRun,
              ...(autoRun ? { auto_run_retries: 0, last_run_error: undefined } : {}),
            }
          : binding
      );

      // trigger auto-run scan so ready tasks start immediately
      if (autoRun) {
        fetchWithNamespace("/api/tasks/auto-run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }).catch(() => {});
      }
    },
    [selected, wsParam, fetchWithNamespace, updateTaskBinding]
  );

  const handleResetAutoRunAttempts = useCallback(async () => {
    if (!selected) return;
    const id = encodeURIComponent(selected.id);
    const metadata = {
      ...selected.chainBinding,
      auto_run: true,
      auto_run_retries: 0,
      last_run_error: undefined,
    };

    await fetchWithNamespace(`/api/tasks/${id}${wsParam}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metadata: JSON.stringify(metadata) }),
    });

    updateTaskBinding(selected.id, (binding) =>
      binding
        ? {
            ...binding,
            auto_run: true,
            auto_run_retries: 0,
            last_run_error: undefined,
          }
        : binding
    );

    await fetchWithNamespace("/api/tasks/auto-run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }).catch(() => {});
  }, [selected, wsParam, fetchWithNamespace, updateTaskBinding]);

  const handleMetadataUpdate = useCallback(
    (metadata: Record<string, unknown>) => {
      const binding = metadata as unknown as Task["chainBinding"];
      setSelected((prev) => {
        if (!prev) return null;
        // also sync to tasks list so re-selecting uses fresh data
        const taskId = prev.id;
        setTasks((tasks) =>
          tasks.map((t) =>
            t.id === taskId ? { ...t, chainBinding: binding } : t
          )
        );
        return { ...prev, chainBinding: binding };
      });
    },
    []
  );

  const handleAddComment = useCallback(
    async (text: string) => {
      if (!selected) return;
      const id = encodeURIComponent(selected.id);
      const res = await fetchWithNamespace(`/api/tasks/${id}/comments${wsParam}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (res.ok) {
        const raw = await res.json();
        const data = unwrapApiData<{ comments?: TaskComment[]; comment?: TaskComment }>(raw);
        if (data.comments) {
          // use the full refreshed list from the API
          setComments(data.comments);
          setSelected((prev) =>
            prev ? { ...prev, commentCount: data.comments!.length } : prev
          );
        } else if (data.comment) {
          setComments((prev) => {
            const next = [...prev, data.comment!];
            setSelected((p) =>
              p ? { ...p, commentCount: next.length } : p
            );
            return next;
          });
        }
      }
    },
    [selected, wsParam, fetchWithNamespace]
  );

  const handleEditSave = useCallback(
    async (updates: Record<string, unknown>) => {
      if (!selected) return;
      const id = encodeURIComponent(selected.id);

      // separate chain assignment from regular field updates
      const patchBody: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(updates)) {
        if (key === "chainId" || key === "chainName" || key === "autoRun") continue;
        patchBody[key] = value;
      }

      const hasChainAssignment = updates.chainId !== undefined || updates.autoRun !== undefined;
      const chainId = updates.chainId !== undefined ? updates.chainId as string : selected.chainBinding?.chain_id;

      if (hasChainAssignment && chainId) {
        patchBody.chainAssignment = {
          chainId: chainId,
          chainName: updates.chainName as string || selected.chainBinding?.chain_name || chainId,
          autoRun: updates.autoRun !== undefined ? updates.autoRun as boolean : (selected.chainBinding?.auto_run ?? false),
        };
      } else if (updates.chainId === "" || updates.chainId === null) {
        // chain removed
        patchBody.chainAssignment = null;
      }

      await fetchWithNamespace(`/api/tasks/${id}${wsParam}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patchBody),
      });

      // re-fetch to get updated data
      fetchTasks();
      fetchDepInfo();
      const detailRes = await fetchWithNamespace(`/api/tasks/${id}${wsParam}`);
      if (detailRes.ok) {
        const raw = await detailRes.json();
        const data = unwrapApiData<{ issue?: TaskRecord }>(raw);
        if (data.issue) {
          const updated = toTask(data.issue);
          setSelected((prev) =>
            prev
              ? {
                  ...prev,
                  ...updated,
                  dependencyCount: updated.dependencyCount || prev.dependencyCount,
                  dependentCount: updated.dependentCount || prev.dependentCount,
                  commentCount: updated.commentCount || prev.commentCount,
                }
              : updated
          );
        }
      }
    },
    [selected, wsParam, fetchTasks, fetchDepInfo, fetchWithNamespace]
  );

  const handleCreate = useCallback(
    async (data: {
      title: string;
      description: string;
      type: string;
      priority: number;
      parent?: string;
      chainId?: string;
      chainName?: string;
      autoRun?: boolean;
      skipRefresh?: boolean;
    }): Promise<string | undefined> => {
      const createData: Record<string, unknown> = {
        title: data.title,
        description: data.description,
        type: data.type,
        priority: data.priority,
      };

      if (data.parent) {
        createData.parent = data.parent;
      }

      if (data.chainId || data.autoRun !== undefined) {
        createData.chainAssignment = {
          chainId: data.chainId || undefined,
          chainName: data.chainName,
          autoRun: data.autoRun ?? false,
        };
      }

      const res = await fetchWithNamespace(`/api/tasks/create${wsParam}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createData),
      });
      const raw = await res.json();
      const result = raw.data ?? raw;
      if (!res.ok) {
        const msg = typeof raw.error === "string" ? raw.error : raw.error?.message || `create failed (${res.status})`;
        throw new Error(msg);
      }
      if (!data.skipRefresh) {
        fetchTasks();
        fetchEpics();
        fetchDepInfo();
      }
      return result.issue?.id as string | undefined;
    },
    [fetchTasks, fetchEpics, fetchDepInfo, wsParam, fetchWithNamespace]
  );

  const handleSelectDep = useCallback(
    async (taskId: string) => {
      // try local list first
      const task = tasks.find((t) => t.id === taskId);
      if (task) {
        handleSelect(task);
        return;
      }
      // not in list (e.g. parent epic) - fetch directly
      const id = encodeURIComponent(taskId);
      const res = await fetchWithNamespace(`/api/tasks/${id}${wsParam}`);
      if (res.ok) {
        const raw = await res.json();
        const data = unwrapApiData<{ issue?: TaskRecord }>(raw);
        if (data.issue) {
          const fetched = toTask(data.issue);
          handleSelect(fetched);
        }
      }
    },
    [tasks, handleSelect, wsParam, fetchWithNamespace]
  );

  const handleAddDep = useCallback(
    async (depTaskId: string) => {
      if (!selected) return;
      const from = selected.id;
      const to = depTaskId;
      const res = await fetchWithNamespace(`/api/tasks/deps${wsParam}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(getApiErrorMessage(data, "Failed to add dependency"));
      }
      // refresh dependency info
      fetchDepInfo();
    },
    [selected, wsParam, fetchWithNamespace, fetchDepInfo]
  );

  const handleBulkAction = useCallback(
    async (action: "close" | "delete") => {
      if (selectedTaskIds.size === 0) return;
      const ids = Array.from(selectedTaskIds);
      try {
        await fetchWithNamespace("/api/tasks/bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids, action }),
        });
        setSelectedTaskIds(new Set());
        setSelectMode(false);
        // clear detail if selected task was in the bulk action
        if (selected && ids.includes(selected.id)) {
          setSelected(null);
          setChildren([]);
          setComments([]);
        }
        fetchTasks();
        fetchEpics();
        fetchDepInfo();
      } catch {
        // ignore
      }
    },
    [selectedTaskIds, selected, fetchTasks, fetchEpics, fetchDepInfo, fetchWithNamespace]
  );

  const isRunning = selected?.chainBinding?.last_run_status === "running";

  const handleOpenGenerate = useCallback((mode: "task" | "decision" | "manual") => {
    setGenerateMode(mode);
    setShowGenerate(true);
    setSelected(null);
    setChildren([]);
    setComments([]);
    setMobileView("detail");
  }, []);

  const generatePanel = (
    <TaskGenerateDialog
      open={showGenerate}
      onClose={() => { setShowGenerate(false); }}
      onCreate={handleCreate}
      onRefresh={() => { fetchTasks(); fetchEpics(); fetchDepInfo(); }}
      parentEpics={epics.map((e) => ({ id: e.id, title: e.title }))}
      workspacePath={workspacePath}
      initialMode={generateMode}
      presentation="panel"
    />
  );

  // auto-select task from ?task= query param (once after initial load)
  useEffect(() => {
    if (autoSelectDone.current) return;
    if (loading) return;
    const taskId = searchParams.get("task");
    if (!taskId) return;
    autoSelectDone.current = true;
    handleSelectDep(taskId);
  }, [loading, searchParams, handleSelectDep]);

  // reconcile stale task statuses once on mount
  const reconciledRef = useRef(false);
  useEffect(() => {
    if (!workspaceReady || reconciledRef.current) return;
    reconciledRef.current = true;
    fetchWithNamespace("/api/tasks/reconcile").catch(() => {});
  }, [workspaceReady, fetchWithNamespace]);

  // periodic task list refresh (picks up server-side status changes)
  useEffect(() => {
    if (!workspaceReady) return;
    const interval = setInterval(() => {
      fetchTasks();
      fetchDepInfo();
      refreshSelectedTask();
    }, 15000);
    return () => clearInterval(interval);
  }, [fetchTasks, fetchDepInfo, refreshSelectedTask, workspaceReady]);

  return (
    <div className="h-full flex flex-col">
      {/* header */}
      <PageBanner
        title="Tasks"
        subtitle="Track and manage project issues. Create epics, features, bugs, and chores with dependency tracking and chain bindings."
        icon={TaskSquareFilled}
        sectionColor="#5b9ef5"
        actions={[
          { label: "Runs", href: "/runs", icon: RouteSquareFilled, iconColor: "#5b9ef5" },
          { label: "Chains", href: "/chains", icon: LinkFilled, iconColor: "#b07ee8" },
        ]}
        docs={[
          { label: "Tasks Guide", href: "/docs/tasks", icon: TaskSquareFilled },
        ]}
      />

      <div className="shrink-0 px-4 pb-2 flex items-center gap-2">
        <WorkflowSidebarSegmentedControl
          options={[
            { value: "list" as const, label: "List" },
            { value: "tree" as const, label: "Dependencies" },
            { value: "overview" as const, label: "Overview" },
          ]}
          value={viewMode}
          onChange={(v) => setViewMode(v as typeof viewMode)}
          className="w-fit"
        />
      </div>

      {/* view modes */}
      {viewMode === "overview" ? (
        <div className="flex-1 overflow-hidden flex">
          <TaskOverview
            onSelectTask={(taskId) => {
              // try local list first, then fetch
              const task = tasks.find((t) => t.id === taskId);
              if (task) {
                handleSelect(task);
              } else {
                handleSelectDep(taskId);
              }
            }}
            onSelectEpic={(epicId) => {
              const epicTask = tasks.find((t) => t.id === epicId);
              if (epicTask) handleSelect(epicTask);
              else handleSelectDep(epicId);
            }}
            selectedTaskId={selected?.id}
          />
          {/* slide-in detail panel */}
          {(selected || showGenerate) && (
            <div className="w-1/2 shrink-0 border-l border-foreground/10 overflow-auto flex flex-col">
              {showGenerate ? (
                generatePanel
              ) : selected ? (
              <TaskDetail
                key={selected.id}
                task={selected}
                subtasks={children}
                comments={comments}
                depInfo={depInfo}
                onBack={handleBack}
                onClose={handleClose}
                onReopen={handleReopen}
                onEdit={() => setShowEdit(true)}
                onSelectChild={handleSelect}
                onSelectDep={handleSelectDep}
                onAssignChain={handleAssignChain}
                onRemoveChain={handleRemoveChain}
                onRunChain={handleRunChain}
                onToggleAutoRun={handleToggleAutoRun}
                onResetAutoRunAttempts={handleResetAutoRunAttempts}
                onClearMetadata={handleClearMetadata}
                onMetadataUpdate={handleMetadataUpdate}
                onRefreshTask={refreshSelectedTask}
                onAddComment={handleAddComment}
                isRunning={isRunning}
                workspacePath={workspacePath}
                allTasks={tasks}
                onAddDep={handleAddDep}
              />
              ) : null}
            </div>
          )}
        </div>
      ) : viewMode === "tree" ? (
        <div className="flex-1 flex overflow-hidden pl-4">
        {/* left: tree sidebar (resizable) */}
        <WorkflowSidebarPane
          className={`${
            mobileView === "detail" ? "hidden md:flex" : "flex"
          } md:flex`}
          style={{ width: sidebarWidth }}
        >
          <TaskTreeView
            selectedId={selected?.id}
            onSelectTask={(taskId) => {
              setMobileView("detail");
              handleSelectDep(taskId);
            }}
          />

          <WorkflowSidebarResizeHandle onMouseDown={onDragStart} />
        </WorkflowSidebarPane>

        {/* right: detail panel */}
        <div
          className={`${
            mobileView === "list" ? "hidden md:flex" : "flex"
          } flex-1 flex-col overflow-hidden md:flex`}
        >
          {!selected ? (
            showGenerate ? (
              generatePanel
            ) : (
            <div className="flex items-center justify-center h-full text-xs text-foreground/30">
              Select a task
            </div>
            )
          ) : (
            <TaskDetail
              key={selected.id}
              task={selected}
              subtasks={children}
              comments={comments}
              depInfo={depInfo}
              onBack={handleBack}
              onClose={handleClose}
              onReopen={handleReopen}
              onEdit={() => setShowEdit(true)}
              onSelectChild={handleSelect}
              onSelectDep={handleSelectDep}
              onAssignChain={handleAssignChain}
              onRemoveChain={handleRemoveChain}
              onClearMetadata={handleClearMetadata}
              onRunChain={handleRunChain}
              onToggleAutoRun={handleToggleAutoRun}
              onResetAutoRunAttempts={handleResetAutoRunAttempts}
              onMetadataUpdate={handleMetadataUpdate}
              onRefreshTask={refreshSelectedTask}
              onAddComment={handleAddComment}
              isRunning={isRunning}
              workspacePath={workspacePath}
            />
          )}
        </div>
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden pl-4">
        {/* left: task list (resizable) */}
        <WorkflowSidebarPane
          className={`${
            mobileView === "detail" ? "hidden md:flex" : "flex"
          } md:flex`}
          style={{ width: sidebarWidth }}
        >
          <TaskFilters
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            filterStatus={filterStatus}
            onFilterStatusChange={setFilterStatus}
            filterType={filterType}
            onFilterTypeChange={setFilterType}
            sortBy={sortBy}
            onSortChange={setSortBy}
            totalCount={tasks.length}
            filteredCount={filtered.length}
            selectMode={selectMode}
            onToggleSelectMode={() => {
              setSelectMode(!selectMode);
              setSelectedTaskIds(new Set());
            }}
            selectedCount={selectedTaskIds.size}
            onBulkClose={() => handleBulkAction("close")}
            onBulkDelete={() => handleBulkAction("delete")}
            onGenerate={() => handleOpenGenerate("task")}
          />

          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <WaveSpinner size="sm" color="primary" animation="ripple" />
              </div>
            ) : filtered.length === 0 ? (
              searchQuery || filterStatus !== "all" || filterType !== "all" ? (
                <div className="text-center py-12 text-xs text-foreground/30">
                  No tasks match filters
                </div>
              ) : (
                <EmptyState
                  icon={<TaskSquareFilled className="h-8 w-8" />}
                  title="No tasks yet"
                  description="Tasks track your work and can be linked to chains for automated execution."
                  action={{
                    label: "Create task",
                    onClick: () => handleOpenGenerate("manual"),
                  }}
                  secondaryAction={{
                    label: "Generate with AI",
                    onClick: () => handleOpenGenerate("task"),
                    variant: "outline",
                  }}
                />
              )
            ) : (
              <div className="px-2 py-2">
                {groups.map((group) => {
                  const groupKey = group.epic?.id || "ungrouped";
                  const isCollapsed = collapsedEpics.has(groupKey);
                  return (
                    <div key={groupKey} className="mb-3 last:mb-0">
                      <EpicGroupHeader
                        epic={group.epic}
                        taskCount={group.tasks.length}
                        collapsed={isCollapsed}
                        selected={!!group.epic && selected?.id === group.epic.id}
                        onToggle={() => {
                          setCollapsedEpics(prev => {
                            const next = new Set(prev);
                            if (next.has(groupKey)) next.delete(groupKey);
                            else next.add(groupKey);
                            return next;
                          });
                        }}
                        onSelect={group.epic ? () => {
                          const epicTask = tasks.find(t => t.id === group.epic!.id);
                          if (epicTask) handleSelect(epicTask);
                        } : undefined}
                      />
                      {!isCollapsed && (
                        <div className="space-y-1">
                          {group.tasks.map((task) => (
                            <TaskListItem
                              key={task.id}
                              task={task}
                              selected={selected?.id === task.id}
                              onSelect={handleSelect}
                              onToggleComplete={handleToggleComplete}
                              depInfo={depInfo}
                              selectMode={selectMode}
                              isChecked={selectedTaskIds.has(task.id)}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <WorkflowSidebarResizeHandle onMouseDown={onDragStart} />
        </WorkflowSidebarPane>

        {/* right: detail panel */}
        <div
          className={`${
            mobileView === "list" ? "hidden md:flex" : "flex"
          } flex-1 flex-col overflow-hidden md:flex`}
        >
          {!selected ? (
            showGenerate ? (
              generatePanel
            ) : (
            <div className="flex items-center justify-center h-full text-xs text-foreground/30">
              Select a task
            </div>
            )
          ) : (
            <TaskDetail
              key={selected.id}
              task={selected}
              subtasks={children}
              comments={comments}
              depInfo={depInfo}
              onBack={handleBack}
              onClose={handleClose}
              onReopen={handleReopen}
              onEdit={() => setShowEdit(true)}
              onSelectChild={handleSelect}
              onSelectDep={handleSelectDep}
              onAssignChain={handleAssignChain}
              onRemoveChain={handleRemoveChain}
              onClearMetadata={handleClearMetadata}
              onRunChain={handleRunChain}
              onToggleAutoRun={handleToggleAutoRun}
              onResetAutoRunAttempts={handleResetAutoRunAttempts}
              onMetadataUpdate={handleMetadataUpdate}
              onRefreshTask={refreshSelectedTask}
              onAddComment={handleAddComment}
              isRunning={isRunning}
              workspacePath={workspacePath}
            />
          )}
        </div>
        </div>
      )}

      {/* edit dialog */}
      {selected && (
        <TaskEditDialog
          key={selected.id}
          task={selected}
          open={showEdit}
          onClose={() => setShowEdit(false)}
          onSave={handleEditSave}
        />
      )}
    </div>
  );
}
