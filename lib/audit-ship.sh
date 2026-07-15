#!/usr/bin/env bash
# audit-ship.sh - invocation-only boundary for the typed audit ship contract.
#
# Audit entry parsing, S3 key derivation, namespace substitution, URL parsing,
# rclone upload orchestration, retry backoff, and failure-record construction
# are owned by web/lib/runner-v2/audit-ship.ts. This file forwards one JSONL
# audit entry from stdin to the compiled process and is spawned by
# web/lib/system/audit-log.ts. The remote feature stays a silent no-op unless
# AUDIT_REMOTE_URL is configured; shipping never blocks the main flow.

set -euo pipefail

exec node "${MENTIKO_CODE_ROOT:?MENTIKO_CODE_ROOT must be configured}/lib/runner-audit-ship.js" ship
