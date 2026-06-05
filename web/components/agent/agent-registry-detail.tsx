"use client";

import { useState } from "react";
import Link from "next/link";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import {
  LinkFilled,
  LinkFilled as Workflow,
  ArrowRightFilled as ArrowUpRight,
  DocumentTextFilled as FileText,
  ClockFilled as Clock,
  RotateRightFilled as RotateCw,
  ShieldTickFilled as Shield,
  FolderOpenFilled as FolderOpen,
  MessageSquareFilled as MessageSquare,
  CpuFilled as Cpu,
  MagicStarFilled as Wand2,
  InfoCircleFilled as Info,
  TrashFilled as Trash2,
  Edit2Filled as Edit,
  BoxFilled as Package,
  ShareFilled as Wrench,
} from "@aliimam/icons";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { DetailHeader } from "@/components/ui/detail-header";
import { AgentEditDialog } from "@/components/agent/agent-edit-dialog";
import { AgentAvatar } from "./agent-avatar";
import type { RegistryAgent } from "@/app/api/agents/registry/route";
import { cn } from "@/lib/utils";

interface AgentRegistryDetailProps {
  agent: RegistryAgent;
  onSaved?: () => void;
  onDeleted?: () => void;
  workspacePath?: string;
}

function getArtifactProduceLabel(artifact: { id: string } | { $ref: string }) {
  return "$ref" in artifact ? artifact.$ref : artifact.id;
}

function EmptyVal() {
  return <span className="text-[10px] text-foreground/25 italic">none</span>;
}

function BentoCard({
  title,
  icon: Icon,
  children,
  className,
  colSpan = 1,
  rowSpan = 1,
}: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
  className?: string;
  colSpan?: 1 | 2;
  rowSpan?: 1 | 2;
}) {
  return (
    <div
      className={cn(
        "bg-muted/50 rounded-lg p-3 flex flex-col",
        colSpan === 2 && "col-span-2",
        rowSpan === 2 && "row-span-2",
        className
      )}
    >
      <div className="flex items-center gap-1.5 mb-2 shrink-0">
        <Icon className="h-3.5 w-3.5 text-foreground/40" />
        <h3 className="text-[10px] font-medium text-foreground/70 uppercase tracking-wide">
          {title}
        </h3>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">{children}</div>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  color = "text-foreground/60",
}: {
  label: string;
  value: React.ReactNode;
  icon: React.ElementType;
  color?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-3.5 w-3.5 text-foreground/30" />
      <div className="flex-1 min-w-0">
        <p className="text-[10px] text-foreground/40">{label}</p>
        <p className={cn("text-xs truncate", color)}>{value}</p>
      </div>
    </div>
  );
}

