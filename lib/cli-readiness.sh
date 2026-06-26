#!/usr/bin/env bash
# cli-readiness.sh - profile-driven startup state classification.

cli_readiness_json() {
    jq -nc \
        --arg status "$1" \
        --arg reason "${2:-}" \
        --arg pattern "${3:-}" \
        --arg action "${4:-}" \
        --arg risk "${5:-}" \
        '{
            status: $status,
            reason: $reason
        }
        + (if ($pattern | length) > 0 then { pattern: $pattern } else {} end)
        + (if ($action | length) > 0 then { action: $action } else {} end)
        + (if ($risk | length) > 0 then { risk: $risk } else {} end)'
}

cli_readiness_match_pattern() {
    local capture_file="$1"
    local pattern_type="$2"
    local pattern_value="$3"

    [[ ! -f "$capture_file" || -z "$pattern_value" ]] && return 1

    case "$pattern_type" in
        regex) grep -Eiq -- "$pattern_value" "$capture_file" ;;
        text|*) grep -Fq -- "$pattern_value" "$capture_file" ;;
    esac
}

cli_readiness_check_group() {
    local profile_file="$1"
    local capture_file="$2"
    local group="$3"
    local status="$4"

    jq -c --arg group "$group" '
        (.readiness[$group] // [])
        | .[]
        | select(.enabled != false)
    ' "$profile_file" 2>/dev/null | while IFS= read -r pattern_json; do
        local name type value action risk
        name=$(jq -r '.name // "unnamed pattern"' <<<"$pattern_json")
        type=$(jq -r '.type // "text"' <<<"$pattern_json")
        value=$(jq -r '.value // empty' <<<"$pattern_json")
        action=$(jq -r '.action // empty' <<<"$pattern_json")
        risk=$(jq -r '.risk // empty' <<<"$pattern_json")

        if cli_readiness_match_pattern "$capture_file" "$type" "$value"; then
            cli_readiness_json "$status" "matched ${name}" "$name" "$action" "$risk"
            return 0
        fi
    done
}

cli_readiness_check() {
    local profile_file="$1"
    local capture_file="$2"

    if [[ ! -f "$profile_file" ]]; then
        cli_readiness_json "unknown" "profile file missing"
        return 0
    fi

    local enabled
    enabled=$(jq -r '.readiness.enabled // false' "$profile_file" 2>/dev/null || echo "false")
    if [[ "$enabled" != "true" ]]; then
        # Fail-closed (opt-in via MENTIKO_READINESS_FAIL_CLOSED=1): a profile with no
        # readiness policy declares NO positive ready signal, so unattended chain
        # execution must NOT treat it as ready and inject task instructions. Default
        # (flag unset) preserves the legacy permissive behavior so existing tenants
        # don't break — roll out per profile by adding ready_patterns, then the flag.
        if [[ "${MENTIKO_READINESS_FAIL_CLOSED:-0}" == "1" ]]; then
            cli_readiness_json "no_ready_signal" "readiness not enabled (fail-closed)"
            return 0
        fi
        cli_readiness_json "ready" "readiness disabled"
        return 0
    fi

    local result
    for spec in \
        "blocked_patterns blocked" \
        "recoverable_patterns recover" \
        "retry_patterns retry" \
        "ready_patterns ready"
    do
        local group status
        group="${spec%% *}"
        status="${spec##* }"
        result=$(cli_readiness_check_group "$profile_file" "$capture_file" "$group" "$status" || true)
        if [[ -n "$result" ]]; then
            printf '%s\n' "$result"
            return 0
        fi
    done

    local ready_count
    ready_count=$(jq -r '(.readiness.ready_patterns // []) | length' "$profile_file" 2>/dev/null || echo "0")
    if [[ "${ready_count:-0}" -eq 0 ]]; then
        # Enabled but no positive ready pattern (e.g. the codex profile today): under
        # fail-closed this is also "no ready signal" — there is nothing that can ever
        # prove readiness, so don't inject. Default preserves the legacy permissive
        # behavior; add ready_patterns to roll this profile onto the strict path.
        if [[ "${MENTIKO_READINESS_FAIL_CLOSED:-0}" == "1" ]]; then
            cli_readiness_json "no_ready_signal" "readiness enabled but no ready_patterns configured (fail-closed)"
            return 0
        fi
        cli_readiness_json "ready" "no ready patterns configured"
        return 0
    fi

    cli_readiness_json "unknown" "no readiness pattern matched"
}
