"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useNamespaceFetch } from "@/lib/use-namespace-fetch";
import { copyToClipboard } from "@/lib/copy-to-clipboard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshFilled as RefreshCw, CommandSquareFilled as Terminal, CopyFilled as Copy } from "@aliimam/icons";
import { WaveSpinner } from "@/components/ui/wave-spinner";

interface LiveOutputProps {
  session: string;
  autoRefresh?: boolean;
  refreshInterval?: number;
}

export function LiveOutput({
  session,
  autoRefresh = true,
  refreshInterval = 2000,
}: LiveOutputProps) {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [output, setOutput] = useState("");
  const [loading, setLoading] = useState(true);
  const outputRef = useRef<HTMLDivElement>(null);

  const fetchOutput = useCallback(async () => {
    try {
      const res = await fetchWithNamespace(`/api/agents/${encodeURIComponent(session)}/output`);
      if (res.ok) {
        const data = await res.json();
        setOutput(data.output || "");
      }
    } catch (err) {
      console.error("Failed to fetch output:", err);
    } finally {
      setLoading(false);
    }
  }, [session, fetchWithNamespace]);

  useEffect(() => {
    fetchOutput();
    if (autoRefresh) {
      const interval = setInterval(fetchOutput, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [session, autoRefresh, refreshInterval, fetchOutput]);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  const handleCopy = () => {
    copyToClipboard(output);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Terminal className="h-4 w-4" />
            {session}
          </CardTitle>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={fetchOutput}>
              <RefreshCw className="h-3 w-3" />
            </Button>
            <Button size="sm" variant="ghost" onClick={handleCopy}>
              <Copy className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div
          ref={outputRef}
          className="bg-black text-green-500 p-3 rounded font-mono text-xs h-80 overflow-y-auto"
        >
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <WaveSpinner size="sm" color="primary" animation="ripple" />
            </div>
          ) : output ? (
            <pre className="whitespace-pre-wrap">{output}</pre>
          ) : (
            <p className="text-muted-foreground">No output yet...</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
