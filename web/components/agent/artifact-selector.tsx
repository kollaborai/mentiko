"use client";

import { useState, useRef, useEffect } from "react";
import {
  CloseCircleFilled as X,
  AddFilled as Plus,
  SearchNormalFilled as Search,
  ArrowDown2Filled as ChevronDown,
  DocumentTextFilled as FileText,
  DocumentCodeFilled as FileJson,
  Code1Filled as Code2,
  ArrowSwapFilled as GitBranch,
  Grid2Filled as Sheet,
  TextalignLeftFilled as AlignLeft,
  ImageFilled as Image,
} from "@aliimam/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ArtifactType } from "@/lib/system/artifact-template-storage";

const TYPE_META: Record<ArtifactType, { label: string; ext: string; icon: React.ReactNode; color: string }> = {
  markdown: { label: "Markdown", ext: ".md", icon: <FileText className="h-3 w-3" />, color: "text-blue-400" },
  json:     { label: "JSON",     ext: ".json", icon: <FileJson className="h-3 w-3" />, color: "text-green-400" },
  code:     { label: "Code",     ext: ".txt", icon: <Code2 className="h-3 w-3" />, color: "text-purple-400" },
  patch:    { label: "Patch",    ext: ".patch", icon: <GitBranch className="h-3 w-3" />, color: "text-orange-400" },
  csv:      { label: "CSV",      ext: ".csv", icon: <Sheet className="h-3 w-3" />, color: "text-cyan-400" },
  text:     { label: "Text",     ext: ".txt", icon: <AlignLeft className="h-3 w-3" />, color: "text-zinc-400" },
  // eslint-disable-next-line jsx-a11y/alt-text -- Image is an SVG icon component from lucide-react, not an img element
  image:    { label: "Image",    ext: ".png", icon: <Image className="h-3 w-3" />, color: "text-pink-400" },
};

export interface ArtifactTemplate {
  id: string;
  name: string;
  type: ArtifactType;
  description: string;
  content: string;
  updatedAt: string;
}

export interface SelectedArtifact {
  id: string;
  type: ArtifactType;
  description: string;
}

interface ArtifactCreateDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (artifact: {
    id: string;
    name: string;
    type: ArtifactType;
    description: string;
    content: string;
  }) => void;
  existingIds: string[];
}

