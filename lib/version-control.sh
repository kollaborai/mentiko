#!/bin/bash
# version-control.sh - invocation-only boundary for the typed chain version contract.
#
# Chain/version JSON parsing, validation, path resolution, metadata mutation,
# rollback, and comparison live in web/lib/runner-v2/version-control.ts. These
# functions forward primitive arguments to the compiled Node entrypoint; this
# file owns no JSON contract and contains no shell fallback.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

_version_control_cli() {
    local cli="${MENTIKO_CODE_ROOT:?MENTIKO_CODE_ROOT must be configured}/lib/runner-version-control.js"
    if [[ ! -f "$cli" ]]; then
        echo "error: typed version-control bundle missing: $cli" >&2
        return 1
    fi
    node "$cli" "$@"
}

vc_parse_semver() {
    _version_control_cli parse-semver "$1"
}

vc_format_version() {
    _version_control_cli format-version "$1" "$2" "$3"
}

vc_bump_version() {
    local args=(bump-version "$1")
    [[ $# -ge 2 ]] && args+=("$2")
    _version_control_cli "${args[@]}"
}

vc_next_version() {
    local args=(next-version "$1")
    [[ $# -ge 2 ]] && args+=("$2")
    _version_control_cli "${args[@]}"
}

vc_get_versions_dir() {
    _version_control_cli versions-dir "$1"
}

vc_version_path() {
    _version_control_cli version-path "$1" "$2"
}

vc_version_exists() {
    _version_control_cli version-exists "$1" "$2"
}

vc_create_version() {
    local args=(create-version "$1" "$2")
    [[ $# -ge 3 ]] && args+=("$3")
    _version_control_cli "${args[@]}"
}

vc_list_versions() {
    _version_control_cli list-versions "$1"
}

vc_rollback() {
    _version_control_cli rollback "$1" "$2"
}

vc_diff_versions() {
    local args=(diff "$1")
    [[ $# -ge 2 ]] && args+=("$2")
    [[ $# -ge 3 ]] && args+=("$3")
    _version_control_cli "${args[@]}"
}

vc_compare_agents() {
    local args=(compare-agents "$1")
    [[ $# -ge 2 ]] && args+=("$2")
    [[ $# -ge 3 ]] && args+=("$3")
    _version_control_cli "${args[@]}"
}

vc_validate_version() {
    _version_control_cli validate-version "$1"
}

vc_get_metadata() {
    _version_control_cli metadata "$1" "$2"
}

export -f vc_parse_semver vc_format_version vc_bump_version vc_next_version
export -f vc_get_versions_dir vc_version_path vc_version_exists vc_create_version
export -f vc_list_versions vc_rollback vc_diff_versions vc_compare_agents
export -f vc_validate_version vc_get_metadata
