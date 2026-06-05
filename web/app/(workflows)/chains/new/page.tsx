"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ChainFlowGraph, type ChainAgent as FlowChainAgent } from "@/components/chain/chain-flow-graph";
import { AgentPreviewTooltip } from "@/components/chain/agent-preview-tooltip";
import { ChainPreviewTooltip } from "@/components/chain/chain-preview-tooltip";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  CodeFilled,
  EyeFilled,
  RotateFilled as Loader2,
  Star1Filled as Sparkles,
  TickCircleFilled as CheckCircle2,
  InfoCircleFilled as AlertCircle,
  SmsFilled as Send,
  ArrowDown2Filled as ChevronDown,
  ArrowUp2Filled as ChevronUp,
  AddFilled as Save,
  Link2Filled as Link2,
  BotMessageSquare as Bot,
} from "@aliimam/icons";
import { useRouter } from "next/navigation";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { useWorkspace } from "@/lib/ui-context/workspace-context";
import { getApiErrorMessage } from "@/lib/api/api-client";
import { useSharedChains } from "@/lib/chains/chains-store";

interface ChainAgent {
  id: string;
  name: string;
  role?: string;
  triggers: string[];
  emits: string;
  prompt?: string;
  retry?: { max_retries?: number; backoff?: string };
  profiles?: Record<string, unknown>;
  agent_profile?: string;
}

interface Chain {
  name: string;
  description?: string;
  agents: ChainAgent[];
  branches?: Record<string, string | string[]>;
  config?: {
    workspace?: {
      type: "local" | "ssh" | "docker";
      [key: string]: unknown;
    };
    cli?: string;
    monitor?: boolean;
    max_rounds?: number;
    on_complete?: string;
  };
  webhook?: {
    url: string;
    secret?: string;
    on_events?: string[];
  };
  scheduler?: {
    enabled: boolean;
    cron: string;
    timezone?: string;
  };
  routing?: {
    default_agent?: string;
    fallback_agent?: string;
    default_timeout?: number;
  };
  profiles?: Record<string, string>;
  default_agent_profile?: string;
}

interface AvailableAgent {
  id: string;
  name: string;
  role?: string;
  triggers: string[];
  emits: string;
}

interface AvailableChain {
  id: string;
  name: string;
  description?: string;
  agentCount: number;
  agents?: { id: string; name: string; emits?: string }[];
}

interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  chain?: Chain;
}

