"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { useWorkspace } from "@/lib/ui-context/workspace-context";
import { BoxFilled, BotMessageSquare, LinkFilled, RouteSquareFilled } from "@aliimam/icons";
import { PageBanner } from "@/components/ui/page-banner";
import { ArtifactTemplateEditor } from "@/components/settings/artifact-template-editor";
import { ArtifactGenerateDialog } from "@/components/artifact/artifact-generate-dialog";
import { ArtifactCreateDialog } from "@/components/agent/artifact-create-dialog";
import { EmptyState } from "@/components/common/empty-state";
import type { ArtifactType } from "@/lib/system/artifact-template-storage";

interface ArtifactTemplate {
  id: string;
  name: string;
  type: ArtifactType;
  description: string;
  content: string;
  updatedAt: string;
}


function ArtifactsPageContent() {
  const { fetchWithNamespace } = useNamespaceFetch();
  const { workspacePath } = useWorkspace();
  const [templates, setTemplates] = useState<ArtifactTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showMobileEditor, setShowMobileEditor] = useState(false);
  const [showGenerateDialog, setShowGenerateDialog] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await fetchWithNamespace("/api/artifact-templates");
      if (res.ok) {
        const data = await res.json();
        setTemplates(data.templates || []);
        if (data.templates?.length > 0) {
          setSelectedId(data.templates[0].id);
        }
      }
    } catch {
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  }, [fetchWithNamespace]);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const handleCreate = async (t: Omit<ArtifactTemplate, "updatedAt">) => {
    const res = await fetchWithNamespace("/api/artifact-templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(t),
    });
    if (res.ok) {
      const data = await res.json();
      setTemplates((prev) => [...prev, data.template]);
      setSelectedId(data.template.id);
      setShowMobileEditor(true);
    }
  };

  const handleUpdate = async (id: string, patch: Partial<ArtifactTemplate>) => {
    const res = await fetchWithNamespace(`/api/artifact-templates/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      const data = await res.json();
      setTemplates((prev) => prev.map((t) => (t.id === id ? data.template : t)));
    }
  };

  const handleDelete = async (id: string) => {
    const res = await fetchWithNamespace(`/api/artifact-templates/${id}`, { method: "DELETE" });
    if (res.ok) {
      setTemplates((prev) => prev.filter((t) => t.id !== id));
      if (selectedId === id) {
        setSelectedId(templates.find((t) => t.id !== id)?.id ?? null);
        setShowMobileEditor(false);
      }
    }
  };

  const handleSelect = (id: string) => {
    setSelectedId(id);
    setShowMobileEditor(true);
  };

  return (
    <div className="h-full flex flex-col">
      {/* header */}
      <PageBanner
        title="Artifacts"
        subtitle="Output templates that agents produce during chain execution. Define report formats, schemas, and documentation structures for consistent agent output."
        icon={BoxFilled}
        sectionColor="#b07ee8"
        actions={[
          { label: "Agents", href: "/agents", icon: BotMessageSquare, iconColor: "#b07ee8" },
          { label: "Chains", href: "/chains", icon: LinkFilled, iconColor: "#b07ee8" },
          { label: "Runs", href: "/runs", icon: RouteSquareFilled, iconColor: "#5b9ef5" },
          { label: "Marketplace", href: "/marketplace/artifacts", icon: BoxFilled, iconColor: "#5cb88a" },
        ]}
        docs={[
          { label: "Artifacts Guide", href: "/docs/artifacts", icon: BoxFilled },
        ]}
      />

      {/* content */}
      <div className="flex-1 flex overflow-hidden pl-4">
        {loading ? (
          <div className="flex items-center justify-center w-full">
            <div className="text-xs text-muted-foreground">loading...</div>
          </div>
        ) : templates.length === 0 ? (
          <div className="flex items-center justify-center w-full">
            <EmptyState
              icon={<BoxFilled className="h-10 w-10" />}
              title="No artifact templates yet"
              description="Artifact templates define the output format for agent-produced content."
              action={{ label: "Browse Marketplace", href: "/marketplace/artifacts" }}
            />
          </div>
        ) : (
          <ArtifactTemplateEditor
            templates={templates}
            selectedId={selectedId}
            onSelect={handleSelect}
            showMobileEditor={showMobileEditor}
            onCreate={handleCreate}
            onUpdate={handleUpdate}
            onDelete={handleDelete}
          />
        )}
      </div>

      <ArtifactCreateDialog
        open={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        onCreated={(template) => {
          fetchTemplates();
          setSelectedId(template.id);
          setShowCreateDialog(false);
        }}
      />

      <ArtifactGenerateDialog
        open={showGenerateDialog}
        onClose={() => setShowGenerateDialog(false)}
        workspacePath={workspacePath}
        onCreate={async (data) => {
          const res = await fetchWithNamespace("/api/artifact-templates", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || "Failed to create artifact");
          }
          const result = await res.json();
          setTemplates((prev) => [...prev, result.template]);
          setSelectedId(result.template.id);
          setShowMobileEditor(true);
        }}
        onRefresh={fetchTemplates}
      />
    </div>
  );
}

export default function ArtifactsPage() {
  return (
    <Suspense fallback={<div className="h-full flex items-center justify-center text-muted-foreground">Loading...</div>}>
      <ArtifactsPageContent />
    </Suspense>
  );
}
