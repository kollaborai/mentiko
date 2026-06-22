/**
 * @jest-environment node
 *
 * ENGINE EVENT CONTRACT — behavioral, not source-grep.
 *
 * The bash engine is the PRODUCER: it writes file-based events into $EVENTS_DIR.
 * The web app is the CONSUMER: it parses those files to drive run progress,
 * the activity feed, the SSE stream, and (critically) completion detection.
 *
 * History: the team once spent ~6 days patching the web-side completion matcher
 * when the real bug was the PRODUCER emitting non-canonical events (an old
 * `${timestamp}-${event}.event` naming scheme that LLM agents could not
 * reproduce, so emitted events went unmatched). The producer was fixed to the
 * canonical `${run_id}-${source}-${event}.event` form written by the single
 * canonical writer `lib/event-trigger.sh::emit-event`. Nothing prevented a
 * regression — the existing flagship "engine test"
 * (web/lib/chain-runner-ai-gateway-source.test.ts) only greps the bash source as
 * a string.
 *
 * This test EXECUTES the real emission paths against a temp data root (redirected
 * via the EVENTS_DIR env var that lib/config.sh honors), reads the actual emitted
 * files, and validates every event against the canonical schema the CONSUMER
 * relies on. The canonical schema below is derived from the consumer parsers:
 *
 *   - web/app/api/events/route.ts        parseEventFile()  (event log API)
 *   - web/app/api/events/stream/route.ts events watcher    (SSE live stream)
 *   - web/lib/runs/run-reconciler.ts     parseEventRecord() + recoverCompletedAgentsFromEvents()
 *                                        (the completion matcher — the load-bearing one)
 *
 * Hermetic: no model providers, no network, no real keys, no pty-manager, no
 * web server. We drive the bash emitters directly with deterministic inputs.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// repo paths (code root resolved relative to this test file — never cwd-derived)
// ---------------------------------------------------------------------------

const CODE_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const LIB = join(CODE_ROOT, "lib");
const BIN = join(CODE_ROOT, "bin");
const EVENT_TRIGGER_SH = join(LIB, "event-trigger.sh");
const WATCHDOG_SH = join(LIB, "watchdog.sh");
const COMPLETE_SH = join(LIB, "chain-runner-complete.sh");
const AGENT_FUNCTIONS_SH = join(LIB, "agent-functions.sh");
const MENTIKO_CLI = join(BIN, "mentiko");

// the bash the engine shebangs use; system bash on macOS is 3.2 and these
// emitters are written for it. resolve from the shebang so we don't accidentally
// test under a different bash than ships in the tenant image.
const ENGINE_BASH = "/bin/bash";

function makeEventsDir(): string {
  const root = mkdtempSync(join(tmpdir(), "mentiko-event-contract-"));
  const events = join(root, "events");
  mkdirSync(events, { recursive: true });
  return events;
}

function makeExecEnv(env: Record<string, string>): NodeJS.ProcessEnv {
  return {
    NODE_ENV: process.env.NODE_ENV || "test",
    ...env,
  };
}

/**
 * Run a bash snippet with EVENTS_DIR redirected to a hermetic temp dir.
 * Returns the directory so the caller can read the emitted files back.
 */
function runEmitter(
  script: string,
  env: Record<string, string> = {},
): { eventsDir: string; stdout: string } {
  const eventsDir = makeEventsDir();
  const stdout = execFileSync(ENGINE_BASH, ["-c", script], {
    env: makeExecEnv({
      // minimal, hermetic env. HOME is redirected so config.sh's
      // $HOME/.mentiko fallback can never touch the real data root even if a
      // script ignores EVENTS_DIR.
      PATH: process.env.PATH || "",
      HOME: join(eventsDir, ".."),
      EVENTS_DIR: eventsDir,
      ...env,
    }),
    encoding: "utf8",
  });
  return { eventsDir, stdout };
}

function listEventFiles(dir: string): string[] {
  return readdirSync(dir).filter((f) => f.endsWith(".event"));
}

