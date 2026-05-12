"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Chain } from "@/lib/types";
import type {
  RetryPolicy,
  ChainRetryConfig,
} from "@/lib/retry-types";
import { useNamespaceFetch } from "@/lib/use-namespace-fetch";

const DEFAULT_RETRY: RetryPolicy = {
  enabled: false,
  maxAttempts: 3,
  backoffStrategy: "exponential",
  baseDelayMs: 1000,
  maxDelayMs: 60000,
  retryableErrors: ["timeout", "network", "rate_limit"],
};

interface RetryConfigProps {
  chain: Chain;
  onConfigChange?: (config: ChainRetryConfig) => void;
}

export function RetryConfig({ chain, onConfigChange }: RetryConfigProps) {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [config, setConfig] = useState<ChainRetryConfig>({
    defaultPolicy: DEFAULT_RETRY,
    agents: {},
    stopOnFirstError: false,
  });
  const [loading, setLoading] = useState(false);

  const loadConfig = useCallback(async () => {
    try {
      const res = await fetchWithNamespace(`/api/retry/config?chainId=${chain.id}`);
      if (res.ok) {
        const data = await res.json();
        if (data) {
          setConfig(data);
        }
      }
    } catch {
      // use defaults
    }
  }, [chain.id, fetchWithNamespace]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const handleSave = async () => {
    setLoading(true);
    try {
      const res = await fetchWithNamespace("/api/retry/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chainId: chain.id,
          config,
        }),
      });
      if (res.ok) {
        onConfigChange?.(config);
      }
    } finally {
      setLoading(false);
    }
  };

  const updateRetry = (updates: Partial<RetryPolicy>) => {
    setConfig({
      ...config,
      defaultPolicy: { ...config.defaultPolicy, ...updates },
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium text-foreground">retry policy</h3>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-foreground/50">enabled</span>
          <Switch
            checked={config.defaultPolicy.enabled}
            onCheckedChange={(checked) => updateRetry({ enabled: checked })}
            className="scale-75"
          />
        </div>
      </div>

      {config.defaultPolicy.enabled && (
        <div className="space-y-3 bg-card rounded-md p-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-foreground/50 mb-1 block">
                max attempts
              </label>
              <Select
                value={config.defaultPolicy.maxAttempts.toString()}
                onValueChange={(val) =>
                  updateRetry({ maxAttempts: parseInt(val) })
                }
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 5, 10].map((n) => (
                    <SelectItem key={n} value={n.toString()}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-[10px] text-foreground/50 mb-1 block">
                backoff strategy
              </label>
              <Select
                value={config.defaultPolicy.backoffStrategy}
                onValueChange={(val) =>
                  updateRetry({ backoffStrategy: val as "fixed" | "linear" | "exponential" | "exponential_with_jitter" })
                }
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fixed">fixed</SelectItem>
                  <SelectItem value="linear">linear</SelectItem>
                  <SelectItem value="exponential">exponential</SelectItem>
                  <SelectItem value="exponential_with_jitter">
                    exponential + jitter
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <label className="text-[10px] text-foreground/50 mb-1 block">
              base delay (ms)
            </label>
            <input
              type="number"
              value={config.defaultPolicy.baseDelayMs}
              onChange={(e) =>
                updateRetry({ baseDelayMs: parseInt(e.target.value) || 1000 })
              }
              className="w-full px-2 py-1.5 text-xs bg-muted rounded-md outline-none focus:ring-1 focus:ring-accent"
              min="100"
              step="100"
            />
          </div>

          <div className="flex items-center justify-between pt-2">
            <span className="text-[10px] text-foreground/40">
              stop chain on first error
            </span>
            <Switch
              checked={config.stopOnFirstError}
              onCheckedChange={(checked) =>
                setConfig({ ...config, stopOnFirstError: checked })
              }
              className="scale-75"
            />
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={handleSave}
          disabled={loading}
          className="text-xs flex-1"
        >
          {loading ? "saving..." : "save config"}
        </Button>
      </div>
    </div>
  );
}
