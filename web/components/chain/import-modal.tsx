"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { copyToClipboard } from "@/lib/ui/copy-to-clipboard";
import {
  ChainImportPreview,
  ChainImportFormat,
  generateChainId,
} from "@/lib/chains/chain-export";
import {
  TickCircleFilled as CheckCircle2,
  CloseCircleFilled as XCircle,
  DangerFilled as AlertTriangle,
  PeopleFilled as Users,
  HierarchyFilled as GitBranch,
  DocumentTextFilled as FileText,
  CopyFilled as Copy,
  TickCircleFilled as Check,
  SettingsFilled as Settings,
} from "@aliimam/icons";
import { CLI_TOOLS } from "@/lib/agents/agent-provider-catalog";

// ─── Customization Modal ─────────────────────────────────────────────────────

export interface ChainCustomization {
  variables: Record<string, string>;
  agentProfile: string;
  executor: string;
}

interface CustomizationModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (customization: ChainCustomization) => void;
  variables: string[];  // placeholder names found in chain prompts
  chainName: string;
  importing?: boolean;
}

export function ChainCustomizationModal({
  open,
  onClose,
  onConfirm,
  variables,
  chainName,
  importing = false,
}: CustomizationModalProps) {
  const [varValues, setVarValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(variables.map((v) => [v, ""]))
  );
  const [agentProfile, setAgentProfile] = useState("");
  const [executor, setExecutor] = useState("");

  const handleConfirm = () => {
    onConfirm({
      variables: varValues,
      agentProfile,
      executor,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-foreground/50" />
            <DialogTitle>Customize Chain</DialogTitle>
          </div>
          <DialogDescription>
            Configure &ldquo;{chainName}&rdquo; before installing.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-2">
          {/* variable substitutions */}
          {variables.length > 0 && (
            <div className="bg-card rounded-md p-4 space-y-3">
              <h3 className="text-sm font-medium">Variables</h3>
              <p className="text-xs text-foreground/50">
                These placeholders were found in agent prompts. Fill in values to substitute them at install time. Leave blank to keep the placeholder.
              </p>
              {variables.map((varName) => (
                <div key={varName} className="space-y-1">
                  <label className="text-xs font-mono text-foreground/60">{`{${varName}}`}</label>
                  <input
                    type={varName.includes("SECRET") || varName.includes("KEY") || varName.includes("TOKEN") ? "password" : "text"}
                    placeholder={`value for ${varName}`}
                    value={varValues[varName] || ""}
                    onChange={(e) => setVarValues((prev) => ({ ...prev, [varName]: e.target.value }))}
                    className="w-full bg-muted rounded px-3 py-1.5 text-sm font-mono focus:outline-none focus:bg-card"
                  />
                </div>
              ))}
            </div>
          )}

          {/* executor selection */}
          <div className="bg-card rounded-md p-4 space-y-3">
            <h3 className="text-sm font-medium">Execution Settings</h3>
            <div className="space-y-1">
              <label className="text-xs text-foreground/50">AI Executor</label>
              <select
                value={executor}
                onChange={(e) => setExecutor(e.target.value)}
                className="w-full bg-muted rounded px-3 py-1.5 text-sm focus:outline-none focus:bg-card"
              >
                <option value="">Use chain default</option>
                {CLI_TOOLS
                  .filter((tool) => tool.id !== "opencode")
                  .map((tool) => (
                    <option key={tool.id} value={tool.id}>{tool.name}</option>
                  ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-foreground/50">Agent Profile</label>
              <input
                type="text"
                placeholder="profile ID (optional)"
                value={agentProfile}
                onChange={(e) => setAgentProfile(e.target.value)}
                className="w-full bg-muted rounded px-3 py-1.5 text-sm font-mono focus:outline-none focus:bg-card"
              />
              <p className="text-[10px] text-foreground/30">
                Sets the default_agent_profile for all agents in this chain.
              </p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={importing}>
            Cancel
          </Button>
          <Button variant="outline" onClick={handleConfirm} disabled={importing}>
            Skip &amp; Install
          </Button>
          <Button onClick={handleConfirm} disabled={importing}>
            {importing ? "Installing..." : "Install Chain"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ImportModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (chainId: string) => void;
  preview: ChainImportPreview;
  importing?: boolean;
}

export function ChainImportPreviewModal({
  open,
  onClose,
  onConfirm,
  preview,
  importing = false,
}: ImportModalProps) {
  const [copiedId, setCopiedId] = useState(false);
  const suggestedId = generateChainId(preview.chain.name);

  const handleCopyId = () => {
    copyToClipboard(suggestedId);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  const formatLabels: Record<ChainImportFormat, string> = {
    json: "JSON",
    yaml: "YAML",
    auto: "Auto-detected",
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle>Import Chain</DialogTitle>
            <Badge variant="secondary" className="text-xs">
              {formatLabels[preview.format]}
            </Badge>
            {preview.valid ? (
              <Badge variant="default" className="text-xs bg-green-500/20 text-green-400">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                Valid
              </Badge>
            ) : (
              <Badge variant="destructive" className="text-xs">
                <XCircle className="h-3 w-3 mr-1" />
                Invalid
              </Badge>
            )}
          </div>
          <DialogDescription>
            Review the chain before importing. {preview.valid ? "Ready to import." : "Fix errors below to proceed."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-2">
          {/* Chain Summary */}
          <div className="bg-card rounded-md p-4">
            <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Chain Summary
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-foreground/50">Name</span>
                <span className="font-medium">{preview.chain.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-foreground/50">Version</span>
                <span className="font-mono">{preview.chain.version}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-foreground/50">Description</span>
                <span className="text-right max-w-[60%] truncate">{preview.chain.description || "none"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-foreground/50">Suggested ID</span>
                <span className="font-mono text-xs flex items-center gap-1">
                  {suggestedId}
                  <button
                    onClick={handleCopyId}
                    className="p-0.5 hover:bg-muted/10 rounded"
                    title="Copy ID"
                  >
                    {copiedId ? (
                      <Check className="h-3 w-3 text-green-400" />
                    ) : (
                      <Copy className="h-3 w-3 text-foreground/50" />
                    )}
                  </button>
                </span>
              </div>
            </div>

            {/* Quick Stats */}
            <div className="grid grid-cols-3 gap-3 mt-4">
              <div className="bg-muted/5 rounded p-2 text-center">
                <Users className="h-4 w-4 mx-auto mb-1 text-foreground/50" />
                <div className="text-lg font-medium">{preview.agents}</div>
                <div className="text-[10px] text-foreground/50">Agents</div>
              </div>
              <div className="bg-muted/5 rounded p-2 text-center">
                <GitBranch className="h-4 w-4 mx-auto mb-1 text-foreground/50" />
                <div className="text-lg font-medium">{preview.hasBranches ? "Yes" : "No"}</div>
                <div className="text-[10px] text-foreground/50">Branches</div>
              </div>
              <div className="bg-muted/5 rounded p-2 text-center">
                <CheckCircle2 className={`h-4 w-4 mx-auto mb-1 ${preview.hasManualStart ? "text-green-400" : "text-red-400"}`} />
                <div className="text-lg font-medium">{preview.hasManualStart ? "Yes" : "No"}</div>
                <div className="text-[10px] text-foreground/50">Entry Point</div>
              </div>
            </div>
          </div>

          {/* Agents List */}
          <div className="bg-card rounded-md p-4">
            <h3 className="text-sm font-medium mb-3">Agents</h3>
            <div className="space-y-2">
              {preview.chain.agents?.map((agent, idx) => (
                <div key={agent.id || idx} className="bg-muted rounded p-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{agent.name}</span>
                    <span className="text-foreground/30 font-mono">({agent.id})</span>
                    {agent.triggers?.includes("manual-start") && (
                      <Badge variant="secondary" className="text-[10px] h-4">
                        Start
                      </Badge>
                    )}
                  </div>
                  <div className="text-foreground/50 mt-1">
                    emits: <span className="font-mono">{agent.emits}</span>
                    {agent.triggers && (
                      <> · triggers: <span className="font-mono">{agent.triggers.join(", ")}</span></>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Errors */}
          {preview.errors.length > 0 && (
            <div className="bg-red-500/10 rounded-md p-4">
              <h3 className="text-sm font-medium mb-3 flex items-center gap-2 text-red-400">
                <XCircle className="h-4 w-4" />
                Errors ({preview.errors.length})
              </h3>
              <div className="space-y-2">
                {preview.errors.map((err, idx) => (
                  <div key={idx} className="text-xs">
                    <div className="flex items-start gap-2">
                      <XCircle className="h-3 w-3 text-red-400 mt-0.5 shrink-0" />
                      <div className="flex-1">
                        <div className="font-mono text-red-300">{err.path}</div>
                        <div className="text-red-400/80">{err.message}</div>
                        {err.fixAction && (
                          <div className="mt-1 text-green-400/80">
                            fix: {err.fixAction}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Warnings */}
          {preview.warnings.length > 0 && (
            <div className="bg-yellow-500/10 rounded-md p-4">
              <h3 className="text-sm font-medium mb-3 flex items-center gap-2 text-yellow-400">
                <AlertTriangle className="h-4 w-4" />
                Warnings ({preview.warnings.length})
              </h3>
              <div className="space-y-2">
                {preview.warnings.map((warn, idx) => (
                  <div key={idx} className="text-xs">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="h-3 w-3 text-yellow-400 mt-0.5 shrink-0" />
                      <div className="flex-1">
                        <div className="font-mono text-yellow-300">{warn.path}</div>
                        <div className="text-yellow-400/80">{warn.message}</div>
                        {warn.fixAction && (
                          <div className="mt-1 text-green-400/80">
                            fix: {warn.fixAction}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={importing}>
            Cancel
          </Button>
          <Button
            variant="default"
            onClick={() => onConfirm(suggestedId)}
            disabled={!preview.valid || importing}
          >
            {importing ? "Importing..." : "Import Chain"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ImportInputModalProps {
  open: boolean;
  onClose: () => void;
  onPreview: (content: string, format: ChainImportFormat) => void;
  loading?: boolean;
  error?: string;
}

export function ChainImportInputModal({
  open,
  onClose,
  onPreview,
  loading = false,
  error = "",
}: ImportInputModalProps) {
  const [activeTab, setActiveTab] = useState<"url" | "json" | "yaml" | "clipboard">("url");
  const [urlInput, setUrlInput] = useState("");
  const [textInput, setTextInput] = useState("");
  const [clipboardError, setClipboardError] = useState("");

  const handleUrlSubmit = () => {
    if (urlInput) {
      onPreview(urlInput, "json");
    }
  };

  const handleTextSubmit = () => {
    if (textInput) {
      const format = textInput.trim().startsWith("{") ? "json" : "yaml";
      onPreview(textInput, format);
    }
  };

  const handleClipboardPaste = async () => {
    setClipboardError("");
    try {
      if (!navigator.clipboard || !navigator.clipboard.readText) {
        setClipboardError("Clipboard API not available in this browser");
        return;
      }
      const text = await navigator.clipboard.readText();
      if (!text) {
        setClipboardError("Clipboard is empty");
        return;
      }
      const format = text.trim().startsWith("{") ? "json" : "yaml";
      onPreview(text, format);
    } catch {
      setClipboardError("Could not access clipboard. Please paste manually.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Import Chain</DialogTitle>
          <DialogDescription>
            Import a chain from URL, paste JSON/YAML, or use clipboard.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          {/* Tabs */}
          <div className="flex gap-2 mb-4">
            {[
              { id: "url", label: "From URL" },
              { id: "json", label: "JSON" },
              { id: "yaml", label: "YAML" },
              { id: "clipboard", label: "Clipboard" },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as "url" | "json" | "yaml" | "clipboard")}
                className={`text-xs px-3 py-1.5 rounded transition-colors ${
                  activeTab === tab.id
                    ? "bg-foreground text-background"
                    : "bg-muted text-foreground/50 hover:bg-card"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          {activeTab === "url" && (
            <div className="space-y-3">
              <input
                type="text"
                placeholder="https://example.com/chain.json"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleUrlSubmit()}
                className="w-full bg-muted rounded-md px-3 py-2 text-sm focus:outline-none focus:bg-card"
              />
              <Button
                size="sm"
                onClick={handleUrlSubmit}
                disabled={loading || !urlInput}
                className="w-full"
              >
                {loading ? "Fetching..." : "Fetch & Preview"}
              </Button>
            </div>
          )}

          {activeTab === "json" && (
            <div className="space-y-3">
              <textarea
                placeholder='{"name": "My Chain", "agents": [...]}'
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                className="w-full h-48 bg-muted rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:bg-card resize-none"
              />
              <Button
                size="sm"
                onClick={handleTextSubmit}
                disabled={loading || !textInput}
                className="w-full"
              >
                {loading ? "Parsing..." : "Parse & Preview"}
              </Button>
            </div>
          )}

          {activeTab === "yaml" && (
            <div className="space-y-3">
              <textarea
                placeholder="name: My Chain\nagents:\n  - id: agent1\n    name: Agent One\n    ..."
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                className="w-full h-48 bg-muted rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:bg-card resize-none"
              />
              <Button
                size="sm"
                onClick={handleTextSubmit}
                disabled={loading || !textInput}
                className="w-full"
              >
                {loading ? "Parsing..." : "Parse & Preview"}
              </Button>
            </div>
          )}

          {activeTab === "clipboard" && (
            <div className="space-y-3 text-center py-4">
              <p className="text-sm text-foreground/50 mb-4">
                Click below to read from your clipboard. Make sure you have a JSON or YAML chain copied.
              </p>
              <Button
                size="lg"
                onClick={handleClipboardPaste}
                disabled={loading}
                className="w-full"
              >
                {loading ? "Reading..." : "Read from Clipboard"}
              </Button>
              {clipboardError && (
                <p className="text-xs text-red-400 mt-2">{clipboardError}</p>
              )}
            </div>
          )}

          {/* Error Display */}
          {error && (
            <div className="text-xs text-red-400 mt-2">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