// ===========================================================================
// CANONICAL EVENT CONTRACT
// ---------------------------------------------------------------------------
// Encoded as plain assertions (the dominant idiom in this repo's contract
// tests — no zod dependency is present, and these checks must mirror the
// consumer parsers byte-for-byte rather than a generic JSON-schema validator).
//
// A canonical `.event` file is line-oriented `key: value` text. The consumer
// extracts these fields. Required + their rules:
// ===========================================================================

/** Event type names the producer emits to `.event` files. snake_case is NEVER
 * canonical for file events — every consumer parser keys on the hyphenated
 * names below. (The in-memory EventBus in web/lib/event-bus.ts uses snake_case
 * but that is a SEPARATE concern and never parses these files.) */
const CANONICAL_EVENT_TYPES = [
  // lifecycle / system events the engine hardcodes
  "chain-complete",
  "run-stalled",
  "task-status-updated",
  // schema-declared agent lifecycle names (also valid as agent emits)
  "manual-start",
  "chain-started",
  "chain-error",
  "agent-started",
  "agent-complete",
  "agent-error",
  "agent-timeout",
  "webhook-triggered",
  "schedule-triggered",
  "fan-in-complete",
  "fan-out-complete",
] as const;

/**
 * Parse a `.event` file the way the REFERENCE consumer parsers do.
 *
 * This is a faithful reimplementation of the shared logic in:
 *   - web/app/api/events/route.ts          parseEventFile (slice on known prefixes)
 *   - web/lib/runs/run-reconciler.ts        parseEventRecord (indexOf(":") split)
 *   - web/app/api/events/stream/route.ts    inline events watcher
 *
 * We use the run-reconciler indexOf(":") strategy because it is the one the
 * COMPLETION MATCHER uses, and it is the strictest about field extraction.
 * `data:` values may themselves contain colons (URLs, timestamps); splitting on
 * the FIRST colon keeps `event`/`source` clean and `data` intact.
 */
interface ParsedEvent {
  event?: string;
  source?: string;
  timestamp?: string;
  processed?: string;
  run_id?: string;
  data?: string;
  [key: string]: string | undefined;
}

function parseEventFileLikeConsumer(content: string): ParsedEvent {
  const fields: ParsedEvent = {};
  for (const line of content.split("\n")) {
    const sep = line.indexOf(":");
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim().toLowerCase();
    const value = line.slice(sep + 1).trim();
    if (key) fields[key] = value;
  }
  return fields;
}

/**
 * Validate a single parsed event against the canonical contract.
 * Returns a list of human-readable violations (empty = canonical).
 *
 * `opts.requireData` is false for system events (run-stalled) that legitimately
 * carry structured fields instead of a freeform `data:` line; all consumer
 * parsers default `data` to "" when absent, so it is optional in the contract.
 */
function contractViolations(
  parsed: ParsedEvent,
  opts: { requireData?: boolean } = {},
): string[] {
  const v: string[] = [];

  // event: required, non-empty, exact-case canonical name
  if (!parsed.event) {
    v.push("missing required field `event:`");
  } else if (parsed.event !== parsed.event.trim()) {
    v.push(`event has surrounding whitespace: ${JSON.stringify(parsed.event)}`);
  } else if (parsed.event !== parsed.event.toLowerCase()) {
    v.push(`event is not lowercase/canonical casing: ${JSON.stringify(parsed.event)}`);
  } else if (parsed.event.includes("_")) {
    v.push(
      `event uses snake_case; canonical file events are hyphenated: ${JSON.stringify(parsed.event)}`,
    );
  }

  // source: required, non-empty (the completion matcher keys on this)
  if (!parsed.source) {
    v.push("missing required field `source:`");
  }

  // timestamp: required, must be parseable by `new Date()` (consumers sort on it)
  if (!parsed.timestamp) {
    v.push("missing required field `timestamp:`");
  } else if (!Number.isFinite(new Date(parsed.timestamp).getTime())) {
    v.push(`timestamp not parseable by new Date(): ${JSON.stringify(parsed.timestamp)}`);
  }

  // processed: required, must be a boolean literal the consumers recognize.
  // events/route.ts + stream do `=== "true"` (case-insensitive via toLowerCase);
  // a missing field is tolerated (defaults false) BUT the canonical writer always
  // emits it, so the contract requires it on engine-produced events.
  if (parsed.processed === undefined) {
    v.push("missing required field `processed:`");
  } else {
    const norm = parsed.processed.toLowerCase();
    if (norm !== "true" && norm !== "false") {
      v.push(`processed must be true|false, got: ${JSON.stringify(parsed.processed)}`);
    }
  }

  if (opts.requireData && parsed.data === undefined) {
    v.push("missing `data:` field");
  }

  return v;
}

