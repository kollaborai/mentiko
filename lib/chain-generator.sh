#!/bin/bash
# chain-generator.sh - AI-powered chain.json generator
#
# usage:
#   chain-generator.sh "<prompt>" [--output <dir>] [--template <file>] [--json]
#
# takes natural language description, generates valid chain.json

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Load config
source "$SCRIPT_DIR/config.sh"

# -------------------------------------------------------------------
# config
# -------------------------------------------------------------------

PROMPT="${1:-}"
OUTPUT_DIR="${OUTPUT_DIR:-.}"
TEMPLATE_FILE="${TEMPLATE_FILE:-}"
JSON_OUTPUT="${JSON_OUTPUT:-false}"
RAW_OUTPUT="${RAW_OUTPUT:-false}"

# ai cli to use for generation
GEN_CLI="${DEFAULT_CLI:-glm}"
GEN_SCHEMA="$SCRIPT_DIR/schema.json"

# -------------------------------------------------------------------
# parse args
# -------------------------------------------------------------------

shift || true
while [[ $# -gt 0 ]]; do
    case "$1" in
        --output) OUTPUT_DIR="$2"; shift 2 ;;
        --template) TEMPLATE_FILE="$2"; shift 2 ;;
        --json) JSON_OUTPUT=true; shift ;;
        --raw) RAW_OUTPUT=true; shift ;;
        *) shift ;;
    esac
done

if [[ -z "$PROMPT" ]]; then
    if [[ "$JSON_OUTPUT" == "true" ]]; then
        jq -n '{error: "prompt required", usage: "chain-generator.sh \"<prompt>\" [--output dir] [--template file] [--json]"}'
    else
        echo "usage: chain-generator.sh \"<prompt>\" [--output <dir>] [--template <file>] [--json]"
    fi
    exit 1
fi

# ensure output dir exists
mkdir -p "$OUTPUT_DIR"

# -------------------------------------------------------------------
# check dependencies
# -------------------------------------------------------------------

if ! command -v jq &> /dev/null; then
    if [[ "$JSON_OUTPUT" == "true" ]]; then
        jq -n '{error: "jq required"}'
    else
        echo "  error: jq required but not installed"
    fi
    exit 1
fi

if ! command -v "$GEN_CLI" &> /dev/null; then
    # fallback to claude if configured cli not available
    if command -v claude &> /dev/null; then
        GEN_CLI="claude"
    else
        if [[ "$JSON_OUTPUT" == "true" ]]; then
            jq -n '{error: "ai cli required (configured cli or claude)"}'
        else
            echo "  error: $GEN_CLI not found, and no fallback available"
        fi
        exit 1
    fi
fi

# -------------------------------------------------------------------
# build generation prompt
# -------------------------------------------------------------------

# read template if provided
TEMPLATE_CONTEXT=""
if [[ -n "$TEMPLATE_FILE" && -f "$TEMPLATE_FILE" ]]; then
    TEMPLATE_CONTEXT="
REFERENCE TEMPLATE (use as pattern, adapt for new use case):
$(cat "$TEMPLATE_FILE")"
fi

# read schema for validation reference
SCHEMA_CONTEXT=""
if [[ -f "$GEN_SCHEMA" ]]; then
    SCHEMA_CONTEXT="
JSON SCHEMA (your output MUST match this structure):
$(cat "$GEN_SCHEMA")"
fi

GENERATION_PROMPT="You are an AI chain generator. Generate a valid mentiko chain.json file from the user's request.

USER REQUEST:
$PROMPT

$TEMPLATE_CONTEXT

$SCHEMA_CONTEXT

REQUIREMENTS:
1. Output ONLY a valid JSON object. No markdown, no explanation, no code blocks.
2. The JSON must be valid according to the schema above.
3. All agents must have: id, name, triggers (array), emits (string)
4. triggers can include: manual-start, or event names from other agents' emits
5. Create a sensible flow: agent A emits X, agent B triggers on X, emits Y, etc.
6. For review loops: make the reviewer emit either 'approved' or 'needs-revision'
   and make the first agent also trigger on 'needs-revision'
7. Default cli should be '\${DEFAULT_CLI}' (or user can override per agent)
8. Include inline prompts for each agent - keep them clear and actionable
9. Set max_rounds to 3 for chains with review loops
10. Set session_prefix to something short and descriptive

OUTPUT FORMAT:
Raw JSON only. No backticks, no 'json' label, nothing but the JSON object."

# -------------------------------------------------------------------
# call ai to generate
# -------------------------------------------------------------------

if [[ "$JSON_OUTPUT" == "true" ]]; then
    jq -n '{"status": "generating", "prompt": $p}' --arg p "$PROMPT"
else
    echo "  generating chain from prompt..."
    echo "  prompt: $PROMPT"
    echo "  cli: $GEN_CLI"
    echo ""
fi

# capture generation output (unset CLAUDECODE to avoid nesting detection)
GENERATED_OUTPUT=$(unset CLAUDECODE; $GEN_CLI -p "$GENERATION_PROMPT" 2>/dev/null || echo "")

