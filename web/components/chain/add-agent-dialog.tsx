"use client";

import { useState, useEffect, useMemo } from "react";
import { BotMessageSquare as Bot, MagicStarFilled as Sparkles, AddFilled as Plus, SearchNormalFilled as Search, RotateFilled as Loader2, ArrowLeftFilled as ArrowLeft } from "@aliimam/icons";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { getApiErrorMessage } from "@/lib/api/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ChainAgent } from "@/lib/types";
import type { RegistryAgent } from "@/app/api/agents/registry/route";

type Mode = "choose" | "browse" | "generate";

interface AddAgentDialogProps {
  open: boolean;
  onClose: () => void;
  onAddAgent: (agent: ChainAgent) => void;
  onCreateBlank: () => void;
  workspacePath?: string;
}

function registryToChainAgent(r: RegistryAgent): ChainAgent {
  return {
    id: r.id,
    name: r.name,
    role: r.role || undefined,
    prompt: r.prompt || undefined,
    triggers: r.triggers || [],
    emits: r.emits || "output",
    timeout: r.timeout,
    retry: r.retry,
    model: r.model,
    tools: r.tools,
  };
}

export function AddAgentDialog({
  open,
  onClose,
  onAddAgent,
  onCreateBlank,
  workspacePath,
}: AddAgentDialogProps) {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [mode, setMode] = useState<Mode>("choose");
  const [agents, setAgents] = useState<RegistryAgent[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [search, setSearch] = useState("");

  // generate state
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<ChainAgent | null>(null);
  const [error, setError] = useState("");

  const reset = () => {
    setMode("choose");
    setSearch("");
    setPrompt("");
    setGenerating(false);
    setGenerated(null);
    setError("");
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  // fetch registry agents when switching to browse
  useEffect(() => {
    if (mode === "browse" && agents.length === 0) {
      setLoadingAgents(true);
      fetchWithNamespace("/api/agents/registry")
        .then((r) => r.json())
        .then((data) => setAgents(data.agents || []))
        .catch(() => setAgents([]))
        .finally(() => setLoadingAgents(false));
    }
  }, [mode, agents.length, fetchWithNamespace]);

  const filtered = useMemo(() => {
    if (!search) return agents;
    const q = search.toLowerCase();
    return agents.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.role.toLowerCase().includes(q) ||
        a.id.toLowerCase().includes(q)
    );
  }, [agents, search]);

  const handlePickAgent = (agent: RegistryAgent) => {
    onAddAgent(registryToChainAgent(agent));
    handleClose();
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setGenerating(true);
    setError("");
    try {
      const res = await fetchWithNamespace("/api/agents/registry/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          ...(workspacePath ? { workspacePath } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(getApiErrorMessage(data, "Failed to generate"));

      const jobId = data.jobId;
      if (!jobId) throw new Error("No generation job returned");

      let agent: Partial<RegistryAgent> | null = null;
      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const pollRes = await fetchWithNamespace(`/api/jobs/${jobId}`);
        const job = await pollRes.json();
        if (job.status === "complete" && job.result) {
          agent = job.result as Partial<RegistryAgent>;
          break;
        }
        if (job.status === "failed") {
          throw new Error(job.error || "Generation failed");
        }
      }
      if (!agent) throw new Error("Generation timed out");

      setGenerated({
        id: agent.id || `agent-${Date.now()}`,
        name: agent.name || "Generated Agent",
        role: agent.role,
        prompt: agent.prompt,
        triggers: agent.triggers || ["manual-start"],
        emits: agent.emits || "output",
        timeout: agent.timeout,
        model: agent.model,
        tools: agent.tools,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  };

  const handleAddGenerated = () => {
    if (!generated) return;
    onAddAgent(generated);
    handleClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-sm font-medium">
            {mode === "choose" && "Add Agent"}
            {mode === "browse" && "Browse Agents"}
            {mode === "generate" && (generated ? "Preview Agent" : "Generate Agent")}
          </DialogTitle>
        </DialogHeader>

        {/* choose mode */}
        {mode === "choose" && (
          <div className="space-y-2">
            <button
              onClick={() => setMode("browse")}
              className="w-full flex items-center gap-3 p-3 rounded-md bg-card hover:bg-muted transition-colors text-left"
            >
              <Bot className="h-4 w-4 text-foreground/50 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">Browse Existing</div>
                <div className="text-[11px] text-muted-foreground">
                  Pick from your agent registry
                </div>
              </div>
              <Badge variant="secondary" className="text-[10px] shrink-0">
                {agents.length > 0 ? `${agents.length} agents` : "registry"}
              </Badge>
            </button>

            <button
              onClick={() => setMode("generate")}
              className="w-full flex items-center gap-3 p-3 rounded-md bg-card hover:bg-muted transition-colors text-left"
            >
              <Sparkles className="h-4 w-4 shrink-0" style={{ color: "#a855f6" }} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">Generate with AI</div>
                <div className="text-[11px] text-muted-foreground">
                  Describe what the agent should do
                </div>
              </div>
            </button>

            <button
              onClick={() => {
                handleClose();
                onCreateBlank();
              }}
              className="w-full flex items-center gap-3 p-3 rounded-md bg-card hover:bg-muted transition-colors text-left"
            >
              <Plus className="h-4 w-4 text-foreground/50 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">Create Blank</div>
                <div className="text-[11px] text-muted-foreground">
                  Start from scratch with an empty agent
                </div>
              </div>
            </button>
          </div>
        )}

        {/* browse mode */}
        {mode === "browse" && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 shrink-0"
                onClick={() => setMode("choose")}
              >
                <ArrowLeft className="h-3 w-3" />
              </Button>
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/80" />
                <Input
                  placeholder="search agents..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-8 pl-8 text-xs"
                  autoFocus
                />
              </div>
            </div>

            <div className="max-h-[320px] overflow-y-auto space-y-1">
              {loadingAgents ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-4 w-4 animate-spin text-foreground/30" />
                </div>
              ) : filtered.length === 0 ? (
                <div className="text-center py-8 text-xs text-foreground/40">
                  {search ? "No agents match" : "No agents in registry"}
                </div>
              ) : (
                filtered.map((agent) => (
                  <button
                    key={agent.id}
                    onClick={() => handlePickAgent(agent)}
                    className="w-full flex items-start gap-3 p-3 rounded-md bg-card hover:bg-muted transition-colors text-left"
                  >
                    <Bot className="h-3.5 w-3.5 text-foreground/40 mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium truncate">
                          {agent.name}
                        </span>
                        <Badge variant="secondary" className="text-[10px] shrink-0">
                          {agent.source}
                        </Badge>
                      </div>
                      <div className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">
                        {agent.role || agent.id}
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-[10px] text-foreground/40">
                        <span>{(agent.triggers || []).length} trigger{(agent.triggers || []).length !== 1 ? "s" : ""}</span>
                        {agent.model && <span>{agent.model}</span>}
                        {agent.chains.length > 0 && (
                          <span>used in {agent.chains.length} chain{agent.chains.length !== 1 ? "s" : ""}</span>
                        )}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {/* generate mode */}
        {mode === "generate" && !generated && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 shrink-0"
                onClick={() => setMode("choose")}
              >
                <ArrowLeft className="h-3 w-3" />
              </Button>
              <span className="text-xs text-foreground/50">Describe what the agent should do</span>
            </div>
            <Textarea
              placeholder="e.g. A code reviewer that checks for security vulnerabilities, code style, and test coverage."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="min-h-[120px] text-sm bg-card resize-none"
              autoFocus
            />
            {error && (
              <div className="text-xs text-red-400 p-2 bg-red-500/10 rounded-md">
                {error}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                size="sm"
                className="bg-purple-500/10 text-purple-400 hover:bg-purple-500/20"
                onClick={handleGenerate}
                disabled={!prompt.trim() || generating}
              >
                {generating ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span className="ml-1.5">Generating...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="h-3 w-3" style={{ color: "#a855f6" }} />
                    <span className="ml-1.5">Generate</span>
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* generate preview */}
        {mode === "generate" && generated && (
          <div className="space-y-3">
            <div className="bg-card rounded-md p-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{generated.name}</span>
                <Badge variant="secondary" className="text-[10px]">generated</Badge>
              </div>
              <p className="text-[11px] text-muted-foreground">{generated.role}</p>
              <div className="flex flex-wrap gap-2 text-[10px] text-foreground/50">
                <span>triggers: {(generated.triggers || []).join(", ")}</span>
                <span>emits: {generated.emits}</span>
                {generated.model && <span>model: {generated.model}</span>}
              </div>
              {generated.prompt && (
                <pre className="text-[10px] text-foreground/40 bg-muted rounded-md p-2 max-h-32 overflow-y-auto whitespace-pre-wrap font-mono">
                  {generated.prompt}
                </pre>
              )}
            </div>
            <div className="flex justify-between gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setGenerated(null)}
              >
                Back
              </Button>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={handleClose}>
                  Cancel
                </Button>
                <Button size="sm" onClick={handleAddGenerated}>
                  Add to Chain
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
