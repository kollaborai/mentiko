import { Suspense } from "react";
import { WaveSpinner } from "@/components/ui/wave-spinner";
import { CodeEditorClient } from "@/components/editor/code-editor-client";

export default function CodePage() {
  return (
    <Suspense
      fallback={
        <div className="h-full flex items-center justify-center">
          <WaveSpinner size="sm" color="primary" animation="ripple" />
        </div>
      }
    >
      <CodeEditorClient />
    </Suspense>
  );
}
