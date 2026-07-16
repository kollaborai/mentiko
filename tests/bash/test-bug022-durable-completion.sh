#!/bin/bash
# test-bug022-durable-completion.sh
#
# BUG-022: a UI attach resizes the pty and re-wraps the instruction echo
# ("...make the final non-empty line exactly AGENT_COMPLETE.") so a standalone
# "AGENT_COMPLETE" line appears on the RENDERED screen while the agent is still
# working. The old monitor false-latched off that screen text and synthesized
# the declared emits event off it (2026-07-04 incident, a9b4cbf).
#
# The fix requires DURABLE evidence — the marker in the agent's session
# transcript JSONL (never re-wrapped) — before latching completion. Completion
# never creates a missing declared event; that path fails closed downstream.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# The functions under test now forward transcript resolution to the typed
# runner-agent-transcript boundary.  Load that invocation-only helper explicitly
# because this test intentionally extracts selected agent-functions.sh methods
# instead of sourcing the whole daemon-starting file.
export MENTIKO_CODE_ROOT="$PROJECT_ROOT"
source "$PROJECT_ROOT/lib/agent-transcript-client.sh"

# strip-terminal-control (used by agent-complete-marker-seen) lives in a pure lib.
source "$PROJECT_ROOT/lib/terminal-sanitize.sh"

# Load ONLY the functions under test — sourcing agent-functions.sh whole would
# try to start the pty daemon and require the CLI binary. Extract by function
# range instead (each closes with a column-0 brace).
extract_fn() { sed -n "/^$1() {/,/^}/p" "$PROJECT_ROOT/lib/agent-functions.sh"; }
eval "$(extract_fn 'agent-complete-marker-seen')"
eval "$(extract_fn '_agent_transcript_jsonl')"
eval "$(extract_fn 'agent-complete-marker-durable')"
eval "$(extract_fn 'agent-completion-latched')"

TMP_DIR="$(mktemp -d)"
trap 'rm -r "$TMP_DIR"' EXIT

# transport_capture stub: returns the "rendered screen" fixture set per-case.
SCREEN_FIXTURE=""
transport_capture() { printf '%s\n' "$SCREEN_FIXTURE"; }

PASS=0
FAIL=0
ok()   { echo "PASS: $1"; PASS=$((PASS + 1)); }
bad()  { echo "FAIL: $1"; FAIL=$((FAIL + 1)); }

# ---- transcript fixtures --------------------------------------------------

# real completion: the agent's OWN (assistant) output ends with a standalone
# marker line (claude transcript shape).
CLAUDE_DONE="$TMP_DIR/claude-done.jsonl"
{
  printf '%s\n' '{"type":"user","message":{"role":"user","content":"Resume the task and make the final non-empty line exactly AGENT_COMPLETE."}}'
  printf '%s\n' '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Wrote the report.\n\nAGENT_COMPLETE"}]}}'
} > "$CLAUDE_DONE"

# codex transcript shape (role-tagged message with content[].text).
CODEX_DONE="$TMP_DIR/codex-done.jsonl"
{
  printf '%s\n' '{"type":"message","role":"user","content":[{"type":"text","text":"finish with AGENT_COMPLETE."}]}'
  printf '%s\n' '{"type":"message","role":"assistant","content":[{"type":"text","text":"done\nAGENT_COMPLETE"}]}'
} > "$CODEX_DONE"

# still-working agent: only the pasted INSTRUCTION exists (user role, marker mid
# sentence with a trailing period). This is exactly what the re-wrapped screen
# echoes — the transcript must NOT count it as completion.
ECHO_ONLY="$TMP_DIR/echo-only.jsonl"
{
  printf '%s\n' '{"type":"user","message":{"role":"user","content":"make the final non-empty line exactly AGENT_COMPLETE."}}'
  printf '%s\n' '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Working on it, still editing files."}]}}'
} > "$ECHO_ONLY"

# the re-wrapped rendered screen: the instruction echo split so AGENT_COMPLETE
# lands alone. agent-complete-marker-seen (screen) MUST see it; the durable
# check MUST reject it.
REWRAP_SCREEN=$'the final non-empty line exactly\nAGENT_COMPLETE\n.'

# ---- durable marker check -------------------------------------------------

