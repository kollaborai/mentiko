import { create } from "zustand";
import {
  appendAgentDraftText,
  repairAgentTextSpacing,
} from "../agents/agent-message-text";
import {
  getKollaborBarWidth,
  KOLLABOR_BAR_MAX_WIDTH_PX,
  KOLLABOR_BAR_MIN_WIDTH_PX,
} from "../ai-engine/kollabor-bar-flag";

export type DraftTool = {
  callId: string;
  name: string;
  args: unknown;
  status: "running" | "done" | "error";
  output?: string;
  error?: string;
  riskLevel?: string;
};

export interface KollaborPermission {
  toolId: string;
  toolName: string;
  /** engine tool category (e.g. "terminal"); fallback when toolName is "unknown"/empty */
  toolType?: string;
  input: unknown;
  riskLevel: string;
  riskReason: string;
  decision?: "approve" | "approve_always" | "deny" | "cancelled";
  cancelled?: boolean;
}

/** First-run choice: ask-every-time vs YOLO (auto-approve). Missing prefs default to YOLO. */
export interface KollaborModeChoice {
  result?: "permission" | "yolo";
}

export interface KollaborAskRequest {
  toolId: string;
  kind: "ask_confirm" | "ask_input" | "ask_choice";
  prompt: string;
  options?: unknown[];
  placeholder?: string;
}

export interface KollaborMessage {
  id: string;
  role: "user" | "assistant" | "system" | "permission";
  content: string;
  timestamp: number;
  pending?: boolean;
  // optional structured fields added for engine integration.
  // old serialized messages won't have these; callers must treat as optional.
  tools?: DraftTool[];
  thinking?: boolean;
  permission?: KollaborPermission;
  ask?: KollaborAskRequest & { result?: unknown };
  modeChoice?: KollaborModeChoice;
}

export type KollaborBarDockEdge = "bottom" | "left" | "right";

export interface KollaborBarDock {
  edge: KollaborBarDockEdge;
  // bottom: reserved for future horizontal percent anchors.
  // left/right: vertical percent from the top of the viewport.
  offset: number;
}

export interface KollaborDrafting {
  text: string;
  tools: DraftTool[];
  thinking: boolean;
}

export interface KollaborBarAppearance {
  backdropEnabled: boolean;
  backdropBlur: number;
  backdropDim: number;
  backdropWidth: number;
  backdropHeight: number;
  backdropSoftness: number;
  transcriptMaxHeight: number;
  surfaceRadius: number;
  surfaceShadow: number;
}

export type KollaborBarAppearancePresetId = "minimal" | "balanced" | "focused";

export interface KollaborBarAppearancePreset {
  id: KollaborBarAppearancePresetId;
  label: string;
  description: string;
  values: KollaborBarAppearance;
}

interface KollaborBarState {
  enabled: boolean;
  storageScope: string;
  storageScopeReady: boolean;
  preferenceReadResolved: boolean;
  preferenceStorageError: string | null;
  shutdownPending: boolean;
  cleanupBlocked: boolean;
  shutdownError: string | null;
  generation: number;
  expanded: boolean;
  inputValue: string;
  agent: string;
  connected: boolean;
  connecting: boolean;
  error: string | null;
  messages: KollaborMessage[];
  // offset from bottom-center anchor, in px. positive y = moved UP toward top of screen.
  offsetX: number;
  offsetY: number;
  dock: KollaborBarDock;
  // user-controlled size multiplier, default 1.0, clamped [0.6, 1.6]
  scale: number;
  // message/input text multiplier, default 1.0, clamped [0.8, 1.35]
  fontScale: number;
  // user-controlled wide-screen bar width, seeded by deployment config and
  // scoped to the active identity/install.
  barWidth: number;
  appearance: KollaborBarAppearance;

  // engine session + streaming state
  sessionId: string | null;
  sessionScope: string | null;
  drafting: KollaborDrafting | null;
  engineReady: boolean;
  engineError: string | null;

  // YOLO mode: when true the agent runs tools without asking for approval.
  // yoloPromptSeen tracks whether the first-run mode choice has been resolved.
  yoloMode: boolean;
  yoloPromptSeen: boolean;
  yoloPreferenceWriteFailed: boolean;

  setExpanded: (v: boolean) => void;
  setEnabled: (v: boolean) => void;
  setStorageScopeReady: (v: boolean) => void;
  setPreferenceStorageError: (v: string | null) => void;
  setShutdownState: (state: {
    pending?: boolean;
    blocked?: boolean;
    error?: string | null;
  }) => void;
  invalidateGeneration: () => number;
  cancelPendingPrompts: () => void;
  setInputValue: (v: string) => void;
  setAgent: (v: string) => void;
  setConnected: (v: boolean) => void;
  setConnecting: (v: boolean) => void;
  setError: (v: string | null) => void;
  pushMessage: (m: KollaborMessage) => void;
  clearMessages: () => void;
  setOffset: (x: number, y: number) => void;
  setDock: (dock: KollaborBarDock) => void;
  setScale: (s: number) => void;
  setFontScale: (s: number) => void;
  setBarWidth: (width: number) => void;
  setAppearance: (patch: Partial<KollaborBarAppearance>) => void;

