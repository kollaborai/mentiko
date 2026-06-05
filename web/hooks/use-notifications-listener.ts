"use client";

import { useEffect, useRef, useCallback } from "react";
import { useNotificationActions } from "@/lib/notifications/notifications-store";
import { showToast } from "@/components/notifications-panel";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { unwrapApiData } from "@/lib/api/api-client";
import { useSharedRuns } from "@/lib/runs/runs-store";

interface WebhookDelivery {
  event_id: string;
  event_type: string;
  url: string;
  attempts: number;
  status: "delivered" | "failed" | "pending";
  created_at: string;
  updated_at?: string;
  http_code?: number;
  last_response?: string;
}

/**
 * Generate the actionUrl for a job notification based on job type and metadata.
 */
function getJobActionUrl(jobType?: string, metadata?: Record<string, unknown>): string | undefined {
  if (!jobType) return "/runs";
  const decisionId = metadata?.decisionId as string | undefined;
  if (
    jobType === "decision_research" ||
    jobType === "decision_steering" ||
    jobType === "decision_retrospective" ||
    jobType.startsWith("decision_guided")
  ) {
    return decisionId ? `/decisions?id=${decisionId}` : "/decisions";
  }
  if (jobType === "generate" || jobType === "recommend") {
    return "/chains";
  }
  if (jobType === "task") {
    return "/tasks";
  }
  if (jobType === "agent" || jobType === "agent_edit") {
    return "/agents";
  }
  if (jobType === "webhook_inbound" || jobType === "webhook_outbound") {
    return "/webhooks";
  }
  return "/runs";
}

export function useNotificationsListener() {
  const { add } = useNotificationActions();
  const { fetchWithNamespace } = useNamespaceFetch();
  const { runs } = useSharedRuns();

  const checkWebhooks = useCallback(async () => {
    try {
      const res = await fetchWithNamespace("/api/webhooks/status");
      if (res.ok) {
        const raw = await res.json();
        const data = unwrapApiData<{ deliveries?: WebhookDelivery[] }>(raw);
        const deliveries: WebhookDelivery[] = data.deliveries || [];

        const failed = deliveries.filter((d) => d.status === "failed");
        const processedFailures = new Set(
          JSON.parse(localStorage.getItem("processed_webhook_failures") || "[]")
        );

        for (const delivery of failed.slice(0, 5)) {
          const key = `${delivery.event_id}_${delivery.updated_at || delivery.created_at}`;
          if (!processedFailures.has(key)) {
            processedFailures.add(key);
            add({
              type: "webhook_failed",
              title: "Webhook delivery failed",
              message: `Failed to deliver ${delivery.event_type} to ${delivery.url}`,
              metadata: {
                webhookUrl: delivery.url,
                httpCode: delivery.http_code,
                actionUrl: "/webhooks",
                actionLabel: "View Webhooks",
              },
            });
            showToast({ type: "error", title: "Webhook failed", message: delivery.url, duration: 6000 });
          }
        }

        localStorage.setItem(
          "processed_webhook_failures",
          JSON.stringify([...processedFailures].slice(-100))
        );
      }
    } catch {}
  }, [add, fetchWithNamespace]);

  useEffect(() => {
    checkWebhooks();
    const interval = setInterval(checkWebhooks, 15000);
    return () => clearInterval(interval);
  }, [checkWebhooks]);

  const knownRunStatuses = useRef<Record<string, string>>({});

  useEffect(() => {
    for (const run of runs) {
      const prev = knownRunStatuses.current[run.id];
      knownRunStatuses.current[run.id] = run.status;
      if (!prev) continue;

      const actionUrl = `/runs?runId=${run.id}`;

      if (prev === "running" && run.status === "completed") {
        add({
          type: "chain_complete",
          title: "Chain completed",
          message: run.chain || run.id,
          metadata: {
            runId: run.id,
            chainId: run.chain,
            actionUrl,
            actionLabel: "View Run",
          },
        });
        showToast({ type: "success", title: "Chain completed", message: run.chain || run.id, duration: 4000 });
      } else if (prev === "running" && (run.status === "failed" || run.status === "cancelled")) {
        add({
          type: "chain_failed",
          title: `Chain ${run.status}`,
          message: run.chain || run.id,
          metadata: {
            runId: run.id,
            chainId: run.chain,
            actionUrl,
            actionLabel: "View Run",
          },
        });
        showToast({ type: "error", title: `Chain ${run.status}`, message: run.chain || run.id, duration: 6000 });
      }
    }
  }, [runs, add]);

  // listen for custom notification events from other components
  useEffect(() => {
    const handleNotification = (e: CustomEvent) => {
      const { type, title, message, metadata, showToast: shouldShowToast } = e.detail;

      // ensure actionUrl is set based on event type
      const enrichedMetadata = { ...metadata };
      if (!enrichedMetadata.actionUrl) {
        if (enrichedMetadata.runId) {
          enrichedMetadata.actionUrl = `/runs?runId=${enrichedMetadata.runId}`;
          enrichedMetadata.actionLabel = "View Run";
        }
      }

      add({ type, title, message, metadata: enrichedMetadata });

      if (shouldShowToast !== false) {
        const toastType =
          type === "agent_error" || type === "chain_failed" || type === "webhook_failed"
            ? "error"
            : "success";
        showToast({ type: toastType, title, message, duration: type.includes("error") || type.includes("failed") ? 6000 : 4000 });
      }
    };

    // @ts-expect-error -- custom event type not in global Window
    window.addEventListener("agent-notification", handleNotification);
    return () => {
      // @ts-expect-error -- custom event type not in global Window
      window.removeEventListener("agent-notification", handleNotification);
    };
  }, [add]);

  // poll for job status changes (jobs dir)
  const knownJobStatuses = useRef<Record<string, string>>({});

  const getJobLabel = (jobType?: string): string => {
    if (!jobType) return "Background job";
    const labels: Record<string, string> = {
      recommend: "Chain analysis",
      generate: "Chain generation",
      task: "Task generation",
      agent: "Agent generation",
      decision_research: "Decision research",
      decision_steering: "Decision steering",
      decision_retrospective: "Decision retrospective",
      agent_edit: "Agent edit",
      webhook_inbound: "Webhook processing",
      webhook_outbound: "Webhook delivery",
      event_trigger: "Event processing",
      template_test: "Template test",
    };
    return labels[jobType] || jobType;
  };

  const checkJobs = useCallback(async () => {
    try {
      const res = await fetchWithNamespace("/api/jobs");
      if (!res.ok) return;
      const raw = await res.json();
      const data = unwrapApiData<{
        jobs?: {
          id: string;
          status: string;
          type?: string;
          error?: string;
          metadata?: Record<string, unknown>;
        }[];
      }>(raw);
      const jobs = data.jobs || [];

      for (const job of jobs) {
        const prev = knownJobStatuses.current[job.id];
        knownJobStatuses.current[job.id] = job.status;
        if (!prev) continue;

        const jobLabel = getJobLabel(job.type);
        const actionUrl = getJobActionUrl(job.type, job.metadata);

        if (prev === "pending" && job.status === "running") {
          add({
            type: "job_started",
            title: `${jobLabel} started`,
            message: "Processing in background...",
            metadata: {
              jobId: job.id,
              jobType: job.type,
              actionUrl,
              actionLabel: "View",
            },
          });
        } else if (prev !== "complete" && job.status === "complete") {
          add({
            type: "job_complete",
            title: `${jobLabel} completed`,
            message: "Finished successfully",
            metadata: {
              jobId: job.id,
              jobType: job.type,
              actionUrl,
              actionLabel: "View Result",
            },
          });
          showToast({ type: "success", title: `${jobLabel} completed`, message: "Finished successfully", duration: 4000 });
        } else if (prev !== "failed" && job.status === "failed") {
          add({
            type: "job_failed",
            title: `${jobLabel} failed`,
            message: job.error || "An error occurred",
            metadata: {
              jobId: job.id,
              jobType: job.type,
              error: job.error,
              actionUrl,
              actionLabel: "View Details",
            },
          });
          showToast({ type: "error", title: `${jobLabel} failed`, message: job.error || "An error occurred", duration: 6000 });
        }
      }
    } catch {}
  }, [add, fetchWithNamespace]);

  useEffect(() => {
    checkJobs();
    const interval = setInterval(checkJobs, 10000);
    return () => clearInterval(interval);
  }, [checkJobs]);
}