if MENTIKO_TRANSCRIPT_JSONL="$CLAUDE_DONE" agent-complete-marker-durable "sess"; then
  ok "durable marker: standalone AGENT_COMPLETE in assistant output (claude shape) latches"
else
  bad "durable marker: standalone AGENT_COMPLETE in assistant output (claude shape) latches"
fi

if MENTIKO_TRANSCRIPT_JSONL="$CODEX_DONE" agent-complete-marker-durable "sess"; then
  ok "durable marker: assistant output marker detected in codex transcript shape"
else
  bad "durable marker: assistant output marker detected in codex transcript shape"
fi

if MENTIKO_TRANSCRIPT_JSONL="$ECHO_ONLY" agent-complete-marker-durable "sess"; then
  bad "durable marker: instruction echo (user role, trailing period) must NOT count"
else
  ok "durable marker: instruction echo (user role, trailing period) must NOT count"
fi

if MENTIKO_TRANSCRIPT_JSONL="$TMP_DIR/does-not-exist.jsonl" agent-complete-marker-durable "sess"; then
  bad "durable marker: unresolvable transcript fails closed (returns non-zero)"
else
  ok "durable marker: unresolvable transcript fails closed (returns non-zero)"
fi

# ---- monitor latch (BUG-022 monitor gap) ----------------------------------

STATE_DIR="$TMP_DIR/state"
mkdir -p "$STATE_DIR"

# re-wrapped screen shows the marker, but the transcript has only the echo:
# the latch MUST NOT fire (this is the still-working agent BUG-022 wedged).
SCREEN_FIXTURE="$REWRAP_SCREEN"
if MENTIKO_TRANSCRIPT_JSONL="$ECHO_ONLY" \
   agent-completion-latched "sess" "$STATE_DIR/sess_complete" "" "" ""; then
  bad "monitor latch: re-wrapped screen marker without durable evidence must NOT latch"
else
  ok "monitor latch: re-wrapped screen marker without durable evidence must NOT latch"
fi
if [[ -f "$STATE_DIR/sess_complete" ]]; then
  bad "monitor latch: false screen marker must not write the completion latch file"
else
  ok "monitor latch: false screen marker must not write the completion latch file"
fi

# real completion: screen marker AND durable transcript marker -> latch fires.
SCREEN_FIXTURE="$REWRAP_SCREEN"
if MENTIKO_TRANSCRIPT_JSONL="$CLAUDE_DONE" \
   agent-completion-latched "sess" "$STATE_DIR/sess2_complete" "" "" ""; then
  ok "monitor latch: screen marker confirmed by durable transcript latches completion"
else
  bad "monitor latch: screen marker confirmed by durable transcript latches completion"
fi
if [[ -f "$STATE_DIR/sess2_complete" ]]; then
  ok "monitor latch: confirmed completion writes the sticky latch file"
else
  bad "monitor latch: confirmed completion writes the sticky latch file"
fi

# sanity: agent-complete-marker-seen alone DOES see the re-wrapped screen marker
# (proves the durable gate — not a screen-scan miss — is what rejects the false
# latch above).
SCREEN_FIXTURE="$REWRAP_SCREEN"
if agent-complete-marker-seen "sess"; then
  ok "screen scan: re-wrapped screen genuinely presents a standalone marker (durable gate is doing the work)"
else
  bad "screen scan: re-wrapped screen genuinely presents a standalone marker (durable gate is doing the work)"
fi

# ---- no missing-event synthesis (BUG-022 completion gap) -------------------

if grep -q '^ensure-event-file()' "$PROJECT_ROOT/lib/agent-functions.sh"; then
  bad "no-fabrication contract: legacy missing-event synthesizer must stay removed"
else
  ok "no-fabrication contract: legacy missing-event synthesizer stays removed"
fi
if find "$TMP_DIR" -name '*.event' -type f 2>/dev/null | grep -q .; then
  bad "no-fabrication contract: durable or rendered marker checks must not write events"
else
  ok "no-fabrication contract: durable or rendered marker checks do not write events"
fi