  // engine session setters
  setSessionId: (v: string | null) => void;
  setEngineReady: (v: boolean) => void;
  setEngineError: (v: string | null) => void;

  // YOLO mode setters
  setYoloMode: (v: boolean) => boolean;
  setYoloPromptSeen: (v: boolean) => boolean;
  resolveModeChoice: (messageId: string, choice: "permission" | "yolo") => boolean;

  // drafting lifecycle
  startDraft: () => void;
  appendDraftText: (t: string) => void;
  setDraftThinking: (v: boolean) => void;
  addDraftTool: (t: DraftTool) => void;
  updateDraftTool: (callId: string, patch: Partial<DraftTool>) => void;
  /**
   * Update a tool by callId wherever it lives — the active draft OR an
   * already-committed message. Needed because permission gating calls
   * finishDraft() between tool_start and tool_result, so the running chip is
   * committed before its result arrives.
   */
  updateToolByCallId: (callId: string, patch: Partial<DraftTool>) => void;
  finishDraft: () => void;

  // permission prompt lifecycle
  pushPermissionRequest: (req: KollaborPermission) => void;
  resolvePermission: (
    messageId: string,
    decision: "approve" | "approve_always" | "deny",
  ) => void;

  // ask prompt lifecycle
  pushAskRequest: (req: KollaborAskRequest) => void;
  resolveAsk: (messageId: string, result: unknown) => void;
}

const LS_KEY = "mentiko-kollabor-transcript";
const LS_OFFSET_KEY = "mentiko-kollabor-offset";
const LS_DOCK_KEY = "mentiko-kollabor-dock";
const LS_SCALE_KEY = "mentiko-kollabor-scale";
const LS_FONT_SCALE_KEY = "mentiko-kollabor-font-scale";
export const LS_WIDTH_KEY = "mentiko-kollabor-width";
export const LS_APPEARANCE_KEY = "mentiko-kollabor-appearance";
const LS_SESSION_KEY = "mentiko-kollabor-session-id";
export const LS_ENABLED_KEY = "mentiko-kollabor-enabled";
export const LS_YOLO_KEY = "mentiko-kollabor-yolo";
export const LS_YOLO_SEEN_KEY = "mentiko-kollabor-yolo-seen";
export const LS_PENDING_SHUTDOWN_KEY = "mentiko-kollabor-pending-shutdown";
const DEFAULT_STORAGE_SCOPE = "anonymous";
let kollaborBarStorageScope = DEFAULT_STORAGE_SCOPE;

export const BAR_SAVE_ERROR =
  "Changed for this tab, but could not save. Reloading may restore your previous setting.";
export const BAR_SCOPE_ERROR = "Could not load your bar settings";
export const BAR_SHUTDOWN_ERROR = "Bar hidden. Could not confirm the active turn stopped.";
export const BAR_WAITING_FOR_SHUTDOWN = "Waiting for the previous turn to stop";

export const SCALE_MIN = 0.6;
export const SCALE_MAX = 1.6;
export const KOLLABOR_BAR_DEFAULT_DOCK: KollaborBarDock = { edge: "bottom", offset: 50 };
export const KOLLABOR_BAR_SIDE_DOCK_REACH_PX = 280;
export const KOLLABOR_BAR_DOCK_OFFSET_MIN = 10;
export const KOLLABOR_BAR_DOCK_OFFSET_MAX = 90;
export const FONT_SCALE_DEFAULT = 1;
export const FONT_SCALE_MIN = 0.8;
export const FONT_SCALE_MAX = 1.35;

export const KOLLABOR_BAR_APPEARANCE_DEFAULTS: KollaborBarAppearance = {
  backdropEnabled: true,
  backdropBlur: 20,
  backdropDim: 22,
  backdropWidth: 540,
  backdropHeight: 900,
  backdropSoftness: 90,
  transcriptMaxHeight: 78,
  surfaceRadius: 16,
  surfaceShadow: 18,
};
export const KOLLABOR_BAR_BACKDROP_BLUR_MIN = 0;
export const KOLLABOR_BAR_BACKDROP_BLUR_MAX = 40;
export const KOLLABOR_BAR_BACKDROP_DIM_MIN = 0;
export const KOLLABOR_BAR_BACKDROP_DIM_MAX = 45;
export const KOLLABOR_BAR_BACKDROP_WIDTH_MIN = 240;
export const KOLLABOR_BAR_BACKDROP_WIDTH_MAX = 900;
export const KOLLABOR_BAR_BACKDROP_HEIGHT_MIN = 360;
export const KOLLABOR_BAR_BACKDROP_HEIGHT_MAX = 1200;
export const KOLLABOR_BAR_BACKDROP_SOFTNESS_MIN = 50;
export const KOLLABOR_BAR_BACKDROP_SOFTNESS_MAX = 100;
export const KOLLABOR_BAR_TRANSCRIPT_HEIGHT_MIN = 35;
export const KOLLABOR_BAR_TRANSCRIPT_HEIGHT_MAX = 90;
export const KOLLABOR_BAR_SURFACE_RADIUS_MIN = 0;
export const KOLLABOR_BAR_SURFACE_RADIUS_MAX = 32;
export const KOLLABOR_BAR_SURFACE_SHADOW_MIN = 0;
export const KOLLABOR_BAR_SURFACE_SHADOW_MAX = 36;

