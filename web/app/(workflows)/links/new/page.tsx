"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TickCircleFilled } from "@aliimam/icons";
import { PageBanner } from "@/components/ui/page-banner";
import { PeopleFilled, LinkFilled, BotMessageSquare } from "@aliimam/icons";
import { useNamespaceFetch } from "@/lib/use-namespace-fetch";
import type { LinkMode } from "@/lib/link-types";
import Link from "next/link";

interface AgentDef {
  id: string;
  name: string;
  role?: string;
}

export default function NewLinkPage() {
  return (
    <Suspense fallback={<div className="p-4 text-xs text-foreground/40">Loading...</div>}>
      <NewLinkContent />
    </Suspense>
  );
}

function NewLinkContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get("edit");
  const { fetchWithNamespace } = useNamespaceFetch();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [mode, setMode] = useState<LinkMode>("collaboration");
  const [maxRounds, setMaxRounds] = useState(0);
  const [stallThreshold, setStallThreshold] = useState(0);
  const [leadingPrompt, setLeadingPrompt] = useState("");
  const [agent1Prompt, setAgent1Prompt] = useState("");
  const [agent2Prompt, setAgent2Prompt] = useState("");
  const [agent1Ref, setAgent1Ref] = useState("");
  const [agent1Name, setAgent1Name] = useState("");
  const [agent1Role, setAgent1Role] = useState("");
  const [agent2Ref, setAgent2Ref] = useState("");
  const [agent2Name, setAgent2Name] = useState("");
  const [agent2Role, setAgent2Role] = useState("");
  const [agents, setAgents] = useState<AgentDef[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // load agent registry
  useEffect(() => {
    fetchWithNamespace("/api/agents/registry")
      .then((r) => r.json())
      .then((d) => {
        const list = d.agents || [];
        setAgents(list);
      })
      .catch(() => {});
  }, [fetchWithNamespace]);

  // load existing link for editing
  useEffect(() => {
    if (!editId) return;
    fetchWithNamespace(`/api/links/${encodeURIComponent(editId)}`)
      .then((r) => r.json())
      .then((d) => {
        const link = d.link;
        if (!link) return;
        setName(link.name || "");
        setDescription(link.description || "");
        setMode(link.config?.mode || "collaboration");
        setMaxRounds(link.config?.max_rounds || 0);
        setStallThreshold(link.config?.stall_threshold || 0);
        setLeadingPrompt(link.config?.leading_prompt || "");
        setAgent1Prompt(link.config?.agent1_prompt || "");
        setAgent2Prompt(link.config?.agent2_prompt || "");
        if (link.agents?.agent1) {
          setAgent1Ref(link.agents.agent1.$ref || "");
          setAgent1Name(link.agents.agent1.name || "");
          setAgent1Role(link.agents.agent1.role || "");
        }
        if (link.agents?.agent2) {
          setAgent2Ref(link.agents.agent2.$ref || "");
          setAgent2Name(link.agents.agent2.name || "");
          setAgent2Role(link.agents.agent2.role || "");
        }
      })
      .catch(() => {});
  }, [editId, fetchWithNamespace]);

  const handleSave = async () => {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }

    // need at least agent names or refs
    const a1 = agent1Ref || agent1Name;
    const a2 = agent2Ref || agent2Name;
    if (!a1 || !a2) {
      setError("Both agents are required");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const body = {
        link: {
          ...(editId ? { id: editId } : {}),
          name: name.trim(),
          description: description.trim(),
          agents: {
            agent1: agent1Ref
              ? { $ref: agent1Ref }
              : { name: agent1Name.trim(), role: agent1Role.trim() || undefined },
            agent2: agent2Ref
              ? { $ref: agent2Ref }
              : { name: agent2Name.trim(), role: agent2Role.trim() || undefined },
          },
          config: {
            mode,
            max_rounds: maxRounds,
            stall_threshold: stallThreshold || undefined,
            leading_prompt: leadingPrompt.trim() || undefined,
            agent1_prompt: agent1Prompt.trim() || undefined,
            agent2_prompt: agent2Prompt.trim() || undefined,
            on_complete: "stop",
          },
          status: "active" as const,
        },
      };

      const res = await fetchWithNamespace("/api/links/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.message || "Failed to save");
      }

      router.push("/links");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <PageBanner
        title={editId ? "Edit Link" : "New Link"}
        subtitle="Define a two-agent collaboration session. Choose agents, set the mode, and configure the debate or review parameters."
        icon={PeopleFilled}
        sectionColor="#b07ee8"
        actions={[
          { label: "Links", href: "/links", icon: PeopleFilled, iconColor: "#b07ee8" },
          { label: "Chains", href: "/chains", icon: LinkFilled, iconColor: "#b07ee8" },
          { label: "Agents", href: "/agents", icon: BotMessageSquare, iconColor: "#b07ee8" },
        ]}
      />

      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-2xl space-y-4">
          {error && (
            <div className="text-xs text-red-400 bg-red-400/10 rounded-sm px-3 py-2">
              {error}
            </div>
          )}

          {/* name + description */}
          <div className="space-y-2">
            <div>
              <label className="text-xs text-foreground/50 mb-1 block">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Architecture Review"
                className="w-full px-3 py-2 bg-muted text-sm rounded-sm border-0 focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
            <div>
              <label className="text-xs text-foreground/50 mb-1 block">Description</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What this link does..."
                className="w-full px-3 py-2 bg-muted text-sm rounded-sm border-0 focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
          </div>

          {/* mode + settings */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-foreground/50 mb-1 block">Mode</label>
              <Select value={mode} onValueChange={(v) => setMode(v as LinkMode)}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="debate">Debate</SelectItem>
                  <SelectItem value="collaboration">Collaboration</SelectItem>
                  <SelectItem value="review">Review</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-foreground/50 mb-1 block">Max Rounds (0 = unlimited)</label>
              <input
                type="number"
                value={maxRounds}
                onChange={(e) => setMaxRounds(parseInt(e.target.value) || 0)}
                min={0}
                className="w-full px-3 py-2 bg-muted text-sm rounded-sm border-0 focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
            <div>
              <label className="text-xs text-foreground/50 mb-1 block">Stall Threshold</label>
              <input
                type="number"
                value={stallThreshold}
                onChange={(e) => setStallThreshold(parseInt(e.target.value) || 0)}
                min={0}
                className="w-full px-3 py-2 bg-muted text-sm rounded-sm border-0 focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
          </div>

          {/* agent 1 */}
          <div className="bg-muted rounded-md p-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
              <span className="text-xs font-medium">Agent 1</span>
            </div>
            <div>
              <label className="text-[10px] text-foreground/40 mb-0.5 block">From Registry</label>
              <Select value={agent1Ref} onValueChange={(v) => {
                setAgent1Ref(v === "__none__" ? "" : v);
                if (v !== "__none__") {
                  const a = agents.find((a) => a.id === v);
                  if (a) {
                    setAgent1Name(a.name);
                    setAgent1Role(a.role || "");
                  }
                }
              }}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Select agent or define inline..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None (inline)</SelectItem>
                  {agents.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {!agent1Ref && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-foreground/40 mb-0.5 block">Name</label>
                  <input
                    type="text"
                    value={agent1Name}
                    onChange={(e) => setAgent1Name(e.target.value)}
                    placeholder="Agent name"
                    className="w-full px-2 py-1.5 bg-card text-xs rounded-sm border-0 focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-foreground/40 mb-0.5 block">Role</label>
                  <input
                    type="text"
                    value={agent1Role}
                    onChange={(e) => setAgent1Role(e.target.value)}
                    placeholder="e.g. Senior Engineer"
                    className="w-full px-2 py-1.5 bg-card text-xs rounded-sm border-0 focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
              </div>
            )}
          </div>

          {/* agent 2 */}
          <div className="bg-muted rounded-md p-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
              <span className="text-xs font-medium">Agent 2</span>
            </div>
            <div>
              <label className="text-[10px] text-foreground/40 mb-0.5 block">From Registry</label>
              <Select value={agent2Ref} onValueChange={(v) => {
                setAgent2Ref(v === "__none__" ? "" : v);
                if (v !== "__none__") {
                  const a = agents.find((a) => a.id === v);
                  if (a) {
                    setAgent2Name(a.name);
                    setAgent2Role(a.role || "");
                  }
                }
              }}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Select agent or define inline..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None (inline)</SelectItem>
                  {agents.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {!agent2Ref && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-foreground/40 mb-0.5 block">Name</label>
                  <input
                    type="text"
                    value={agent2Name}
                    onChange={(e) => setAgent2Name(e.target.value)}
                    placeholder="Agent name"
                    className="w-full px-2 py-1.5 bg-card text-xs rounded-sm border-0 focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-foreground/40 mb-0.5 block">Role</label>
                  <input
                    type="text"
                    value={agent2Role}
                    onChange={(e) => setAgent2Role(e.target.value)}
                    placeholder="e.g. Product Manager"
                    className="w-full px-2 py-1.5 bg-card text-xs rounded-sm border-0 focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
              </div>
            )}
          </div>

          {/* prompts */}
          <div className="space-y-2">
            <div>
              <label className="text-xs text-foreground/50 mb-1 block">Leading Prompt</label>
              <textarea
                value={leadingPrompt}
                onChange={(e) => setLeadingPrompt(e.target.value)}
                placeholder="The main task or topic for the collaboration..."
                className="w-full px-3 py-2 bg-muted text-sm rounded-sm border-0 focus:outline-none focus:ring-1 focus:ring-accent resize-none h-24"
              />
            </div>
            <div>
              <label className="text-xs text-foreground/50 mb-1 block">Agent 1 Custom Prompt (optional)</label>
              <textarea
                value={agent1Prompt}
                onChange={(e) => setAgent1Prompt(e.target.value)}
                placeholder="Custom role instructions for agent 1..."
                className="w-full px-3 py-2 bg-muted text-sm rounded-sm border-0 focus:outline-none focus:ring-1 focus:ring-accent resize-none h-16"
              />
            </div>
            <div>
              <label className="text-xs text-foreground/50 mb-1 block">Agent 2 Custom Prompt (optional)</label>
              <textarea
                value={agent2Prompt}
                onChange={(e) => setAgent2Prompt(e.target.value)}
                placeholder="Custom role instructions for agent 2..."
                className="w-full px-3 py-2 bg-muted text-sm rounded-sm border-0 focus:outline-none focus:ring-1 focus:ring-accent resize-none h-16"
              />
            </div>
          </div>

          {/* save button */}
          <div className="flex items-center gap-2 pt-2">
            <Button onClick={handleSave} disabled={saving}>
              <TickCircleFilled className="h-3.5 w-3.5 mr-1.5" />
              {saving ? "Saving..." : editId ? "Update Link" : "Create Link"}
            </Button>
            <Link href="/links">
              <Button variant="ghost">Cancel</Button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
