"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import { TaskDetail } from "@/components/task/task-detail";
import { toTask } from "@/lib/task-transforms";
import { useNamespaceFetch } from "@/lib/use-namespace-fetch";
import { useWorkspace } from "@/lib/workspace-context";
import { unwrapApiData } from "@/lib/api-client";
import { WaveSpinner } from "@/components/ui/wave-spinner";
import type { Task, TaskComment, TaskRecord } from "@/lib/task-types";

export default function TaskDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { fetchWithNamespace } = useNamespaceFetch();
  const { workspacePath, workspaceReady } = useWorkspace();

  const taskId = params.id as string;
  const [task, setTask] = useState<Task | null>(null);
  const [subtasks, setSubtasks] = useState<Task[]>([]);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRunning, setIsRunning] = useState(false);

  const wsParam = workspacePath ? `?workspace=${encodeURIComponent(workspacePath)}` : "";

  const loadTask = useCallback(async () => {
    setLoading(true);
    try {
      const id = encodeURIComponent(taskId);

      // fetch task detail, deps, and comments in parallel
      const [detailRes, childRes, commentRes] = await Promise.all([
        fetchWithNamespace(`/api/tasks/${id}${wsParam}`).catch(() => null),
        fetchWithNamespace(`/api/tasks/${id}/deps${wsParam}`).catch(() => null),
        fetchWithNamespace(`/api/tasks/${id}/comments${wsParam}`).catch(() => null),
      ]);

      if (detailRes?.ok) {
        const raw = await detailRes.json();
        const data = unwrapApiData<{ issue?: TaskRecord }>(raw);
        if (data.issue) {
          const t = toTask(data.issue);
          setTask(t);
          setIsRunning(t.chainBinding?.last_run_status === "running");
        }
      }

      if (childRes?.ok) {
        const raw = await childRes.json();
        const data = unwrapApiData<{ children?: TaskRecord[] }>(raw);
        const childIssues: TaskRecord[] = data.children || [];
        setSubtasks(childIssues.map(toTask));
      } else {
        setSubtasks([]);
      }

      if (commentRes?.ok) {
        const raw = await commentRes.json();
        const data = unwrapApiData<{ comments?: TaskComment[] }>(raw);
        setComments(data.comments || []);
      } else {
        setComments([]);
      }
    } catch {
      setTask(null);
    } finally {
      setLoading(false);
    }
  }, [taskId, wsParam, fetchWithNamespace]);

  useEffect(() => {
    if (!workspaceReady) return;
    loadTask();
  }, [loadTask, workspaceReady]);

  const handleBack = () => router.push("/tasks");

  const handleClose = async () => {
    if (!task) return;
    const id = encodeURIComponent(task.id);
    await fetchWithNamespace(`/api/tasks/${id}/close${wsParam}`, { method: "POST" });
    router.push("/tasks");
  };

  const handleReopen = async () => {
    if (!task) return;
    const id = encodeURIComponent(task.id);
    await fetchWithNamespace(`/api/tasks/${id}${wsParam}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "open" }),
    });
    loadTask();
  };

  const handleEdit = () => {
    // TODO: open edit dialog
  };

  const handleSelectChild = (child: Task) => {
    router.push(`/tasks/${encodeURIComponent(child.id)}`);
  };

  const handleSelectDep = (depId: string) => {
    router.push(`/tasks/${encodeURIComponent(depId)}`);
  };

  const handleAssignChain = async (chainId: string, chainName: string) => {
    if (!task) return;
    const id = encodeURIComponent(task.id);
    await fetchWithNamespace(`/api/tasks/${id}${wsParam}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        metadata: JSON.stringify({
          chain_id: chainId,
          chain_name: chainName,
          auto_run: true,
        }),
      }),
    });
    loadTask();
  };

  const handleRemoveChain = async () => {
    if (!task) return;
    const id = encodeURIComponent(task.id);
    await fetchWithNamespace(`/api/tasks/${id}${wsParam}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metadata: "{}" }),
    });
    loadTask();
  };

  const handleRunChain = async () => {
    if (!task) return;
    const id = encodeURIComponent(task.id);
    const res = await fetchWithNamespace(`/api/tasks/${id}/run-chain${wsParam}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(workspacePath ? { workspacePath } : {}),
    });
    if (res.ok) {
      setIsRunning(true);
    }
  };

  const handleToggleAutoRun = async (autoRun: boolean) => {
    if (!task?.chainBinding) return;
    const id = encodeURIComponent(task.id);
    const metadata = { ...task.chainBinding, auto_run: autoRun };
    await fetchWithNamespace(`/api/tasks/${id}${wsParam}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metadata: JSON.stringify(metadata) }),
    });
    loadTask();
  };

  const handleToggleEpicAutoRun = async (autoRun: boolean) => {
    if (!task) return;
    const id = encodeURIComponent(task.id);
    await fetchWithNamespace(`/api/tasks/${id}/auto-run${wsParam}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ auto_run: autoRun }),
    });
    loadTask();
  };

  const handleClearMetadata = async () => {
    if (!task) return;
    const id = encodeURIComponent(task.id);

    // preserve chain assignment
    const currentMetadata = task.chainBinding;
    const preservedMetadata: Record<string, unknown> = {};
    if (currentMetadata?.chain_id) preservedMetadata.chain_id = currentMetadata.chain_id;
    if (currentMetadata?.chain_name) preservedMetadata.chain_name = currentMetadata.chain_name;
    if (currentMetadata?.auto_run !== undefined) preservedMetadata.auto_run = currentMetadata.auto_run;
    if (currentMetadata?.run_config) preservedMetadata.run_config = currentMetadata.run_config;
    if (currentMetadata?.last_run_id) preservedMetadata.last_run_id = currentMetadata.last_run_id;
    if (currentMetadata?.last_run_status) preservedMetadata.last_run_status = currentMetadata.last_run_status;

    await fetchWithNamespace(`/api/tasks/${id}${wsParam}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metadata: JSON.stringify(preservedMetadata) }),
    });
    loadTask();
  };

  const handleMetadataUpdate = (metadata: Record<string, unknown>) => {
    const binding = metadata as unknown as Task["chainBinding"];
    setTask((prev) => (prev ? { ...prev, chainBinding: binding } : null));
  };

  const handleAddComment = async (text: string) => {
    if (!task) return;
    const id = encodeURIComponent(task.id);
    const res = await fetchWithNamespace(`/api/tasks/${id}/comments${wsParam}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (res.ok) {
      const raw = await res.json();
      const data = unwrapApiData<{ comments?: TaskComment[]; comment?: TaskComment }>(raw);
      if (data.comments) {
        setComments(data.comments);
      } else if (data.comment) {
        setComments((prev) => [...prev, data.comment!]);
      }
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <WaveSpinner size="sm" color="primary" animation="ripple" />
      </div>
    );
  }

  if (!task) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <p className="text-lg mb-2">Task not found</p>
          <button
            onClick={handleBack}
            className="text-sm text-blue-500 hover:underline"
          >
            Back to tasks
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-hidden">
      <TaskDetail
        task={task}
        subtasks={subtasks}
        comments={comments}
        onBack={handleBack}
        onClose={handleClose}
        onReopen={handleReopen}
        onEdit={handleEdit}
        onSelectChild={handleSelectChild}
        onSelectDep={handleSelectDep}
        onAssignChain={handleAssignChain}
        onRemoveChain={handleRemoveChain}
        onRunChain={handleRunChain}
        onToggleAutoRun={handleToggleAutoRun}
        onToggleEpicAutoRun={task.type === "epic" ? handleToggleEpicAutoRun : undefined}
        onClearMetadata={handleClearMetadata}
        onMetadataUpdate={handleMetadataUpdate}
        onAddComment={handleAddComment}
        isRunning={isRunning}
        workspacePath={workspacePath}
      />
    </div>
  );
}