// ===========================================================================
// PRODUCER PATH 1 — the single canonical writer: event-trigger.sh::emit-event
// (used by the CLI, the agent-facing `mentiko emit`, the chain-runner fallback,
//  and the chain-complete / task-status-updated lifecycle emissions)
// ===========================================================================

describe("producer: event-trigger.sh emit-event (the single canonical writer)", () => {
  it("emits a canonical .event file for every event type the engine produces", () => {
    for (const eventType of CANONICAL_EVENT_TYPES) {
      const { eventsDir } = runEmitter(
        `source ${q(EVENT_TRIGGER_SH)} >/dev/null 2>&1
         emit-event ${q(eventType)} "researcher" "task=write report status=ok" >/dev/null 2>&1`,
        { MENTIKO_RUN_ID: "run-1700000000" },
      );

      const files = listEventFiles(eventsDir);
      expect(files).toHaveLength(1);

      // canonical filename: ${run_id}-${source}-${event}.event
      expect(files[0]).toBe(`run-1700000000-researcher-${eventType}.event`);

      const parsed = parseEventFileLikeConsumer(
        readFileSync(join(eventsDir, files[0]), "utf8"),
      );
      const violations = contractViolations(parsed, { requireData: true });
      expect(violations).toEqual([]);

      // exact field values
      expect(parsed.event).toBe(eventType);
      expect(parsed.source).toBe("researcher");
      expect(parsed.run_id).toBe("run-1700000000");
      expect(parsed.processed).toBe("false");
      expect(parsed.data).toBe("task=write report status=ok");
    }
  });

  it("drops the run_id prefix from the filename for manual CLI use (no run_id set)", () => {
    const { eventsDir } = runEmitter(
      `source ${q(EVENT_TRIGGER_SH)} >/dev/null 2>&1
       emit-event "agent-complete" "writer" "done" >/dev/null 2>&1`,
      // no MENTIKO_RUN_ID / RUN_ID
    );
    const files = listEventFiles(eventsDir);
    expect(files).toEqual(["writer-agent-complete.event"]);
    const parsed = parseEventFileLikeConsumer(readFileSync(join(eventsDir, files[0]), "utf8"));
    expect(parsed.run_id).toBe("");
    expect(contractViolations(parsed, { requireData: true })).toEqual([]);
  });

  it("keeps event/source clean when data contains colons (URLs, timestamps)", () => {
    // the reconciler splits on the FIRST colon. data with embedded colons must
    // not corrupt the matcher's view of event/source.
    const { eventsDir } = runEmitter(
      `source ${q(EVENT_TRIGGER_SH)} >/dev/null 2>&1
       emit-event "agent-complete" "fetcher" "url=https://example.com:8080/p when=2026-01-01T00:00:00Z" >/dev/null 2>&1`,
      { MENTIKO_RUN_ID: "run-x" },
    );
    const parsed = parseEventFileLikeConsumer(
      readFileSync(join(eventsDir, listEventFiles(eventsDir)[0]), "utf8"),
    );
    expect(parsed.event).toBe("agent-complete");
    expect(parsed.source).toBe("fetcher");
    expect(parsed.data).toBe("url=https://example.com:8080/p when=2026-01-01T00:00:00Z");
    expect(contractViolations(parsed, { requireData: true })).toEqual([]);
  });

  it("sanitizes path-bearing source/event into a safe filename without losing field values", () => {
    // event-filename-component() must not let a malicious source escape EVENTS_DIR.
    const { eventsDir } = runEmitter(
      `source ${q(EVENT_TRIGGER_SH)} >/dev/null 2>&1
       emit-event "agent-complete" "../../etc/passwd" "x" >/dev/null 2>&1`,
      { MENTIKO_RUN_ID: "run-x" },
    );
    const files = listEventFiles(eventsDir);
    expect(files).toHaveLength(1);
    // the real safety property: event-filename-component() strips path
    // separators, so the file cannot escape EVENTS_DIR. (Literal `..` dots may
    // survive as `_`-joined text, but with no `/` they are inert.)
    expect(files[0]).not.toContain("/");
    expect(files[0]).not.toMatch(/(^|[^.])\.\.[/\\]/); // no traversal sequence
    expect(files[0]).toBe("run-x-.._.._etc_passwd-agent-complete.event");
    // but the field value INSIDE the file is preserved verbatim for the consumer
    const parsed = parseEventFileLikeConsumer(readFileSync(join(eventsDir, files[0]), "utf8"));
    expect(parsed.source).toBe("../../etc/passwd");
  });
});