export default function NewChainPage() {
  const { fetchWithNamespace } = useNamespaceFetch();
  const { chains: sharedChains, loading: loadingChains } = useSharedChains();
  const { workspacePath } = useWorkspace();
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [generatedChain, setGeneratedChain] = useState<Chain | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [viewMode, setViewMode] = useState<"visual" | "json">("visual");
  const [editedJson, setEditedJson] = useState("");
  const [jsonError, setJsonError] = useState("");

  // conversation history for revisions
  const [conversation, setConversation] = useState<ConversationMessage[]>([]);
  const [revisionInput, setRevisionInput] = useState("");
  const conversationEndRef = useRef<HTMLDivElement>(null);

  // optional pickers
  const [showAgentPicker, setShowAgentPicker] = useState(false);
  const [showChainPicker, setShowChainPicker] = useState(false);
  const [availableAgents, setAvailableAgents] = useState<AvailableAgent[]>([]);
  const availableChains: AvailableChain[] = sharedChains.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    agentCount: c.agentCount,
    agents: undefined,
  }));
  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
  const [selectedChains, setSelectedChains] = useState<string[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(false);

  // validation
  const [isValid, setIsValid] = useState<boolean | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  useEffect(() => {
    conversationEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation]);

  const fetchAgents = async () => {
    if (availableAgents.length > 0) return;
    setLoadingAgents(true);
    try {
      const res = await fetchWithNamespace("/api/agents/registry");
      const data = await res.json();
      setAvailableAgents(
        (data.agents || []).map((a: AvailableAgent) => ({
          id: a.id,
          name: a.name,
          role: a.role || "",
          triggers: a.triggers || [],
          emits: a.emits || "",
        }))
      );
    } catch {
      /* silent */
    } finally {
      setLoadingAgents(false);
    }
  };

  const toggleAgent = (id: string) => {
    setSelectedAgents((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]
    );
  };

  const toggleChain = (id: string) => {
    setSelectedChains((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  };

  const buildPrompt = (userText: string) => {
    let fullPrompt = userText;

    if (selectedAgents.length > 0) {
      const agentNames = selectedAgents
        .map((id) => availableAgents.find((a) => a.id === id))
        .filter(Boolean)
        .map((a) => `"${a!.id}" (${a!.name})`)
        .join(", ");
      fullPrompt += `\n\nIMPORTANT: You MUST include these agents in the chain using $ref syntax: ${agentNames}`;
    }

    if (selectedChains.length > 0) {
      const chainNames = selectedChains
        .map((id) => availableChains.find((c) => c.id === id))
        .filter(Boolean)
        .map((c) => `"${c!.id}" (${c!.name})`)
        .join(", ");
      fullPrompt += `\n\nCompose this chain with these existing chains: ${chainNames}. Include their agents and connect the flows together.`;
    }

    return fullPrompt;
  };

  const validateChain = async (chain: Chain) => {
    try {
      const res = await fetchWithNamespace("/api/chains/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chain }),
      });
      const data = await res.json();
      setValidationErrors(
        data.errors?.map(
          (e: { message?: string } | string) =>
            typeof e === "string" ? e : e.message || String(e)
        ) || []
      );
      setIsValid(data.valid);
      return data.valid;
    } catch {
      setIsValid(false);
      return false;
    }
  };

  const pollJob = async (jobId: string) => {
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const poll = await fetchWithNamespace(`/api/jobs/${jobId}`);
      const job = await poll.json();
      if (job.status === "complete" && job.result) {
        return job.result as { name?: string; agents?: ChainAgent[]; [key: string]: unknown };
      }
      if (job.status === "failed") throw new Error(job.error || "Generation failed");
    }
    throw new Error("Generation timed out");
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) return;

    setLoading(true);
    setError("");
    setGeneratedChain(null);
    setValidationErrors([]);
    setIsValid(null);

    const fullPrompt = buildPrompt(prompt);

    setConversation([{ role: "user", content: prompt }]);

    try {
      const res = await fetchWithNamespace("/api/chains/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: fullPrompt,
          ...(workspacePath ? { workspacePath } : {}),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(getApiErrorMessage(data, "Failed to generate chain"));

      const chain = await pollJob(data.jobId) as Chain;
      setGeneratedChain(chain);
      setEditedJson(JSON.stringify(chain, null, 2));
      setViewMode("visual");
      await validateChain(chain);

      setConversation((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Created "${chain.name}" with ${chain.agents?.length || 0} agents.${chain.description ? " " + chain.description : ""}`,
          chain,
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleRevision = async () => {
    if (!revisionInput.trim() || !generatedChain) return;

    const revisionText = revisionInput;
    setRevisionInput("");
    setLoading(true);
    setError("");

    setConversation((prev) => [
      ...prev,
      { role: "user", content: revisionText },
    ]);

    const revisionPrompt = `I have an existing chain definition:\n\n${JSON.stringify(generatedChain, null, 2)}\n\nThe user wants these changes: ${revisionText}\n\nReturn the COMPLETE updated chain JSON with the requested modifications. Keep everything that works, only change what was requested.`;

    try {
      const res = await fetchWithNamespace("/api/chains/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: revisionPrompt,
          ...(workspacePath ? { workspacePath } : {}),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(getApiErrorMessage(data, "Failed to revise chain"));

      const chain = await pollJob(data.jobId) as Chain;
      setGeneratedChain(chain);
      setEditedJson(JSON.stringify(chain, null, 2));
      await validateChain(chain);

      setConversation((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Updated "${chain.name}" - ${chain.agents?.length || 0} agents.`,
          chain,
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setConversation((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Error: ${err instanceof Error ? err.message : String(err)}`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!generatedChain) return;

    setSaving(true);
    setError("");

    try {
      let chainToSave = generatedChain;

      if (viewMode === "json" && editedJson) {
        try {
          chainToSave = JSON.parse(editedJson);
          setJsonError("");
        } catch (e: unknown) {
          setJsonError(
            "Invalid JSON: " + (e instanceof Error ? e.message : String(e))
          );
          setSaving(false);
          return;
        }
      }

      const valid = await validateChain(chainToSave);
      if (!valid) {
        setError("Cannot save: chain validation failed");
        setSaving(false);
        return;
      }

      const name =
        chainToSave.name?.toLowerCase().replace(/\s+/g, "-") || "new-chain";
      const res = await fetchWithNamespace("/api/chains/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chain: chainToSave, name }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(getApiErrorMessage(data, "Failed to save chain"));
      }

      router.push("/chains");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleJsonChange = (value: string) => {
    setEditedJson(value);
    try {
      const parsed = JSON.parse(value);
      setJsonError("");
      setGeneratedChain(parsed);
      validateChain(parsed);
    } catch (e: unknown) {
      setJsonError(e instanceof Error ? e.message : String(e));
    }
  };

  const examplePrompts = [
    {
      label: "Research & Write",
      prompt:
        "Create a chain with a researcher that searches the web, a writer that creates a blog post from the research, and a reviewer. If review fails, loop back to the writer.",
    },
    {
      label: "Code Review",
      prompt:
        "3 parallel reviewers analyzing security, performance, and style. A consolidator merges feedback and approves or requests changes.",
    },
    {
      label: "Data Pipeline",
      prompt:
        "Extract data from documents, validate against schema, transform to standard format, load into database. On validation failure, route to manual review.",
    },
  ];

  return (
    <TooltipProvider>
    <div className="max-w-4xl mx-auto py-8 px-4">
      <h1 className="text-2xl font-semibold mb-1">Create Chain</h1>
      <p className="text-sm text-foreground/50 mb-6">
        Describe your workflow and AI will build it. Be specific about agents,
        flow, and conditions.
      </p>

      {/* main input - only show when no chain generated yet */}
      {!generatedChain && (
        <div className="space-y-4">
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={`What should this chain do?\n\nBe specific about:\n- How many agents and what each one does\n- The flow: sequential, parallel, or conditional\n- What triggers each agent and what they output\n- Any loops or error handling\n\nExample: "3 agents - researcher searches the web, writer creates a summary, reviewer checks quality. If review fails, send back to writer."`}
            className="min-h-[180px] text-sm bg-card resize-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && e.metaKey) {
                e.preventDefault();
                handleGenerate();
              }
            }}
          />

          {/* agent & chain pickers */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="text-xs gap-1.5"
              onClick={() => {
                setShowAgentPicker(!showAgentPicker);
                if (!showAgentPicker) fetchAgents();
              }}
            >
              <Bot className="h-3.5 w-3.5" />
              Pin Agents
              {selectedAgents.length > 0 && (
                <Badge variant="secondary" className="ml-1 text-[10px] px-1.5">
                  {selectedAgents.length}
                </Badge>
              )}
              {showAgentPicker ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="text-xs gap-1.5"
              onClick={() => {
                setShowChainPicker(!showChainPicker);
              }}
            >
              <Link2 className="h-3.5 w-3.5" />
              Compose Chains
              {selectedChains.length > 0 && (
                <Badge variant="secondary" className="ml-1 text-[10px] px-1.5">
                  {selectedChains.length}
                </Badge>
              )}
              {showChainPicker ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
            </Button>
          </div>

          {/* agent picker panel */}
          {showAgentPicker && (
            <div className="bg-card rounded-md p-3">
              <p className="text-[11px] text-foreground/50 mb-2">
                Force these agents to be included in the generated chain:
              </p>
              {loadingAgents ? (
                <div className="flex items-center gap-2 text-xs text-foreground/40 py-2">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Loading agents...
                </div>
              ) : availableAgents.length === 0 ? (
                <p className="text-xs text-foreground/40 py-2">
                  No standalone agents found. Create agents first in the Agent
                  Registry.
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {availableAgents.map((agent) => (
                    <AgentPreviewTooltip key={agent.id} agent={agent} side="bottom">
                      <button
                        onClick={() => toggleAgent(agent.id)}
                        className={`text-[11px] px-2.5 py-1.5 rounded-md transition-colors ${
                          selectedAgents.includes(agent.id)
                            ? "bg-blue-500/20 text-blue-400 ring-1 ring-blue-500/30"
                            : "bg-muted text-foreground/60 hover:text-foreground/80"
                        }`}
                      >
                        {agent.name}
                      </button>
                    </AgentPreviewTooltip>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* chain picker panel */}
          {showChainPicker && (
            <div className="bg-card rounded-md p-3">
              <p className="text-[11px] text-foreground/50 mb-2">
                Compose with existing chains - their agents will be wired into
                your new chain:
              </p>
              {loadingChains ? (
                <div className="flex items-center gap-2 text-xs text-foreground/40 py-2">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Loading chains...
                </div>
              ) : availableChains.length === 0 ? (
                <p className="text-xs text-foreground/40 py-2">
                  No existing chains found.
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {availableChains.map((chain) => (
                    <ChainPreviewTooltip key={chain.id} chain={chain} side="bottom">
                      <button
                        onClick={() => toggleChain(chain.id)}
                        className={`text-[11px] px-2.5 py-1.5 rounded-md transition-colors ${
                          selectedChains.includes(chain.id)
                            ? "bg-purple-500/20 text-purple-400 ring-1 ring-purple-500/30"
                            : "bg-muted text-foreground/60 hover:text-foreground/80"
                        }`}
                      >
                        {chain.name}
                        <span className="text-foreground/30 ml-1">
                          {chain.agentCount} agents
                        </span>
                      </button>
                    </ChainPreviewTooltip>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* examples */}
          <div>
            <p className="text-[11px] text-foreground/40 mb-2">
              or try an example:
            </p>
            <div className="flex gap-2">
              {examplePrompts.map((ex) => (
                <button
                  key={ex.label}
                  onClick={() => setPrompt(ex.prompt)}
                  className="text-[11px] px-3 py-2 rounded-md bg-muted text-foreground/60 hover:text-foreground/80 transition-colors text-left"
                >
                  {ex.label}
                </button>
              ))}
            </div>
          </div>

          {/* generate button */}
          <Button
            onClick={handleGenerate}
            disabled={loading || !prompt.trim()}
            className="w-full gap-2"
            size="lg"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Generate Chain
              </>
            )}
          </Button>
        </div>
      )}

      {/* error */}
      {error && (
        <Alert variant="destructive" className="mt-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="text-xs">{error}</AlertDescription>
        </Alert>
      )}

      {/* generated chain preview + conversation */}
      {generatedChain && (
        <div className="mt-6 space-y-4">
          {/* conversation history */}
          <div className="space-y-3">
            {conversation.map((msg, i) => (
              <div key={i}>
                <div
                  className={`text-xs px-3 py-2 rounded-md ${
                    msg.role === "user"
                      ? "bg-blue-500/10 text-blue-300 ml-12"
                      : "bg-card text-foreground/70 mr-12"
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}
            <div ref={conversationEndRef} />
          </div>

          {/* view toggle + validation */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setViewMode("visual")}
                className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
                  viewMode === "visual"
                    ? "bg-accent text-foreground"
                    : "text-foreground/40 hover:text-foreground/60"
                }`}
              >
                <EyeFilled className="h-3 w-3 inline mr-1" />
                Visual
              </button>
              <button
                onClick={() => setViewMode("json")}
                className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
                  viewMode === "json"
                    ? "bg-accent text-foreground"
                    : "text-foreground/40 hover:text-foreground/60"
                }`}
              >
                <CodeFilled className="h-3 w-3 inline mr-1" />
                JSON
              </button>
            </div>

            <div className="flex items-center gap-2">
              {isValid !== null && (
                <Badge
                  variant={isValid ? "secondary" : "destructive"}
                  className="text-[10px]"
                >
                  {isValid ? (
                    <>
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      Valid
                    </>
                  ) : (
                    <>
                      <AlertCircle className="h-3 w-3 mr-1" />
                      {validationErrors.length} errors
                    </>
                  )}
                </Badge>
              )}
            </div>
          </div>

          {/* validation errors */}
          {validationErrors.length > 0 && (
            <div className="bg-red-500/5 rounded-md p-2.5">
              {validationErrors.map((err, i) => (
                <p key={i} className="text-[11px] text-red-400">
                  {err}
                </p>
              ))}
            </div>
          )}

          {/* visual preview */}
          {viewMode === "visual" && (
            <div className="bg-card rounded-md p-4">
              <ChainFlowGraph
                agents={generatedChain.agents as unknown as FlowChainAgent[]}
                branches={generatedChain.branches}
                width={700}
                height={Math.max(300, generatedChain.agents.length * 120)}
                showRoutingDetails
              />
            </div>
          )}

          {/* json editor */}
          {viewMode === "json" && (
            <div>
              <textarea
                value={editedJson}
                onChange={(e) => handleJsonChange(e.target.value)}
                className="w-full min-h-[400px] bg-card text-xs font-mono p-3 rounded-md resize-y text-foreground/80 focus:outline-none focus:ring-1 focus:ring-accent"
                spellCheck={false}
              />
              {jsonError && (
                <p className="text-[11px] text-red-400 mt-1">{jsonError}</p>
              )}
            </div>
          )}

          {/* revision input */}
          <div className="flex gap-2">
            <Textarea
              value={revisionInput}
              onChange={(e) => setRevisionInput(e.target.value)}
              placeholder="Describe changes... e.g. 'add a security scanner before the reviewer' or 'make the first two agents run in parallel'"
              className="min-h-[44px] max-h-[120px] text-sm bg-card resize-none flex-1"
              onKeyDown={(e) => {
                if (e.key === "Enter" && e.metaKey) {
                  e.preventDefault();
                  handleRevision();
                }
              }}
            />
            <Button
              onClick={handleRevision}
              disabled={loading || !revisionInput.trim()}
              size="icon"
              className="shrink-0 h-[44px] w-[44px]"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>

          {/* action buttons */}
          <div className="flex gap-2">
            <Button
              onClick={handleSave}
              disabled={saving || isValid === false}
              className="flex-1 gap-2"
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  Save Chain
                </>
              )}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setGeneratedChain(null);
                setConversation([]);
                setPrompt("");
                setSelectedAgents([]);
                setSelectedChains([]);
                setError("");
                setValidationErrors([]);
                setIsValid(null);
              }}
            >
              Start Over
            </Button>
          </div>
        </div>
      )}
    </div>
    </TooltipProvider>
  );
}
