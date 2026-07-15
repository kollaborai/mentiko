#!/bin/bash
# Typed plugin registry boundary. Shell only invokes the compiled dispatcher so
# plugin hooks may remain executable shell integrations without owning state.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

run-plugins() {
    if [[ "$#" -ne 5 ]]; then
        echo "usage: run-plugins <event> <chain-id> <run-id> <agent-id> <data-json>" >&2
        return 2
    fi
    if [[ -z "${NAMESPACE_ID:-}" || -z "${ORG_ID:-}" ]]; then
        echo "NAMESPACE_ID and ORG_ID are required for plugin dispatch" >&2
        return 2
    fi
    node "$SCRIPT_DIR/runner-plugin-dispatch.js" dispatch \
        --namespace-id "$NAMESPACE_ID" \
        --org-id "$ORG_ID" \
        --event "$1" \
        --chain-id "$2" \
        --run-id "$3" \
        --agent-id "$4" \
        --data-json "$5"
}

export -f run-plugins