export const KOLLABOR_BAR_APPEARANCE_PRESETS: readonly KollaborBarAppearancePreset[] = [
  {
    id: "minimal",
    label: "Minimal",
    description: "Clear page, light surface",
    values: {
      backdropEnabled: false,
      backdropBlur: 0,
      backdropDim: 0,
      backdropWidth: 360,
      backdropHeight: 600,
      backdropSoftness: 100,
      transcriptMaxHeight: 60,
      surfaceRadius: 10,
      surfaceShadow: 0,
    },
  },
  {
    id: "balanced",
    label: "Balanced",
    description: "Current default look",
    values: { ...KOLLABOR_BAR_APPEARANCE_DEFAULTS },
  },
  {
    id: "focused",
    label: "Focused",
    description: "Stronger backdrop, more room",
    values: {
      backdropEnabled: true,
      backdropBlur: 30,
      backdropDim: 34,
      backdropWidth: 700,
      backdropHeight: 1100,
      backdropSoftness: 70,
      transcriptMaxHeight: 82,
      surfaceRadius: 20,
      surfaceShadow: 28,
    },
  },
];

export { KOLLABOR_BAR_MAX_WIDTH_PX, KOLLABOR_BAR_MIN_WIDTH_PX };

function normalizeStorageScope(scope?: string | null): string {
  const value = typeof scope === "string" ? scope.trim() : "";
  return value || DEFAULT_STORAGE_SCOPE;
}

function scopedStorageKey(baseKey: string): string {
  return `${baseKey}:${kollaborBarStorageScope}`;
}

function scopedStorageKeyFor(baseKey: string, scope: string): string {
  return `${baseKey}:${normalizeStorageScope(scope)}`;
}

export interface BooleanPreferenceRead {
  value: boolean;
  resolved: boolean;
  error: string | null;
}

export interface PendingShutdownMarker {
  scope: string;
  sessionId: string;
  generation: number;
  startedAt: number;
}

function readStorageValue(key: string): { value: string | null; error: string | null } {
  if (typeof window === "undefined") return { value: null, error: null };
  try {
    return { value: window.localStorage.getItem(key), error: null };
  } catch {
    return { value: null, error: "storage-read-failed" };
  }
}

export function readEnabledPreference(scope = kollaborBarStorageScope): BooleanPreferenceRead {
  const { value: raw, error } = readStorageValue(scopedStorageKeyFor(LS_ENABLED_KEY, scope));
  if (error) {
    return { value: false, resolved: false, error: "Could not read your bar setting" };
  }
  if (raw === null) return { value: true, resolved: true, error: null };
  if (raw === "1") return { value: true, resolved: true, error: null };
  if (raw === "0") return { value: false, resolved: true, error: null };
  return { value: false, resolved: false, error: "Could not read your bar setting" };
}

export function writeEnabledPreference(
  value: boolean,
  scope = kollaborBarStorageScope,
): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(scopedStorageKeyFor(LS_ENABLED_KEY, scope), value ? "1" : "0");
    return true;
  } catch {
    return false;
  }
}

export function readPendingShutdownMarker(
  scope = kollaborBarStorageScope,
): PendingShutdownMarker | null {
  const { value: raw, error } = readStorageValue(scopedStorageKeyFor(LS_PENDING_SHUTDOWN_KEY, scope));
  if (error) {
    return {
      scope: normalizeStorageScope(scope),
      sessionId: "unknown",
      generation: 0,
      startedAt: 0,
    };
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PendingShutdownMarker>;
    if (
      parsed.scope === normalizeStorageScope(scope) &&
      typeof parsed.sessionId === "string" &&
      parsed.sessionId.length > 0 &&
      typeof parsed.generation === "number" &&
      typeof parsed.startedAt === "number"
    ) {
      return parsed as PendingShutdownMarker;
    }
  } catch {
    // Treat malformed markers as an unresolved shutdown. The next load must
    // fail closed instead of silently reusing a session.
  }
  return {
    scope: normalizeStorageScope(scope),
    sessionId: "unknown",
    generation: 0,
    startedAt: 0,
  };
}

export function writePendingShutdownMarker(marker: PendingShutdownMarker): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(
      scopedStorageKeyFor(LS_PENDING_SHUTDOWN_KEY, marker.scope),
      JSON.stringify(marker),
    );
    return true;
  } catch {
    return false;
  }
}

