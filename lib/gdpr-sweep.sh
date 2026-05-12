#!/bin/bash
# gdpr-sweep.sh — remove orphan files owned by a deleted user.
#
# called by /api/gdpr/delete after crypto-shred.
# runs in background, non-blocking.
#
# usage: gdpr-sweep.sh <user_id> <namespace_id>

set -euo pipefail

USER_ID="${1:?usage: gdpr-sweep.sh <user_id> <namespace_id>}"
NAMESPACE_ID="${2:-default}"

GLOBAL_ROOT="${MENTIKO_GLOBAL_ROOT:-$HOME/.mentiko}"
NS_ROOT="$GLOBAL_ROOT/namespaces/$NAMESPACE_ID"

echo "[gdpr-sweep] starting sweep for user=$USER_ID namespace=$NAMESPACE_ID"

# chains owned by this user
CHAINS_DIR="$NS_ROOT/chains"
if [[ -d "$CHAINS_DIR" ]]; then
    for chain_dir in "$CHAINS_DIR"/*/; do
        chain_file="$chain_dir/chain.json"
        if [[ -f "$chain_file" ]] && grep -q "\"created_by\":\"$USER_ID\"" "$chain_file" 2>/dev/null; then
            echo "[gdpr-sweep] removing chain: $chain_dir"
            rm -rf "$chain_dir"
        fi
    done
fi

# runs by this user
RUNS_DIR="$NS_ROOT/runs"
if [[ -d "$RUNS_DIR" ]]; then
    for run_dir in "$RUNS_DIR"/*/; do
        run_file="$run_dir/run.json"
        if [[ -f "$run_file" ]] && grep -q "\"user_id\":\"$USER_ID\"" "$run_file" 2>/dev/null; then
            echo "[gdpr-sweep] removing run: $run_dir"
            rm -rf "$run_dir"
        fi
    done
fi

# conversations by this user
CONV_DIR="$NS_ROOT/conversations"
if [[ -d "$CONV_DIR" ]]; then
    for conv_file in "$CONV_DIR"/*.jsonl; do
        if [[ -f "$conv_file" ]] && grep -q "\"user_id\":\"$USER_ID\"" "$conv_file" 2>/dev/null; then
            echo "[gdpr-sweep] removing conversation: $conv_file"
            rm -f "$conv_file"
        fi
    done
fi

# decisions by this user
DECISIONS_DIR="$NS_ROOT/decisions"
if [[ -d "$DECISIONS_DIR" ]]; then
    for dec_file in "$DECISIONS_DIR"/*.json; do
        if [[ -f "$dec_file" ]] && grep -q "\"userId\":\"$USER_ID\"" "$dec_file" 2>/dev/null; then
            echo "[gdpr-sweep] removing decision: $dec_file"
            rm -f "$dec_file"
        fi
    done
fi

echo "[gdpr-sweep] complete for user=$USER_ID"
