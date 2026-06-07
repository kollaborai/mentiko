"use client";

import { useNamespace } from "@/lib/ui-context/namespace-context";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ArrowSwapFilled as ChevronsUpDown } from "@aliimam/icons";

export function NavNamespaceSelector() {
  const { namespaceId, setNamespaceId, namespaces } = useNamespace();

  const current = namespaces.find((n) => n.id === namespaceId);

  // single org: hide entirely (no point showing "default")
  if (namespaces.length <= 1) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-xs gap-1.5"
        >
          <span className="max-w-[120px] truncate">
            {current?.name ?? namespaceId}
          </span>
          <ChevronsUpDown className="h-3 w-3 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[140px]">
        {namespaces.map((ns) => (
          <DropdownMenuItem
            key={ns.id}
            onClick={() => setNamespaceId(ns.id)}
            className={namespaceId === ns.id ? "bg-accent" : ""}
          >
            <span className="text-xs">{ns.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