# clean the output (remove markdown code blocks if present)
CLEANED_JSON=$(echo "$GENERATED_OUTPUT" | sed 's/^```json//' | sed 's/^```//' | sed 's/```$//' | tr -d '\n' | sed 's/  */ /g' | sed 's/}/}\n/g' | grep -v '^$' | head -1)

# if cleaning failed, try raw
if ! echo "$CLEANED_JSON" | jq empty 2>/dev/null; then
    CLEANED_JSON=$(echo "$GENERATED_OUTPUT" | grep -A1000 '{' | grep -B1000 '}' | head -1)
fi

# -------------------------------------------------------------------
# validate generated json
# -------------------------------------------------------------------

if ! echo "$CLEANED_JSON" | jq empty 2>/dev/null; then
    if [[ "$JSON_OUTPUT" == "true" ]]; then
        jq -n '{error: "generated invalid json", raw: $raw}' --arg raw "$CLEANED_JSON"
    else
        echo "  error: ai generated invalid json"
        echo "  raw output:"
        echo "$CLEANED_JSON" | head -20
    fi
    exit 1
fi

# validate against schema if jq supports validate
if jq -e '.required' "$GEN_SCHEMA" &>/dev/null; then
    # basic validation: check required fields
    CHAIN_NAME=$(echo "$CLEANED_JSON" | jq -r '.name // empty')
    AGENT_COUNT=$(echo "$CLEANED_JSON" | jq '.agents | length // 0')

    if [[ -z "$CHAIN_NAME" ]]; then
        if [[ "$JSON_OUTPUT" == "true" ]]; then
            jq -n '{error: "missing required field: name"}'
        else
            echo "  error: generated chain missing 'name' field"
        fi
        exit 1
    fi

    if [[ "$AGENT_COUNT" -lt 1 ]]; then
        if [[ "$JSON_OUTPUT" == "true" ]]; then
            jq -n '{error: "chain must have at least 1 agent"}'
        else
            echo "  error: generated chain has no agents"
        fi
        exit 1
    fi
fi

# -------------------------------------------------------------------
# write output
# -------------------------------------------------------------------

CHAIN_FILE="$OUTPUT_DIR/chain.json"

echo "$CLEANED_JSON" > "$CHAIN_FILE"

# create spec files if agents reference them
mkdir -p "$OUTPUT_DIR/specs"

for i in $(seq 0 $((AGENT_COUNT - 1))); do
    AGENT_ID=$(echo "$CLEANED_JSON" | jq -r ".agents[$i].id")
    AGENT_SPEC=$(echo "$CLEANED_JSON" | jq -r ".agents[$i].spec // empty")

    if [[ -n "$AGENT_SPEC" && ! -f "$OUTPUT_DIR/$AGENT_SPEC" ]]; then
        # generate spec file from inline prompt
        AGENT_NAME=$(echo "$CLEANED_JSON" | jq -r ".agents[$i].name")
        AGENT_ROLE=$(echo "$CLEANED_JSON" | jq -r ".agents[$i].role // \"\"")
        AGENT_PROMPT=$(echo "$CLEANED_JSON" | jq -r ".agents[$i].prompt // \"\"")

        cat > "$OUTPUT_DIR/$AGENT_SPEC" <<SPEC
# $AGENT_NAME

session-prefix: $AGENT_ID

## Role
$AGENT_ROLE

## Task
$AGENT_PROMPT

## Playbooks

### Deliverables
Write your outputs to the workspace specified in your chain config.

### Completion
When complete, emit your event and write AGENT_COMPLETE.
SPEC
    fi
done

# -------------------------------------------------------------------
# output results
# -------------------------------------------------------------------

if [[ "$RAW_OUTPUT" == "true" ]]; then
    cat "$CHAIN_FILE"
elif [[ "$JSON_OUTPUT" == "true" ]]; then
    cat "$CHAIN_FILE"
    # for backwards compat, could also do status wrapper
    # jq -n \
    #     --arg name "$CHAIN_NAME" \
    #     --arg file "$CHAIN_FILE" \
    #     --argjson agents "$AGENT_COUNT" \
    #     '{status: "success", name: $name, chain_file: $file, agent_count: $agents}'
else
    echo "  chain generated: $CHAIN_NAME"
    echo "  agents: $AGENT_COUNT"
    echo "  file: $CHAIN_FILE"
    echo ""
    echo "  chain graph:"
    echo "  ---"
    for i in $(seq 0 $((AGENT_COUNT - 1))); do
        local_id=$(echo "$CLEANED_JSON" | jq -r ".agents[$i].id")
        local_name=$(echo "$CLEANED_JSON" | jq -r ".agents[$i].name")
        local_triggers=$(echo "$CLEANED_JSON" | jq -r ".agents[$i].triggers | join(\", \")")
        local_emits=$(echo "$CLEANED_JSON" | jq -r ".agents[$i].emits")
        echo "  [$local_id] $local_name"
        echo "    triggers: $local_triggers"
        echo "    emits:    $local_emits"
        echo ""
    done
    echo "  next: mentiko validate $CHAIN_FILE"
    echo "       mentiko run $CHAIN_FILE"
fi