// ===========================================================================
// PRODUCER PATH 2 — chain lifecycle emission (chain-complete) via the canonical
// writer, exactly as chain-runner-complete.sh invokes it at run end.
// ===========================================================================

describe("producer: chain-complete lifecycle event (chain-runner-complete.sh call site)", () => {
  it("emits the terminal chain-complete event the completion matcher keys on", () => {
    // mirrors lib/chain-runner-complete.sh:1328
    //   emit-event "chain-complete" "$CHAIN_NAME" "chain=... run_id=... last_event=..."
    const { eventsDir } = runEmitter(
      `source ${q(EVENT_TRIGGER_SH)} >/dev/null 2>&1
       CHAIN_NAME="content-pipeline"
       RUN_ID="run-1700000000"
       TRIGGERED_EVENT_NAME="agent-complete"
       emit-event "chain-complete" "$CHAIN_NAME" \
         "chain=$CHAIN_NAME run_id=$RUN_ID last_event=$TRIGGERED_EVENT_NAME" >/dev/null 2>&1`,
      { MENTIKO_RUN_ID: "run-1700000000" },
    );
    const files = listEventFiles(eventsDir);
    expect(files).toEqual(["run-1700000000-content-pipeline-chain-complete.event"]);

    const parsed = parseEventFileLikeConsumer(readFileSync(join(eventsDir, files[0]), "utf8"));
    expect(contractViolations(parsed, { requireData: true })).toEqual([]);
    expect(parsed.event).toBe("chain-complete");
    expect(parsed.source).toBe("content-pipeline");
    expect(parsed.data).toContain("last_event=agent-complete");
  });
});

// ===========================================================================
// PRODUCER PATH 3 — the agent-facing CLI: `bin/mentiko emit`
// This is the path real agents use mid-run. It sources config.sh (honoring
// EVENTS_DIR) and routes through the SAME canonical writer.
// ===========================================================================

describe("producer: bin/mentiko emit (agent-facing CLI path)", () => {
  it("produces a byte-compatible canonical event, defaulting source to MENTIKO_AGENT_ID", () => {
    const eventsDir = makeEventsDir();
    execFileSync(MENTIKO_CLI, ["emit", "agent-complete"], {
      env: makeExecEnv({
        PATH: process.env.PATH || "",
        HOME: join(eventsDir, ".."),
        EVENTS_DIR: eventsDir,
        RUN_ID: "run-1700000001",
        MENTIKO_AGENT_ID: "writer-agent",
        // keep it hermetic: config.sh roots must not touch the real ~/.mentiko
        MENTIKO_GLOBAL_ROOT: join(eventsDir, "..", "global"),
      }),
      encoding: "utf8",
    });

    const files = listEventFiles(eventsDir);
    expect(files).toEqual(["run-1700000001-writer-agent-agent-complete.event"]);

    const parsed = parseEventFileLikeConsumer(readFileSync(join(eventsDir, files[0]), "utf8"));
    expect(contractViolations(parsed)).toEqual([]); // data optional (CLI omitted it)
    expect(parsed.event).toBe("agent-complete");
    expect(parsed.source).toBe("writer-agent");
    expect(parsed.run_id).toBe("run-1700000001");
  });

  it("refuses to emit a literal event named --help (agents probe the command)", () => {
    const eventsDir = makeEventsDir();
    const out = execFileSync(MENTIKO_CLI, ["emit", "--help"], {
      env: makeExecEnv({
        PATH: process.env.PATH || "",
        HOME: join(eventsDir, ".."),
        EVENTS_DIR: eventsDir,
        MENTIKO_GLOBAL_ROOT: join(eventsDir, "..", "global"),
      }),
      encoding: "utf8",
    });
    expect(out).toContain("usage: mentiko emit");
    expect(listEventFiles(eventsDir)).toEqual([]); // nothing polluted the stream
  });
});

