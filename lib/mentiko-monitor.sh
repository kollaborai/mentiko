#!/bin/bash
# mentiko-monitor.sh - Profile-aware agent monitor
#
# usage:
#   mentiko-monitor <agent-session-name> "expected end state description"
#   mentiko-monitor <agent-session-name> "expected end state" [profile] [interval]
#
# examples:
#   mentiko-monitor gaia-migration-1 "all pages updated to gaia design system"
#   mentiko-monitor PhaseB-types "typescript types created in web/lib/types.ts"
#   mentiko-monitor fix-build "npm run build passes with 0 errors" mentiko 30
#
# profiles live in lib/monitor-profiles/*.md
# default profile: mentiko

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/session-transport.sh"

# -------------------------------------------------------------------
# args
# -------------------------------------------------------------------
SESSION_NAME="${1:-}"
END_STATE="${2:-}"
PROFILE_NAME="${3:-mentiko}"
CHECK_INTERVAL="${4:-60}"

if [[ -z "$SESSION_NAME" ]]; then
    echo "  usage: mentiko-monitor <session-name> \"end state\" [profile] [interval]"
    echo ""
    echo "  profiles:"
    for p in "$SCRIPT_DIR"/monitor-profiles/*.md; do
        [[ -f "$p" ]] && echo "    $(basename "$p" .md)"
    done
    echo ""
    echo "  examples:"
    echo "    mentiko-monitor my-agent \"build passes with 0 errors\""
    echo "    mentiko-monitor my-agent \"all tests green\" mentiko 30"
    exit 1
fi

if [[ -z "$END_STATE" ]]; then
    echo "  error: end state required"
    echo "  usage: mentiko-monitor <session-name> \"what success looks like\""
    exit 1
fi

# -------------------------------------------------------------------
# load profile
# -------------------------------------------------------------------
PROFILE_FILE="$SCRIPT_DIR/monitor-profiles/${PROFILE_NAME}.md"
if [[ ! -f "$PROFILE_FILE" ]]; then
    echo "  error: profile '$PROFILE_NAME' not found"
    echo "  available:"
    for p in "$SCRIPT_DIR"/monitor-profiles/*.md; do
        [[ -f "$p" ]] && echo "    $(basename "$p" .md)"
    done
    exit 1
fi

PROFILE_CONTENT=$(cat "$PROFILE_FILE")

# -------------------------------------------------------------------
# cli detection
# -------------------------------------------------------------------
MENTIKO_CLI="${MENTIKO_CLI:-claude}"
if ! command -v "$MENTIKO_CLI" &> /dev/null; then
    echo "  error: $MENTIKO_CLI not found. set MENTIKO_CLI"
    exit 1
fi

# -------------------------------------------------------------------
# state tracking
# -------------------------------------------------------------------
STATE_DIR="$HOME/.mentiko_monitor"
mkdir -p "$STATE_DIR"

STATE_FILE="$STATE_DIR/${SESSION_NAME}_state"
STALE_FILE="$STATE_DIR/${SESSION_NAME}_stale"
LOG_FILE="$STATE_DIR/${SESSION_NAME}_log"

# nudge budget: stop nudging the session after this many consecutive stale cycles,
# so an unattended monitor can't spam keystrokes + burn advisor tokens overnight.
# It keeps watching (AGENT_COMPLETE is still detected) — only the nudging stops.
# This is the STANDALONE monitor (the `mentiko monitor` CLI command); the chain
# path uses monitor-chain-agent, not this. 0 = unbounded (prior behavior). Raise
# via MENTIKO_MONITOR_MAX_STALE for long manual runs.
MAX_STALE_COUNT="${MENTIKO_MONITOR_MAX_STALE:-10}"

echo "0" > "$STALE_FILE"

# -------------------------------------------------------------------
# session check (retry to handle race with agent launch)
# -------------------------------------------------------------------
RETRIES=0
while ! transport_has_session "$SESSION_NAME" 2>/dev/null; do
    RETRIES=$((RETRIES + 1))
    if [[ $RETRIES -ge 10 ]]; then
        echo "  error: session '$SESSION_NAME' not found after 30s"
        echo "  active sessions:"
        transport_list_sessions 2>/dev/null | head -10
        exit 1
    fi
    echo "  waiting for session '$SESSION_NAME'... ($RETRIES/10)"
    sleep 3
done

# -------------------------------------------------------------------
# banner
# -------------------------------------------------------------------
echo ""
echo "  mentiko-monitor v1.0"
echo "  ─────────────────────────────────────"
echo "  session:   $SESSION_NAME"
echo "  profile:   $PROFILE_NAME"
echo "  interval:  ${CHECK_INTERVAL}s"
echo "  end state: $END_STATE"
echo "  log:       $LOG_FILE"
echo "  ─────────────────────────────────────"
echo ""

# init log
echo "$(date -Iseconds) monitor started for $SESSION_NAME" > "$LOG_FILE"
echo "  end state: $END_STATE" >> "$LOG_FILE"
echo "  profile: $PROFILE_NAME" >> "$LOG_FILE"
echo "---" >> "$LOG_FILE"

# -------------------------------------------------------------------
# initial state snapshot
# -------------------------------------------------------------------
CURRENT_HASH=$(transport_capture "$SESSION_NAME" 20 | md5sum | cut -d' ' -f1)
echo "$CURRENT_HASH" > "$STATE_FILE"

# -------------------------------------------------------------------
# main loop
# -------------------------------------------------------------------
while true; do
    sleep "$CHECK_INTERVAL"

    # session still alive?
    if ! transport_has_session "$SESSION_NAME" 2>/dev/null; then
        echo "$(date '+%H:%M:%S') session gone. stopping."
        echo "$(date -Iseconds) session terminated" >> "$LOG_FILE"
        rm -f "$STATE_FILE" "$STALE_FILE"
        break
    fi

    # grab recent output
    RECENT_OUTPUT=$(transport_capture "$SESSION_NAME" 500 2>/dev/null)
    LAST_50=$(echo "$RECENT_OUTPUT" | tail -50)
    LAST_40=$(echo "$RECENT_OUTPUT" | tail -40)
    LAST_20=$(echo "$RECENT_OUTPUT" | tail -20)

    # ---------------------------------------------------------------
    # COMPLETION DETECTION PROTOCOL:
    #
    # 1. hash the last 20 lines of output to detect activity
    # 2. if hash changed since last poll → agent is actively working
    #    → do nothing, let it cook
    # 3. if hash is STABLE (same as last poll) → agent is idle
    #    → NOW check last 50 lines for AGENT_COMPLETE
    #    → if found: agent finished, trigger handoff
    #    → if NOT found: agent is stalled, send nudge via pty
    #
    # WHY NOT grep the full buffer?
    # The agent's PROMPT contains "output AGENT_COMPLETE" as an
    # instruction. Grepping 500 lines matches this instruction text
    # BEFORE the agent finishes, causing false positive completions.
    # Only checking last ~50 lines after idle ensures we match the
    # agent's actual output, not the prompt.
    #
    # HOW IDLE DETECTION WORKS:
    # - claude doesn't exit on context exhaustion, it sits at the
    #   prompt waiting for input. p alive is always true.
    # - the ONLY reliable signal is output hash comparison:
    #   hash changing = working, hash stable = idle at prompt
    # - after idle detected + no AGENT_COMPLETE: send keys to pty
    #   to nudge agent to write event file and output completion
    # ---------------------------------------------------------------

    # hash check: is the agent actively working?
    NEW_HASH=$(echo "$LAST_40" | head -20 | md5sum | cut -d' ' -f1)
    OLD_HASH=""
    [[ -f "$STATE_FILE" ]] && OLD_HASH=$(cat "$STATE_FILE")

    if [[ "$NEW_HASH" != "$OLD_HASH" ]]; then
        # output changed → agent is active, reset stale counter
        echo "$NEW_HASH" > "$STATE_FILE"
        echo "0" > "$STALE_FILE"
        echo "$(date '+%H:%M:%S') - active"
        continue
    fi

    # hash stable → agent is idle. check last 50 lines for completion.
    # wider window because claude outputs thinking/crunching chrome + prompt
    # decorations AFTER AGENT_COMPLETE, pushing it past a 20-line window.
    if echo "$LAST_50" | grep -q "AGENT_COMPLETE"; then
        echo "$(date '+%H:%M:%S') - AGENT_COMPLETE detected"
        echo "$(date -Iseconds) AGENT_COMPLETE" >> "$LOG_FILE"

        # trigger completion handler if available
        PROJECT_ROOT="${MENTIKO_GLOBAL_ROOT:-$HOME/.mentiko}"
        if [[ -f "$SCRIPT_DIR/agent-functions.sh" ]]; then
            source "$SCRIPT_DIR/agent-functions.sh" 2>/dev/null
            if declare -f ensure-event-file >/dev/null 2>/dev/null; then
                ensure-event-file "$SESSION_NAME" "end state: $END_STATE" "$PROJECT_ROOT"
            fi
        fi

        # kill the agent session
        sleep 2
        if transport_has_session "$SESSION_NAME" 2>/dev/null; then
            transport_kill_session "$SESSION_NAME"
            echo "  killed agent session: $SESSION_NAME"
            echo "$(date -Iseconds) killed session" >> "$LOG_FILE"
        fi

        rm -f "$STATE_FILE" "$STALE_FILE"
        echo "  done. agent completed and session cleaned up."
        break
    fi

    # idle but no AGENT_COMPLETE → agent is stalled
    STALE_COUNT=$(cat "$STALE_FILE")
    STALE_COUNT=$((STALE_COUNT + 1))
    echo "$STALE_COUNT" > "$STALE_FILE"

    # nudge budget: past the cap, keep watching for AGENT_COMPLETE but stop nudging
    # (no more advisor calls, no more keystrokes typed into the session) so an
    # unattended standalone monitor cannot run the terminal forever.
    if [[ "$MAX_STALE_COUNT" -gt 0 && "$STALE_COUNT" -ge "$MAX_STALE_COUNT" ]]; then
        if [[ "$STALE_COUNT" -eq "$MAX_STALE_COUNT" ]]; then
            echo "$(date '+%H:%M:%S') stale x${STALE_COUNT}: nudge budget (${MAX_STALE_COUNT}) exhausted; watching without nudging."
            echo "$(date -Iseconds) nudge budget exhausted at x${STALE_COUNT}" >> "$LOG_FILE"
        fi
        continue
    fi

    echo "$(date '+%H:%M:%S') stale x${STALE_COUNT}. nudging..."
    echo "$(date -Iseconds) stale x${STALE_COUNT}" >> "$LOG_FILE"

        # ---------------------------------------------------------------
        # capture agent pane: top (task context) + bottom (current state)
        # pty-manager scrollback: 5000 lines, grab full buffer then slice
        # ---------------------------------------------------------------
        FULL_PANE=$(transport_capture "$SESSION_NAME" 2>/dev/null)
        TOTAL_LINES=$(echo "$FULL_PANE" | wc -l | tr -d ' ')

        # top 150 lines = what the agent was told to do (task, spec, initial prompt)
        PANE_TOP=$(echo "$FULL_PANE" | head -150)
        # bottom 400 lines = where they're at now (recent work, errors, current state)
        PANE_BOTTOM=$(echo "$FULL_PANE" | tail -400)

        # ---------------------------------------------------------------
        # build prompt: pane context first, profile at the BOTTOM
        # (LLM weights the end of prompt heaviest)
        # ---------------------------------------------------------------
        NUDGE_PROMPT="AGENT SESSION CAPTURE (${TOTAL_LINES} total lines)

== TOP OF SESSION (task assignment, first 150 lines) ==
${PANE_TOP}

== BOTTOM OF SESSION (current state, last 400 lines) ==
${PANE_BOTTOM}

== END OF CAPTURE ==

---

MONITORING CONTEXT:
- Session: ${SESSION_NAME}
- Stale count: ${STALE_COUNT} (no output change in $((STALE_COUNT * CHECK_INTERVAL))+ seconds)
- Expected end state: ${END_STATE}

---

${PROFILE_CONTENT}

---

Now output exactly ONE message as Mentiko would send it. Nothing else."

        # send assembled prompt to LLM
        # pass full prompt as -p arg (pane context + monitoring + profile)
        # allow up to 10 lines for exit checklist messages
        NUDGE=$($MENTIKO_CLI -p "$NUDGE_PROMPT" 2>/dev/null | head -10)

        # fallback if LLM returned nothing
        if [[ -z "$NUDGE" ]]; then
            if [[ "$STALE_COUNT" -le 2 ]]; then
                NUDGE="Resume only the current assigned task. If it is complete, write any required artifacts, run your completion command (mentiko emit), and make the final non-empty line exactly AGENT_COMPLETE."
            elif [[ "$STALE_COUNT" -le 4 ]]; then
                NUDGE="You look stalled. State the blocker in one sentence, then continue the assigned task or, if done, write your required artifacts, run your completion command (mentiko emit), and finish with AGENT_COMPLETE."
            else
                NUDGE="Stop waiting. Finish only the assigned task: write required artifacts, run your completion command (mentiko emit), and make your final non-empty line exactly AGENT_COMPLETE. Do not hand-write event files."
            fi
        fi

        # clean up: remove wrapping quotes, trim to reasonable length
        NUDGE=$(echo "$NUDGE" | sed 's/^"//;s/"$//' | sed "s/^'//;s/'$//")
        NUDGE_LOWER=$(printf '%s' "$NUDGE" | tr '[:upper:]' '[:lower:]' | tr '\r\n\t' '   ' | sed 's/[[:space:]]\+/ /g;s/^[[:space:]]*//;s/[[:space:]]*$//')
        if [[ -z "$NUDGE_LOWER" ]] || printf '%s\n' "$NUDGE_LOWER" | grep -Eq '^(proceed|continue|go|k|ok|yes|y)([[:space:]]+(proceed|continue|go|k|ok|yes|y))*[.!]*$'; then
            NUDGE="Resume only the current assigned task. If it is complete, write any required artifacts, run your completion command (mentiko emit), and make the final non-empty line exactly AGENT_COMPLETE."
        fi

        echo "  -> $NUDGE"
        echo "  nudge: $NUDGE" >> "$LOG_FILE"

        # send to the agent session
        transport_send_raw "$SESSION_NAME" "$NUDGE"
        sleep 1
        transport_send_raw "$SESSION_NAME" $'\r'
        sleep 0.5

    echo "$NEW_HASH" > "$STATE_FILE"
done

echo ""
echo "  mentiko-monitor finished for $SESSION_NAME"
echo "  log: $LOG_FILE"