export function clearPendingShutdownMarker(scope = kollaborBarStorageScope): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.removeItem(scopedStorageKeyFor(LS_PENDING_SHUTDOWN_KEY, scope));
    return true;
  } catch {
    return false;
  }
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizeKollaborBarWidth(
  value: unknown,
  fallback = getKollaborBarWidth(),
): number {
  const numeric = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim() !== ""
      ? Number(value)
      : Number.NaN;
  if (!Number.isInteger(numeric)) return fallback;
  return clampNumber(numeric, KOLLABOR_BAR_MIN_WIDTH_PX, KOLLABOR_BAR_MAX_WIDTH_PX);
}

function numericAppearanceValue(
  raw: Record<string, unknown>,
  key: keyof KollaborBarAppearance,
  min: number,
  max: number,
  fallback: number,
): number {
  const value = raw[key];
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return clampNumber(Math.round(value), min, max);
}

export function normalizeKollaborBarAppearance(
  value: unknown,
  fallback: KollaborBarAppearance = KOLLABOR_BAR_APPEARANCE_DEFAULTS,
): KollaborBarAppearance {
  if (!value || typeof value !== "object") return { ...fallback };
  const raw = value as Record<string, unknown>;
  return {
    backdropEnabled: typeof raw.backdropEnabled === "boolean"
      ? raw.backdropEnabled
      : fallback.backdropEnabled,
    backdropBlur: numericAppearanceValue(raw, "backdropBlur", KOLLABOR_BAR_BACKDROP_BLUR_MIN, KOLLABOR_BAR_BACKDROP_BLUR_MAX, fallback.backdropBlur),
    backdropDim: numericAppearanceValue(raw, "backdropDim", KOLLABOR_BAR_BACKDROP_DIM_MIN, KOLLABOR_BAR_BACKDROP_DIM_MAX, fallback.backdropDim),
    backdropWidth: numericAppearanceValue(raw, "backdropWidth", KOLLABOR_BAR_BACKDROP_WIDTH_MIN, KOLLABOR_BAR_BACKDROP_WIDTH_MAX, fallback.backdropWidth),
    backdropHeight: numericAppearanceValue(raw, "backdropHeight", KOLLABOR_BAR_BACKDROP_HEIGHT_MIN, KOLLABOR_BAR_BACKDROP_HEIGHT_MAX, fallback.backdropHeight),
    backdropSoftness: numericAppearanceValue(raw, "backdropSoftness", KOLLABOR_BAR_BACKDROP_SOFTNESS_MIN, KOLLABOR_BAR_BACKDROP_SOFTNESS_MAX, fallback.backdropSoftness),
    transcriptMaxHeight: numericAppearanceValue(raw, "transcriptMaxHeight", KOLLABOR_BAR_TRANSCRIPT_HEIGHT_MIN, KOLLABOR_BAR_TRANSCRIPT_HEIGHT_MAX, fallback.transcriptMaxHeight),
    surfaceRadius: numericAppearanceValue(raw, "surfaceRadius", KOLLABOR_BAR_SURFACE_RADIUS_MIN, KOLLABOR_BAR_SURFACE_RADIUS_MAX, fallback.surfaceRadius),
    surfaceShadow: numericAppearanceValue(raw, "surfaceShadow", KOLLABOR_BAR_SURFACE_SHADOW_MIN, KOLLABOR_BAR_SURFACE_SHADOW_MAX, fallback.surfaceShadow),
  };
}

export function normalizeKollaborBarDock(value: unknown): KollaborBarDock {
  if (!value || typeof value !== "object") return KOLLABOR_BAR_DEFAULT_DOCK;
  const raw = value as { edge?: unknown; offset?: unknown };
  if (raw.edge !== "bottom" && raw.edge !== "left" && raw.edge !== "right") {
    return KOLLABOR_BAR_DEFAULT_DOCK;
  }
  if (raw.edge === "bottom") return KOLLABOR_BAR_DEFAULT_DOCK;
  const offset = typeof raw.offset === "number" && Number.isFinite(raw.offset)
    ? raw.offset
    : KOLLABOR_BAR_DEFAULT_DOCK.offset;
  return {
    edge: raw.edge,
    offset: clampNumber(offset, KOLLABOR_BAR_DOCK_OFFSET_MIN, KOLLABOR_BAR_DOCK_OFFSET_MAX),
  };
}

export function getKollaborBarDockForPoint(
  x: number,
  y: number,
  viewportWidth: number,
  viewportHeight: number,
): KollaborBarDock {
  if (viewportWidth <= 0 || viewportHeight <= 0) return KOLLABOR_BAR_DEFAULT_DOCK;
  const reach = Math.min(
    KOLLABOR_BAR_SIDE_DOCK_REACH_PX,
    Math.max(200, viewportWidth * 0.2),
  );
  const offset = clampNumber(
    (y / viewportHeight) * 100,
    KOLLABOR_BAR_DOCK_OFFSET_MIN,
    KOLLABOR_BAR_DOCK_OFFSET_MAX,
  );
  if (x <= reach) return { edge: "left", offset };
  if (x >= viewportWidth - reach) return { edge: "right", offset };
  return KOLLABOR_BAR_DEFAULT_DOCK;
}