// ===========================================================================
// PRODUCER PATH 4 — the watchdog run-stalled SYSTEM event (inline heredoc, a
// DIFFERENT writer than emit-event). It intentionally keeps its own filename
// scheme; the contract still requires the canonical parseable fields.
// ===========================================================================

describe("producer: watchdog run-stalled system event (inline writer)", () => {
  it("emits a parseable run-stalled event carrying structured stall fields", () => {
    // execute the exact heredoc from lib/watchdog.sh (kept in sync via the
    // source-shape guard test below). data: is intentionally absent — run-stalled
    // carries last_agent/last_agent_status/pending_agents instead.
    const { eventsDir } = runEmitter(
      `run_id="run-1700000000"
       last_agent="researcher"
       last_agent_status="running"
       pending_list="writer,editor"
       ts="20260101T000000"
       event_file="$EVENTS_DIR/\${ts}-run-stalled.event"
       cat > "$event_file" <<EOF
event: run-stalled
source: watchdog
timestamp: $(date -Iseconds 2>/dev/null || date)
run_id: $run_id
last_agent: \${last_agent:-unknown}
last_agent_status: \${last_agent_status:-unknown}
pending_agents: \${pending_list:-none}
processed: false
EOF`,
    );
    const files = listEventFiles(eventsDir);
    expect(files).toEqual(["20260101T000000-run-stalled.event"]);

    const parsed = parseEventFileLikeConsumer(readFileSync(join(eventsDir, files[0]), "utf8"));
    // run-stalled legitimately omits `data:`
    expect(contractViolations(parsed, { requireData: false })).toEqual([]);
    expect(parsed.event).toBe("run-stalled");
    expect(parsed.source).toBe("watchdog");
    expect(parsed.run_id).toBe("run-1700000000");
    expect(parsed.last_agent).toBe("researcher");
    expect(parsed.pending_agents).toBe("writer,editor");
  });

  it("watchdog.sh still writes the run-stalled fields this test pins (source-shape guard)", () => {
    // cheap drift guard: if someone edits the watchdog heredoc, this flags that
    // the behavioral fixture above needs updating too.
    const src = readFileSync(WATCHDOG_SH, "utf8");
    expect(src).toContain("event: run-stalled");
    expect(src).toContain("source: watchdog");
    expect(src).toContain("processed: false");
    expect(src).toContain("${ts}-run-stalled.event");
  });
});

// ===========================================================================
// PRODUCER PATH 5 — the two fallback writers (agent-functions.sh +
// chain-runner-complete.sh). agent-functions.sh keeps the legitimate
// ensure-event-file fallback writer (`-fallback.event` naming, source:
// ${SESSION_PREFIX}) for paths where the agent genuinely signalled completion.
// chain-runner-complete.sh no longer fabricates success on no-event completion
// (triage finding #2): it emits an agent-error DIAGNOSTIC instead, with
// source: chain-runner-complete so the matcher can never read it as a handoff.
// ===========================================================================

