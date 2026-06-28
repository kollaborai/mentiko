#!/bin/bash
# email-integration.sh - Email notifications for chain completion
#
# sends email reports when chains complete, including:
# - run summary
# - agent results
# - output links
#
# usage:
#   source email-integration.sh
#   send-chain-report <run-id> <chain.json> <status>

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/run-lib.sh"

# -------------------------------------------------------------------
# email config from env or chain.json
# -------------------------------------------------------------------
# env vars (highest priority):
#   CHAIN_EMAIL_TO, CHAIN_EMAIL_FROM, CHAIN_EMAIL_SMTP
#   CHAIN_EMAIL_API_KEY, CHAIN_EMAIL_API_URL
#
# chain.json config (medium priority):
#   config.email.to, config.email.from, config.email.smtp
#   config.email.api_key, config.email.api_url
#
# defaults (lowest priority):
#   from: noreply@mentiko.local
#   method: auto (mail -> sendmail -> curl)

# get-email-config: read email config from env and chain.json
# args: <chain.json>
# outputs: json with email config
get-email-config() {
    local chain_file="$1"

    # read from chain.json
    local chain_to=$(jq -r '.config.email.to // ""' "$chain_file" 2>/dev/null)
    local chain_from=$(jq -r '.config.email.from // ""' "$chain_file" 2>/dev/null)
    local chain_smtp=$(jq -r '.config.email.smtp // ""' "$chain_file" 2>/dev/null)
    local chain_method=$(jq -r '.config.email.method // "auto"' "$chain_file" 2>/dev/null)
    local chain_api_url=$(jq -r '.config.email.api_url // ""' "$chain_file" 2>/dev/null)
    local chain_api_key=$(jq -r '.config.email.api_key // ""' "$chain_file" 2>/dev/null)

    # env vars override
    local env_to="${CHAIN_EMAIL_TO:-$chain_to}"
    local env_from="${CHAIN_EMAIL_FROM:-$chain_from}"
    local env_smtp="${CHAIN_EMAIL_SMTP:-$chain_smtp}"
    local env_method="${CHAIN_EMAIL_METHOD:-$chain_method}"
    local env_api_url="${CHAIN_EMAIL_API_URL:-$chain_api_url}"
    local env_api_key="${CHAIN_EMAIL_API_KEY:-$chain_api_key}"

    # defaults
    local from="${env_from:-noreply@mentiko.local}"
    local method="${env_method:-auto}"

    # build config json
    # NOTE: jq -n, not a heredoc. get-email-config is `export -f`'d; a heredoc body can fail
    # to serialize through export -f on some bash builds. jq -n also escapes the values.
    jq -n \
        --arg to "$env_to" \
        --arg from "$from" \
        --arg smtp "$env_smtp" \
        --arg method "$method" \
        --arg api_url "$env_api_url" \
        --arg api_key "$env_api_key" \
        '{ to: $to, from: $from, smtp: $smtp, method: $method, api_url: $api_url, api_key: $api_key }'
}