function loadScale(): number {
  if (typeof window === "undefined") return 1;
  try {
    const raw = localStorage.getItem(LS_SCALE_KEY);
    if (!raw) return 1;
    const n = parseFloat(raw);
    if (Number.isNaN(n)) return 1;
    return Math.min(SCALE_MAX, Math.max(SCALE_MIN, n));
  } catch {
    return 1;
  }
}

function saveScale(s: number) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LS_SCALE_KEY, String(s));
  } catch {
    // ignore
  }
}

function loadFontScale(): number {
  if (typeof window === "undefined") return FONT_SCALE_DEFAULT;
  try {
    const raw = localStorage.getItem(LS_FONT_SCALE_KEY);
    if (!raw) return FONT_SCALE_DEFAULT;
    const n = parseFloat(raw);
    if (Number.isNaN(n)) return FONT_SCALE_DEFAULT;
    return Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, n));
  } catch {
    return FONT_SCALE_DEFAULT;
  }
}

function saveFontScale(s: number) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LS_FONT_SCALE_KEY, String(s));
  } catch {
    // ignore
  }
}

function loadBarWidth(scope = kollaborBarStorageScope): number {
  const fallback = getKollaborBarWidth();
  const { value: raw } = readStorageValue(scopedStorageKeyFor(LS_WIDTH_KEY, scope));
  return normalizeKollaborBarWidth(raw, fallback);
}

function saveBarWidth(width: number, scope = kollaborBarStorageScope): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(
      scopedStorageKeyFor(LS_WIDTH_KEY, scope),
      String(normalizeKollaborBarWidth(width)),
    );
    return true;
  } catch {
    return false;
  }
}

function loadAppearance(scope = kollaborBarStorageScope): KollaborBarAppearance {
  const fallback = KOLLABOR_BAR_APPEARANCE_DEFAULTS;
  const { value: raw } = readStorageValue(scopedStorageKeyFor(LS_APPEARANCE_KEY, scope));
  if (!raw) return { ...fallback };
  try {
    return normalizeKollaborBarAppearance(JSON.parse(raw), fallback);
  } catch {
    return { ...fallback };
  }
}

function saveAppearance(
  appearance: KollaborBarAppearance,
  scope = kollaborBarStorageScope,
): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(
      scopedStorageKeyFor(LS_APPEARANCE_KEY, scope),
      JSON.stringify(normalizeKollaborBarAppearance(appearance)),
    );
    return true;
  } catch {
    return false;
  }
}

function loadOffset(): { x: number; y: number } {
  if (typeof window === "undefined") return { x: 0, y: 0 };
  try {
    const raw = localStorage.getItem(LS_OFFSET_KEY);
    if (!raw) return { x: 0, y: 0 };
    const parsed = JSON.parse(raw);
    return {
      x: typeof parsed?.x === "number" ? parsed.x : 0,
      y: typeof parsed?.y === "number" ? parsed.y : 0,
    };
  } catch {
    return { x: 0, y: 0 };
  }
}

function loadDock(): KollaborBarDock {
  if (typeof window === "undefined") return KOLLABOR_BAR_DEFAULT_DOCK;
  try {
    const raw = localStorage.getItem(LS_DOCK_KEY);
    if (!raw) return KOLLABOR_BAR_DEFAULT_DOCK;
    return normalizeKollaborBarDock(JSON.parse(raw));
  } catch {
    return KOLLABOR_BAR_DEFAULT_DOCK;
  }
}

function saveDock(dock: KollaborBarDock) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LS_DOCK_KEY, JSON.stringify(normalizeKollaborBarDock(dock)));
  } catch {
    // ignore
  }
}

function saveOffset(x: number, y: number) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LS_OFFSET_KEY, JSON.stringify({ x, y }));
  } catch {
    // ignore
  }
}

function loadTranscript(): KollaborMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(scopedStorageKey(LS_KEY));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // normalize older messages that lack the new optional fields.
    // missing tools/thinking/permission is fine — they stay undefined.
    // we only defensively coerce the role to a known value.
    const normalized: KollaborMessage[] = parsed
      .filter(
        (m): m is KollaborMessage =>
          m &&
          typeof m === "object" &&
          typeof m.id === "string" &&
          typeof m.content === "string" &&
          typeof m.timestamp === "number" &&
          (m.role === "user" ||
            m.role === "assistant" ||
            m.role === "system" ||
            m.role === "permission"),
      )
      .map((m) => ({
        ...m,
        content: m.role === "assistant" ? repairAgentTextSpacing(m.content) : m.content,
      }))
      .slice(-50);
    return normalized;
  } catch {
    return [];
  }
}

