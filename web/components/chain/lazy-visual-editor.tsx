"use client";

import { lazy, Suspense } from "react";
import { Card } from "@/components/ui/card";
import { RotateFilled as Loader2 } from "@aliimam/icons";
import type { VisualChainEditorProps } from "./visual-editor-reactflow";

// lazy load the heavy ReactFlow-based editor
export const VisualChainEditorReactFlow = lazy(() =>
  import("./visual-editor-reactflow").then((m) => ({
    default: m.VisualChainEditor,
  }))
);

// lazy load the original visual editor
export const VisualChainEditor = lazy(() =>
  import("./visual-editor").then((m) => ({
    default: m.VisualChainEditor,
  }))
);

export function VisualEditorLoading() {
  return (
    <Card className="h-[600px] flex items-center justify-center">
      <div className="text-center text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
        <p className="text-sm">Loading visual editor...</p>
      </div>
    </Card>
  );
}

export function VisualChainEditorLazy(props: VisualChainEditorProps) {
  return (
    <Suspense fallback={<VisualEditorLoading />}>
      <VisualChainEditorReactFlow {...props} />
    </Suspense>
  );
}

export function VisualChainEditorOldLazy(props: VisualChainEditorProps) {
  return (
    <Suspense fallback={<VisualEditorLoading />}>
      <VisualChainEditor {...props} />
    </Suspense>
  );
}
