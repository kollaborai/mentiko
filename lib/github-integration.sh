#!/bin/bash
# github-integration.sh - GitHub issue creation for agent errors
#
# usage:
#   source github-integration.sh
#   github-create-issue <repo> <title> <body> [labels]

# Source config for namespace-aware paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.sh"

# -------------------------------------------------------------------
# github-get-token: read GITHUB_TOKEN from env or .env
# -------------------------------------------------------------------
github-get-token() {
    if [[ -n "$GITHUB_TOKEN" ]]; then
        echo "$GITHUB_TOKEN"
        return 0
    fi

    local env_file="$(git rev-parse --show-toplevel 2>/dev/null || pwd)/.env"
    if [[ -f "$env_file" ]]; then
        local token=$(grep "^GITHUB_TOKEN=" "$env_file" | cut -d'=' -f2- | tr -d '"' | tr -d "'" | xargs)
        if [[ -n "$token" ]]; then
            echo "$token"
            return 0
        fi
    fi

    return 1
}

# -------------------------------------------------------------------
# github-api: call github api with token auth
# -------------------------------------------------------------------
github-api() {
    local endpoint="$1"
    local method="${2:-GET}"
    local data="${3:-}"

    local token=$(github-get-token)
    if [[ -z "$token" ]]; then
        echo "  error: GITHUB_TOKEN not set" >&2
        return 1
    fi

    local url="https://api.github.com${endpoint}"
    local args=(-X "$method" -H "Authorization: Bearer $token" -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28")

    if [[ -n "$data" ]]; then
        args+=(-H "Content-Type: application/json" -d "$data")
    fi

    curl -s "${args[@]}" "$url"
}

# -------------------------------------------------------------------
# github-create-issue: create an issue on a repo
# -------------------------------------------------------------------
# args: <repo> <title> <body> [labels]
github-create-issue() {
    local repo="$1"
    local title="$2"
    local body="$3"
    local labels="${4:-}"

    if [[ -z "$repo" || -z "$title" ]]; then
        echo "  usage: github-create-issue <repo> <title> <body> [labels]" >&2
        return 1
    fi

    local token=$(github-get-token)
    if [[ -z "$token" ]]; then
        echo "  error: GITHUB_TOKEN not found" >&2
        return 1
    fi

    local json=$(jq -n \
        --arg t "$title" \
        --arg b "$body" \
        '{title: $t, body: $b}')

    if [[ -n "$labels" ]]; then
        json=$(echo "$json" | jq --arg l "$labels" '.labels = ($l | split(","))')
    fi

    local response=$(github-api "/repos/$repo/issues" "POST" "$json")

    if echo "$response" | jq -e '.html_url' > /dev/null 2>&1; then
        local url=$(echo "$response" | jq -r '.html_url')
        local number=$(echo "$response" | jq -r '.number')
        echo "  issue created: #$number"
        echo "  $url"
        return 0
    else
        echo "  error creating issue" >&2
        echo "$response" | jq -r '.message // "unknown error"' >&2
        return 1
    fi
}

# -------------------------------------------------------------------
# github-agent-error-issue: create issue from agent error
# -------------------------------------------------------------------
# args: <repo> <run-id> <agent-id> <error-message> [output-file]
github-agent-error-issue() {
    local repo="$1"
    local run_id="$2"
    local agent_id="$3"
    local error_msg="$4"
    local output_file="${5:-}"

    local token=$(github-get-token)
    if [[ -z "$token" ]]; then
        echo "  error: GITHUB_TOKEN not found" >&2
        return 1
    fi

    local namespace_id="${NAMESPACE_ID:-default}"
    local run_file="$RUNS_DIR/$run_id/run.json"
    local run_info="{}"
    if [[ -f "$run_file" ]]; then
        run_info=$(cat "$run_file")
    fi

    local chain=$(echo "$run_info" | jq -r '.chain // "unknown"')
    local goal=$(echo "$run_info" | jq -r '.goal // "no goal"')
    local started=$(echo "$run_info" | jq -r '.started // "unknown"')
    local status=$(echo "$run_info" | jq -r '.status // "unknown"')

    local output_section=""
    if [[ -n "$output_file" && -f "$output_file" ]]; then
        local last_lines=$(tail -100 "$output_file")
        output_section="

## Agent Output (last 100 lines)
$(printf '%s\n' "$last_lines" | sed 's/`/\\`/g' | sed 's/\\/\\\\/g')"
    fi

    local body="## Agent Error Report

**Run ID:** \`$run_id\`
**Agent:** \`$agent_id\`
**Chain:** $chain
**Status:** $status
**Started:** $started

## Goal
$goal

## Error
$(printf '%s\n' "$error_msg" | sed 's/`/\\`/g' | sed 's/\\/\\\\/g')
$output_section

## Run Info
$(printf '%s\n' "$run_info" | jq -r 'to_entries | map("- **\(.key):** \(.value)") | join("\n")')

---
Created by mentiko github integration
Timestamp: $(date -Iseconds)"

    local title="Agent Error: $agent_id failed in $chain"
    local labels="agent-error,bug,automated"

    github-create-issue "$repo" "$title" "$body" "$labels"
}

# -------------------------------------------------------------------
# github-test-connection: verify token works
# -------------------------------------------------------------------
github-test-connection() {
    local token=$(github-get-token)
    if [[ -z "$token" ]]; then
        echo "  ✖ no GITHUB_TOKEN found"
        return 1
    fi

    local response=$(github-api "/user" "GET")
    local login=$(echo "$response" | jq -r '.login // ""')

    if [[ -n "$login" && "$login" != "null" ]]; then
        echo "  ✔ connected as @$login"
        return 0
    else
        echo "  ✖ token invalid"
        echo "$response" | jq -r '.message // "unknown error"' >&2
        return 1
    fi
}

# -------------------------------------------------------------------
# github-validate-repo: check if repo exists and is accessible
# -------------------------------------------------------------------
# args: <repo>
github-validate-repo() {
    local repo="$1"

    if [[ -z "$repo" ]]; then
        echo "  ✖ repo required" >&2
        return 1
    fi

    local response=$(github-api "/repos/$repo" "GET")
    if echo "$response" | jq -e '.full_name' > /dev/null 2>&1; then
        local name=$(echo "$response" | jq -r '.full_name')
        local priv=$(echo "$response" | jq -r '.private // false')
        local access=$(echo "$response" | jq -r '.permissions // {}' | jq -r 'if .admin then "admin" elif .push then "write" elif .pull then "read" else "none" end')
        echo "  ✔ repo: $name ($access)$( [[ "$priv" == "true" ]] && echo ", private" || echo ", public" )"
        return 0
    else
        echo "  ✖ repo not accessible" >&2
        return 1
    fi
}

# export functions
export -f github-get-token
export -f github-api
export -f github-create-issue
export -f github-agent-error-issue
export -f github-test-connection
export -f github-validate-repo