function saveTranscript(messages: KollaborMessage[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(scopedStorageKey(LS_KEY), JSON.stringify(messages.slice(-50)));
  } catch {
    // quota or disabled; ignore
  }
}

function loadSessionId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(scopedStorageKey(LS_SESSION_KEY));
    return raw && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

function saveSessionId(v: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (v === null || v === "") {
      localStorage.removeItem(scopedStorageKey(LS_SESSION_KEY));
    } else {
      localStorage.setItem(scopedStorageKey(LS_SESSION_KEY), v);
    }
  } catch {
    // ignore
  }
}

function loadBool(key: string, defaultValue = true, scope = kollaborBarStorageScope): boolean {
  if (typeof window === "undefined") return defaultValue;
  try {
    const scopedKey = scopedStorageKeyFor(key, scope);
    const scoped = window.localStorage.getItem(scopedKey);
    if (scoped !== null) return scoped === "1";

    // YOLO migration is intentionally anonymous-only. Authenticated scopes
    // must never inherit an origin-wide value from another identity.
    if (key === LS_YOLO_KEY || key === LS_YOLO_SEEN_KEY) {
      const normalizedScope = normalizeStorageScope(scope);
      if (normalizedScope.startsWith("anonymous:")) {
        const legacy = window.localStorage.getItem(key);
        if (legacy !== null && legacy !== "0" && legacy !== "1") return false;
        if (legacy === "0" || legacy === "1") {
          try {
            window.localStorage.setItem(scopedKey, legacy);
          } catch {
            // A failed migration leaves the raw value untouched and the
            // current tab still receives the migrated behavior.
          }
          return legacy === "1";
        }
      }
    }
    return defaultValue;
  } catch {
    // An unreadable preference is not the same as a missing one. In
    // particular, never enable auto-approval when storage cannot be read.
    return false;
  }
}

function saveBool(key: string, v: boolean, scope = kollaborBarStorageScope): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(scopedStorageKeyFor(key, scope), v ? "1" : "0");
    return true;
  } catch {
    return false;
  }
}

function newMessageId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function setKollaborBarStorageScope(scope?: string | null): void {
  const nextScope = normalizeStorageScope(scope);
  if (nextScope === kollaborBarStorageScope) return;
  kollaborBarStorageScope = nextScope;
  const preference = readEnabledPreference(nextScope);
  const current = useKollaborBarStore.getState();
  useKollaborBarStore.setState({
    storageScope: nextScope,
    storageScopeReady: false,
    enabled: preference.value,
    preferenceReadResolved: preference.resolved,
    preferenceStorageError: preference.error,
    barWidth: loadBarWidth(nextScope),
    appearance: loadAppearance(nextScope),
    shutdownPending: false,
    cleanupBlocked: false,
    shutdownError: null,
    generation: current.generation + 1,
    expanded: false,
    inputValue: "",
    connected: false,
    connecting: false,
    error: null,
    engineReady: false,
    engineError: null,
    messages: loadTranscript(),
    sessionId: loadSessionId(),
    sessionScope: nextScope,
    drafting: null,
    yoloMode: loadBool(LS_YOLO_KEY, true, nextScope),
    yoloPromptSeen: loadBool(LS_YOLO_SEEN_KEY, true, nextScope),
    yoloPreferenceWriteFailed: false,
  });
}

export function getKollaborBarStorageScope(): string {
  return kollaborBarStorageScope;
}

