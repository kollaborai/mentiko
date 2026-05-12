"use client";

import { useState, useEffect, useCallback } from "react";
import { useNamespaceFetch } from "@/lib/use-namespace-fetch";
import { TickCircleFilled, CloseCircleFilled, ClockFilled, InfoCircleFilled } from "@aliimam/icons";
import { Button } from "@/components/ui/button";
import { unwrapApiData } from "@/lib/api-client";

interface ApprovalRequest {
  id: string;
  chainId: string;
  runId: string;
  agentName: string;
  stepName: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  action: string;
  description: string;
  requestedAt: string;
  approvedBy?: string;
  approvedAt?: string;
  rejectionReason?: string;
}

export function ApprovalList() {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [filter, setFilter] = useState<"all" | "pending">("pending");
  const [loading, setLoading] = useState(false);

  const loadApprovals = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filter === "pending") {
        params.append("status", "pending");
      }
      params.append("limit", "50");

      const res = await fetchWithNamespace(`/api/approvals?${params}`);
      if (res.ok) {
        const raw = await res.json();
        const data = unwrapApiData<{ requests?: ApprovalRequest[] }>(raw);
        setApprovals(data.requests || []);
      }
    } catch {
      // ignore
    }
  }, [filter, fetchWithNamespace]);

  useEffect(() => {
    loadApprovals();
    const interval = setInterval(loadApprovals, 15000); // refresh every 15s
    return () => clearInterval(interval);
  }, [filter, loadApprovals]);

  const handleApprove = async (id: string) => {
    setLoading(true);
    try {
      const res = await fetchWithNamespace(`/api/approvals/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (res.ok) {
        await loadApprovals();
      }
    } finally {
      setLoading(false);
    }
  };

  const handleReject = async (id: string) => {
    const reason = prompt("Rejection reason (optional):");
    if (reason === null) return; // cancelled

    setLoading(true);
    try {
      const res = await fetchWithNamespace(`/api/approvals/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (res.ok) {
        await loadApprovals();
      }
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (ts: string) => {
    const date = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
    return date.toLocaleDateString();
  };

  const getStatusIcon = (status: ApprovalRequest["status"]) => {
    switch (status) {
      case "pending":
        return <ClockFilled className="h-4 w-4 text-yellow-400" />;
      case "approved":
        return <TickCircleFilled className="h-4 w-4 text-green-400" />;
      case "rejected":
        return <CloseCircleFilled className="h-4 w-4 text-red-400" />;
      case "cancelled":
        return <InfoCircleFilled className="h-4 w-4 text-foreground/30" />;
    }
  };

  const getStatusColor = (status: ApprovalRequest["status"]) => {
    switch (status) {
      case "pending":
        return "bg-yellow-500/20 text-yellow-400";
      case "approved":
        return "bg-green-500/20 text-green-400";
      case "rejected":
        return "bg-red-500/20 text-red-400";
      case "cancelled":
        return "bg-muted text-foreground/30";
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">approvals</h3>
        <div className="flex items-center gap-2">
          {filter === "all" ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setFilter("pending")}
              className="h-7 text-xs"
            >
              show pending
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setFilter("all")}
              className="h-7 text-xs"
            >
              show all
            </Button>
          )}
        </div>
      </div>

      {approvals.length === 0 ? (
        <div className="text-center py-8 bg-card rounded-md">
          <p className="text-xs text-foreground/40">
            {filter === "pending" ? "no pending approvals" : "no approvals"}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {approvals.map((approval) => (
            <div
              key={approval.id}
              className="bg-card rounded-md p-3 space-y-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2 flex-1 min-w-0">
                  {getStatusIcon(approval.status)}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${getStatusColor(approval.status)}`}>
                        {approval.status}
                      </span>
                      <span className="text-[10px] text-foreground/50">
                        {formatTime(approval.requestedAt)}
                      </span>
                    </div>
                    <p className="text-xs text-foreground font-medium truncate">
                      {approval.action}
                    </p>
                    <p className="text-[10px] text-foreground/60 truncate">
                      {approval.description}
                    </p>
                    <p className="text-[10px] text-foreground/30">
                      {approval.chainId} / {approval.stepName}
                    </p>
                    {approval.rejectionReason && (
                      <p className="text-[10px] text-red-400 mt-1">
                        rejected: {approval.rejectionReason}
                      </p>
                    )}
                    {approval.approvedBy && (
                      <p className="text-[10px] text-foreground/50 mt-1">
                        by {approval.approvedBy}
                      </p>
                    )}
                  </div>
                </div>

                {approval.status === "pending" && (
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleApprove(approval.id)}
                      disabled={loading}
                      className="h-7 w-7 p-0 text-green-400 hover:text-green-300"
                    >
                      <TickCircleFilled className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleReject(approval.id)}
                      disabled={loading}
                      className="h-7 w-7 p-0 text-red-400 hover:text-red-300"
                    >
                      <CloseCircleFilled className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
