import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { TickCircleFilled as CheckCircle2, RecordCircleFilled as Circle, InfoCircleFilled as AlertCircle, RotateFilled as Loader2 } from "@aliimam/icons";
import type { ChainAgent as BaseChainAgent } from "@/lib/types";

export interface ChainAgent extends Omit<BaseChainAgent, 'status'> {
  status?: "pending" | "running" | "complete" | "error";
}

interface ChainGraphProps {
  agents: ChainAgent[];
  title?: string;
}

export function ChainGraph({ agents, title }: ChainGraphProps) {
  const getStatusIcon = (status: ChainAgent["status"]) => {
    switch (status) {
      case "running":
        return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
      case "complete":
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case "error":
        return <AlertCircle className="h-4 w-4 text-red-500" />;
      default:
        return <Circle className="h-4 w-4 text-muted-foreground" />;
    }
  };

  return (
    <Card>
      {title && (
        <div className="border-b px-4 py-3">
          <h3 className="font-semibold">{title}</h3>
        </div>
      )}
      <div className="p-4">
        <div className="space-y-1">
          {agents.map((agent, idx) => (
            <div key={agent.id} className="relative">
              <div className="flex items-center gap-3 p-3 rounded-md border bg-card">
                {getStatusIcon(agent.status)}
                <Badge variant="outline" className="text-xs">
                  {agent.id}
                </Badge>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{agent.name}</p>
                  {agent.role && (
                    <p className="text-xs text-muted-foreground truncate">{agent.role}</p>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">emits</p>
                  <Badge variant="secondary" className="text-xs mt-1">
                    {agent.emits}
                  </Badge>
                </div>
              </div>
              {idx < agents.length - 1 && (
                <div className="flex justify-center">
                  <div className="w-0.5 h-4 bg-border" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
