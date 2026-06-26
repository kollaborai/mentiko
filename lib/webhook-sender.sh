#!/bin/bash
# webhook-sender.sh - Webhook notification system with retry logic
#
# usage:
#   source webhook-sender.sh
#   send-webhook <event-type> <chain-file> <payload-data>
#   get-webhook-status <chain-file>
#
# supported events:
#   agent_started, agent_complete, agent_error
#   chain_started, chain_complete, chain_error

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# load metrics for webhook tracking
source "$SCRIPT_DIR/metrics.sh" 2>/dev/null || true

# webhook delivery state dir
WEBHOOK_STATE_DIR="$HOME/.mentiko_webhooks"
mkdir -p "$WEBHOOK_STATE_DIR"

# -------------------------------------------------------------------
# send-webhook: send webhook with retry logic
# -------------------------------------------------------------------
send-webhook() {
    local event_type="$1"
    local chain_file="$2"
    shift 2
    local payload_data=("$@")

    if [[ ! -f "$chain_file" ]]; then
        echo "  error: chain file not found: $chain_file"
        return 1
    fi

    # check if webhooks are enabled
    local webhooks_enabled=$(jq -r '.config.webhooks.enabled // false' "$chain_file" 2>/dev/null)
    if [[ "$webhooks_enabled" != "true" ]]; then
        return 0
    fi

    # get webhook urls
    local webhook_urls=()
    while IFS= read -r url; do
        [[ -n "$url" ]] && webhook_urls+=("$url")
    done < <(jq -r '.config.webhooks.urls[]? // empty' "$chain_file" 2>/dev/null)

    if [[ ${#webhook_urls[@]} -eq 0 ]]; then
        echo "  webhook: no urls configured"
        return 0
    fi

    # check if this event type is subscribed
    local subscribed_events=$(jq -r '.config.webhooks.events[]? // empty' "$chain_file" 2>/dev/null | tr '\n' '|')
    if [[ -n "$subscribed_events" ]]; then
        if ! echo "$event_type" | grep -qE "^(${subscribed_events%|})$"; then
            return 0
        fi
    fi

    # build payload
    local chain_name=$(jq -r '.name' "$chain_file")
    local timestamp=$(date -Iseconds)
    local event_id="${chain_name}-${event_type}-$(date +%s)-$$"

    local payload="{"
    payload+="\"event\":\"$event_type\","
    payload+="\"event_id\":\"$event_id\","
    payload+="\"chain\":\"$chain_name\","
    payload+="\"timestamp\":\"$timestamp\""

    # add additional payload data
    for item in "${payload_data[@]}"; do
        if [[ "$item" =~ ^([a-zA-Z_][a-zA-Z0-9_]*)=(.*)$ ]]; then
            local key="${BASH_REMATCH[1]}"
            local value="${BASH_REMATCH[2]}"
            # escape quotes in value
            value="${value//\"/\\\"}"
            payload+=",\"$key\":\"$value\""
        fi
    done

    payload+="}"

    # get retry config
    local max_attempts=$(jq -r '.config.webhooks.retry.max_attempts // 3' "$chain_file")
    local backoff_base=$(jq -r '.config.webhooks.retry.backoff_base // 2' "$chain_file")
    local initial_delay=$(jq -r '.config.webhooks.retry.initial_delay // 1' "$chain_file")
    local max_delay=$(jq -r '.config.webhooks.retry.max_delay // 60' "$chain_file")

    # get custom headers
    local headers=$(jq -r '.config.webhooks.headers // {}' "$chain_file" 2>/dev/null)

    # get secret for signature
    local secret=$(jq -r '.config.webhooks.secret // ""' "$chain_file" 2>/dev/null)

    echo "  webhook: sending $event_type to ${#webhook_urls[@]} url(s)"

    # send to each url
    for url in "${webhook_urls[@]}"; do
        local webhook_id="$(echo -n "$url" | md5sum | cut -d' ' -f1)"
        local state_file="$WEBHOOK_STATE_DIR/${event_id}-${webhook_id}.json"

        # init state
        cat > "$state_file" <<STATEEOF
{
  "event_id": "$event_id",
  "event_type": "$event_type",
  "url": "$url",
  "attempts": 0,
  "status": "pending",
  "created_at": "$timestamp"
}
STATEEOF

        local attempt=1
        local delay=$initial_delay
        local success=false

        while [[ $attempt -le $max_attempts ]]; do
            # SECURITY: build the curl invocation as an ARGUMENT ARRAY, never a shell
            # string passed to eval. $url / $payload / header values are webhook-authored;
            # eval would let a single quote or $(...) in any of them execute commands.
            # As array args they are inert data handed straight to curl.
            local -a curl_cmd=(
                curl -s -X POST "$url"
                -H "Content-Type: application/json"
                -H "X-Webhook-Event: $event_type"
                -H "X-Webhook-Id: $event_id"
                -H "X-Webhook-Timestamp: $timestamp"
                -H "User-Agent: mentiko/1.0"
                --max-time 10
                --retry 0
                -d "$payload"
            )

            # add signature if secret provided
            if [[ -n "$secret" ]]; then
                local signature=$(echo -n "$payload" | openssl dgst -sha256 -hmac "$secret" | awk '{print $2}')
                curl_cmd+=( -H "X-Webhook-Signature: sha256=$signature" )
            fi

            # add custom headers
            while IFS='=' read -r key value; do
                [[ -n "$key" ]] && curl_cmd+=( -H "$key: $value" )
            done < <(echo "$headers" | jq -r 'to_entries[] | "\(.key)=\(.value)"' 2>/dev/null)

            # send webhook
            local response
            local http_code
            response=$("${curl_cmd[@]}" -w '\n%{http_code}' 2>/dev/null)
            http_code=$(echo "$response" | tail -1)
            response=$(echo "$response" | head -n -1)

            # update state
            local updated_at=$(date -Iseconds)
            if [[ "$http_code" =~ ^2[0-9]{2}$ ]]; then
                success=true
                jq -n \
                    --arg id "$event_id" \
                    --arg type "$event_type" \
                    --arg u "$url" \
                    --argjson att "$attempt" \
                    --arg st "delivered" \
                    --arg created "$timestamp" \
                    --arg updated "$updated_at" \
                    --arg hc "$http_code" \
                    '{
                        event_id: $id,
                        event_type: $type,
                        url: $u,
                        attempts: $att,
                        status: $st,
                        created_at: $created,
                        updated_at: $updated,
                        http_code: $hc
                    }' > "$state_file"
                echo "  webhook: delivered to $url (attempt $attempt, $http_code)"

                # track metrics
                metric-webhook "$event_type" "delivered" 0 2>/dev/null || true

                break
            else
                jq -n \
                    --arg id "$event_id" \
                    --arg type "$event_type" \
                    --arg u "$url" \
                    --argjson att "$attempt" \
                    --arg st "failed" \
                    --arg created "$timestamp" \
                    --arg updated "$updated_at" \
                    --arg hc "${http_code:-0}" \
                    --arg resp "${response:0:500}" \
                    '{
                        event_id: $id,
                        event_type: $type,
                        url: $u,
                        attempts: $att,
                        status: $st,
                        created_at: $created,
                        updated_at: $updated,
                        http_code: $hc,
                        last_response: $resp
                    }' > "$state_file"
                echo "  webhook: failed to $url (attempt $attempt, http $http_code)"

                # track metrics
                metric-webhook "$event_type" "failed" 0 2>/dev/null || true
            fi

            # retry with exponential backoff
            if [[ $attempt -lt $max_attempts ]]; then
                sleep "$delay"
                # exponential backoff with cap
                delay=$((delay * backoff_base))
                [[ $delay -gt $max_delay ]] && delay=$max_delay
            fi

            ((attempt++))
        done

        if [[ "$success" != "true" ]]; then
            echo "  webhook: gave up on $url after $max_attempts attempts"
        fi
    done

    return 0
}

# -------------------------------------------------------------------
# get-webhook-status: get recent webhook delivery status
# -------------------------------------------------------------------
get-webhook-status() {
    local chain_file="${1:-}"
    local chain_name=""

    if [[ -n "$chain_file" && -f "$chain_file" ]]; then
        chain_name=$(jq -r '.name' "$chain_file")
    fi

    echo ""
    echo "  webhook status:"
    echo "  ---"

    local found=0
    for state_file in "$WEBHOOK_STATE_DIR"/*.json; do
        [[ -f "$state_file" ]] || continue

        # filter by chain name if provided
        if [[ -n "$chain_name" ]]; then
            if ! jq -e ".event_id | contains(\"$chain_name\")" "$state_file" >/dev/null 2>&1; then
                continue
            fi
        fi

        found=1
        local event_type=$(jq -r '.event_type' "$state_file")
        local url=$(jq -r '.url' "$state_file")
        local status=$(jq -r '.status' "$state_file")
        local attempts=$(jq -r '.attempts' "$state_file")
        local created=$(jq -r '.created_at' "$state_file")
        local http_code=$(jq -r '.http_code // "N/A"' "$state_file")

        local status_icon="?"
        case "$status" in
            delivered) status_icon="✔" ;;
            failed) status_icon="✖" ;;
            pending) status_icon="◌" ;;
        esac

        printf "  %s  %-20s  %s  attempts: %s  %s\n" \
            "$status_icon" "$event_type" "$url" "$attempts" "$created"
    done

    if [[ $found -eq 0 ]]; then
        echo "  no webhook deliveries found"
    fi
    echo ""
}

# -------------------------------------------------------------------
# cleanup-webhook-state: remove old webhook state files
# -------------------------------------------------------------------
cleanup-webhook-state() {
    local days="${1:-7}"

    find "$WEBHOOK_STATE_DIR" -type f -name "*.json" -mtime "+$days" -delete 2>/dev/null
    echo "  cleaned webhook state older than ${days} days"
}

# -------------------------------------------------------------------
# fire-chain-webhooks: fire webhooks stored in metadata.webhooks array
# new format: [{id,name,url,events[],headers,secret,enabled}]
# called at chain started/completed/failed lifecycle points
# -------------------------------------------------------------------
fire-chain-webhooks() {
    local event_type="$1"   # started | completed | failed
    local chain_file="$2"
    local chain_id="${3:-}"
    local run_id="${4:-}"

    [[ ! -f "$chain_file" ]] && return 0

    local webhooks_json
    webhooks_json=$(jq -r '.metadata.webhooks // []' "$chain_file" 2>/dev/null)
    [[ "$webhooks_json" == "[]" || -z "$webhooks_json" ]] && return 0

    local chain_name
    chain_name=$(jq -r '.name // ""' "$chain_file" 2>/dev/null)
    local timestamp
    timestamp=$(date -Iseconds)

    local payload
    payload=$(jq -nc \
        --arg event "$event_type" \
        --arg chainId "${chain_id:-$chain_name}" \
        --arg chainName "$chain_name" \
        --arg runId "$run_id" \
        --arg timestamp "$timestamp" \
        '{event:$event,chainId:$chainId,runId:$runId,timestamp:$timestamp,chain:{name:$chainName}}')

    local count=0
    while IFS= read -r webhook_json; do
        local enabled events_match url secret
        enabled=$(echo "$webhook_json" | jq -r '.enabled // true')
        [[ "$enabled" != "true" ]] && continue

        events_match=$(echo "$webhook_json" | jq -r --arg ev "$event_type" '.events | map(. == $ev) | any')
        [[ "$events_match" != "true" ]] && continue

        url=$(echo "$webhook_json" | jq -r '.url // ""')
        [[ -z "$url" ]] && continue

        secret=$(echo "$webhook_json" | jq -r '.secret // ""')

        local curl_args=(-s -X POST "$url"
            -H "Content-Type: application/json"
            -H "X-Webhook-Event: $event_type"
            -H "X-Webhook-Chain: ${chain_id:-$chain_name}"
            -H "X-Webhook-Timestamp: $timestamp"
            -H "User-Agent: mentiko/1.0"
            --max-time 10
            -d "$payload")

        if [[ -n "$secret" ]]; then
            local sig
            sig=$(echo -n "$payload" | openssl dgst -sha256 -hmac "$secret" 2>/dev/null | awk '{print $2}')
            curl_args+=(-H "X-Webhook-Signature: sha256=$sig")
        fi

        # fire and forget
        curl "${curl_args[@]}" 2>/dev/null || true &
        count=$((count + 1))
        echo "  webhook[$event_type]: $url"
    done < <(echo "$webhooks_json" | jq -c '.[]')

    [[ $count -gt 0 ]] && wait 2>/dev/null || true
}

# exports
export -f send-webhook
export -f get-webhook-status
export -f cleanup-webhook-state
export -f fire-chain-webhooks

echo "  mentiko: webhook functions loaded"