// helper function to trigger notifications from anywhere
export function notifyAgentEvent(params: {
  type: "agent_complete" | "agent_error" | "chain_complete" | "chain_failed" | "chain_started";
  title: string;
  message: string;
  metadata?: { agentId?: string; chainId?: string; runId?: string; actionUrl?: string; actionLabel?: string };
  showToast?: boolean;
}) {
  window.dispatchEvent(new CustomEvent("agent-notification", { detail: params }));
}

// hook for monitoring a specific run's events
export function useRunNotifications(runId: string | null) {
  const { fetchWithNamespace } = useNamespaceFetch();

  useEffect(() => {
    if (!runId) return;

    let previousStatus: string | null = null;

    const checkStatus = async () => {
      try {
        const res = await fetchWithNamespace(`/api/runs/${runId}`);
        if (res.ok) {
          const raw = await res.json();
          const data = unwrapApiData<{ run?: { status?: string; chain?: string } }>(raw);
          const run = data.run;
          const status = run?.status;

          if (status && status !== previousStatus) {
            if (status === "completed" && previousStatus === "running") {
              notifyAgentEvent({
                type: "chain_complete",
                title: "Chain completed",
                message: run?.chain || `Run ${runId}`,
                metadata: {
                  runId,
                  chainId: run?.chain,
                  actionUrl: `/runs?runId=${runId}`,
                  actionLabel: "View Run",
                },
              });
            } else if (status === "failed") {
              notifyAgentEvent({
                type: "chain_failed",
                title: "Chain failed",
                message: run?.chain || `Run ${runId}`,
                metadata: {
                  runId,
                  chainId: run?.chain,
                  actionUrl: `/runs?runId=${runId}`,
                  actionLabel: "View Run",
                },
              });
            }
            previousStatus = status;
          }
        }
      } catch {}
    };

    checkStatus();
    const interval = setInterval(checkStatus, 3000);
    return () => clearInterval(interval);
  }, [runId, fetchWithNamespace]);
}
