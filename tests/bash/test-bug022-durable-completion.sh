#!/bin/bash
# Typed monitor retirement boundary regression.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
AGENT_FUNCTIONS="$PROJECT_ROOT/lib/agent-functions.sh"
CHAIN_RUNNER="$PROJECT_ROOT/lib/chain-runner.sh"
MONITOR_RUNTIME="$PROJECT_ROOT/lib/monitor-v2.js"
forbidden='monitor-chain-agent|monitor-with-ai|agent-completion-latched|_monitor_emit_diagnostic_event|monitor-agent-died|monitor-agent-stalled'
if grep -Eq "$forbidden" "$AGENT_FUNCTIONS"; then
  echo "FAIL: agent-functions retains shell monitor ownership"
  exit 1
fi
[[ -s "$MONITOR_RUNTIME" ]] || { echo "FAIL: compiled typed monitor runtime missing"; exit 1; }
grep -Fq 'exec node "\$_monitor_v2_script"' "$CHAIN_RUNNER" || { echo "FAIL: routed chain runner does not exec typed monitor"; exit 1; }
if grep -q 'monitor-chain-agent' "$CHAIN_RUNNER"; then
  echo "FAIL: routed chain runner retains shell monitor fallback"
  exit 1
fi
echo "PASS: shell monitor APIs retired; routed launch executes compiled TypeScript monitor"
