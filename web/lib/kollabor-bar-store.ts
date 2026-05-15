import { create } from "zustand";
import {
  appendAgentDraftText,
  repairAgentTextSpacing,
} from "./agent-message-text";

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
  input: unknown;
  riskLevel: string;
  riskReason: string;
  decision?: "approve" | "approve_always" | "deny";
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

interface KollaborBarState {
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

  // engine session + streaming state
  sessionId: string | null;
  drafting: KollaborDrafting | null;
  engineReady: boolean;
  engineError: string | null;

  setExpanded: (v: boolean) => void;
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

  // engine session setters
  setSessionId: (v: string | null) => void;
  setEngineReady: (v: boolean) => void;
  setEngineError: (v: string | null) => void;

  // drafting lifecycle
  startDraft: () => void;
  appendDraftText: (t: string) => void;
  setDraftThinking: (v: boolean) => void;
  addDraftTool: (t: DraftTool) => void;
  updateDraftTool: (callId: string, patch: Partial<DraftTool>) => void;
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
const LS_SESSION_KEY = "mentiko-kollabor-session-id";

export const SCALE_MIN = 0.6;
export const SCALE_MAX = 1.6;
export const KOLLABOR_BAR_DEFAULT_DOCK: KollaborBarDock = { edge: "bottom", offset: 50 };
export const KOLLABOR_BAR_SIDE_DOCK_REACH_PX = 280;
export const KOLLABOR_BAR_DOCK_OFFSET_MIN = 10;
export const KOLLABOR_BAR_DOCK_OFFSET_MAX = 90;
export const FONT_SCALE_DEFAULT = 1;
export const FONT_SCALE_MIN = 0.8;
export const FONT_SCALE_MAX = 1.35;

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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
    const raw = localStorage.getItem(LS_KEY);
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
    localStorage.setItem(LS_KEY, JSON.stringify(messages.slice(-50)));
  } catch {
    // quota or disabled; ignore
  }
}

function loadSessionId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LS_SESSION_KEY);
    return raw && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

function saveSessionId(v: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (v === null || v === "") {
      localStorage.removeItem(LS_SESSION_KEY);
    } else {
      localStorage.setItem(LS_SESSION_KEY, v);
    }
  } catch {
    // ignore
  }
}

function newMessageId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export const useKollaborBarStore = create<KollaborBarState>((set, get) => {
  const initialOffset = loadOffset();
  return {
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

    sessionId: loadSessionId(),
    drafting: null,
    engineReady: false,
    engineError: null,

    setExpanded: (v) => set({ expanded: v }),
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

    setSessionId: (v) => {
      saveSessionId(v);
      set({ sessionId: v });
    },
    setEngineReady: (v) => set({ engineReady: v }),
    setEngineError: (v) => set({ engineError: v }),

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
