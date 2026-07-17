#!/bin/bash
# Coordinator delegates typed group lifecycle; launcher retains only external agent processes.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/parallel-launcher.sh" "$@"