// Inline create dialog extracted for use within selector
function ArtifactCreateInline({ open, onClose, onSave, existingIds }: ArtifactCreateDialogProps) {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<ArtifactType>("markdown");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");

  const idTaken = existingIds.includes(id);
  const canSave = id && name && !idTaken;

  const handleSave = () => {
    if (!canSave) return;
    onSave({ id, name, type, description, content });
    reset();
  };

  const reset = () => {
    setId("");
    setName("");
    setType("markdown");
    setDescription("");
    setContent("");
  };

  useEffect(() => {
    if (!open) reset();
  }, [open]);

  return (
    <div className="p-3 bg-card border-t border-border">
      <p className="text-[10px] font-medium text-foreground/40 uppercase tracking-wider mb-3">
        new artifact template
      </p>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-muted-foreground">id</label>
            <Input
              className="mt-1 text-[10px] font-mono h-7"
              placeholder="technical-analysis"
              value={id}
              onChange={(e) => setId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
            />
            {idTaken && (
              <p className="text-[9px] text-red-400 mt-0.5">id already exists</p>
            )}
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground">name</label>
            <Input
              className="mt-1 text-[10px] h-7"
              placeholder="Technical Analysis"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-muted-foreground">type</label>
            <select
              className="mt-1 w-full h-7 px-2 text-[10px] bg-muted rounded-sm border-0 focus:ring-1 focus:ring-foreground/20 outline-none"
              value={type}
              onChange={(e) => setType(e.target.value as ArtifactType)}
            >
              {(Object.keys(TYPE_META) as ArtifactType[]).map((t) => (
                <option key={t} value={t}>
                  {TYPE_META[t].label} ({TYPE_META[t].ext})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground">description</label>
            <Input
              className="mt-1 text-[10px] h-7"
              placeholder="what this artifact produces"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>

        <div>
          <label className="text-[10px] text-muted-foreground">content template</label>
          <textarea
            className="mt-1 w-full h-16 px-2 py-1 text-[10px] font-mono bg-muted rounded-sm border-0 focus:ring-1 focus:ring-foreground/20 outline-none resize-y"
            placeholder="# {{SUBJECT}}&#10;&#10;{{AGENT}} analysis..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
        </div>

        <div className="flex gap-2 pt-1">
          <Button size="sm" className="h-7 text-xs" onClick={handleSave} disabled={!canSave}>
            create
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onClose}>
            cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

interface Props {
  selected: SelectedArtifact[];
  onChange: (artifacts: SelectedArtifact[]) => void;
  artifactTemplates: ArtifactTemplate[];
  onCreateArtifact?: (artifact: {
    id: string;
    name: string;
    type: ArtifactType;
    description: string;
    content: string;
  }) => void;
}

export function ArtifactSelector({ selected, onChange, artifactTemplates, onCreateArtifact }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const selectedIds = new Set(selected.map((s) => s.id));
  const availableTemplates = artifactTemplates.filter((t) => !selectedIds.has(t.id));

  const filteredTemplates = search
    ? availableTemplates.filter(
        (t) =>
          t.name.toLowerCase().includes(search.toLowerCase()) ||
          t.id.toLowerCase().includes(search.toLowerCase()) ||
          t.type.toLowerCase().includes(search.toLowerCase())
      )
    : availableTemplates;

  const handleAdd = (template: ArtifactTemplate) => {
    onChange([...selected, { id: template.id, type: template.type, description: template.description }]);
    setSearch("");
  };

  const handleRemove = (id: string) => {
    onChange(selected.filter((s) => s.id !== id));
  };

  const handleCreate = (artifact: {
    id: string;
    name: string;
    type: ArtifactType;
    description: string;
    content: string;
  }) => {
    onCreateArtifact?.(artifact);
    setShowCreate(false);
    setSearch("");
  };

  // close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setShowCreate(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // focus search when opening
  useEffect(() => {
    if (open) {
      searchInputRef.current?.focus();
    }
  }, [open]);

  const existingIds = artifactTemplates.map((t) => t.id);

  return (
    <div ref={containerRef} className="relative">
      {/* selected chips */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {selected.map((s) => {
            const template = artifactTemplates.find((t) => t.id === s.id);
            const meta = TYPE_META[s.type];
            return (
              <div
                key={s.id}
                className="flex items-center gap-1.5 px-2 py-1 rounded-sm bg-card text-xs"
              >
                <span className={meta.color}>{meta.icon}</span>
                <span className="text-foreground/80">{template?.name || s.id}</span>
                <span className="text-[9px] px-1 rounded bg-muted text-muted-foreground">
                  {meta.label}
                </span>
                <button
                  type="button"
                  onClick={() => handleRemove(s.id)}
                  className="ml-0.5 text-foreground/30 hover:text-foreground/60"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* trigger button */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "w-full flex items-center justify-between px-3 py-2 text-left text-xs",
          "rounded-sm bg-muted hover:bg-accent transition-colors",
          "focus:outline-none focus:ring-1 focus:ring-foreground/20"
        )}
      >
        <span className="text-muted-foreground">
          {selected.length === 0
            ? "select artifacts..."
            : `${selected.length} artifact${selected.length > 1 ? "s" : ""} selected`}
        </span>
        <ChevronDown className={cn("h-3 w-3 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {/* dropdown */}
      {open && (
        <div className="absolute z-50 w-full mt-1 bg-card rounded-sm shadow-lg overflow-hidden">
          {/* search */}
          <div className="p-2 border-b border-border">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
              <Input
                ref={searchInputRef}
                placeholder="search artifacts..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-7 h-7 text-xs bg-muted"
              />
            </div>
          </div>

          {/* artifact list or create form */}
          {showCreate ? (
            <ArtifactCreateInline
              open={showCreate}
              onClose={() => setShowCreate(false)}
              onSave={handleCreate}
              existingIds={existingIds}
            />
          ) : (
            <div className="max-h-48 overflow-y-auto">
              {filteredTemplates.length === 0 ? (
                <div className="p-4 text-center text-xs text-muted-foreground">
                  {search ? "no artifacts found" : "all artifacts selected"}
                </div>
              ) : (
                filteredTemplates.map((t) => {
                  const meta = TYPE_META[t.type];
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => handleAdd(t)}
                      className="w-full px-3 py-2 text-left hover:bg-accent transition-colors border-b border-border last:border-0"
                    >
                      <div className="flex items-center gap-2">
                        <span className={meta.color}>{meta.icon}</span>
                        <span className="text-xs font-medium">{t.name}</span>
                        <span className="text-[9px] px-1 rounded bg-muted text-muted-foreground ml-auto">
                          {meta.label}
                        </span>
                      </div>
                      {t.description && (
                        <p className="text-[10px] text-muted-foreground mt-0.5 ml-5 truncate">
                          {t.description}
                        </p>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          )}

          {/* create button (only when not showing create form) */}
          {!showCreate && (
            <div className="p-2 border-t border-border">
              <Button
                size="sm"
                variant="ghost"
                className="w-full h-7 text-xs"
                onClick={() => setShowCreate(true)}
              >
                <Plus className="h-3 w-3 mr-1" />
                create new artifact
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
