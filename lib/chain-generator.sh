#!/bin/bash
# chain-generator.sh - invocation-only boundary for the typed chain generator.
#
# The external model CLI remains a child process of the compiled TypeScript
# contract. This file intentionally does not parse, validate, or write chain
# data; it exists for the legacy `mentiko generate` command boundary.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$SCRIPT_DIR/runner-chain-generation.js" "$@"
