#!/bin/bash
# token-extractor.sh - parse token usage from agent session output
#
# Usage:
#   source token-extractor.sh
#   extract-tokens-from-output <output-file> <run-id> <chain-name> <agent-id> [agent-name] [model]
#
# Parses patterns from Claude Code, OpenAI, and generic output.
# Calls /api/tokens/record to persist the usage.

extract-tokens-from-output() {
    local output_file="${1:-}"
    local run_id="${2:-}"
    local chain_name="${3:-}"
    local agent_id="${4:-}"
    local agent_name="${5:-$agent_id}"
    local model="${6:-}"

    [[ -z "$output_file" || ! -f "$output_file" ]] && return 0
    [[ -z "$run_id" || -z "$chain_name" || -z "$agent_id" ]] && return 0

    local input_tokens=0
    local output_tokens=0
    local cache_read_tokens=0
    local cache_write_tokens=0
    local provider="unknown"

    # -----------------------------------------------------------------------
    # Claude Code patterns
    # e.g. "Tokens: 1234 input, 567 output"
    #      "Usage: input_tokens=1234 output_tokens=567"
    #      JSON usage block: {"input_tokens":1234,"output_tokens":567,...}
    # -----------------------------------------------------------------------

    # Pattern: "Tokens: NNN input, NNN output"
    local tok_line
    tok_line=$(grep -im1 'tokens:.*input.*output\|input.*tokens.*output.*tokens' "$output_file" 2>/dev/null | head -1 || true)
    if [[ -n "$tok_line" ]]; then
        input_tokens=$(echo "$tok_line" | grep -oP '[\d,]+(?=\s*input)' | tr -d ',' | head -1 || echo 0)
        output_tokens=$(echo "$tok_line" | grep -oP '[\d,]+(?=\s*output)' | tr -d ',' | head -1 || echo 0)
        provider="claude"
    fi

    # Pattern: Claude Code summary line "Tokens used: X input (Y cache read) / Z output"
    if [[ "$input_tokens" -eq 0 ]]; then
        local summary_line
        summary_line=$(grep -im1 'tokens used:' "$output_file" 2>/dev/null | head -1 || true)
        if [[ -n "$summary_line" ]]; then
            input_tokens=$(echo "$summary_line" | grep -oP '[\d,]+\s*input' | grep -oP '[\d,]+' | tr -d ',' | head -1 || echo 0)
            output_tokens=$(echo "$summary_line" | grep -oP '[\d,]+\s*output' | grep -oP '[\d,]+' | tr -d ',' | head -1 || echo 0)
            cache_read_tokens=$(echo "$summary_line" | grep -oP '[\d,]+\s*cache\s*read' | grep -oP '[\d,]+' | tr -d ',' | head -1 || echo 0)
            provider="claude"
        fi
    fi

    # Pattern: JSON block with usage (last occurrence wins — final message)
    if [[ "$input_tokens" -eq 0 ]]; then
        local json_usage
        json_usage=$(grep -o '"usage":{[^}]*}' "$output_file" 2>/dev/null | tail -1 || true)
        if [[ -n "$json_usage" ]]; then
            input_tokens=$(echo "$json_usage" | grep -oP '"input_tokens":\K\d+' | head -1 || echo 0)
            output_tokens=$(echo "$json_usage" | grep -oP '"output_tokens":\K\d+' | head -1 || echo 0)
            cache_read_tokens=$(echo "$json_usage" | grep -oP '"cache_read_input_tokens":\K\d+' | head -1 || echo 0)
            cache_write_tokens=$(echo "$json_usage" | grep -oP '"cache_creation_input_tokens":\K\d+' | head -1 || echo 0)
            provider="claude"
        fi
    fi

    # Pattern: "Total cost: $X.XX" (Claude Code footer) — backup detection
    if [[ "$provider" == "unknown" ]]; then
        local cost_line
        cost_line=$(grep -im1 'total cost:.*\$' "$output_file" 2>/dev/null | head -1 || true)
        [[ -n "$cost_line" ]] && provider="claude"
    fi

    # Pattern: OpenAI "completion_tokens": N, "prompt_tokens": N
    if [[ "$input_tokens" -eq 0 ]]; then
        local oai_usage
        oai_usage=$(grep -o '"prompt_tokens":[0-9]*\|"completion_tokens":[0-9]*' "$output_file" 2>/dev/null | tail -20 | tr '\n' ' ' || true)
        if [[ -n "$oai_usage" ]]; then
            # sum all prompt_tokens and completion_tokens (multiple messages)
            local pt ct
            pt=$(echo "$oai_usage" | grep -oP '"prompt_tokens":\K\d+' | awk '{s+=$1}END{print s+0}')
            ct=$(echo "$oai_usage" | grep -oP '"completion_tokens":\K\d+' | awk '{s+=$1}END{print s+0}')
            if [[ "${pt:-0}" -gt 0 || "${ct:-0}" -gt 0 ]]; then
                input_tokens="${pt:-0}"
                output_tokens="${ct:-0}"
                provider="openai"
            fi
        fi
    fi

    # -----------------------------------------------------------------------
    # auto-detect model from output if not provided
    # -----------------------------------------------------------------------
    if [[ -z "$model" ]]; then
        # Claude Code prints model near the top
        model=$(grep -im1 'claude-[a-z0-9-]*' "$output_file" 2>/dev/null | grep -oP 'claude-[a-z0-9.-]+' | head -1 || true)
        if [[ -z "$model" ]]; then
            model=$(grep -im1 'gpt-[0-9a-z-]*\|o[13]-[a-z-]*' "$output_file" 2>/dev/null | grep -oP '(gpt|o[13])-[a-z0-9.-]+' | head -1 || true)
        fi
        [[ -z "$model" && "$provider" == "claude" ]] && model="claude-sonnet-4-6"
        [[ -z "$model" && "$provider" == "openai" ]] && model="gpt-4o"
        [[ -z "$model" ]] && model="claude-sonnet-4-6"
    fi

    # sanitize integers
    input_tokens=$(echo "${input_tokens:-0}" | tr -d ',' | grep -oP '^\d+' || echo 0)
    output_tokens=$(echo "${output_tokens:-0}" | tr -d ',' | grep -oP '^\d+' || echo 0)
    cache_read_tokens=$(echo "${cache_read_tokens:-0}" | tr -d ',' | grep -oP '^\d+' || echo 0)
    cache_write_tokens=$(echo "${cache_write_tokens:-0}" | tr -d ',' | grep -oP '^\d+' || echo 0)

    # only record if we extracted something
    if [[ "${input_tokens:-0}" -gt 0 || "${output_tokens:-0}" -gt 0 ]]; then
        local BASE_URL="${BETTER_AUTH_URL:-http://localhost:3000}"
        local NS="${NAMESPACE_ID:-default}"

        curl -s -X POST "${BASE_URL}/api/tokens/record" \
            -H "Content-Type: application/json" \
            -H "Authorization: Bearer ${BETTER_AUTH_SECRET:-}" \
            -d "$(jq -nc \
                --arg runId "$run_id" \
                --arg chainName "$chain_name" \
                --arg agentId "$agent_id" \
                --arg agentName "$agent_name" \
                --arg provider "$provider" \
                --arg model "$model" \
                --argjson inputTokens "${input_tokens:-0}" \
                --argjson outputTokens "${output_tokens:-0}" \
                --argjson cacheReadTokens "${cache_read_tokens:-0}" \
                --argjson cacheWriteTokens "${cache_write_tokens:-0}" \
                --arg nsId "$NS" \
                '{runId:$runId,chainName:$chainName,agentId:$agentId,agentName:$agentName,provider:$provider,model:$model,inputTokens:$inputTokens,outputTokens:$outputTokens,cacheReadTokens:$cacheReadTokens,cacheWriteTokens:$cacheWriteTokens,namespaceId:$nsId}')" \
            2>/dev/null || true
        echo "  tokens recorded: input=$input_tokens output=$output_tokens model=$model"
    else
        echo "  tokens: no usage data found in output"
    fi
}
