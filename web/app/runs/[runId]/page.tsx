"use client";

import { useParams, useRouter } from "next/navigation";
import { RunDetailPanel } from "@/components/run/run-detail-panel";

export default function RunDetailPage() {
  const params = useParams();
  const router = useRouter();
  const runId = params.runId as string;

  return (
    <div className="h-full overflow-hidden">
      <RunDetailPanel
        runId={runId}
        onBack={() => router.push("/runs")}
        onDelete={() => router.push("/runs")}
      />
    </div>
  );
}
