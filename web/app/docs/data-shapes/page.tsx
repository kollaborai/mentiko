"use client";

import { Data2Filled, DocumentTextFilled } from "@aliimam/icons";
import { PageBanner } from "@/components/ui/page-banner";
import { DataShapeStatusLegend, DataShapesCatalog, RunnerLineageLegend } from "@/components/docs/data-shapes-catalog";

export default function DataShapesPage() {
  return (
    <div className="flex h-full min-h-0 flex-col" data-source="app/docs/data-shapes/page.tsx">
      <PageBanner
        title="Data Shapes"
        subtitle="Persisted contracts, storage scope, source ownership, and live drift evidence."
        icon={Data2Filled}
        sectionColor="#f59e0b"
        actions={[
          { label: "Architecture", href: "/docs/architecture", icon: DocumentTextFilled, iconColor: "#f59e0b" },
        ]}
      />
      <DataShapeStatusLegend />
      <RunnerLineageLegend />
      <DataShapesCatalog />
    </div>
  );
}
