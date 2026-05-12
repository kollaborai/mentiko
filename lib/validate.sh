#!/bin/bash
# validate.sh - JSON schema validation for chain.json
#
# usage:
#   bash lib/validate.sh <chain.json> [--strict]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCHEMA="$SCRIPT_DIR/schema.json"

CHAIN="${1:-}"
STRICT=""
if [[ "${2:-}" == "--strict" ]]; then
    STRICT="--strict"
fi

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

error() {
    echo -e "${RED}error:${NC} $*" >&2
}

warn() {
    echo -e "${YELLOW}warning:${NC} $*"
}

info() {
    echo -e "${BLUE}$*${NC}"
}

success() {
    echo -e "${GREEN}$*${NC}"
}

# Check args
if [[ -z "$CHAIN" ]]; then
    error "no chain file specified"
    echo ""
    echo "usage: mentiko validate <chain.json> [--strict]"
    echo ""
    echo "options:"
    echo "  --strict    enable additional validation (trigger/emits resolution, duplicate IDs)"
    exit 1
fi

if [[ ! -f "$CHAIN" ]]; then
    error "file not found: $CHAIN"
    exit 1
fi

# Check for jq
if ! command -v jq &> /dev/null; then
    error "jq required for validation. install with: brew install jq"
    exit 1
fi

# Strip JSON5 comments using Node.js
# This handles // comments, /* */ comments, and trailing commas
strip_json5() {
    node -e "
    const fs = require('fs');
    const content = fs.readFileSync('$1', 'utf8');

    // Remove // comments (but not in strings)
    let result = content.replace(/\/\/.*$/gm, function(match) {
        // Check if we're inside a string
        const before = content.substring(0, content.indexOf(match));
        const stringChars = before.match(/\"/g);
        if (stringChars && stringChars.length % 2 === 1) {
            return match; // Inside string, keep the comment
        }
        return '';
    });

    // Remove /* */ comments
    result = result.replace(/\/\*[\s\S]*?\*\//g, '');

    // Remove trailing commas
    result = result.replace(/,(\s*[}\]])/g, '$1');

    console.log(result);
    "
}

# Create temp file for cleaned JSON
TEMP_JSON=$(mktemp)
trap "rm -f $TEMP_JSON" EXIT

if ! strip_json5 "$CHAIN" > "$TEMP_JSON" 2>/dev/null; then
    error "failed to parse JSON5 from $CHAIN"
    exit 1
fi

# Validate JSON syntax with jq
if ! jq empty "$TEMP_JSON" 2>/dev/null; then
    error "invalid JSON syntax in $CHAIN"
    jq empty "$TEMP_JSON" 2>&1 | head -5 | sed 's/^/    /'
    exit 1
fi

# Extract data for validation
NAME=$(jq -r '.name // empty' "$TEMP_JSON")
DESCRIPTION=$(jq -r '.description // empty' "$TEMP_JSON")
VERSION=$(jq -r '.version // "1.0"' "$TEMP_JSON")
AGENT_COUNT=$(jq '.agents | length' "$TEMP_JSON")

info "validating $CHAIN..."

# Basic structure validation
if [[ -z "$NAME" ]]; then
    error "missing required field: name"
    exit 1
fi

if [[ "$AGENT_COUNT" -lt 1 ]]; then
    error "no agents defined"
    exit 1
fi

# Check for duplicate agent IDs
DUPLICATE_IDS=$(jq -r '.agents[].id' "$TEMP_JSON" | sort | uniq -d)
if [[ -n "$DUPLICATE_IDS" ]]; then
    error "duplicate agent IDs found:"
    echo "$DUPLICATE_IDS" | sed 's/^/      /'
    exit 1
fi

# Check required fields in each agent
INVALID_AGENTS=$(jq -r '.agents[] | select(.id == null or .name == null or .triggers == null or .emits == null) | .id // "unnamed"' "$TEMP_JSON")
if [[ -n "$INVALID_AGENTS" ]]; then
    error "agents missing required fields (id, name, triggers, emits):"
    echo "$INVALID_AGENTS" | sed 's/^/      /'
    exit 1
fi

echo ""
success "  schema valid"
success "  chain: $NAME"
echo "    version: $VERSION"
echo "    agents: $AGENT_COUNT"
if [[ -n "$DESCRIPTION" ]]; then
    echo "    description: $DESCRIPTION"
fi

