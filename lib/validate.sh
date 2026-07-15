#!/bin/bash
# validate.sh - invocation-only boundary for the typed chain validator.

set -euo pipefail

CHAIN="${1:-}"
STRICT="${2:-}"

if [[ -z "$CHAIN" ]]; then
    echo "error: no chain file specified" >&2
    exit 1
fi

exec node "${MENTIKO_CODE_ROOT:?MENTIKO_CODE_ROOT must be configured}/lib/runner-chain-validation.js" "$CHAIN" "$STRICT"