export const useKollaborBarStore = create<KollaborBarState>((set, get) => {
  const initialOffset = loadOffset();
  return {
    enabled: true,
    storageScope: DEFAULT_STORAGE_SCOPE,
    storageScopeReady: false,
    preferenceReadResolved: false,
    preferenceStorageError: null,
    shutdownPending: false,
    cleanupBlocked: false,
    shutdownError: null,
    generation: 0,
    expanded: false,
    inputValue: "",
    agent: "mentiko",
    connected: false,
    connecting: false,
    error: null,
    messages: loadTranscript(),
    offsetX: initialOffset.x,
    offsetY: initialOffset.y,
    dock: loadDock(),
    scale: loadScale(),
    fontScale: loadFontScale(),
    barWidth: getKollaborBarWidth(),
    appearance: { ...KOLLABOR_BAR_APPEARANCE_DEFAULTS },

    sessionId: loadSessionId(),
    sessionScope: DEFAULT_STORAGE_SCOPE,
    drafting: null,
    engineReady: false,
    engineError: null,

    yoloMode: loadBool(LS_YOLO_KEY),
    yoloPromptSeen: loadBool(LS_YOLO_SEEN_KEY),
    yoloPreferenceWriteFailed: false,

    setExpanded: (v) => set({ expanded: v }),
    setEnabled: (v) => {
      const state = get();
      if (!state.storageScopeReady) return;
      const saved = writeEnabledPreference(v, state.storageScope);
      set({
        enabled: v,
        preferenceReadResolved: true,
        preferenceStorageError: saved ? null : BAR_SAVE_ERROR,
      });
    },
    setStorageScopeReady: (v) => set({ storageScopeReady: v }),
    setPreferenceStorageError: (v) => set({ preferenceStorageError: v }),
    setShutdownState: (state) => set({
      ...(state.pending === undefined ? {} : { shutdownPending: state.pending }),
      ...(state.blocked === undefined ? {} : { cleanupBlocked: state.blocked }),
      ...(state.error === undefined ? {} : { shutdownError: state.error }),
    }),
    invalidateGeneration: () => {
      const next = get().generation + 1;
      set({
        generation: next,
        connected: false,
        connecting: false,
        engineReady: false,
        engineError: null,
      });
      return next;
    },
    cancelPendingPrompts: () => {
      const next = get().messages.map((message) => {
        if (message.permission && message.permission.decision === undefined) {
          return {
            ...message,
            permission: {
              ...message.permission,
              decision: "cancelled" as const,
              cancelled: true,
            },
          };
        }
        if (message.ask && message.ask.result === undefined) {
          return { ...message, ask: { ...message.ask, result: "cancelled" } };
        }
        return message;
      });
      saveTranscript(next);
      set({ messages: next, drafting: null });
    },
    setInputValue: (v) => set({ inputValue: v }),
    setAgent: (v) => set({ agent: v }),
    setConnected: (v) => set({ connected: v }),
    setConnecting: (v) => set({ connecting: v }),
    setError: (v) => set({ error: v }),
    pushMessage: (m) => {
      const next = [...get().messages, m];
      saveTranscript(next);
      set({ messages: next });
    },
    clearMessages: () => {
      saveTranscript([]);
      set({ messages: [] });
    },
    setOffset: (x, y) => {
      saveOffset(x, y);
      set({ offsetX: x, offsetY: y });
    },
    setDock: (dock) => {
      const normalized = normalizeKollaborBarDock(dock);
      saveDock(normalized);
      set({ dock: normalized });
    },
    setScale: (s) => {
      const clamped = Math.min(SCALE_MAX, Math.max(SCALE_MIN, s));
      saveScale(clamped);
      set({ scale: clamped });
    },
    setFontScale: (s) => {
      const clamped = Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, s));
      saveFontScale(clamped);
      set({ fontScale: clamped });
    },
    setBarWidth: (width) => {
      const state = get();
      if (!state.storageScopeReady) return;
      const next = normalizeKollaborBarWidth(width);
      const saved = saveBarWidth(next, state.storageScope);
      set({
        barWidth: next,
        preferenceReadResolved: true,
        preferenceStorageError: saved ? null : BAR_SAVE_ERROR,
      });
    },
    setAppearance: (patch) => {
      const state = get();
      if (!state.storageScopeReady) return;
      const next = normalizeKollaborBarAppearance({ ...state.appearance, ...patch });
      const saved = saveAppearance(next, state.storageScope);
      set({
        appearance: next,
        preferenceReadResolved: true,
        preferenceStorageError: saved ? null : BAR_SAVE_ERROR,
      });
    },

    setSessionId: (v) => {
      saveSessionId(v);
      set({ sessionId: v, sessionScope: v ? kollaborBarStorageScope : null });
    },
    setEngineReady: (v) => set({ engineReady: v }),
    setEngineError: (v) => set({ engineError: v }),

    setYoloMode: (v) => {
      const scope = get().storageScope;
      const modeSaved = saveBool(LS_YOLO_KEY, v, scope);
      const choiceSaved = saveBool(LS_YOLO_SEEN_KEY, true, scope);
      const saved = modeSaved && choiceSaved;
      set({
        yoloMode: v,
        yoloPromptSeen: true,
        yoloPreferenceWriteFailed: !saved,
        preferenceStorageError: saved ? null : BAR_SAVE_ERROR,
      });
      return saved;
    },
    setYoloPromptSeen: (v) => {
      const state = get();
      const saved = saveBool(LS_YOLO_SEEN_KEY, v, state.storageScope);
      set({
        yoloPromptSeen: v,
        preferenceStorageError: saved && !state.yoloPreferenceWriteFailed
          ? null
          : BAR_SAVE_ERROR,
      });
      return saved;
    },
    resolveModeChoice: (messageId, choice) => {
      const state = get();
      const modeSaved = saveBool(LS_YOLO_KEY, choice === "yolo", state.storageScope);
      const choiceSaved = saveBool(LS_YOLO_SEEN_KEY, true, state.storageScope);
      const saved = modeSaved && choiceSaved;
      const next = state.messages.map((m) =>
        m.id === messageId && m.modeChoice
          ? { ...m, modeChoice: { result: choice } }
          : m,
      );
      saveTranscript(next);
      set({
        messages: next,
        yoloMode: choice === "yolo",
        yoloPromptSeen: true,
        yoloPreferenceWriteFailed: !saved,
        preferenceStorageError: saved ? null : BAR_SAVE_ERROR,
      });
      return saved;
    },

    startDraft: () => {
      set({ drafting: { text: "", tools: [], thinking: false } });
    },
    appendDraftText: (t) => {
      const d = get().drafting;
      if (!d) {
        // caller forgot to startDraft — warn but don't throw.
        console.warn("[kollabor-bar-store] appendDraftText called with no active draft");
        return;
      }
      set({ drafting: { ...d, text: appendAgentDraftText(d.text, t) } });
    },
    setDraftThinking: (v) => {
      const d = get().drafting;
      if (!d) {
        set({ drafting: { text: "", tools: [], thinking: v } });
        return;
      }
      set({ drafting: { ...d, thinking: v } });
    },
    addDraftTool: (t) => {
      const d = get().drafting;
      if (!d) {
        set({ drafting: { text: "", tools: [t], thinking: false } });
        return;
      }
      set({ drafting: { ...d, tools: [...d.tools, t] } });
    },
    updateDraftTool: (callId, patch) => {
      const d = get().drafting;
      if (!d) return;
      const tools = d.tools.map((tool) =>
        tool.callId === callId ? { ...tool, ...patch } : tool,
      );
      set({ drafting: { ...d, tools } });
    },
    updateToolByCallId: (callId, patch) => {
      // prefer the live draft (in-flight turn)
      const d = get().drafting;
      if (d && d.tools.some((tool) => tool.callId === callId)) {
        set({
          drafting: {
            ...d,
            tools: d.tools.map((tool) =>
              tool.callId === callId ? { ...tool, ...patch } : tool,
            ),
          },
        });
        return;
      }
      // otherwise the chip was already committed (e.g. permission gate) —
      // patch it in the transcript so it doesn't stay stuck on "running".
      let changed = false;
      const next = get().messages.map((m) => {
        if (!m.tools || !m.tools.some((tool) => tool.callId === callId)) return m;
        changed = true;
        return {
          ...m,
          tools: m.tools.map((tool) =>
            tool.callId === callId ? { ...tool, ...patch } : tool,
          ),
        };
      });
      if (changed) {
        saveTranscript(next);
        set({ messages: next });
      }
    },
    finishDraft: () => {
      const d = get().drafting;
      if (!d) return;
      const hasContent = d.text.length > 0 || d.tools.length > 0;
      if (hasContent) {
        const msg: KollaborMessage = {
          id: newMessageId("a"),
          role: "assistant",
          content: repairAgentTextSpacing(d.text),
          timestamp: Date.now(),
          tools: d.tools.length > 0 ? d.tools : undefined,
          thinking: d.thinking || undefined,
        };
        const next = [...get().messages, msg];
        saveTranscript(next);
        set({ messages: next, drafting: null });
      } else {
        set({ drafting: null });
      }
    },

    pushPermissionRequest: (req) => {
      const msg: KollaborMessage = {
        id: newMessageId("perm"),
        role: "permission",
        content: "",
        timestamp: Date.now(),
        permission: { ...req },
      };
      const next = [...get().messages, msg];
      saveTranscript(next);
      set({ messages: next });
    },
    resolvePermission: (messageId, decision) => {
      const next = get().messages.map((m) => {
        if (m.id !== messageId) return m;
        if (!m.permission) return m;
        return { ...m, permission: { ...m.permission, decision } };
      });
      saveTranscript(next);
      set({ messages: next });
    },

    pushAskRequest: (req) => {
      const msg: KollaborMessage = {
        id: newMessageId("ask"),
        role: "assistant",
        content: "",
        timestamp: Date.now(),
        ask: { ...req },
      };
      const next = [...get().messages, msg];
      saveTranscript(next);
      set({ messages: next });
    },
    resolveAsk: (messageId, result) => {
      const next = get().messages.map((m) => {
        if (m.id !== messageId) return m;
        if (!m.ask) return m;
        return { ...m, ask: { ...m.ask, result } };
      });
      saveTranscript(next);
      set({ messages: next });
    },
  };
});

/** Re-read the current scoped preference after identity hydration. */
export function hydrateKollaborBarPreference(): BooleanPreferenceRead {
  const scope = kollaborBarStorageScope;
  const preference = readEnabledPreference(scope);
  const marker = readPendingShutdownMarker(scope);
  useKollaborBarStore.setState({
    storageScope: scope,
    enabled: preference.value,
    preferenceReadResolved: preference.resolved,
    preferenceStorageError: preference.error,
    shutdownPending: marker !== null,
    cleanupBlocked: marker !== null,
    shutdownError: marker ? BAR_SHUTDOWN_ERROR : null,
    yoloMode: loadBool(LS_YOLO_KEY, true, scope),
    yoloPromptSeen: loadBool(LS_YOLO_SEEN_KEY, true, scope),
    yoloPreferenceWriteFailed: false,
    barWidth: loadBarWidth(scope),
    appearance: loadAppearance(scope),
    sessionId: loadSessionId(),
    sessionScope: loadSessionId() ? scope : null,
  });
  return preference;
}
