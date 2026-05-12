#!/bin/bash
# team-mux-bridge.sh - Bridge between mentiko and team-mux systems
#
# usage:
#   team-mux-bridge.sh import <agent-spec>     import team-mux agent to chain format
#   team-mux-bridge.sh export <chain.json>     export chain agents as team-mux specs
#   team-mux-bridge.sh memory <agent-id>       read agent memory as context
#
# the bridge allows:
# 1. converting team-mux agent specs to chain.json agents
# 2. exporting chain agents as team-mux compatible specs
# 3. reading synapse memory files for agent context

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# -------------------------------------------------------------------
# config
# -------------------------------------------------------------------

CMD="${1:-}"
shift || true

# team-mux paths (auto-detect)
TEAMMUX_LOCAL="${TEAMMUX_LOCAL:-}"
TEAMMUX_GLOBAL="${TEAMMUX_GLOBAL:-$HOME/.team_mux}"

# find project-local team-mux
_find_teammux_local() {
    local root
    root="${MENTIKO_GLOBAL_ROOT:-$HOME/.mentiko}"
    if [[ -d "$root/.team_mux" ]]; then
        echo "$root/.team_mux"
    fi
}

TEAMMUX_LOCAL="$(_find_teammux_local)"

# -------------------------------------------------------------------
# import: convert team-mux agent to chain.json agent
# -------------------------------------------------------------------
import_agent() {
    local agent_path="$1"

    if [[ -z "$agent_path" || ! -d "$agent_path" ]]; then
        echo "usage: team-mux-bridge.sh import <agent-path>"
        echo "  agent-path should be like: .team_mux/agents/c-level/my-agent"
        exit 1
    fi

    local agent_id=$(basename "$agent_path")
    local agent_config="$agent_path/configurations/agent-spec.json"

    if [[ ! -f "$agent_config" ]]; then
        # try README.md fallback
        local readme="$agent_path/README.md"
        if [[ -f "$readme" ]]; then
            _import_from_readme "$agent_path" "$readme"
            return
        fi

        echo "  error: no agent-spec.json or README.md found in $agent_path"
        exit 1
    fi

    # check jq
    if ! command -v jq &> /dev/null; then
        echo "  error: jq required"
        exit 1
    fi

    # read agent spec
    local agent_name=$(jq -r '.name // .agent_name // "'"$agent_id"'"' "$agent_config")
    local agent_role=$(jq -r '.role // .description // ""' "$agent_config")
    local agent_level=$(jq -r '.level // "team"' "$agent_config")
    local agent_dept=$(jq -r '.department // ""' "$agent_config")

    # build chain agent json
    cat <<EOF
{
  "id": "$agent_id",
  "name": "$agent_name",
  "role": "$agent_role",
  "triggers": ["manual-start"],
  "emits": "complete",
  "context": {
    "read_first": ["$agent_path/README.md"],
    "workspace": "workspace/$agent_id/"
  },
  "prompt": "You are $agent_name, a $agent_level-level agent in the $agent_dept department.\n\nRead your full spec at: $agent_path/\n\nFollow your procedures and playbooks from the README.md file.\n\nWhen complete, write your event file and output AGENT_COMPLETE.",
  "authorities": {
    "can": ["read project files", "write to workspace/$agent_id/"],
    "needs_approval": []
  }
}
EOF
}

_import_from_readme() {
    local agent_path="$1"
    local readme="$2"
    local agent_id=$(basename "$agent_path")

    # parse basic info from readme
    local agent_name=$(grep -m1 "^# " "$readme" | sed 's/^# //' || echo "$agent_id")
    local agent_role=$(grep -m1 "Role:" "$readme" | sed 's/.*Role:[[:space:]]*//' || echo "")

    cat <<EOF
{
  "id": "$agent_id",
  "name": "$agent_name",
  "role": "$agent_role",
  "triggers": ["manual-start"],
  "emits": "complete",
  "context": {
    "read_first": ["$readme"],
    "workspace": "workspace/$agent_id/"
  },
  "prompt": "You are $agent_name.\n\nRead your full spec at: $readme\n\nFollow your procedures and playbooks.\n\nWhen complete, write your event file and output AGENT_COMPLETE.",
  "authorities": {
    "can": ["read project files", "write to workspace/$agent_id/"],
    "needs_approval": []
  }
}
EOF
}

