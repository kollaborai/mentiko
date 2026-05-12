#!/bin/bash
# integrations.sh - third-party integration handlers
#
# supported integrations:
#   github  - create issues on chain errors
#   teams   - send notifications to teams webhook
#
# note: slack and email are already configured in schema.json and handled
#       by existing webhook/email systems
#
# usage:
#   source integrations.sh
#   integration-send <integration-type> <event-type> <chain-file> <data>
#   integration-test <integration-type> <chain-file>
#   integration-status <chain-file>

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# integration state dir
INTEGRATION_STATE_DIR="$HOME/.mentiko_integrations"
mkdir -p "$INTEGRATION_STATE_DIR"

# -------------------------------------------------------------------
# integration-send: send event to configured integration
# -------------------------------------------------------------------
integration-send() {
    local integration_type="$1"
    local event_type="$2"
    local chain_file="$3"
    shift 3
    local data=("$@")

    case "$integration_type" in
        github)
            integration-github "$event_type" "$chain_file" "${data[@]}"
            ;;
        teams)
            integration-teams "$event_type" "$chain_file" "${data[@]}"
            ;;
        *)
            echo "  integration: unknown type '$integration_type'"
            return 1
            ;;
    esac
}

# -------------------------------------------------------------------
# integration-github: create github issues on errors
# -------------------------------------------------------------------
integration-github() {
    local event_type="$1"
    local chain_file="$2"
    shift 2
    local data=("$@")

    # check if integrations are enabled at top level
    local enabled=$(jq -r '.config.integrations.github.enabled // false' "$chain_file" 2>/dev/null)
    if [[ "$enabled" != "true" ]]; then
        return 0
    fi

    # get github config
    local gh_token=$(jq -r '.config.integrations.github.token // empty' "$chain_file" 2>/dev/null)
    local gh_owner=$(jq -r '.config.integrations.github.owner // empty' "$chain_file" 2>/dev/null)
    local gh_repo=$(jq -r '.config.integrations.github.repo // empty' "$chain_file" 2>/dev/null)
    local gh_labels=$(jq -r '.config.integrations.github.labels[]? // empty' "$chain_file" 2>/dev/null | tr '\n' ',' | sed 's/,$//')

    if [[ -z "$gh_token" || -z "$gh_owner" || -z "$gh_repo" ]]; then
        return 0
    fi

    # only create issues for error events
    if [[ ! "$event_type" =~ _error$ && ! "$event_type" =~ _failed$ && ! "$event_type" =~ _timeout$ ]]; then
        return 0
    fi

    local chain_name=$(jq -r '.name' "$chain_file")
    local timestamp=$(date -Iseconds)
    local title="[$chain_name] Chain error: $event_type"

    # build issue body
    local body="**Chain:** $chain_name\n"
    body+="**Event:** $event_type\n"
    body+="**Timestamp:** $timestamp\n"
    body+="\n**Data:**\n```\n"
    for item in "${data[@]}"; do
        body+="$item\n"
    done
    body+="\n```\n"

    # create labels array for api
    local labels_payload=""
    if [[ -n "$gh_labels" ]]; then
        IFS=',' read -ra LABEL_ARRAY <<< "$gh_labels"
        for label in "${LABEL_ARRAY[@]}"; do
            labels_payload+="\"$label\","
        done
        labels_payload="${labels_payload%,}"
    fi

    # build api request
    local api_url="https://api.github.com/repos/$gh_owner/$gh_repo/issues"
    local issue_payload="{"
    issue_payload+="\"title\":\"$title\","
    issue_payload+="\"body\":\"$(echo "$body" | jq -Rs .)\","
    if [[ -n "$labels_payload" ]]; then
        issue_payload+="\"labels\":[$labels_payload],"
    fi
    issue_payload+="}"

    local response=$(curl -s -X POST "$api_url" \
        -H "Authorization: token $gh_token" \
        -H "Accept: application/vnd.github.v3+json" \
        -H "Content-Type: application/json" \
        -d "$issue_payload")

    local issue_url=$(echo "$response" | jq -r '.html_url // empty')

    if [[ -n "$issue_url" ]]; then
        echo "  github: issue created $issue_url"
    else
        echo "  github: failed to create issue"
    fi
}