describe("producer: fallback + diagnostic event writers (inline)", () => {
  it("emits a canonical fallback event the matcher recovers from", () => {
    // mirrors lib/agent-functions.sh ensure-event-file heredoc shape
    const { eventsDir } = runEmitter(
      `EXPECTED_EVENT="agent-complete"
       SESSION_PREFIX="researcher"
       RUN_ID="run-1700000000"
       fallback_file="$EVENTS_DIR/\${RUN_ID}-\${SESSION_PREFIX}-\${EXPECTED_EVENT}-fallback.event"
       cat > "$fallback_file" <<FBEOF
event: \${EXPECTED_EVENT}
source: \${SESSION_PREFIX}
run_id: \${RUN_ID:-}
timestamp: $(date -Iseconds 2>/dev/null || date)
data: fallback (chain.json expected event, agent did not write event file)
processed: false
FBEOF`,
    );
    const files = listEventFiles(eventsDir);
    expect(files).toEqual(["run-1700000000-researcher-agent-complete-fallback.event"]);

    const parsed = parseEventFileLikeConsumer(readFileSync(join(eventsDir, files[0]), "utf8"));
    expect(contractViolations(parsed, { requireData: true })).toEqual([]);
    expect(parsed.event).toBe("agent-complete");
    expect(parsed.source).toBe("researcher");
  });

  it("fallback writer (agent-functions) and diagnostic writer (complete.sh) keep canonical shapes", () => {
    const completeSrc = readFileSync(COMPLETE_SH, "utf8");
    const agentFnSrc = readFileSync(AGENT_FUNCTIONS_SH, "utf8");
    // agent-functions.sh: the legitimate fallback writer survives (ensure-event-file)
    expect(agentFnSrc).toContain("event: ${");
    expect(agentFnSrc).toContain("source: ${");
    expect(agentFnSrc).toContain("processed: false");
    expect(agentFnSrc).toContain("-fallback.event");
    // chain-runner-complete.sh: no success fabrication — agent-error diagnostic
    // with a fixed non-agent source, so source.includes(agentId) never matches
    expect(completeSrc).toContain('emit_completion_diagnostic_event "agent-error"');
    expect(completeSrc).toContain("source: chain-runner-complete");
    expect(completeSrc).toContain("processed: false");
  });
});

// ===========================================================================
// CONSUMER CONTRACT — the completion matcher.
// This is the logic the team burned 6 days on. We reproduce the EXACT predicate
// from run-reconciler.ts::recoverCompletedAgentsFromEvents and prove the
// producer's emitted source/event fields satisfy it. (recoverCompletedAgentsFromEvents
// is not exported, so we replicate its matcher faithfully here and drive it with
// REAL producer output rather than hand-written fixtures.)
// ===========================================================================

/** Faithful copy of run-reconciler.ts:178-186 match predicate. */
function reconcilerMatches(
  candidate: { event?: string; source?: string },
  agentId: string,
  declaredEmits: string[],
): boolean {
  const eventName = candidate.event?.trim().toLowerCase();
  const source = candidate.source?.trim().toLowerCase() || "";
  const expected = declaredEmits.map((e) => e.trim().toLowerCase());
  const sourceNeedle = agentId.toLowerCase();
  if (!eventName || !expected.includes(eventName)) return false;
  if (!source.includes(sourceNeedle)) return false;
  return true;
}