export function AgentRegistryDetail({ agent, onSaved, onDeleted, workspacePath }: AgentRegistryDetailProps) {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [showEdit, setShowEdit] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const canEdit = agent.source === "standalone";

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-4">
        {/* header strip */}
        <DetailHeader className="gap-3 mb-4">
          <AgentAvatar seed={agent.id} size={32} className="relative" />
          <div className="relative min-w-0 flex-1">
            <h2 className="text-lg font-bold tracking-tighter truncate">{agent.name}</h2>
            <p className="text-xs text-foreground/50 truncate">{agent.role || "no role"}</p>
          </div>
          <div className="relative flex items-center gap-1.5 shrink-0">
            {agent.source === "standalone" && (
              <span className="text-[9px] px-2 py-0.5 rounded-full bg-green-500/10 text-green-400">
                standalone
              </span>
            )}
            <CopyButton value={agent.id} fullValue={agent} />
            {canEdit && (
              <>
                <Link href={`/agents/${encodeURIComponent(agent.id)}/edit`}>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px] gap-1">
                    <Edit className="h-3 w-3" />
                    Edit
                  </Button>
                </Link>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-[10px] gap-1"
                  onClick={() => setShowEdit(true)}
                >
                  <Wand2 className="h-3 w-3" />
                  AI Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-[10px] gap-1 text-red-400 hover:text-red-400 hover:bg-red-400/10"
                  onClick={() => setShowDeleteConfirm(true)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </>
            )}
          </div>
        </DetailHeader>

        {/* bento grid */}
        <div className="grid grid-cols-2 gap-2">
          {/* prompt - large card, 2 columns, 2 rows */}
          <BentoCard title="prompt" icon={FileText} colSpan={2} rowSpan={2} className="bg-accent/30">
            {agent.prompt ? (
              <pre className="text-[11px] font-mono whitespace-pre-wrap text-foreground/70 leading-relaxed max-h-[280px] overflow-y-auto">
                {agent.prompt}
              </pre>
            ) : (
              <EmptyVal />
            )}
          </BentoCard>

          {/* description - 1 column */}
          <BentoCard title="description" icon={Info}>
            {agent.description ? (
              <p className="text-[11px] text-foreground/60 leading-relaxed">{agent.description}</p>
            ) : (
              <EmptyVal />
            )}
          </BentoCard>

          {/* triggers - 1 column */}
          <BentoCard title="triggers" icon={MessageSquare}>
            {(agent.triggers || []).length === 0 ? (
              <p className="text-[10px] text-foreground/40">starts chain</p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {(agent.triggers || []).map((t, i) => (
                  <code
                    key={i}
                    className="text-[10px] bg-accent px-1.5 py-0.5 rounded text-foreground/70"
                  >
                    {t}
                  </code>
                ))}
              </div>
            )}
          </BentoCard>

          {/* emits - 1 column */}
          <BentoCard title="emits" icon={ArrowUpRight}>
            {agent.emits ? (
              <code className="text-[10px] bg-green-500/10 text-green-400 px-1.5 py-0.5 rounded">
                {agent.emits}
              </code>
            ) : (
              <EmptyVal />
            )}
          </BentoCard>

          {/* chains - 1 column */}
          <BentoCard title="used in" icon={Workflow}>
            {agent.chains.length === 0 ? (
              <EmptyVal />
            ) : (
              <div className="space-y-0.5">
                {agent.chains.slice(0, 5).map((chain) => (
                  <Link
                    key={chain.id}
                    href={`/chains/${chain.id}/edit`}
                    className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-accent transition-colors group"
                  >
                    <LinkFilled className="h-3 w-3 text-foreground/30 group-hover:text-foreground/50 shrink-0" />
                    <span className="text-xs text-foreground/60 group-hover:text-foreground truncate">
                      {chain.name}
                    </span>
                  </Link>
                ))}
                {agent.chains.length > 5 && (
                  <p className="text-[10px] text-foreground/30 px-2">
                    +{agent.chains.length - 5} more
                  </p>
                )}
              </div>
            )}
          </BentoCard>

          {/* config - 2 columns, compact stats */}
          <BentoCard title="config" icon={Cpu} colSpan={2}>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              <StatCard
                label="timeout"
                value={agent.timeout ? `${agent.timeout}s` : "default"}
                icon={Clock}
              />
              <StatCard
                label="retry"
                value={agent.retry ? `${agent.retry.max_retries}x · ${agent.retry.backoff}` : "none"}
                icon={RotateCw}
              />
              <StatCard
                label="model"
                value={agent.model || "default"}
                icon={Cpu}
                color="text-violet-400/80 font-mono"
              />
              <StatCard
                label="tools"
                value={agent.tools?.length ?? 0}
                icon={Wrench}
                color="text-amber-400/80"
              />
            </div>
            {agent.tools && agent.tools.length > 0 && (
              <div className="mt-2 pt-2 border-t border-foreground/5">
                <div className="flex flex-wrap gap-1">
                  {agent.tools.map((tool, i) => (
                    <code
                      key={i}
                      className="text-[9px] bg-accent px-1 py-0.5 rounded text-foreground/60"
                    >
                      {tool}
                    </code>
                  ))}
                </div>
              </div>
            )}
          </BentoCard>

          {/* authorities - 1 column */}
          {agent.authorities && (agent.authorities.can?.length || agent.authorities.needs_approval?.length) && (
            <BentoCard title="authorities" icon={Shield}>
              <div className="space-y-2">
                {agent.authorities.can && agent.authorities.can.length > 0 && (
                  <div>
                    <p className="text-[10px] text-foreground/40 mb-1">can</p>
                    <div className="flex flex-wrap gap-1">
                      {agent.authorities.can.map((auth, i) => (
                        <code
                          key={i}
                          className="text-[10px] bg-green-500/10 text-green-400/80 px-1.5 py-0.5 rounded"
                        >
                          {auth}
                        </code>
                      ))}
                    </div>
                  </div>
                )}
                {agent.authorities.needs_approval && agent.authorities.needs_approval.length > 0 && (
                  <div>
                    <p className="text-[10px] text-foreground/40 mb-1">needs approval</p>
                    <div className="flex flex-wrap gap-1">
                      {agent.authorities.needs_approval.map((auth, i) => (
                        <code
                          key={i}
                          className="text-[10px] bg-amber-500/10 text-amber-400/80 px-1.5 py-0.5 rounded"
                        >
                          {auth}
                        </code>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </BentoCard>
          )}

          {/* context - 1 column */}
          {agent.context && (agent.context.workspace || agent.context.read_first?.length) && (
            <BentoCard title="context" icon={FolderOpen}>
              <div className="space-y-2">
                {agent.context.workspace && (
                  <div>
                    <p className="text-[10px] text-foreground/40 mb-1">workspace</p>
                    <code className="text-[10px] bg-accent px-1.5 py-0.5 rounded">
                      {agent.context.workspace}
                    </code>
                  </div>
                )}
                {agent.context.read_first && agent.context.read_first.length > 0 && (
                  <div>
                    <p className="text-[10px] text-foreground/40 mb-1">read first</p>
                    <div className="flex flex-wrap gap-1">
                      {agent.context.read_first.map((file, i) => (
                        <code
                          key={i}
                          className="text-[10px] bg-accent px-1.5 py-0.5 rounded truncate max-w-[180px]"
                        >
                          {file}
                        </code>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </BentoCard>
          )}

          {/* artifacts - 2 columns */}
          {agent.artifacts && (agent.artifacts.produces?.length || agent.artifacts.consumes?.length) && (
            <BentoCard title="artifacts" icon={Package} colSpan={2}>
              <div className="flex gap-4">
                {agent.artifacts.produces && agent.artifacts.produces.length > 0 && (
                  <div className="flex-1">
                    <p className="text-[10px] text-foreground/40 mb-1">produces</p>
                    <div className="flex flex-wrap gap-1">
                      {agent.artifacts.produces.map((artifact, i) => (
                        <code
                          key={i}
                          className="text-[10px] bg-blue-500/10 text-blue-400/80 px-1.5 py-0.5 rounded"
                        >
                          {getArtifactProduceLabel(artifact as { id: string } | { $ref: string })}
                        </code>
                      ))}
                    </div>
                  </div>
                )}
                {agent.artifacts.consumes && agent.artifacts.consumes.length > 0 && (
                  <div className="flex-1">
                    <p className="text-[10px] text-foreground/40 mb-1">consumes</p>
                    <div className="space-y-1">
                      {agent.artifacts.consumes.map((artifact, i) => (
                        <div key={i} className="text-[10px] text-foreground/60 flex items-center gap-1">
                          <code className="bg-accent px-1 py-0.5 rounded">{artifact.from}</code>
                          <span className="text-foreground/30">→</span>
                          <code className="bg-accent px-1 py-0.5 rounded">{artifact.artifact}</code>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </BentoCard>
          )}
        </div>
      </div>

      {canEdit && (
        <AgentEditDialog
          open={showEdit}
          agent={agent}
          onClose={() => setShowEdit(false)}
          workspacePath={workspacePath}
          onSaved={() => {
            setShowEdit(false);
            onSaved?.();
          }}
        />
      )}

      {/* delete confirmation */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="bg-card rounded-md p-5 max-w-sm w-full mx-4 space-y-4">
            <div>
              <p className="text-sm font-medium">Delete agent?</p>
              <p className="text-xs text-foreground/50 mt-1">
                <span className="font-mono text-foreground/70">{agent.id}</span> will be permanently deleted. This cannot be undone.
              </p>
            </div>
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="outline" onClick={() => setShowDeleteConfirm(false)} disabled={deleting}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-red-400 hover:text-red-400 hover:bg-red-400/10"
                disabled={deleting}
                onClick={async () => {
                  setDeleting(true);
                  try {
                    const res = await fetchWithNamespace(`/api/agents/registry/${encodeURIComponent(agent.id)}`, { method: "DELETE" });
                    if (res.ok) {
                      setShowDeleteConfirm(false);
                      onDeleted?.();
                    }
                  } finally {
                    setDeleting(false);
                  }
                }}
              >
                {deleting ? "Deleting..." : "Delete"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
