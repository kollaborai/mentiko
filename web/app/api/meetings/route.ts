/**
 * GET /api/meetings
 *
 * lists active + completed peer review sessions ("meetings").
 * discovers meetings from:
 *   1. live PTY sessions (peer pairs sharing a timestamp suffix)
 *   2. completed transcripts in peer-output directory
 *   3. manager-* sessions
 */

import { NextRequest } from "next/server";
import { execFileSync } from "node:child_process";
import { join } from "path";
import { readdirSync } from "fs";
import config from "@/lib/config";
import { getNamespaceIdFromRequest } from "@/lib/namespace-config";
import { requirePermission } from "@/lib/auth/rbac-auth";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { resolvePeerOutputDir } from "@/lib/links/link-run-runtime";

export const dynamic = "force-dynamic";

const pBin = join(config.binDir, "p");

// timestamp suffix pattern: YYYYMMDD-HHMMSS
const TIMESTAMP_RE = /(\d{8}-\d{6})$/;
// peer-output filename: {session}-r{round}-{epoch}.txt
const TRANSCRIPT_RE = /^(.+)-r(\d+)-(\d+)\.txt$/;

// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

interface PeerInfo {
  session: string;
  role?: string;
  alive: boolean;
}

interface Meeting {
  id: string;
  status: "active" | "completed" | "stalled";
  peer1: PeerInfo;
  peer2: PeerInfo;
  manager?: string;
  initiative?: string;
  round?: number;
  startedAt: string;
  sessionConfig?: {
    peer1: { role: string; context: string };
    peer2: { role: string; context: string };
    objective: string;
  };
}