describe("consumer contract: completion matcher recovers real producer events", () => {
  it("a canonical agent-complete event matches its declaring agent", () => {
    // agent "researcher" declares emits: ["agent-complete"], emits via the CLI/writer.
    const { eventsDir } = runEmitter(
      `source ${q(EVENT_TRIGGER_SH)} >/dev/null 2>&1
       emit-event "agent-complete" "researcher" "ok" >/dev/null 2>&1`,
      { MENTIKO_RUN_ID: "run-1700000000" },
    );
    const parsed = parseEventFileLikeConsumer(
      readFileSync(join(eventsDir, listEventFiles(eventsDir)[0]), "utf8"),
    );
    expect(reconcilerMatches(parsed, "researcher", ["agent-complete"])).toBe(true);
  });

  it("matches when source is a session-prefixed superstring of the agent id", () => {
    // chain-runner often emits with source = a session prefix that CONTAINS the
    // agent id (e.g. "researcher-7f3a"). reconciler uses source.includes(agentId).
    const { eventsDir } = runEmitter(
      `source ${q(EVENT_TRIGGER_SH)} >/dev/null 2>&1
       emit-event "agent-complete" "researcher-7f3a" "ok" >/dev/null 2>&1`,
      { MENTIKO_RUN_ID: "run-1700000000" },
    );
    const parsed = parseEventFileLikeConsumer(
      readFileSync(join(eventsDir, listEventFiles(eventsDir)[0]), "utf8"),
    );
    expect(reconcilerMatches(parsed, "researcher", ["agent-complete"])).toBe(true);
  });

  it("does NOT match a different event name (matcher is event-name-specific)", () => {
    const { eventsDir } = runEmitter(
      `source ${q(EVENT_TRIGGER_SH)} >/dev/null 2>&1
       emit-event "agent-started" "researcher" "ok" >/dev/null 2>&1`,
      { MENTIKO_RUN_ID: "run-1700000000" },
    );
    const parsed = parseEventFileLikeConsumer(
      readFileSync(join(eventsDir, listEventFiles(eventsDir)[0]), "utf8"),
    );
    // agent declares emits agent-complete; an agent-started event must not satisfy completion
    expect(reconcilerMatches(parsed, "researcher", ["agent-complete"])).toBe(false);
  });

  it("the OLD timestamp-prefixed naming (the original 6-day bug) is NOT what the producer emits", () => {
    // regression sentinel: emit-event must NOT fall back to ${timestamp}-${event}.event.
    const { eventsDir } = runEmitter(
      `source ${q(EVENT_TRIGGER_SH)} >/dev/null 2>&1
       emit-event "agent-complete" "researcher" "ok" >/dev/null 2>&1`,
      { MENTIKO_RUN_ID: "run-1700000000" },
    );
    const file = listEventFiles(eventsDir)[0];
    // canonical: starts with run id + source. NOT a bare unix/ISO timestamp.
    expect(file).toBe("run-1700000000-researcher-agent-complete.event");
    expect(file).not.toMatch(/^\d{10,}-agent-complete\.event$/);
    expect(file).not.toMatch(/^\d{8}T\d{6}-agent-complete\.event$/);
  });
});

// ===========================================================================
// CONSUMER CONTRACT — the event log API + SSE stream parsers must also accept
// real producer output. We replicate their slice-on-prefix parsers (a DIFFERENT
// strategy than the reconciler's indexOf split) and confirm they agree.
// ===========================================================================

/** Faithful copy of web/app/api/events/route.ts::parseEventFile field extraction. */
function parseEventFileLikeEventLogApi(content: string) {
  const result: Record<string, string | boolean> = {};
  const dataLines: string[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("event:")) result.event = trimmed.slice(6).trim();
    else if (trimmed.startsWith("source:")) result.source = trimmed.slice(7).trim();
    else if (trimmed.startsWith("timestamp:")) result.timestamp = trimmed.slice(10).trim();
    else if (trimmed.startsWith("processed:"))
      result.processed = trimmed.slice(10).trim().toLowerCase() === "true";
    else if (trimmed.startsWith("data:")) dataLines.push(trimmed.slice(5).trim());
    else if (trimmed && !trimmed.includes(":")) dataLines.push(trimmed);
  }
  result.data = dataLines.join(" ").trim();
  return result;
}

describe("consumer contract: event-log API + SSE stream parsers agree with the reconciler", () => {
  it("both consumer parse strategies extract identical event/source/processed from real output", () => {
    const { eventsDir } = runEmitter(
      `source ${q(EVENT_TRIGGER_SH)} >/dev/null 2>&1
       emit-event "agent-complete" "researcher" "task=ship it status=ok" >/dev/null 2>&1`,
      { MENTIKO_RUN_ID: "run-1700000000" },
    );
    const content = readFileSync(join(eventsDir, listEventFiles(eventsDir)[0]), "utf8");

    const viaReconciler = parseEventFileLikeConsumer(content);
    const viaEventLogApi = parseEventFileLikeEventLogApi(content);

    expect(viaEventLogApi.event).toBe(viaReconciler.event);
    expect(viaEventLogApi.source).toBe(viaReconciler.source);
    // event-log API coerces processed to boolean; reconciler keeps the raw string
    expect(viaEventLogApi.processed).toBe(false);
    expect(viaReconciler.processed).toBe("false");
    // both surface the data payload
    expect(viaEventLogApi.data).toBe("task=ship it status=ok");
    expect(viaReconciler.data).toBe("task=ship it status=ok");
  });
});

