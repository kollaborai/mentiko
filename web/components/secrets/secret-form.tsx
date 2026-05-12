"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { EyeFilled, EyeSlashFilled } from "@aliimam/icons";
import { COMMON_PRESETS, PROVIDER_CREDENTIALS } from "@/lib/provider-config";

export interface SecretFormProps {
  onSave: (data: { name: string; envVar: string; value: string; description?: string }) => Promise<void>;
  onCancel?: () => void;
  prefilledPreset?: string;
  inline?: boolean;
  editMode?: boolean;
  initialValues?: { name?: string; envVar?: string; description?: string };
  saving?: boolean;
  error?: string;
}

export function SecretForm({
  onSave,
  onCancel,
  prefilledPreset,
  editMode,
  initialValues,
  saving,
  error,
}: SecretFormProps) {
  const [formName, setFormName] = useState(initialValues?.name ?? "");
  const [formEnvVar, setFormEnvVar] = useState(initialValues?.envVar ?? "");
  const [formValue, setFormValue] = useState("");
  const [formDesc, setFormDesc] = useState(initialValues?.description ?? "");
  const [showValue, setShowValue] = useState(false);
  const [localError, setLocalError] = useState("");

  // reset form when initialValues change (edit vs create)
  useEffect(() => {
    setFormName(initialValues?.name ?? "");
    setFormEnvVar(initialValues?.envVar ?? "");
    setFormValue("");
    setFormDesc(initialValues?.description ?? "");
    setShowValue(false);
    setLocalError("");
  }, [initialValues?.name, initialValues?.envVar, initialValues?.description]);

  // auto-select preset on mount
  useEffect(() => {
    if (prefilledPreset) {
      applyPreset(prefilledPreset);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefilledPreset]);

  const applyPreset = (envVar: string) => {
    setFormEnvVar(envVar);
    const preset = COMMON_PRESETS.find((p) => p.envVar === envVar);
    const isPresetName = COMMON_PRESETS.some((p) => p.label === formName);
    if (preset && preset.label !== "Custom" && (!formName || isPresetName)) {
      setFormName(preset.label);
    }
  };

  const handleSubmit = async () => {
    if (!formName || !formEnvVar) {
      setLocalError("name and env var are required");
      return;
    }
    if (!editMode && !formValue) {
      setLocalError("value is required");
      return;
    }
    setLocalError("");
    await onSave({
      name: formName,
      envVar: formEnvVar,
      value: formValue,
      description: formDesc || undefined,
    });
  };

  const displayError = error || localError;
  const providerCredential = Object.values(PROVIDER_CREDENTIALS).find(
    (credential) => credential.envKey === formEnvVar,
  );
  const selectedPreset = COMMON_PRESETS.find((preset) => preset.envVar === formEnvVar);
  const labelPlaceholder =
    providerCredential?.label || selectedPreset?.label || "My API Key";
  const valuePlaceholder = editMode
    ? "Leave blank to keep existing value"
    : providerCredential?.placeholder || "api-key-...";
  const descriptionPlaceholder = providerCredential
    ? `Used for ${providerCredential.label.replace(/ API Key$/, "")} calls`
    : "Used for production API calls";

  return (
    <div className="space-y-3 py-2">
      {/* preset picker */}
      {!editMode && (
        <div className="space-y-1">
          <label className="text-xs text-foreground/50">Quick preset</label>
          <div className="flex flex-wrap gap-1.5">
            {COMMON_PRESETS.map((p) => (
              <button
                key={p.envVar || "custom"}
                onClick={() => applyPreset(p.envVar)}
                className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                  formEnvVar === p.envVar && p.envVar
                    ? "border-foreground/40 text-foreground/80 bg-accent"
                    : "border-foreground/15 text-foreground/40 hover:border-foreground/30"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-1">
        <label className="text-xs text-foreground/50">Label</label>
        <input
          type="text"
          placeholder={labelPlaceholder}
          value={formName}
          onChange={(e) => setFormName(e.target.value)}
          className="w-full bg-muted rounded px-3 py-1.5 text-sm focus:outline-none focus:bg-accent"
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs text-foreground/50">Env Var Name</label>
        <input
          type="text"
          placeholder="MY_API_KEY"
          value={formEnvVar}
          onChange={(e) => setFormEnvVar(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_"))}
          className="w-full bg-muted rounded px-3 py-1.5 text-sm font-mono focus:outline-none focus:bg-accent"
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs text-foreground/50">
          Value{editMode && <span className="text-foreground/30"> (blank = keep existing)</span>}
        </label>
        <div className="relative">
          <input
            type={showValue ? "text" : "password"}
            placeholder={valuePlaceholder}
            value={formValue}
            onChange={(e) => setFormValue(e.target.value)}
            className="w-full bg-muted rounded px-3 py-1.5 text-sm font-mono focus:outline-none focus:bg-accent pr-8"
          />
          <button
            type="button"
            onClick={() => setShowValue(!showValue)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-foreground/30 hover:text-foreground/60"
          >
            {showValue ? <EyeSlashFilled className="h-3 w-3" /> : <EyeFilled className="h-3 w-3" />}
          </button>
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-xs text-foreground/50">Description <span className="text-foreground/30">(optional)</span></label>
        <input
          type="text"
          placeholder={descriptionPlaceholder}
          value={formDesc}
          onChange={(e) => setFormDesc(e.target.value)}
          className="w-full bg-muted rounded px-3 py-1.5 text-sm focus:outline-none focus:bg-accent"
        />
      </div>

      {displayError && <p className="text-xs text-red-400">{displayError}</p>}

      <div className="flex justify-end gap-2 pt-1">
        {onCancel && (
          <Button size="sm" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={saving || !formName || !formEnvVar || (!editMode && !formValue)}
        >
          {saving ? "Saving..." : editMode ? "Update" : "Save Secret"}
        </Button>
      </div>
    </div>
  );
}
