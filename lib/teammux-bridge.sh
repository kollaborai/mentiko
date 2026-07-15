#!/bin/bash
# team-mux bridge invocation boundary.
#
# Data-shape parsing, validation, path resolution, and JSON/text mutation live
# in the compiled TypeScript owner. This file only invokes that process.

set -euo pipefail

exec node "${MENTIKO_CODE_ROOT:?MENTIKO_CODE_ROOT must be configured}/lib/runner-teammux-bridge.js" "$@"
