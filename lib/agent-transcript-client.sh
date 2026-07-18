#!/usr/bin/env bash
# Minimal shell-to-TypeScript runner agent-transcript invocation boundary.
#
# The transcript/provenance contract (root resolution, identity-bound UUID
# selection, assistant-marker validation, ambiguity handling) is owned by
# web/lib/runner-v2/agent-transcript.ts via lib/runner-agent-transcript.js.
# The shell only forwards the pty capture on stdin plus primitive identity
# arguments. There is no shell fallback: a missing node or bundle fails closed
# so completion waits for the declared event file.

_agent_transcript_cli() {
  local cli="${MENTIKO_CODE_ROOT:?MENTIKO_CODE_ROOT must be configured}/lib/runner-agent-transcript.js"
  if ! command -v node >/dev/null 2>&1; then
    echo "  mentiko: node is required for typed runner agent transcript" >&2
    return 1
  fi
  if [[ ! -f "$cli" ]]; then
    echo "  mentiko: typed runner-agent-transcript bundle missing: $cli" >&2
    return 1
  fi
  node "$cli" "$@"
}

# Build the primitive identity arguments the typed boundary scores a candidate
# transcript against. Only anchors the shell actually holds are forwarded; the
# typed owner fails closed when none are present rather than guessing. Keep this
# Bash 3.2-compatible: macOS's /bin/bash has no nameref (`local -n`). Callers
# copy the result from the private array immediately after this function returns.
_AGENT_TRANSCRIPT_IDENTITY_ARGS=()
_agent_transcript_identity_args() {
  _AGENT_TRANSCRIPT_IDENTITY_ARGS=()
  [[ -n "${MENTIKO_AGENT_PROFILE_PATH:-}" ]] && _AGENT_TRANSCRIPT_IDENTITY_ARGS+=(--profile-path "$MENTIKO_AGENT_PROFILE_PATH")
  [[ -n "${MENTIKO_TRANSCRIPT_JSONL:-}" ]] && _AGENT_TRANSCRIPT_IDENTITY_ARGS+=(--explicit-jsonl "$MENTIKO_TRANSCRIPT_JSONL")
  local run_id="${MENTIKO_RUN_ID:-${RUN_ID:-}}"
  [[ -n "$run_id" ]] && _AGENT_TRANSCRIPT_IDENTITY_ARGS+=(--run-id "$run_id")
  [[ -n "${MENTIKO_TRANSCRIPT_WORKSPACE:-${CHAIN_PROJECT_ROOT:-}}" ]] \
    && _AGENT_TRANSCRIPT_IDENTITY_ARGS+=(--workspace "${MENTIKO_TRANSCRIPT_WORKSPACE:-${CHAIN_PROJECT_ROOT}}")
  [[ -n "${MENTIKO_TRANSCRIPT_ATTEMPT_STARTED_AT:-}" ]] \
    && _AGENT_TRANSCRIPT_IDENTITY_ARGS+=(--attempt-started-at "$MENTIKO_TRANSCRIPT_ATTEMPT_STARTED_AT")
  [[ -n "${MENTIKO_TRANSCRIPT_INSTRUCTION_PATH:-}" ]] \
    && _AGENT_TRANSCRIPT_IDENTITY_ARGS+=(--instruction-path "$MENTIKO_TRANSCRIPT_INSTRUCTION_PATH")
  return 0
}

export -f _agent_transcript_cli
export -f _agent_transcript_identity_args
