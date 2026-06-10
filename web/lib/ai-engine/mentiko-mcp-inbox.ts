// -------------------------------------------------------------------
// mentiko-mcp-inbox.ts — Per-session in-memory inbox for UI effects.
// -------------------------------------------------------------------
// Both the effects buffer and the results store are keyed by sessionId.
// Effects route to the specific browser session that initiated the agent turn.
// Results (permission prompt replies) are session-scoped so session A cannot
// consume session B's answers.
//
// Buffer eviction: sessions not drained in 10 min are evicted on every
// popEffects call.
//
// State is pinned to globalThis so it survives Next.js HMR/route reloads
// in dev and route-handler isolation in prod.
// -------------------------------------------------------------------

export interface UIEffect {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  timestamp: number;
}

export interface CurrentPage {
  pathname: string;
  search: string;
  label?: string;
  updatedAt: number;
}

interface SessionBuffer {
  effects: UIEffect[];
  lastDrained: number;
}

interface InboxState {
  buffers: Map<string, SessionBuffer>;
  // results: Map<"sessionId:toolId", { value, expiresAt }>
  results: Map<string, { value: unknown; expiresAt: number }>;
  currentPages: Map<string, CurrentPage>;
  deliveredEffects: Map<string, number>;
}

const EVICT_IDLE_MS = 10 * 60 * 1000;  // 10 min
const MAX_BUFFER_SIZE = 500;
const RESULT_TTL_MS = 5 * 60 * 1000;
const CURRENT_PAGE_TTL_MS = 60 * 1000;

const G = globalThis as unknown as { __mentikoMcpInbox?: InboxState };

// -------------------------------------------------------------------
// global state initialization — pinned to globalThis for HMR survival
// -------------------------------------------------------------------

function state(): InboxState {
  if (!G.__mentikoMcpInbox) {
    G.__mentikoMcpInbox = {
      buffers: new Map(),
      results: new Map(),
      currentPages: new Map(),
      deliveredEffects: new Map(),
    };
  }
  if (!G.__mentikoMcpInbox.currentPages) {
    G.__mentikoMcpInbox.currentPages = new Map();
  }
  if (!G.__mentikoMcpInbox.deliveredEffects) {
    G.__mentikoMcpInbox.deliveredEffects = new Map();
  }
  return G.__mentikoMcpInbox;
}

function getOrCreateBuffer(sessionId: string): SessionBuffer {
  const s = state();
  let buf = s.buffers.get(sessionId);
  if (!buf) {
    buf = { effects: [], lastDrained: Date.now() };
    s.buffers.set(sessionId, buf);
  }
  return buf;
}

function evictStale(): void {
  const s = state();
  const cutoff = Date.now() - EVICT_IDLE_MS;
  for (const [sid, buf] of s.buffers) {
    if (buf.lastDrained < cutoff) {
      s.buffers.delete(sid);
    }
  }
  for (const [sid, page] of s.currentPages) {
    if (Date.now() - page.updatedAt > CURRENT_PAGE_TTL_MS) {
      s.currentPages.delete(sid);
    }
  }
  for (const [key, deliveredAt] of s.deliveredEffects) {
    if (deliveredAt < cutoff) {
      s.deliveredEffects.delete(key);
    }
  }
}

function genId(kind: string): string {
  return `${kind}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function resultKey(sessionId: string, toolId: string): string {
  return `${sessionId}:${toolId}`;
}

function effectKey(sessionId: string, effectId: string): string {
  return `${sessionId}:${effectId}`;
}

// -------------------------------------------------------------------
// current page tracking — for route-aware UI effects
// -------------------------------------------------------------------

export function setCurrentPage(sessionId: string, page: CurrentPage): void {
  state().currentPages.set(sessionId, page);
}

export function getCurrentPage(sessionId: string): CurrentPage | null {
  const s = state();
  const page = s.currentPages.get(sessionId);
  if (!page) return null;
  if (Date.now() - page.updatedAt > CURRENT_PAGE_TTL_MS) {
    s.currentPages.delete(sessionId);
    return null;
  }
  return page;
}

// -------------------------------------------------------------------
// effects buffer — per-session queue of UI effects
// -------------------------------------------------------------------

export function pushEffect(
  kind: string,
  payload: Record<string, unknown>,
  sessionId: string,
): UIEffect {
  const buf = getOrCreateBuffer(sessionId);
  const effect: UIEffect = { id: genId(kind), kind, payload, timestamp: Date.now() };
  buf.effects.push(effect);
  if (buf.effects.length > MAX_BUFFER_SIZE) {
    buf.effects.splice(0, buf.effects.length - MAX_BUFFER_SIZE);
  }
  return effect;
}

export function popEffects(sessionId: string): UIEffect[] {
  evictStale();
  const s = state();
  const buf = s.buffers.get(sessionId);
  if (!buf) return [];
  const effects = buf.effects.splice(0);
  buf.lastDrained = Date.now();
  return effects;
}

export function markEffectDelivered(sessionId: string, effectId: string): void {
  state().deliveredEffects.set(effectKey(sessionId, effectId), Date.now());
}

export function isEffectDelivered(sessionId: string, effectId: string): boolean {
  return state().deliveredEffects.has(effectKey(sessionId, effectId));
}

// -------------------------------------------------------------------
// results store — permission prompt replies, per-session
// -------------------------------------------------------------------

export function storeResult(sessionId: string, toolId: string, result: unknown): void {
  const s = state();
  const key = resultKey(sessionId, toolId);
  s.results.set(key, { value: result, expiresAt: Date.now() + RESULT_TTL_MS });
  // opportunistic cleanup
  if (s.results.size > 1000) {
    const now = Date.now();
    for (const [k, v] of s.results) if (v.expiresAt < now) s.results.delete(k);
  }
}

export function consumeResult(sessionId: string, toolId: string): unknown | undefined {
  const s = state();
  const key = resultKey(sessionId, toolId);
  const r = s.results.get(key);
  if (!r) return undefined;
  if (r.expiresAt < Date.now()) {
    s.results.delete(key);
    return undefined;
  }
  s.results.delete(key);
  return r.value;
}

// -------------------------------------------------------------------
// session cleanup — evict all session data on logout/close
// -------------------------------------------------------------------

export function evictSession(sessionId: string): void {
  const s = state();
  s.buffers.delete(sessionId);
  s.currentPages.delete(sessionId);
  // evict all results for this session
  for (const key of s.results.keys()) {
    if (key.startsWith(`${sessionId}:`)) s.results.delete(key);
  }
  for (const key of s.deliveredEffects.keys()) {
    if (key.startsWith(`${sessionId}:`)) s.deliveredEffects.delete(key);
  }
}