# Strict validation
if [[ -n "$STRICT" ]]; then
    echo ""
    info "running strict validation..."

    # Check trigger/emits resolution
    ALL_EMITS=()
    ALL_TRIGGERS=()

    while IFS= read -r emit; do
        [[ -n "$emit" ]] && ALL_EMITS+=("$emit")
    done < <(jq -r '.agents[].emits // empty' "$TEMP_JSON")

    while IFS= read -r trigger; do
        [[ -n "$trigger" ]] && ALL_TRIGGERS+=("$trigger")
    done < <(jq -r '.agents[].triggers[]? // empty' "$TEMP_JSON")

    # Check for unresolved triggers
    UNRESOLVED=()
    for trigger in "${ALL_TRIGGERS[@]}"; do
        if [[ "$trigger" != "manual-start" ]]; then
            found=false
            for emit in "${ALL_EMITS[@]}"; do
                if [[ "$trigger" == "$emit" ]]; then
                    found=true
                    break
                fi
            done
            if [[ "$found" == "false" ]]; then
                UNRESOLVED+=("$trigger")
            fi
        fi
    done

    # Check for emits with no triggers
    UNUSED_EMITS=()
    for emit in "${ALL_EMITS[@]}"; do
        found=false
        for trigger in "${ALL_TRIGGERS[@]}"; do
            if [[ "$emit" == "$trigger" ]]; then
                found=true
                break
            fi
        done
        if [[ "$found" == "false" ]]; then
            UNUSED_EMITS+=("$emit")
        fi
    done

    # Report strict validation results
    STRICT_ERRORS=0

    if [[ ${#UNRESOLVED[@]} -gt 0 ]]; then
        warn "triggers with no matching emits:"
        for trigger in "${UNRESOLVED[@]}"; do
            echo "      $trigger"
            ((STRICT_ERRORS++))
        done
    fi

    if [[ ${#UNUSED_EMITS[@]} -gt 0 ]]; then
        warn "emits with no matching triggers:"
        for emit in "${UNUSED_EMITS[@]}"; do
            echo "      $emit"
            ((STRICT_ERRORS++))
        done
    fi

    if [[ $STRICT_ERRORS -eq 0 ]]; then
        success "  all triggers resolved"
    fi

    # Check for agent config issues
    echo ""
    info "checking agent configuration..."

    # Check agents without prompts or specs
    NO_PROMPT=()
    while IFS= read -r agent_id; do
        has_prompt=$(jq -r ".agents[] | select(.id==\"$agent_id\") | .prompt // empty" "$TEMP_JSON")
        has_spec=$(jq -r ".agents[] | select(.id==\"$agent_id\") | .spec // empty" "$TEMP_JSON")
        if [[ -z "$has_prompt" && -z "$has_spec" ]]; then
            NO_PROMPT+=("$agent_id")
        fi
    done < <(jq -r '.agents[].id' "$TEMP_JSON")

    if [[ ${#NO_PROMPT[@]} -gt 0 ]]; then
        warn "agents without prompt or spec:"
        for agent_id in "${NO_PROMPT[@]}"; do
            echo "      $agent_id"
        done
    fi

    # Check webhook config if enabled
    WEBHOOK_ENABLED=$(jq -r '.config.webhooks.enabled // false' "$TEMP_JSON")
    if [[ "$WEBHOOK_ENABLED" == "true" ]]; then
        WEBHOOK_URLS=$(jq -r '.config.webhooks.urls // empty' "$TEMP_JSON")
        if [[ -z "$WEBHOOK_URLS" || "$WEBHOOK_URLS" == "null" ]]; then
            warn "webhooks enabled but no URLs configured"
        fi
    fi

    # Check workspace config
    WORKSPACE_TYPE=$(jq -r '.config.workspace.type // "local"' "$TEMP_JSON")
    if [[ "$WORKSPACE_TYPE" == "ssh" ]]; then
        SSH_HOST=$(jq -r '.config.workspace.ssh.host // empty' "$TEMP_JSON")
        SSH_USER=$(jq -r '.config.workspace.ssh.user // empty' "$TEMP_JSON")
        SSH_PATH=$(jq -r '.config.workspace.ssh.path // empty' "$TEMP_JSON")

        if [[ -z "$SSH_HOST" || -z "$SSH_USER" || -z "$SSH_PATH" ]]; then
            error "ssh workspace requires host, user, and path"
            exit 1
        fi
        success "  ssh workspace config valid"
    fi

    if [[ "$WORKSPACE_TYPE" == "docker" ]]; then
        DOCKER_CONTAINER=$(jq -r '.config.workspace.docker.container // empty' "$TEMP_JSON")
        DOCKER_PATH=$(jq -r '.config.workspace.docker.path // empty' "$TEMP_JSON")

        if [[ -z "$DOCKER_CONTAINER" || -z "$DOCKER_PATH" ]]; then
            error "docker workspace requires container and path"
            exit 1
        fi
        success "  docker workspace config valid"
    fi
fi

echo ""
success "validation complete"
