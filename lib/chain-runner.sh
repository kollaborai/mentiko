#!/bin/bash
# Compatibility filename for integrations that still invoke chain-runner.sh.
# The typed direct-run CLI owns parsing, validation, run records, PTY startup,
# readiness, instructions, task context, monitor launch, and lifecycle state.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$SCRIPT_DIR/runner-v2-direct-run.js" "$@"
