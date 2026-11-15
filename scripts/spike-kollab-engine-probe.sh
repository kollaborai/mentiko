#!/usr/bin/env bash
# Spike probe: drive one Mentiko-style agent turn through kollabor_engine
# (claude-code over ACP) instead of a PTY. Findings: docs/spike-kollab-engine-driver.md
#
# Run from anywhere. Creates its own engine on a free port with a private
# KOLLAB_CONFIG_DIR, runs a turn that writes an event file + AGENT_COMPLETE,
# then stops the engine. Never touches engines on 7433/7443.
#
# NOTE: the engine MUST come from the kollab repo venv (editable install).
# The pip site-packages kollabor-engine (0.18.5) ignores KOLLAB_CONFIG_DIR
# and clobbers the shared ~/.kollab/engine.token on startup.

set -euo pipefail

KOLLAB_VENV_PY="${KOLLAB_VENV_PY:-/Users/malmazan/dev/kollab/.venv/bin/python}"
WORK="${WORK:-$HOME/backups/glm-kollab-spike-work}"
PORT="${PORT:-7453}"
CFG="$WORK/kcfg"
WS="$WORK/scratch-ws"

mkdir -p "$CFG" "$WS/events"

if ! /usr/bin/grep -q KOLLAB_CONFIG_DIR "$KOLLAB_VENV_PY" 2>/dev/null; then :; fi

echo "== starting engine on :$PORT (private config dir $CFG)"
KOLLAB_CONFIG_DIR="$CFG" "$KOLLAB_VENV_PY" -m kollabor_engine serve --port "$PORT" \
  > "$WORK/logs/engine-$PORT.log" 2>&1 &
ENGINE_PID=$!
trap 'kill $ENGINE_PID 2>/dev/null || true' EXIT
until curl -sf -o /dev/null "http://127.0.0.1:$PORT/health"; do sleep 1; done
TOK=$(cat "$CFG/engine.token")   # never echo $TOK
AUTH="Authorization: Bearer $TOK"
BASE="http://127.0.0.1:$PORT"

echo "== profiles (expect a claude-code / acp entry)"
curl -s -H "$AUTH" "$BASE/profiles" | python3 -c 'import json,sys; [print(p["name"], p["provider"]) for p in json.load(sys.stdin)["profiles"]]'

echo "== create session (claude-code over ACP, event-file + AGENT_COMPLETE turn)"
SID=$(curl -s -X POST "$BASE/sessions" -H "$AUTH" -H "Content-Type: application/json" \
  -d "{\"profile\":\"claude-code\",\"workspace\":\"$WS\"}" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["session_id"])')
echo "session: $SID"

echo "== send turn, capture SSE"
curl -sN -X POST "$BASE/sessions/$SID/message" -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"content":"Write the file events/test_done.event in the current workspace with exactly this JSON body: {\"status\":\"done\",\"spike\":\"kollab-engine\"}. Use a single shell command, do not read it back. Then reply with the single line AGENT_COMPLETE and nothing else."}' \
  -o "$WORK/logs/spike-turn.sse"

echo "== event file written?"
cat "$WS/events/test_done.event"; echo

echo "== turn result"
python3 - "$WORK/logs/spike-turn.sse" <<'EOF'
import json, sys
from collections import Counter
types = []
for line in open(sys.argv[1]):
    if line.startswith("data: "):
        d = json.loads(line[6:])
        types.append(d["type"])
        if d["type"] == "turn_complete":
            print("stop_reason:", d.get("stop_reason"))
print("event types:", dict(Counter(types)))
EOF

echo "== nudge: second message on the same session (mid-turn or after, both accepted)"
curl -sN -X POST "$BASE/sessions/$SID/message" -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"content":"Reply with the single word ACK and stop."}' -o "$WORK/logs/spike-turn2.sse"

echo "== teardown"
curl -s -X DELETE "$BASE/sessions/$SID" -H "$AUTH"
echo
echo "engine log tail:"; tail -3 "$WORK/logs/engine-$PORT.log"
