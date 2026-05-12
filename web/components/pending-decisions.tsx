"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TickCircleFilled as CheckCircle2, JudgeFilled } from "@aliimam/icons";
import { TimeAgo } from "@/components/shared/time-ago";
import { useNamespaceFetch } from "@/lib/use-namespace-fetch";
import { useWorkspace } from "@/lib/workspace-context";
import { unwrapApiData } from "@/lib/api-client";

interface Decision {
  id: string;
  prompt: string;
  title?: string;
  status: string;
  createdAt: string;
  context?: { problem?: string };
  recommendation?: { choiceId?: string; rationale?: string; confidence?: number };
}

interface PendingDecisionsProps {
  className?: string;
}

export function PendingDecisions({ className }: PendingDecisionsProps) {
  const { fetchWithNamespace } = useNamespaceFetch();
  const { workspacePath } = useWorkspace();
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchDecisions = async () => {
      try {
        const wsParam = workspacePath ? `&workspace=${encodeURIComponent(workspacePath)}` : "";
        const res = await fetchWithNamespace(`/api/decisions?status=pending${wsParam}`);
        const raw = await res.json();
        const data = unwrapApiData<{ decisions?: Decision[] }>(raw);
        setDecisions(data.decisions || []);
      } catch {
        setDecisions([]);
      } finally {
        setLoading(false);
      }
    };
    fetchDecisions();
  }, [fetchWithNamespace, workspacePath]);

  if (!loading && decisions.length === 0) return null;

  return (
    <div className={`bg-background border border-border/40 rounded-xl overflow-hidden ${className || ""}`}>
      <div className="px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <JudgeFilled className="h-4 w-4 shrink-0" style={{ color: "#f59e0b" }} />
          <div>
            <h3 className="text-sm font-bold tracking-tight flex items-center gap-2">
              Pending Decisions
            </h3>
            <p className="text-[10px] text-muted-foreground">awaiting your review</p>
          </div>
        </div>
        {decisions.length > 0 && (
          <Link href="/decisions" className="text-[10px] text-muted-foreground hover:text-foreground">
            view all
          </Link>
        )}
      </div>
      {loading ? (
        <div className="px-4 py-6 text-center text-xs text-muted-foreground">loading...</div>
      ) : (
        <div className="divide-y divide-muted/40">
          {decisions.slice(0, 5).map((d) => (
            <Link key={d.id} href={`/decisions?decisionId=${d.id}`}>
              <div className="px-4 py-3 hover:bg-accent/40 transition-colors">
                <p className="text-xs font-medium line-clamp-1">{d.title || d.prompt}</p>
                {d.context?.problem && (
                  <p className="text-[10px] text-muted-foreground line-clamp-1 mt-0.5">{d.context.problem}</p>
                )}
                <div className="flex items-center gap-2 mt-1">
                  <TimeAgo date={d.createdAt} format="short" suffix={false} className="text-[10px] text-muted-foreground/40" />
                  {d.recommendation && (
                    <span className="text-[10px] text-green-400 flex items-center gap-0.5">
                      <CheckCircle2 className="h-2.5 w-2.5" />
                      researched
                    </span>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
