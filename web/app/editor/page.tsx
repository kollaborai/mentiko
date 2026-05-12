import { Suspense } from "react";
import { WaveSpinner } from "@/components/ui/wave-spinner";
import { EditorPageClient } from "@/components/editor/editor-page-client";

export default function EditorPage() {
  return (
    <Suspense
      fallback={
        <div className="h-full flex items-center justify-center">
          <WaveSpinner size="sm" color="primary" animation="ripple" />
        </div>
      }
    >
      <EditorPageClient />
    </Suspense>
  );
}
