#!/bin/bash
# Compatibility entrypoint only. The typed standalone launcher owns spec
# parsing, session identity, PTY orchestration, prompt delivery, state, and
# monitor lifecycle. No shell fallback exists.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$SCRIPT_DIR/runner-v2-standalone-agent-launch.js" "$@"