interface PtySession {
  name: string;
  pid: number;
  status: "alive" | "dead";
  command: string;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function parseSessions(output: string): PtySession[] {
  const lines = output.trim().split("\n");
  const sessions: PtySession[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    // format: name  pid=XXX  COLSxROWS  alive|dead  command...
    const match = line.match(/^(\S+)\s+pid=(\d+)\s+\d+x\d+\s+(\w+)\s+(.+)$/);
    if (!match) continue;
    const [, name, pid, status, command] = match;
    sessions.push({
      name,
      pid: parseInt(pid, 10),
      status: status as "alive" | "dead",
      command,
    });
  }
  return sessions;
}


function captureLines(sessionName: string, lines: number): string {
  try {
    return execFileSync(pBin, ["capture", sessionName, String(lines)], {
      cwd: config.codeRoot,
      stdio: "pipe",
      timeout: 30000,
    }).toString();
  } catch {
    return "";
  }
}

/** extract current round from manager session capture */
function parseRound(capture: string): number | undefined {
  // historical controller logs: "round N: ..."
  const matches = capture.match(/round (\d+)/g);
  if (!matches || matches.length === 0) return undefined;
  const last = matches[matches.length - 1];
  const num = last.match(/round (\d+)/);
  return num ? parseInt(num[1], 10) : undefined;
}

/** extract initiative (task) from manager session capture */
function parseInitiative(capture: string): string | undefined {
  // historical controller logs: "  task:    <task description>"
  const match = capture.match(/task:\s+(.+)/);
  return match ? match[1].trim() : undefined;
}

/** convert YYYYMMDD-HHMMSS to ISO timestamp */
function timestampToISO(ts: string): string {
  // 20260321-232930 -> 2026-03-21T23:29:30
  const y = ts.slice(0, 4);
  const mo = ts.slice(4, 6);
  const d = ts.slice(6, 8);
  const h = ts.slice(9, 11);
  const mi = ts.slice(11, 13);
  const s = ts.slice(13, 15);
  return `${y}-${mo}-${d}T${h}:${mi}:${s}`;
}

/** extract timestamp suffix from a session name */
function extractTimestamp(name: string): string | null {
  const m = name.match(TIMESTAMP_RE);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// meeting discovery
// ---------------------------------------------------------------------------

function discoverFromPty(): Map<string, Partial<Meeting>> {
  const meetings = new Map<string, Partial<Meeting>>();

  let raw = "";
  try {
    raw = execFileSync(pBin, ["list"], {
      cwd: config.codeRoot,
      stdio: "pipe",
      timeout: 30000,
    }).toString();
  } catch {
    return meetings;
  }

  const sessions = parseSessions(raw);

  // group by timestamp suffix
  const byTimestamp = new Map<string, PtySession[]>();
  const managers = new Map<string, PtySession>();

  for (const s of sessions) {
    // manager sessions
    if (s.name.startsWith("manager-")) {
      managers.set(s.name, s);
      continue;
    }

    const ts = extractTimestamp(s.name);
    if (!ts) continue;

    const group = byTimestamp.get(ts) || [];
    group.push(s);
    byTimestamp.set(ts, group);
  }

  // build meetings from peer groups (2+ sessions sharing a timestamp)
  for (const [ts, group] of byTimestamp) {
    if (group.length < 2) continue;

    // sort by name so peer ordering is deterministic
    group.sort((a, b) => a.name.localeCompare(b.name));

    const p1 = group[0];
    const p2 = group[1];
    const p1Alive = p1.status === "alive";
    const p2Alive = p2.status === "alive";
    const anyAlive = p1Alive || p2Alive;

    const meeting: Partial<Meeting> = {
      id: ts,
      status: anyAlive ? "active" : "stalled",
      peer1: { session: p1.name, alive: p1Alive },
      peer2: { session: p2.name, alive: p2Alive },
      startedAt: timestampToISO(ts),
    };

    meetings.set(ts, meeting);
  }

  // attach manager sessions to meetings
  for (const [mName, mSession] of managers) {
    // try to find the meeting this manager belongs to
    // manager sessions are launched alongside peers, capture to find round/initiative
    const capture = captureLines(mName, 30);
    const round = parseRound(capture);
    const initiative = parseInitiative(capture);

    // try matching by scanning meetings for timestamp proximity
    // or just attach to any meeting that doesn't have a manager yet
    let matched = false;
    for (const [, m] of meetings) {
      if (!m.manager) {
        m.manager = mName;
        if (round !== undefined) m.round = round;
        if (initiative) m.initiative = initiative;
        matched = true;
        break;
      }
    }

    // manager with no peer group - create a standalone entry
    if (!matched) {
      const ts = mName.replace("manager-", "");
      meetings.set(mName, {
        id: ts,
        status: mSession.status === "alive" ? "active" : "stalled",
        peer1: { session: "", alive: false },
        peer2: { session: "", alive: false },
        manager: mName,
        round,
        initiative,
        startedAt: new Date().toISOString(),
      });
    }
  }

  return meetings;
}

function discoverFromTranscripts(
  existing: Map<string, Partial<Meeting>>,
  peerOutputDir: string
): Map<string, Partial<Meeting>> {
  let files: string[];
  try {
    files = readdirSync(peerOutputDir);
  } catch {
    return existing;
  }

  // group transcripts by their timestamp suffix
  const transcriptsByTs = new Map<
    string,
    { sessions: Set<string>; maxRound: number; latestEpoch: number }
  >();

  for (const f of files) {
    const m = f.match(TRANSCRIPT_RE);
    if (!m) continue;
    const [, session, roundStr, epochStr] = m;
    const round = parseInt(roundStr, 10);
    const epoch = parseInt(epochStr, 10);

    const ts = extractTimestamp(session);
    if (!ts) continue;

    const entry = transcriptsByTs.get(ts) || {
      sessions: new Set<string>(),
      maxRound: 0,
      latestEpoch: 0,
    };
    entry.sessions.add(session);
    if (round > entry.maxRound) entry.maxRound = round;
    if (epoch > entry.latestEpoch) entry.latestEpoch = epoch;
    transcriptsByTs.set(ts, entry);
  }

  // merge transcript data into existing or create new completed meetings
  for (const [ts, data] of transcriptsByTs) {
    const sessionNames = Array.from(data.sessions).sort();

    if (existing.has(ts)) {
      // already found from PTY - just enrich with round info
      const m = existing.get(ts)!;
      if (m.round === undefined || data.maxRound > (m.round || 0)) {
        m.round = data.maxRound;
      }
      continue;
    }

    // completed meeting (no live sessions)
    const p1 = sessionNames[0] || "";
    const p2 = sessionNames[1] || "";

    existing.set(ts, {
      id: ts,
      status: "completed",
      peer1: { session: p1, alive: false },
      peer2: { session: p2, alive: false },
      round: data.maxRound,
      startedAt: timestampToISO(ts),
    });
  }

  return existing;
}

// ---------------------------------------------------------------------------
// route
// ---------------------------------------------------------------------------

export const GET = withErrorHandling(async (req: NextRequest) => {
  const perm = await requirePermission(req, "view_chains");
  if (perm) return perm;

  // discover from both sources
  const namespaceId = await getNamespaceIdFromRequest(req);
  let meetings = discoverFromPty();
  meetings = discoverFromTranscripts(meetings, resolvePeerOutputDir(namespaceId));

  // convert to array, sort by startedAt descending (newest first)
  const sorted: Meeting[] = Array.from(meetings.values())
    .map((m) => ({
      id: m.id!,
      status: m.status!,
      peer1: m.peer1!,
      peer2: m.peer2!,
      manager: m.manager,
      initiative: m.initiative,
      round: m.round,
      startedAt: m.startedAt!,
      sessionConfig: m.sessionConfig,
    }))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  return apiSuccess({ meetings: sorted });
});