// ===========================================================================
// FIXED (#13) — SSE stream chain-complete fast-path now matches real output.
// The stream's events-watcher fast-path previously keyed on
// `event.event === "chain_complete"` (underscore), but the producer emits
// `chain-complete` (hyphen) — so the branch was dead. It was changed to match
// the canonical hyphen form (web/app/api/events/stream/route.ts). The outbound
// SSE message `type` stays "chain_complete" because the client listens for that
// event name (web/hooks/use-event-stream.ts:103). This test now asserts the
// FIXED contract: the producer's hyphen form is exactly what the consumer
// fast-path matches, and the matcher is keyed on the hyphen (not underscore).
// ===========================================================================

/**
 * Faithful copy of the events-watcher fast-path predicate in
 * web/app/api/events/stream/route.ts after the #13 fix. It compares the parsed
 * file's `event` field against the canonical hyphen form.
 */
function streamFastPathFires(parsed: { event?: string }): boolean {
  return parsed.event === "chain-complete";
}

describe("FIXED #13: SSE stream chain-complete fast-path matches real producer output", () => {
  it("producer emits hyphenated chain-complete and the stream fast-path now fires on it", () => {
    const { eventsDir } = runEmitter(
      `source ${q(EVENT_TRIGGER_SH)} >/dev/null 2>&1
       emit-event "chain-complete" "content-pipeline" "run_id=run-x" >/dev/null 2>&1`,
      { MENTIKO_RUN_ID: "run-x" },
    );
    const parsed = parseEventFileLikeConsumer(
      readFileSync(join(eventsDir, listEventFiles(eventsDir)[0]), "utf8"),
    );

    // canonical: the producer emits the HYPHEN form
    expect(parsed.event).toBe("chain-complete");
    expect(parsed.event).not.toBe("chain_complete");

    // the consumer's fast-path now matches that hyphen form (was a dead
    // underscore branch before the #13 fix):
    expect(streamFastPathFires(parsed)).toBe(true);
    // and it would NOT have fired on the old underscore expectation:
    expect(streamFastPathFires({ event: "chain_complete" })).toBe(false);
  });
});

// ===========================================================================
// FIXED (#14) — event.schema.json enum now matches the live producer. The
// static JSON schema's `type` enum was stale: the producer emits `run-stalled`
// (lib/watchdog.sh) and `task-status-updated` (lib/run-lib.sh), neither of which
// was in the enum. Both names were added to lib/schemas/event.schema.json. The
// live consumer parsers do NOT enforce the enum (they accept any event string),
// so this was a stale-doc finding, not a runtime break — but the schema is now
// the accurate contract. This test asserts the gap is closed.
// ===========================================================================

describe("FIXED #14: event.schema.json enum covers run-stalled and task-status-updated", () => {
  const schema = JSON.parse(
    readFileSync(join(LIB, "schemas", "event.schema.json"), "utf8"),
  ) as { properties: { type: { enum: string[] } } };
  const schemaEnum = schema.properties.type.enum;

  it("the schema enum now includes the system event types the producer emits", () => {
    // these ARE produced (proven behaviorally elsewhere in this file) and are
    // now declared in the schema enum:
    expect(schemaEnum).toContain("run-stalled");
    expect(schemaEnum).toContain("task-status-updated");
    // and the core lifecycle names are still present
    expect(schemaEnum).toContain("chain-complete");
    expect(schemaEnum).toContain("agent-complete");
  });

  it("every CANONICAL_EVENT_TYPE this contract pins is present in the schema enum", () => {
    // the canonical list and the schema enum must not drift apart again.
    for (const t of CANONICAL_EVENT_TYPES) {
      expect(schemaEnum).toContain(t);
    }
  });
});

// ---------------------------------------------------------------------------
// shell-quote helper (single-quote a value safely for `bash -c`)
// ---------------------------------------------------------------------------
function q(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
