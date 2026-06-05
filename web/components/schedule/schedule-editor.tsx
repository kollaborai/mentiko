"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ClockFilled as Clock, GlobalFilled as Globe, TickCircleFilled as Check, CloseCircleFilled as X } from "@aliimam/icons";
import { CRON_PRESETS, getTimezones, isValidCron, isValidTimezone, getCronDescription } from "@/lib/schedules/schedule-utils";

interface ScheduleEditorProps {
  chainName: string;
  initialCron?: string;
  initialTimezone?: string;
  onSave: (cron: string, timezone: string) => void;
  onCancel: () => void;
}

export function ScheduleEditor({
  chainName,
  initialCron = "0 * * * *",
  initialTimezone = "UTC",
  onSave,
  onCancel,
}: ScheduleEditorProps) {
  const [cron, setCron] = useState(initialCron);
  const [timezone, setTimezone] = useState(initialTimezone);
  const [customCron, setCustomCron] = useState(initialCron);
  const [showCustom, setShowCustom] = useState(!CRON_PRESETS.find(p => p.expression === initialCron));

  const validCron = isValidCron(cron);
  const validTimezone = isValidTimezone(timezone);
  const canSave = validCron && validTimezone;

  // include current timezone in list if valid but not in defaults
  const knownTzs = getTimezones();
  const tzList = knownTzs.includes(timezone) || !validTimezone
    ? knownTzs
    : [timezone, ...knownTzs];

  const handlePresetSelect = (expression: string) => {
    setCron(expression);
    setCustomCron(expression);
    setShowCustom(false);
  };

  const handleCustomChange = (value: string) => {
    setCustomCron(value);
    setCron(value);
  };

  const handleSave = () => {
    if (canSave) {
      onSave(cron, timezone);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-foreground/50" />
          <span className="text-sm font-medium">Schedule: {chainName}</span>
        </div>
        <div className="flex items-center gap-2">
          {validCron ? (
            <Check className="h-4 w-4 text-green-400" />
          ) : (
            <X className="h-4 w-4 text-red-400" />
          )}
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <Label className="text-xs text-foreground/50">Preset Schedules</Label>
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
            {CRON_PRESETS.slice(0, 8).map((preset) => (
              <button
                key={`${preset.label}-${preset.expression}`}
                onClick={() => handlePresetSelect(preset.expression)}
                className={`text-left px-3 py-2 rounded-md text-xs transition-colors ${
                  cron === preset.expression && !showCustom
                    ? "bg-blue-500/20 text-blue-400"
                    : "bg-muted hover:bg-accent"
                }`}
              >
                <div className="font-medium">{preset.label}</div>
                <div className="text-[10px] text-foreground/40">{preset.description}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="h-px bg-accent flex-1" />
          <span className="text-[10px] text-foreground/30">or</span>
          <div className="h-px bg-accent flex-1" />
        </div>

        <div>
          <Label className="text-xs text-foreground/50">Custom Cron Expression</Label>
          <Input
            value={customCron}
            onChange={(e) => {
              setShowCustom(true);
              handleCustomChange(e.target.value);
            }}
            placeholder="* * * * *"
            className={`mt-2 h-9 text-xs font-mono ${
              !validCron && customCron ? "bg-red-500/10" : ""
            }`}
          />
          <p className="mt-1 text-[10px] text-foreground/30">
            Format: minute hour day month weekday
          </p>
        </div>

        {cron && validCron && (
          <div className="bg-card rounded-md p-3">
            <div className="text-[10px] text-foreground/50 mb-1">Preview</div>
            <div className="text-xs">{getCronDescription(cron)}</div>
            <code className="text-[10px] text-foreground/40 font-mono">{cron}</code>
          </div>
        )}
      </div>

      <div>
        <Label className="flex items-center gap-2 text-xs text-foreground/50">
          <Globe className="h-3 w-3" />
          Timezone
        </Label>
        <Select value={timezone} onValueChange={setTimezone}>
          <SelectTrigger className="mt-2 h-9 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {tzList.map((tz) => (
              <SelectItem key={tz} value={tz} className="text-xs">
                {tz}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex gap-2 pt-2">
        <Button size="sm" variant="ghost" onClick={onCancel} className="flex-1 text-xs">
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={!canSave}
          className="flex-1 text-xs"
        >
          Save Schedule
        </Button>
      </div>
    </div>
  );
}
