"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PageBanner } from "@/components/ui/page-banner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { getApiErrorMessage } from "@/lib/api/api-client";
import { getMissingChainDefaultProfileId } from "@/lib/chains/chain-profile-settings";
import type { AgentProfile } from "@/lib/types";
import {
  ArrowRight2Filled,
  JudgeFilled,
  RefreshFilled,
  RouteSquareFilled,
  TickCircleFilled,
  Warning2Filled,
} from "@aliimam/icons";

interface DecisionCoreChain {
  id: string;
  name: string;
  description: string;
  version: string;
  phase: string;
  default_agent_profile?: string;
  agentCount: number;
}

interface DecisionSettingsResponse {
  chains: DecisionCoreChain[];
  profiles: AgentProfile[];
}

const PHASE_LABELS: Record<string, string> = {
  research: "research",
  questions: "questions",
  options: "options",
  plan: "plan",
};

function getProfileSummary(profile?: AgentProfile) {
  if (!profile) return "workspace default";
  return `${profile.name}${profile.model ? ` / ${profile.model}` : ""}`;
}

function getProfileSummaryForChain(chain: DecisionCoreChain, profiles: AgentProfile[]) {
  const missingProfileId = getMissingChainDefaultProfileId(chain.default_agent_profile, profiles);
  if (missingProfileId) return `profile not found: ${missingProfileId}`;
  return getProfileSummary(profiles.find((item) => item.id === chain.default_agent_profile));
}

export default function DecisionSettingsPage() {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [chains, setChains] = useState<DecisionCoreChain[]>([]);
  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingChainId, setSavingChainId] = useState<string | null>(null);
  const [restoringChainId, setRestoringChainId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetchWithNamespace("/api/settings/decisions/core-chains");
      const data = await res.json() as DecisionSettingsResponse;
      setChains(data.chains || []);
      setProfiles(data.profiles || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load decision settings");
    } finally {
      setLoading(false);
    }
  }, [fetchWithNamespace]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  async function updateProfile(chainId: string, value: string) {
    setSavingChainId(chainId);
    setSaved("");
    setError("");
    try {
      const res = await fetchWithNamespace("/api/settings/decisions/core-chains", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chainId,
          defaultAgentProfileId: value === "__workspace__" ? null : value,
        }),
      });
      const data = await res.json() as { chain?: DecisionCoreChain };
      if (!res.ok || !data.chain) {
        throw new Error(getApiErrorMessage(data, "Failed to update decision chain profile"));
      }
      setChains((current) => current.map((chain) => chain.id === chainId ? data.chain as DecisionCoreChain : chain));
      setSaved("profile saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update decision chain profile");
    } finally {
      setSavingChainId(null);
    }
  }

  async function restoreChains(chainId?: string) {
    const label = chainId ? chains.find((chain) => chain.id === chainId)?.name || chainId : "all decision core chains";
    if (!window.confirm(`Restore ${label} to factory defaults?`)) return;

    setRestoringChainId(chainId || "__all__");
    setSaved("");
    setError("");
    try {
      const res = await fetchWithNamespace("/api/settings/decisions/core-chains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(chainId ? { chainId } : {}),
      });
      const data = await res.json() as { chains?: DecisionCoreChain[] };
      if (!res.ok || !data.chains) {
        throw new Error(getApiErrorMessage(data, "Failed to restore decision chains"));
      }
      setChains(data.chains);
      setSaved(chainId ? "chain restored" : "all chains restored");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to restore decision chains");
    } finally {
      setRestoringChainId(null);
    }
  }

  return (
    <div className="flex-1 overflow-auto">
      <PageBanner
        title="Decision Settings"
        subtitle="Configure the saved core chains that power decision research, questions, options, and plans."
        icon={JudgeFilled}
        sectionColor="#5b9ef5"
        actions={[
          { label: "Decision Tasks", href: "/tasks?type=decision", icon: JudgeFilled, iconColor: "#5b9ef5" },
          { label: "Chains", href: "/chains", icon: RouteSquareFilled, iconColor: "#5cb88a" },
        ]}
      />

      <div className="mx-auto max-w-5xl px-4 pb-8">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">core decision chains</h2>
            <p className="text-xs text-muted-foreground">
              changes here update the saved chains shown in /chains.
            </p>
          </div>
          <Button
            size="sm"
            variant="secondary"
            className="h-8 text-xs"
            onClick={() => void restoreChains()}
            disabled={loading || restoringChainId !== null}
          >
            <RefreshFilled className="mr-1.5 h-3.5 w-3.5" />
            restore all
          </Button>
        </div>

        {error && (
          <div className="mb-3 flex items-center gap-2 rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-300">
            <Warning2Filled className="h-3.5 w-3.5" />
            {error}
          </div>
        )}

        {saved && (
          <div className="mb-3 flex items-center gap-2 rounded-md bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
            <TickCircleFilled className="h-3.5 w-3.5" />
            {saved}
          </div>
        )}

        <div className="space-y-2">
          {loading ? (
            <div className="rounded-md border border-border/40 bg-card p-4 text-xs text-muted-foreground">
              loading decision chains...
            </div>
          ) : chains.map((chain) => {
            const missingProfileId = getMissingChainDefaultProfileId(chain.default_agent_profile, profiles);
            const phase = PHASE_LABELS[chain.phase] || chain.phase;
            return (
              <div key={chain.id} className="rounded-md border border-border/40 bg-card p-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-sm font-semibold">{chain.name}</h3>
                      <span className="rounded-full bg-foreground/5 px-2 py-0.5 text-[10px] text-muted-foreground">
                        {phase}
                      </span>
                      <span className="rounded-full bg-foreground/5 px-2 py-0.5 text-[10px] text-muted-foreground">
                        v{chain.version}
                      </span>
                    </div>
                    <p className="line-clamp-2 text-xs text-muted-foreground">{chain.description}</p>
                    <p className="mt-2 text-[10px] text-muted-foreground/70">
                      effective profile: {getProfileSummaryForChain(chain, profiles)}
                    </p>
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <Select
                      value={chain.default_agent_profile || "__workspace__"}
                      onValueChange={(value) => void updateProfile(chain.id, value)}
                      disabled={savingChainId === chain.id || restoringChainId !== null}
                    >
                      <SelectTrigger className="h-8 w-full bg-background text-xs sm:w-64">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__workspace__">Use workspace default</SelectItem>
                        {missingProfileId && (
                          <SelectItem value={missingProfileId}>
                            Profile not found - {missingProfileId}
                          </SelectItem>
                        )}
                        {profiles.map((item) => (
                          <SelectItem key={item.id} value={item.id}>
                            {item.name}{item.model ? ` / ${item.model}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Link
                      href={`/chains?chain=${encodeURIComponent(chain.id)}&edit=1`}
                      className="inline-flex h-8 items-center justify-center rounded-md border border-border/50 px-3 text-xs hover:bg-accent"
                    >
                      edit
                      <ArrowRight2Filled className="ml-1.5 h-3.5 w-3.5" />
                    </Link>

                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 px-3 text-xs"
                      onClick={() => void restoreChains(chain.id)}
                      disabled={restoringChainId !== null}
                    >
                      <RefreshFilled className="mr-1.5 h-3.5 w-3.5" />
                      restore
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
