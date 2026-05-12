"use client";

import { useEffect } from "react";
import Link from "next/link";

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function DashboardError({ error, reset }: ErrorProps) {
  useEffect(() => {
    console.error("[dashboard error]", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4 px-4">
      <p className="text-sm text-foreground/50">
        Dashboard failed to load. {error.digest && <span className="font-mono text-xs">({error.digest})</span>}
      </p>
      <div className="flex items-center gap-3">
        <button
          onClick={reset}
          className="px-3 py-1.5 text-xs rounded-md bg-muted hover:bg-accent transition-colors"
        >
          Try again
        </button>
        <Link href="/runs" className="text-xs text-foreground/40 hover:text-foreground transition-colors">
          View runs
        </Link>
      </div>
    </div>
  );
}
