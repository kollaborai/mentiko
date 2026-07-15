#!/bin/bash
# metrics.sh - primitive shell adapter for the typed legacy metrics contract.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.sh"
_metrics_cli() { node "$SCRIPT_DIR/runner-legacy-metrics.js" "$@"; }
metric-start-timer() { _metrics_cli start "$1"; }
metric-end-timer() { _metrics_cli end "$1" "${2:-agent}"; }
metric-counter() { _metrics_cli counter "$1" "${2:-1}"; }
metric-gauge() { _metrics_cli gauge "$1" "$2"; }
metric-webhook() { _metrics_cli webhook "$1" "$2" "${3:-0}"; }
get-metrics-json() { _metrics_cli json; }
get-prometheus-metrics() { _metrics_cli prometheus; }
reset-metrics() { _metrics_cli reset; }
show-metrics() { _metrics_cli show; }
export -f _metrics_cli metric-start-timer metric-end-timer metric-counter metric-gauge metric-webhook get-metrics-json get-prometheus-metrics reset-metrics show-metrics