# -------------------------------------------------------------------
# integration-teams: send teams webhook notifications
# -------------------------------------------------------------------
integration-teams() {
    local event_type="$1"
    local chain_file="$2"
    shift 2
    local data=("$@")

    # check if integrations are enabled at top level
    local enabled=$(jq -r '.config.integrations.teams.enabled // false' "$chain_file" 2>/dev/null)
    if [[ "$enabled" != "true" ]]; then
        return 0
    fi

    local teams_webhook=$(jq -r '.config.integrations.teams.webhook_url // empty' "$chain_file" 2>/dev/null)

    if [[ -z "$teams_webhook" ]]; then
        return 0
    fi

    # check event filter
    local teams_events=$(jq -r '.config.integrations.teams.events[]? // empty' "$chain_file" 2>/dev/null | tr '\n' '|')
    if [[ -n "$teams_events" ]]; then
        if ! echo "$event_type" | grep -qE "^(${teams_events%|})$"; then
            return 0
        fi
    fi

    local chain_name=$(jq -r '.name' "$chain_file")
    local timestamp=$(date -Iseconds)

    # determine color based on event
    local color="00ff00"
    case "$event_type" in
        *error|*failed|*timeout)
            color="ff0000"
            ;;
        *warning|*retry)
            color="ffff00"
            ;;
    esac

    # build teams adaptive card
    local teams_payload="{"
    teams_payload+="\"type\":\"message\","
    teams_payload+="\"attachments\":[{"
    teams_payload+="\"contentType\":\"application/vnd.microsoft.card.adaptive\","
    teams_payload+="\"contentUrl\":null,"
    teams_payload+="\"content\":{"
    teams_payload+="\"type\":\"AdaptiveCard\","
    teams_payload+="\"\$schema\":\"http://adaptivecards.io/schemas/adaptive-card.json\","
    teams_payload+="\"version\":\"1.4\","
    teams_payload+="\"body\":[{"
    teams_payload+="\"type\":\"TextBlock\","
    teams_payload+="\"text\":\"$chain_name: $event_type\","
    teams_payload+="\"weight\":\"Bolder\","
    teams_payload+="\"size\":\"Medium\","
    teams_payload+="\"color\":\"$( [[ "$color" == "ff0000" ]] && echo "Attention" || echo "Good" )\""
    teams_payload+="},{"
    teams_payload+="\"type\":\"TextBlock\","
    teams_payload+="\"text\":\"$timestamp\","
    teams_payload+="\"isSubtle\":true,"
    teams_payload+="\"size\":\"Small\""
    teams_payload+="}"
    teams_payload+="],"
    teams_payload+="\"msteams\":{\"width\":\"full\"}"
    teams_payload+="}"
    teams_payload+="}]"
    teams_payload+="}"

    local response=$(curl -s -X POST "$teams_webhook" \
        -H "Content-Type: application/json" \
        -d "$teams_payload")

    if [[ -z "$response" || "$response" == "1" ]]; then
        echo "  teams: notification sent"
    else
        echo "  teams: notification failed - $response"
    fi
}