# ---- transcript resolution: decoy-UUID resilience -------------------------
# A capture routinely holds MORE than one UUID: the real transcript/session UUID
# in the CLI status bar, plus decoys the agent's goal/prompt echoed earlier (a
# decision_id, a task id). The old `head -1` stopped at the first (a decoy with
# no file) and never found the durable marker, hanging completion. Resolution
# must scan every UUID and accept the first that maps to a real transcript file.
RESOLVE_HOME="$TMP_DIR/resolve-home"
mkdir -p "$RESOLVE_HOME/.claude/projects/proj"
REAL_UUID="9c775526-1481-48dd-99cb-bc8da80d47bc"
DECOY_UUID="c11fb05f-fdf5-43ba-b76c-dd4f28c4d7a0"   # decision_id shape, no transcript file
REAL_TRANSCRIPT="$RESOLVE_HOME/.claude/projects/proj/${REAL_UUID}.jsonl"
RESOLVE_WORKSPACE="$RESOLVE_HOME/workspace"
mkdir -p "$RESOLVE_WORKSPACE"
# Live identity-bound resolution needs at least one current-run anchor.  Give
# this synthetic transcript the same session UUID and workspace metadata that a
# real CLI transcript records; a profile path alone must now fail closed.
printf '%s\n' \
  "{\"type\":\"assistant\",\"sessionId\":\"$REAL_UUID\",\"cwd\":\"$RESOLVE_WORKSPACE\",\"timestamp\":\"2026-07-15T12:00:00.000Z\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"Wrote the report.\\n\\nAGENT_COMPLETE\"}]}}" \
  > "$REAL_TRANSCRIPT"
RESOLVE_PROFILE="$TMP_DIR/resolve-profile.json"
printf '{"cli":"claude","log_path":"~/.claude/projects"}\n' > "$RESOLVE_PROFILE"
RESOLVE_ATTEMPT_STARTED_AT="2026-07-15T11:59:00.000Z"

# decoy appears FIRST in the scrollback, real UUID last (status-bar shape).
SCREEN_FIXTURE=$"DECISION_ID: ${DECOY_UUID}"$'\n''...scroll...'$'\n'"bypass permissions ${REAL_UUID}  104416 tokens"
resolved="$(HOME="$RESOLVE_HOME" MENTIKO_AGENT_PROFILE_PATH="$RESOLVE_PROFILE" MENTIKO_TRANSCRIPT_WORKSPACE="$RESOLVE_WORKSPACE" MENTIKO_TRANSCRIPT_ATTEMPT_STARTED_AT="$RESOLVE_ATTEMPT_STARTED_AT" _agent_transcript_jsonl 'sess')"
if [[ "$resolved" == "$REAL_TRANSCRIPT" ]]; then
  ok "transcript resolution: skips a decoy UUID (first in capture) and resolves the real transcript file"
else
  bad "transcript resolution: skips a decoy UUID (first in capture) and resolves the real transcript file (got: '${resolved:-<empty>}')"
fi

# durable-marker completion works end-to-end when a decoy precedes the real UUID.
if HOME="$RESOLVE_HOME" MENTIKO_AGENT_PROFILE_PATH="$RESOLVE_PROFILE" MENTIKO_TRANSCRIPT_WORKSPACE="$RESOLVE_WORKSPACE" MENTIKO_TRANSCRIPT_ATTEMPT_STARTED_AT="$RESOLVE_ATTEMPT_STARTED_AT" agent-complete-marker-durable 'sess'; then
  ok "durable marker: latches through a decoy-then-real UUID capture (regression: decision-chain completion hang)"
else
  bad "durable marker: latches through a decoy-then-real UUID capture (regression: decision-chain completion hang)"
fi

# only a decoy present (no matching transcript file) -> unresolved, fail closed.
SCREEN_FIXTURE=$"DECISION_ID: ${DECOY_UUID} only"
resolved="$(HOME="$RESOLVE_HOME" MENTIKO_AGENT_PROFILE_PATH="$RESOLVE_PROFILE" MENTIKO_TRANSCRIPT_WORKSPACE="$RESOLVE_WORKSPACE" MENTIKO_TRANSCRIPT_ATTEMPT_STARTED_AT="$RESOLVE_ATTEMPT_STARTED_AT" _agent_transcript_jsonl 'sess')"
if [[ -z "$resolved" ]]; then
  ok "transcript resolution: a decoy-only capture resolves to nothing (fails closed, no mis-resolve)"
else
  bad "transcript resolution: a decoy-only capture resolves to nothing (got: '$resolved')"
fi

echo ""
echo "passed: $PASS  failed: $FAIL"
[[ "$FAIL" -eq 0 ]]
