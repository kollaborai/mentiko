"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AddFilled as Plus,
  Trash,
  DocumentTextFilled as FileText,
  DocumentCodeFilled as FileJson,
  Code1Filled as Code2,
  GitBranch,
  Sheet,
  AlignLeftFilled as AlignLeft,
  GalleryFilled as ImageIcon,
} from "@aliimam/icons";
import { cn } from "@/lib/utils";
import type { ArtifactType } from "@/lib/system/artifact-template-storage";
import {
  WorkflowSidebarPane,
  WorkflowSidebarFilters,
  WorkflowSidebarSearchInput,
  WorkflowSidebarToggleFilter,
  matchesToggleFilter,
  WorkflowSidebarItem,
  WorkflowSidebarResizeHandle,
} from "@/components/ui/workflow-sidebar";

interface ArtifactTemplate {
  id: string;
  name: string;
  type: ArtifactType;
  description: string;
  content: string;
  updatedAt: string;
}

const TYPE_META: Record<ArtifactType, { label: string; ext: string; icon: React.ReactNode; accentBar: string; pillColor: string }> = {
  markdown: { label: "Markdown", ext: ".md", icon: <FileText className="h-3 w-3" />, accentBar: "bg-sky-400", pillColor: "bg-sky-500/15 text-sky-400" },
  json:     { label: "JSON",     ext: ".json", icon: <FileJson className="h-3 w-3" />, accentBar: "bg-purple-400", pillColor: "bg-purple-500/15 text-purple-400" },
  code:     { label: "Code",     ext: ".txt", icon: <Code2 className="h-3 w-3" />, accentBar: "bg-purple-400", pillColor: "bg-purple-500/15 text-purple-400" },
  patch:    { label: "Patch",    ext: ".patch", icon: <GitBranch className="h-3 w-3" />, accentBar: "bg-rose-400", pillColor: "bg-rose-500/15 text-rose-400" },
  csv:      { label: "CSV",      ext: ".csv", icon: <Sheet className="h-3 w-3" />, accentBar: "bg-emerald-400", pillColor: "bg-emerald-500/15 text-emerald-400" },
  text:     { label: "Text",     ext: ".txt", icon: <AlignLeft className="h-3 w-3" />, accentBar: "bg-amber-400", pillColor: "bg-amber-500/15 text-amber-400" },
  image:    { label: "Image",    ext: ".png", icon: <ImageIcon className="h-3 w-3" />, accentBar: "bg-pink-400", pillColor: "bg-pink-500/15 text-pink-400" },
};

const TEMPLATE_VARIABLES = [
  { name: "SUBJECT", description: "What is being analyzed" },
  { name: "AGENT", description: "Agent name/id" },
  { name: "DATE", description: "Current date" },
  { name: "TASK_TITLE", description: "Task title" },
  { name: "CHAIN_NAME", description: "Chain name" },
];

const CATEGORY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "all", label: "All" },
  { value: "markdown", label: "Markdown" },
  { value: "json", label: "JSON" },
  { value: "code", label: "Code" },
  { value: "patch", label: "Patch" },
  { value: "csv", label: "CSV" },
  { value: "text", label: "Text" },
  { value: "image", label: "Image" },
];

interface Props {
  templates: ArtifactTemplate[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  showMobileEditor: boolean;
  onCreate: (t: Omit<ArtifactTemplate, "updatedAt">) => Promise<void>;
  onUpdate: (id: string, patch: Partial<ArtifactTemplate>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export function ArtifactTemplateEditor({
  templates,
  selectedId,
  onSelect,
  showMobileEditor,
  onCreate,
  onUpdate,
  onDelete,
}: Props) {
  const [creating, setCreating] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string[]>([]);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window === "undefined") return 340;
    const stored = localStorage.getItem("artifacts-sidebar-width");
    return stored ? parseInt(stored, 10) : 340;
  });
  const [newId, setNewId] = useState("");
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<ArtifactType>("markdown");
  const [newDesc, setNewDesc] = useState("");
  const [localContent, setLocalContent] = useState<Record<string, string>>({});
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isResizing = useRef(false);

