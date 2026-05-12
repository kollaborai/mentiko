"use client";

interface ChainPreviewCardProps {
  name: string;
  description?: string;
  agents: { name: string; role?: string }[];
  className?: string;
}

export function ChainPreviewCard({
  name,
  description,
  agents,
  className = "",
}: ChainPreviewCardProps) {
  return (
    <div className={`bg-muted rounded-md p-3 ${className}`}>
      <div className="text-sm font-medium">{name}</div>
      {description && (
        <div className="text-[10px] text-foreground/40 mt-0.5 line-clamp-2">
          {description}
        </div>
      )}
      {agents.length > 0 && (
        <div className="mt-1.5 font-mono text-[10px] text-foreground/50">
          {agents.map((a) => a.name).join(" -> ")}
        </div>
      )}
      <div className="text-[10px] text-foreground/30 mt-1">
        {agents.length} agent{agents.length !== 1 ? "s" : ""}
      </div>
    </div>
  );
}