# -------------------------------------------------------------------
# integration-test: test an integration configuration
# -------------------------------------------------------------------
integration-test() {
    local integration_type="$1"
    local chain_file="$2"

    case "$integration_type" in
        github)
            local enabled=$(jq -r '.config.integrations.github.enabled // false' "$chain_file" 2>/dev/null)
            local gh_token=$(jq -r '.config.integrations.github.token // "MISSING"' "$chain_file" 2>/dev/null)
            local gh_owner=$(jq -r '.config.integrations.github.owner // "MISSING"' "$chain_file" 2>/dev/null)
            local gh_repo=$(jq -r '.config.integrations.github.repo // "MISSING"' "$chain_file" 2>/dev/null)

            echo "  github integration test:"
            echo "    enabled: $enabled"
            echo "    token: ${gh_token:0:10}..."
            echo "    owner: $gh_owner"
            echo "    repo: $gh_repo"

            if [[ "$enabled" == "true" && "$gh_token" != "MISSING" && "$gh_owner" != "MISSING" && "$gh_repo" != "MISSING" ]]; then
                # test api call
                local response=$(curl -s -X POST "https://api.github.com/repos/$gh_owner/$gh_repo/issues" \
                    -H "Authorization: token $gh_token" \
                    -H "Accept: application/vnd.github.v3+json" \
                    -H "Content-Type: application/json" \
                    -d '{"title":"[mentiko] test issue","body":"This is a test issue from mentiko integration test. You can delete this."}')
                local issue_url=$(echo "$response" | jq -r '.html_url // empty')
                if [[ -n "$issue_url" ]]; then
                    echo "    status: success - test issue created"
                    echo "    issue: $issue_url"
                    return 0
                else
                    echo "    status: failed - $(echo "$response" | jq -r '.message // "unknown error"')"
                    return 1
                fi
            else
                echo "    status: skipped - integration not fully configured"
                return 1
            fi
            ;;

        teams)
            local enabled=$(jq -r '.config.integrations.teams.enabled // false' "$chain_file" 2>/dev/null)
            local teams_webhook=$(jq -r '.config.integrations.teams.webhook_url // "MISSING"' "$chain_file" 2>/dev/null)
            echo "  teams integration test:"
            echo "    enabled: $enabled"
            echo "    webhook: ${teams_webhook:0:30}..."

            if [[ "$enabled" == "true" && "$teams_webhook" != "MISSING" ]]; then
                local test_msg='{"type":"message","attachments":[{"contentType":"application/vnd.microsoft.card.adaptive","content":{"type":"AdaptiveCard","body":[{"type":"TextBlock","text":"mentiko test notification"}]}}]}'
                local response=$(curl -s -X POST "$teams_webhook" -H "Content-Type: application/json" -d "$test_msg")
                if [[ -z "$response" || "$response" == "1" ]]; then
                    echo "    status: success - message sent"
                    return 0
                else
                    echo "    status: failed - $response"
                    return 1
                fi
            else
                echo "    status: skipped - integration not fully configured"
                return 1
            fi
            ;;

        *)
            echo "  unknown integration type: $integration_type"
            return 1
            ;;
    esac
}

# -------------------------------------------------------------------
# integration-status: show integration status for a chain
# -------------------------------------------------------------------
integration-status() {
    local chain_file="$1"

    if [[ ! -f "$chain_file" ]]; then
        echo "  chain file not found: $chain_file"
        return 1
    fi

    echo ""
    echo "  integrations status:"
    echo "  ---"

    local integrations=$(jq -r '.config.integrations // empty' "$chain_file" 2>/dev/null)

    if [[ -z "$integrations" || "$integrations" == "null" ]]; then
        echo "  no integrations configured"
        echo ""
        return 0
    fi

    # github
    if echo "$integrations" | jq -e '.github' >/dev/null 2>&1; then
        local gh_enabled=$(jq -r '.config.integrations.github.enabled // false' "$chain_file")
        local gh_owner=$(jq -r '.config.integrations.github.owner // "not set"' "$chain_file")
        local gh_repo=$(jq -r '.config.integrations.github.repo // "not set"' "$chain_file")
        local gh_token=$(jq -r '.config.integrations.github.token // "not set"' "$chain_file")
        echo "  github:"
        echo "    enabled: $gh_enabled"
        echo "    owner: $gh_owner"
        echo "    repo: $gh_repo"
        echo "    token: ${gh_token:+configured}"
    fi

    # teams
    if echo "$integrations" | jq -e '.teams' >/dev/null 2>&1; then
        local teams_enabled=$(jq -r '.config.integrations.teams.enabled // false' "$chain_file")
        local teams_url=$(jq -r '.config.integrations.teams.webhook_url // "not set"' "$chain_file")
        echo "  teams:"
        echo "    enabled: $teams_enabled"
        echo "    webhook: ${teams_url:+configured}"
    fi

    # slack (already in schema)
    if echo "$integrations" | jq -e '.slack' >/dev/null 2>&1; then
        local slack_enabled=$(jq -r '.config.integrations.slack.enabled // false' "$chain_file")
        echo "  slack:"
        echo "    enabled: $slack_enabled"
    fi

    # email (already in schema at config level, not under integrations)
    local email_enabled=$(jq -r '.config.email.enabled // false' "$chain_file")
    local email_to=$(jq -r '.config.email.to // "not set"' "$chain_file")
    echo "  email:"
    echo "    enabled: $email_enabled"
    echo "    to: $email_to"

    echo ""
}

# exports
export -f integration-send
export -f integration-github
export -f integration-teams
export -f integration-test
export -f integration-status

echo "  mentiko: integration functions loaded"