  useEffect(() => {
    localStorage.setItem("artifacts-sidebar-width", String(sidebarWidth));
  }, [sidebarWidth]);

  const handleMouseDown = (e: React.MouseEvent) => {
    isResizing.current = true;
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isResizing.current) return;
      const delta = moveEvent.clientX - startX;
      const next = Math.max(280, Math.min(600, startWidth + delta));
      setSidebarWidth(next);
    };

    const handleMouseUp = () => {
      isResizing.current = false;
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const selected = templates.find((t) => t.id === selectedId);

  const filtered = templates.filter((t) => {
    if (!matchesToggleFilter(categoryFilter, t.type)) return false;
    if (search) {
      const q = search.toLowerCase();
      return t.name.toLowerCase().includes(q) || t.id.toLowerCase().includes(q);
    }
    return true;
  });

  const getContent = (id: string) =>
    localContent[id] ?? templates.find((t) => t.id === id)?.content ?? "";

  const updateContent = (id: string, content: string) => {
    setLocalContent((prev) => ({ ...prev, [id]: content }));
    setDirty(true);
  };

  const insertVariable = (name: string) => {
    if (!selectedId) return;
    const el = textareaRef.current;
    const tag = `{{${name}}}`;
    const current = getContent(selectedId);
    if (el) {
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const next = current.slice(0, start) + tag + current.slice(end);
      updateContent(selectedId, next);
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = start + tag.length;
        el.focus();
      });
    } else {
      updateContent(selectedId, current + tag);
    }
  };

  const handleSave = async () => {
    if (!selectedId || !dirty) return;
    await onUpdate(selectedId, { content: getContent(selectedId) });
    setDirty(false);
  };

  const handleCreate = async () => {
    if (!newId || !newName) return;
    await onCreate({ id: newId, name: newName, type: newType, description: newDesc, content: "" });
    setCreating(false);
    setNewId("");
    setNewName("");
    setNewDesc("");
    setNewType("markdown");
  };

  const handleDelete = async (id: string) => {
    await onDelete(id);
  };

  return (
    <div className="h-full flex overflow-hidden">
      {/* sidebar */}
      <WorkflowSidebarPane
        className={cn(
          showMobileEditor ? "hidden md:flex" : "flex"
        )}
        style={{ width: sidebarWidth }}
      >
          <WorkflowSidebarFilters>
            <div className="flex items-center gap-1.5">
              <WorkflowSidebarSearchInput
                value={search}
                onChange={setSearch}
                placeholder="Search templates..."
              />
              <Button size="sm" variant="default" className="shrink-0" onClick={() => { setCreating(true); onSelect(""); }} title="New template">
                <Plus className="h-3 w-3" />
              </Button>
            </div>
            <WorkflowSidebarToggleFilter
              options={CATEGORY_OPTIONS}
              value={categoryFilter}
              onChange={setCategoryFilter}
            />
          </WorkflowSidebarFilters>

          <div className="flex-1 space-y-1 overflow-y-auto p-2">
            {filtered.map((t) => {
              const meta = TYPE_META[t.type];
              const contentLen = t.content?.length ?? 0;
              const sizeLabel = contentLen < 1000 ? `${contentLen} chars` : `${(contentLen / 1000).toFixed(1)}k chars`;
              return (
                <WorkflowSidebarItem
                  key={t.id}
                  selected={selectedId === t.id}
                  onClick={() => { onSelect(t.id); setCreating(false); setDirty(false); }}
                  accentClassName={meta?.accentBar}
                >
                  <div className="pl-4">
                    <div className="flex items-start justify-between gap-2">
                      <span className="line-clamp-1 text-sm font-semibold leading-5">{t.name}</span>
                      <span className="shrink-0 text-[10px] text-foreground/30">
                        {new Date(t.updatedAt).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="line-clamp-1 text-[11px] text-foreground/40 mt-0.5">{t.description}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-foreground/40">
                      <span className={`rounded-full px-2 py-0.5 uppercase tracking-[0.14em] ${meta?.pillColor ?? "bg-foreground/5"}`}>
                        {meta?.label}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-foreground/5 px-2 py-0.5">
                        {meta?.icon}
                        <span>{meta?.ext}</span>
                      </span>
                      {contentLen > 0 && (
                        <span className="rounded-full bg-foreground/5 px-2 py-0.5 font-mono">
                          {sizeLabel}
                        </span>
                      )}
                    </div>
                  </div>
                </WorkflowSidebarItem>
              );
            })}
            {filtered.length === 0 && !creating && (
              <div className="p-4 text-center text-xs text-muted-foreground">
                no templates found
              </div>
            )}
          </div>

          <WorkflowSidebarResizeHandle onMouseDown={handleMouseDown} />
        </WorkflowSidebarPane>

      {/* editor */}
      <div
        className={cn(
          "flex-1 overflow-y-auto",
          showMobileEditor ? "block" : "hidden md:block"
        )}
      >
        <div className="p-5">
          {creating ? (
            <div className="max-w-lg space-y-4">
              <p className="text-xs font-medium text-foreground/50 uppercase tracking-wider">
                new template
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">id (slug)</Label>
                  <Input
                    className="mt-1 text-xs font-mono h-8"
                    placeholder="technical-analysis"
                    value={newId}
                    onChange={(e) => setNewId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
                  />
                </div>
                <div>
                  <Label className="text-xs">name</Label>
                  <Input
                    className="mt-1 text-xs h-8"
                    placeholder="Technical Analysis"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">type</Label>
                  <Select value={newType} onValueChange={(v) => setNewType(v as ArtifactType)}>
                    <SelectTrigger className="mt-1 h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(TYPE_META) as ArtifactType[]).map((t) => (
                        <SelectItem key={t} value={t} className="text-xs">
                          {TYPE_META[t].label} ({TYPE_META[t].ext})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">description</Label>
                  <Input
                    className="mt-1 text-xs h-8"
                    placeholder="brief description"
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleCreate} disabled={!newId || !newName}>
                  create
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setCreating(false)}
                  className="text-foreground/50"
                >
                  cancel
                </Button>
              </div>
            </div>
          ) : selected ? (
            <div className="max-w-3xl space-y-4">
              {/* header */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{selected.name}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {TYPE_META[selected.type]?.label} · {selected.id}{TYPE_META[selected.type]?.ext} ·{" "}
                    updated {new Date(selected.updatedAt).toLocaleDateString()}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleDelete(selected.id)}
                  className="text-muted-foreground hover:text-foreground h-8"
                >
                  <Trash className="h-3.5 w-3.5" />
                </Button>
              </div>

              {/* variable chips */}
              <div className="bg-card rounded-md p-3">
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  template variables
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {TEMPLATE_VARIABLES.map((v) => (
                    <button
                      key={v.name}
                      onClick={() => insertVariable(v.name)}
                      className="text-[10px] px-2 py-1 rounded bg-muted hover:bg-accent text-muted-foreground hover:text-foreground transition-colors font-mono"
                      title={v.description}
                    >
                      {"{{" + v.name + "}}"}
                    </button>
                  ))}
                </div>
              </div>

              {/* content editor */}
              <div className="bg-card rounded-md p-4">
                <Label className="text-xs text-muted-foreground">template content</Label>
                <Textarea
                  ref={textareaRef}
                  className="mt-2 text-xs font-mono h-96 resize-y"
                  value={getContent(selected.id)}
                  onChange={(e) => updateContent(selected.id, e.target.value)}
                  placeholder="enter artifact template..."
                />
              </div>

              <div className="flex gap-2">
                <Button size="sm" onClick={handleSave} disabled={!dirty}>
                  save
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-40 text-xs text-muted-foreground">
              select a template or create one
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