# -------------------------------------------------------------------
# build-email-body: create email body from run data
# -------------------------------------------------------------------
# args: <run-id> <chain.json> <status>
build-email-body() {
    local run_id="$1"
    local chain_file="$2"
    local status="${3:-complete}"

    local run_data=$(get-run "$run_id")
    local chain_name=$(jq -r '.name' "$chain_file")
    local namespace_id="${NAMESPACE_ID:-default}"
    local reports_dir="${REPORTS_DIR:-${MENTIKO_PROJECT_ROOT:-${MENTIKO_NAMESPACE_ROOT:-$HOME/.mentiko/namespaces/${namespace_id}}}/reports/agent-reports}"

    # parse run data
    local goal=$(echo "$run_data" | jq -r '.goal // "no goal"')
    local started=$(echo "$run_data" | jq -r '.started // "unknown"')
    local completed=$(echo "$run_data" | jq -r '.completed // "running"')
    local agent_count=$(echo "$run_data" | jq -r '.agents | length' 2>/dev/null || echo "0")

    # format goal (remove quotes if present)
    goal=$(echo "$goal" | sed 's/^"//;s/"$//' | tr '_' ' ')

    # build report links
    local report_links=""
    if [[ -d "$reports_dir" ]]; then
        local reports=($(ls -t "$reports_dir"/*.txt 2>/dev/null | head -5))
        if [[ ${#reports[@]} -gt 0 ]]; then
            report_links="\nrecent output files:"
            for report in "${reports[@]}"; do
                local name=$(basename "$report")
                report_links="$report_links\n  - $reports_dir/$name"
            done
        fi
    fi

    # build agent summary
    local agent_summary=""
    if [[ $agent_count -gt 0 ]]; then
        agent_summary="\nagent execution:"
        echo "$run_data" | jq -r '.agents[]? | "  - \(.name // .id): \(.status // "unknown")"' 2>/dev/null | while read line; do
            agent_summary="$agent_summary\n$line"
        done
    fi

    # email body
    # NOTE: printf, not a heredoc. build-email-body is `export -f`'d; a heredoc body can fail
    # to serialize through export -f on some bash builds. $agent_summary / $report_links are
    # passed as %s args, so their literal "\n" sequences are preserved exactly as the old
    # heredoc emitted them (printf interprets escapes in the FORMAT only, never in args).
    printf 'mentiko run report\n\nchain: %s\nrun-id: %s\nstatus: %s\n\ngoal:\n  %s\n\ntiming:\n  started:  %s\n  completed: %s\n%s\n%s\n\n---\nsent by mentiko on %s at %s\n' \
        "$chain_name" "$run_id" "$status" "$goal" "$started" "$completed" "$agent_summary" "$report_links" "$(hostname)" "$(date)"
}

# -------------------------------------------------------------------
# send-email-mail: send using mail command
# -------------------------------------------------------------------
# args: <to> <from> <subject> <body>
send-email-mail() {
    local to="$1"
    local from="$2"
    local subject="$3"
    local body="$4"

    if ! command -v mail &> /dev/null; then
        return 1
    fi

    echo -e "$body" | mail -s "$subject" -r "$from" "$to" 2>/dev/null
}

# -------------------------------------------------------------------
# send-email-sendmail: send using sendmail
# -------------------------------------------------------------------
# args: <to> <from> <subject> <body>
send-email-sendmail() {
    local to="$1"
    local from="$2"
    local subject="$3"
    local body="$4"

    if ! command -v sendmail &> /dev/null; then
        return 1
    fi

    {
        echo "Subject: $subject"
        echo "From: $from"
        echo "To: $to"
        echo "MIME-Version: 1.0"
        echo "Content-Type: text/plain; charset=UTF-8"
        echo ""
        echo "$body"
    } | sendmail -t 2>/dev/null
}

# -------------------------------------------------------------------
# send-email-api: send using http api (mailgun, sendgrid, etc)
# -------------------------------------------------------------------
# args: <to> <from> <subject> <body> <api_url> <api_key>
send-email-api() {
    local to="$1"
    local from="$2"
    local subject="$3"
    local body="$4"
    local api_url="$5"
    local api_key="$6"

    if [[ -z "$api_url" || -z "$api_key" ]]; then
        return 1
    fi

    # detect provider and format accordingly
    if [[ "$api_url" =~ mailgun ]]; then
        # mailgun format
        curl -s -X POST "$api_url" \
            --user "api:$api_key" \
            -F from="$from" \
            -F to="$to" \
            -F subject="$subject" \
            -F text="$body" \
            2>/dev/null
    elif [[ "$api_url" =~ sendgrid ]]; then
        # sendgrid format
        curl -s -X POST "$api_url" \
            -H "Authorization: Bearer $api_key" \
            -H "Content-Type: application/json" \
            -d "{
                \"personalizations\": [{
                    \"to\": [{\"email\": \"$to\"}]
                }],
                \"from\": {\"email\": \"$from\"},
                \"subject\": \"$subject\",
                \"content\": [{
                    \"type\": \"text/plain\",
                    \"value\": $(echo "$body" | jq -Rs .)
                }]
            }" \
            2>/dev/null
    else
        # generic json format
        curl -s -X POST "$api_url" \
            -H "Authorization: Bearer $api_key" \
            -H "Content-Type: application/json" \
            -d "{
                \"to\": \"$to\",
                \"from\": \"$from\",
                \"subject\": \"$subject\",
                \"body\": $(echo "$body" | jq -Rs .)
            }" \
            2>/dev/null
    fi
}

# -------------------------------------------------------------------
# send-chain-report: main entry point
# -------------------------------------------------------------------
# args: <run-id> <chain.json> <status>
send-chain-report() {
    local run_id="$1"
    local chain_file="$2"
    local status="${3:-complete}"

    local email_config=$(get-email-config "$chain_file")
    local to=$(echo "$email_config" | jq -r '.to // ""')
    local from=$(echo "$email_config" | jq -r '.from // ""')
    local method=$(echo "$email_config" | jq -r '.method // "auto"')
    local api_url=$(echo "$email_config" | jq -r '.api_url // ""')
    local api_key=$(echo "$email_config" | jq -r '.api_key // ""')

    # validate config
    if [[ -z "$to" ]]; then
        echo "  email: no recipient configured (set CHAIN_EMAIL_TO or config.email.to)"
        return 1
    fi

    local chain_name=$(jq -r '.name' "$chain_file")
    local subject="chain report: $chain_name [$status]"

    # build email body
    local body=$(build-email-body "$run_id" "$chain_file" "$status")

    # send email
    local sent=false

    if [[ "$method" == "api" && -n "$api_url" ]]; then
        send-email-api "$to" "$from" "$subject" "$body" "$api_url" "$api_key" && sent=true
    elif [[ "$method" == "sendmail" ]]; then
        send-email-sendmail "$to" "$from" "$subject" "$body" && sent=true
    elif [[ "$method" == "mail" ]]; then
        send-email-mail "$to" "$from" "$subject" "$body" && sent=true
    else
        # auto: try mail, then sendmail, then api
        send-email-mail "$to" "$from" "$subject" "$body" && sent=true
        if [[ "$sent" == "false" ]]; then
            send-email-sendmail "$to" "$from" "$subject" "$body" && sent=true
        fi
        if [[ "$sent" == "false" && -n "$api_url" ]]; then
            send-email-api "$to" "$from" "$subject" "$body" "$api_url" "$api_key" && sent=true
        fi
    fi

    if [[ "$sent" == "true" ]]; then
        echo "  email: sent to $to"
        return 0
    else
        echo "  email: failed to send (no mail/sendmail/curl available or config incomplete)"
        return 1
    fi
}

# export functions
export -f get-email-config
export -f build-email-body
export -f send-email-mail
export -f send-email-sendmail
export -f send-email-api
export -f send-chain-report
