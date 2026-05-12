"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { AddFilled as Plus, TrashFilled as Trash2, FlashFilled as Zap, HierarchyFilled as GitMerge, PlayFilled as Play } from "@aliimam/icons";
import { useNamespaceFetch } from "@/lib/use-namespace-fetch";

export interface ChainEventTrigger {
  event: string;
  source_chain?: string;
  condition?: string;
  pass_data?: boolean;
}

interface AllChainTriggers {
  chain_name: string;
  triggers: ChainEventTrigger[];
}

interface ChainTriggersPanelProps {
  chainName: string;
  triggers: ChainEventTrigger[];
  onChange: (triggers: ChainEventTrigger[]) => void;
}

export function ChainTriggersPanel({ chainName, triggers, onChange }: ChainTriggersPanelProps) {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [allTriggers, setAllTriggers] = useState<AllChainTriggers[]>([]);
  const [emitting, setEmitting] = useState(false);
  const [testEvent, setTestEvent] = useState("");
  const [testResult, setTestResult] = useState<string | null>(null);

  // load all cross-chain triggers for context
  const loadAllTriggers = useCallback(async () => {
    try {
      const res = await fetchWithNamespace("/api/chain-triggers");
      if (res.ok) {
        const data = await res.json();
        setAllTriggers(data.triggers ?? []);
      }
    } catch {
      // non-critical
    }
  }, [fetchWithNamespace]);

  useEffect(() => {
    loadAllTriggers();
  }, [loadAllTriggers]);

  function addTrigger() {
    onChange([...triggers, { event: "", source_chain: "", condition: "", pass_data: false }]);
  }

  function removeTrigger(i: number) {
    const next = [...triggers];
    next.splice(i, 1);
    onChange(next);
  }

  function updateTrigger(i: number, field: keyof ChainEventTrigger, value: string | boolean) {
    const next = triggers.map((t, idx) => (idx === i ? { ...t, [field]: value } : t));
    onChange(next);
  }

  async function emitTestEvent() {
    if (!testEvent.trim()) return;
    setEmitting(true);
    setTestResult(null);
    try {
      const res = await fetchWithNamespace("/api/chain-triggers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: testEvent.trim(), source: chainName, data: "" }),
      });
      if (res.ok) {
        setTestResult("event emitted — watcher will pick it up within ~10s");
      } else {
        const err = await res.json();
        setTestResult(`error: ${err.error}`);
      }
    } catch {
      setTestResult("network error");
    } finally {
      setEmitting(false);
    }
  }

  // chains that will trigger when THIS chain emits chain-complete
  const downstreamChains = allTriggers.filter(
    (t) =>
      t.chain_name !== chainName &&
      t.triggers.some(
        (tr) =>
          (tr.event === "chain-complete" && tr.source_chain === chainName) ||
          (tr.event === "chain-complete" && !tr.source_chain)
      )
  );

  return (
    <div className="space-y-6">
      {/* triggers this chain listens to */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h4 className="text-sm font-medium">Event Triggers</h4>
            <p className="text-xs text-foreground/40 mt-0.5">
              Start this chain automatically when a matching event is emitted
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={addTrigger} className="h-7 text-xs gap-1">
            <Plus className="w-3 h-3" />
            Add trigger
          </Button>
        </div>

        {triggers.length === 0 ? (
          <div className="rounded-md border border-dashed border-foreground/10 p-6 text-center">
            <Zap className="w-5 h-5 text-foreground/20 mx-auto mb-2" />
            <p className="text-xs text-foreground/40">No event triggers configured</p>
            <p className="text-[10px] text-foreground/30 mt-1">
              Add a trigger to start this chain when another chain emits an event
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {triggers.map((t, i) => (
              <div
                key={i}
                className="rounded-md bg-card p-3 space-y-2"
              >
                <div className="flex items-start gap-2">
                  <div className="flex-1 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-[10px] text-foreground/50">Event name</Label>
                        <Input
                          value={t.event}
                          onChange={(e) => updateTrigger(i, "event", e.target.value)}
                          placeholder="e.g. review-approved"
                          className="h-7 text-xs bg-background"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] text-foreground/50">Source chain (optional)</Label>
                        <Input
                          value={t.source_chain ?? ""}
                          onChange={(e) => updateTrigger(i, "source_chain", e.target.value)}
                          placeholder="any chain"
                          className="h-7 text-xs bg-background"
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-foreground/50">Condition (optional bash expression)</Label>
                      <Input
                        value={t.condition ?? ""}
                        onChange={(e) => updateTrigger(i, "condition", e.target.value)}
                        placeholder='e.g. "$data" == *"approved"*'
                        className="h-7 text-xs bg-background font-mono"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id={`pass-data-${i}`}
                        checked={t.pass_data ?? false}
                        onChange={(e) => updateTrigger(i, "pass_data", e.target.checked)}
                        className="w-3 h-3"
                      />
                      <Label htmlFor={`pass-data-${i}`} className="text-[10px] text-foreground/50 cursor-pointer">
                        Pass event data as CHAIN_INPUT env var
                      </Label>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => removeTrigger(i)}
                    className="h-7 w-7 p-0 text-foreground/30 hover:text-destructive shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* downstream chains (informational) */}
      {downstreamChains.length > 0 && (
        <div>
          <h4 className="text-sm font-medium mb-2 flex items-center gap-1.5">
            <GitMerge className="w-3.5 h-3.5 text-foreground/40" />
            Downstream chains
          </h4>
          <p className="text-xs text-foreground/40 mb-3">
            These chains are configured to start when <span className="font-mono text-foreground/60">{chainName}</span> completes
          </p>
          <div className="space-y-1.5">
            {downstreamChains.map((d) => (
              <div
                key={d.chain_name}
                className="flex items-center justify-between rounded-md bg-card px-3 py-2"
              >
                <span className="text-xs font-mono">{d.chain_name}</span>
                <div className="flex gap-1 flex-wrap justify-end">
                  {d.triggers
                    .filter(
                      (tr) =>
                        (tr.event === "chain-complete" && tr.source_chain === chainName) ||
                        (tr.event === "chain-complete" && !tr.source_chain)
                    )
                    .map((tr, ti) => (
                      <Badge key={ti} variant="secondary" className="text-[10px]">
                        {tr.source_chain ? "pinned" : "any chain"}
                        {tr.condition ? " + condition" : ""}
                      </Badge>
                    ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* test event emitter */}
      <div>
        <h4 className="text-sm font-medium mb-2 flex items-center gap-1.5">
          <Play className="w-3.5 h-3.5 text-foreground/40" />
          Test event emission
        </h4>
        <p className="text-xs text-foreground/40 mb-3">
          Emit a test event to the namespace events dir. The chain watcher will pick it up within ~10s.
        </p>
        <div className="flex gap-2">
          <Input
            value={testEvent}
            onChange={(e) => setTestEvent(e.target.value)}
            placeholder="event name (e.g. review-approved)"
            className="h-8 text-xs bg-card flex-1"
          />
          <Button
            size="sm"
            onClick={emitTestEvent}
            disabled={emitting || !testEvent.trim()}
            className="h-8 text-xs"
          >
            {emitting ? "Emitting..." : "Emit"}
          </Button>
        </div>
        {testResult && (
          <p className="text-[10px] mt-1.5 text-foreground/50">{testResult}</p>
        )}
      </div>
    </div>
  );
}