# -------------------------------------------------------------------
# export: convert chain.json agents to team-mux specs
# -------------------------------------------------------------------
export_chain() {
    local chain_file="$1"
    local output_dir="${2:-./teammux-export}"

    if [[ -z "$chain_file" || ! -f "$chain_file" ]]; then
        echo "usage: team-mux-bridge.sh export <chain.json> [output-dir]"
        exit 1
    fi

    if ! command -v jq &> /dev/null; then
        echo "  error: jq required"
        exit 1
    fi

    mkdir -p "$output_dir"

    local agent_count=$(jq '.agents | length' "$chain_file")

    echo "  exporting $agent_count agents to $output_dir"
    echo ""

    for i in $(seq 0 $((agent_count - 1))); do
        local agent_id=$(jq -r ".agents[$i].id" "$chain_file")
        local agent_name=$(jq -r ".agents[$i].name" "$chain_file")
        local agent_role=$(jq -r ".agents[$i].role // \"\"" "$chain_file")
        local agent_prompt=$(jq -r ".agents[$i].prompt // \"\"" "$chain_file")

        local agent_dir="$output_dir/$agent_id"
        mkdir -p "$agent_dir"/{memory/{working,semantic,episodic},projects/{active,completed,planned},knowledge,reports,inbox,configurations,documentation}

        # write README as agent spec
        cat > "$agent_dir/README.md" <<SPEC
# $agent_name

**Agent ID**: $agent_id
**Role**: $agent_role

## Task
$agent_prompt

## Chain Context
This agent was exported from an mentiko definition.

## Memory Structure
- \`memory/working/\` - Current session memories
- \`memory/semantic/\` - Learned knowledge and procedures
- \`memory/episodic/\` - Historical events and outcomes

## Working Directories
- \`projects/active/\` - Current projects
- \`projects/completed/\` - Finished work
- \`knowledge/\` - Reference materials
- \`reports/\` - Output and deliverables
SPEC

        # write agent-spec.json for team-mux
        cat > "$agent_dir/configurations/agent-spec.json" <<JSON
{
  "name": "$agent_name",
  "agent_id": "$agent_id",
  "role": "$agent_role",
  "level": "team",
  "department": "chain-exported",
  "created": "$(date -Iseconds)",
  "source_chain": "$(basename "$chain_file")"
}
JSON

        echo "  exported: $agent_id"
    done

    echo ""
    echo "  done. import to team-mux with:"
    echo "    cp -r $output_dir/* ~/.team_mux/agents/team/"
}

# -------------------------------------------------------------------
# memory: read synapse memory for agent context
# -------------------------------------------------------------------
read_memory() {
    local agent_id="$1"
    local memory_type="${2:-all}"  # working, semantic, episodic, or all
    local project_context="${3:-}"

    # determine which team-mux to use
    local base="$TEAMMUX_LOCAL"
    if [[ -z "$base" || ! -d "$base" ]]; then
        base="$TEAMMUX_GLOBAL"
    fi

    if [[ -z "$base" || ! -d "$base" ]]; then
        echo "  error: team-mux directory not found"
        echo "  set TEAMMUX_LOCAL or ensure ~/.team_mux exists"
        exit 1
    fi

    # find agent directory
    local agent_dir=""
    for dir in "$base"/agents/*/"$agent_id"; do
        if [[ -d "$dir" ]]; then
            agent_dir="$dir"
            break
        fi
    done

    if [[ -z "$agent_dir" ]]; then
        echo "  error: agent '$agent_id' not found in team-mux"
        exit 1
    fi

    local mem_dir="$agent_dir/memory"

    if [[ ! -d "$mem_dir" ]]; then
        echo "  no memory directory found for $agent_id"
        return
    fi

    echo "  reading memory for: $agent_id"
    echo ""

    # read specified memory type(s)
    case "$memory_type" in
        working)
            _dump_memory "$mem_dir/working" "Working Memory"
            ;;
        semantic)
            _dump_memory "$mem_dir/semantic" "Semantic Memory"
            ;;
        episodic)
            _dump_memory "$mem_dir/episodic" "Episodic Memory"
            ;;
        all)
            _dump_memory "$mem_dir/working" "Working Memory"
            _dump_memory "$mem_dir/semantic" "Semantic Memory"
            _dump_memory "$mem_dir/episodic" "Episodic Memory"
            ;;
        *)
            echo "  error: memory_type must be: working, semantic, episodic, or all"
            exit 1
            ;;
    esac
}

_dump_memory() {
    local mem_path="$1"
    local label="$2"

    if [[ ! -d "$mem_path" ]]; then
        echo "  $label: (not found)"
        echo ""
        return
    fi

    echo "  $label:"
    echo "  ---"

    local found=0
    for mem_file in "$mem_path"/*.json; do
        [[ -f "$mem_file" ]] || continue
        found=1

        local timestamp=$(jq -r '.timestamp // "?"' "$mem_file" 2>/dev/null || echo "?")
        local summary=$(jq -r '.activity_summary // .summary // "no summary"' "$mem_file" 2>/dev/null || echo "error reading")

        printf "  [%s] %s\n" "$timestamp" "$summary"
    done

    if [[ $found -eq 0 ]]; then
        echo "  (empty)"
    fi
    echo ""
}

# -------------------------------------------------------------------
# help
# -------------------------------------------------------------------
show_help() {
    echo ""
    echo "  team-mux-bridge - bridge mentiko and team-mux systems"
    echo ""
    echo "  commands:"
    echo "    import <agent-path>              import team-mux agent as chain.json"
    echo "    export <chain.json> [output]      export chain agents as team-mux specs"
    echo "    memory <agent-id> [type]          read agent memory (working|semantic|episodic|all)"
    echo ""
    echo "  examples:"
    echo "    team-mux-bridge.sh import .team_mux/agents/c-level/eric-cto"
    echo "    team-mux-bridge.sh export examples/robin-engagement/chain.json ./tmux-specs"
    echo "    team-mux-bridge.sh memory eric-cto working"
    echo ""
}

# -------------------------------------------------------------------
# main
# -------------------------------------------------------------------

case "$CMD" in
    import)
        import_agent "$@"
        ;;
    export)
        export_chain "$@"
        ;;
    memory)
        read_memory "$@"
        ;;
    help|--help|-h|"")
        show_help
        ;;
    *)
        echo "  unknown command: $CMD"
        show_help
        exit 1
        ;;
esac
