import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import config from "../config";
import path from "path";

const REGISTRY_DIR = path.join(config.namespaceRoot, "peer-escalations");
const REGISTRY_PATH = path.join(REGISTRY_DIR, "registry.json");

export interface SessionEntry {
  telegram_chat_id?: string;
  task: string;
  peer1?: string;
  peer2?: string;
  started_at: string;
  status: "active" | "completed";
}

interface Registry {
  sessions: Record<string, SessionEntry>;
  by_chat_id: Record<string, string>;
}

export interface EscalationEvent {
  id: string;
  session_id: string;
  round: number;
  trigger: "STATUS:ESCALATE" | "STALL" | "MAX_ROUNDS";
  consecutive_continues: number;
  peer1_last: string;
  peer2_last: string;
  haiku_summary?: string;
  telegram_message_id?: number;
  sent_at: string;
  human_reply?: string;
  replied_at?: string;
  injected_at?: string;
}

function readRegistry(): Registry {
  mkdirSync(REGISTRY_DIR, { recursive: true });
  if (!existsSync(REGISTRY_PATH)) return { sessions: {}, by_chat_id: {} };
  return JSON.parse(readFileSync(REGISTRY_PATH, "utf-8"));
}

function writeRegistry(registry: Registry): void {
  mkdirSync(REGISTRY_DIR, { recursive: true });
  writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2));
}

export function registerSession(
  session_id: string,
  entry: SessionEntry
): void {
  const reg = readRegistry();
  reg.sessions[session_id] = entry;
  if (entry.telegram_chat_id) {
    reg.by_chat_id[entry.telegram_chat_id] = session_id;
  }
  writeRegistry(reg);
}

export function getSessionByChatId(chat_id: string): string | null {
  const reg = readRegistry();
  return reg.by_chat_id[chat_id] ?? null;
}

export function getSessionEntry(session_id: string): SessionEntry | null {
  const reg = readRegistry();
  return reg.sessions[session_id] ?? null;
}

export function escalationDir(session_id: string): string {
  return path.join(REGISTRY_DIR, session_id);
}

export function replyFile(session_id: string): string {
  return path.join(escalationDir(session_id), "reply.txt");
}

export function historyFile(session_id: string): string {
  return path.join(escalationDir(session_id), "history.json");
}

export function readHistory(session_id: string): EscalationEvent[] {
  const file = historyFile(session_id);
  if (!existsSync(file)) return [];
  return JSON.parse(readFileSync(file, "utf-8"));
}

export function appendHistory(
  session_id: string,
  event: EscalationEvent
): void {
  const dir = escalationDir(session_id);
  mkdirSync(dir, { recursive: true });
  const file = historyFile(session_id);
  const existing = existsSync(file)
    ? JSON.parse(readFileSync(file, "utf-8"))
    : [];
  existing.push(event);
  writeFileSync(file, JSON.stringify(existing, null, 2));

  // also write individual snapshot
  const snapPath = path.join(dir, `escalation-${existing.length}.json`);
  writeFileSync(snapPath, JSON.stringify(event, null, 2));
}

export function updateLastHistoryEntry(
  session_id: string,
  updates: Partial<EscalationEvent>
): void {
  const file = historyFile(session_id);
  if (!existsSync(file)) return;
  const history: EscalationEvent[] = JSON.parse(readFileSync(file, "utf-8"));
  if (history.length === 0) return;
  Object.assign(history[history.length - 1], updates);
  writeFileSync(file, JSON.stringify(history, null, 2));

  // update the individual snapshot too
  const n = history.length;
  const snapPath = path.join(escalationDir(session_id), `escalation-${n}.json`);
  writeFileSync(snapPath, JSON.stringify(history[n - 1], null, 2));
}

export function isPendingReply(session_id: string): boolean {
  const history = readHistory(session_id);
  if (history.length === 0) return false;
  const last = history[history.length - 1];
  return !last.human_reply && !existsSync(replyFile(session_id));
}

/** Active sessions whose latest escalation is still waiting on a human reply. */
export function listPendingEscalations(): { sessionId: string; task: string; startedAt: string }[] {
  const reg = readRegistry();
  return Object.entries(reg.sessions)
    .filter(([sessionId, entry]) => entry.status === "active" && isPendingReply(sessionId))
    .map(([sessionId, entry]) => ({ sessionId, task: entry.task, startedAt: entry.started_at }));
}
