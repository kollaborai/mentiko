#!/bin/bash
# version-control.sh - chain version management
#
# usage:
#   source lib/version-control.sh
#   vc_next_version <chain-dir> [increment-type]
#   vc_create_version <chain-dir> <version> <message>
#   vc_list_versions <chain-dir>
#   vc_rollback <chain-dir> <version>
#   vc_diff_versions <chain-dir> <from-version> <to-version>

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# semver regex
SEMVER_REGEX='^v?([0-9]+)\.([0-9]+)\.([0-9]+)$'

# -------------------------------------------------------------------
# vc_parse_semver: extract major.minor.patch from version string
# -------------------------------------------------------------------
vc_parse_semver() {
    local version="$1"

    if [[ "$version" =~ ^v ]]; then
        version="${version#v}"
    fi

    if [[ ! "$version" =~ $SEMVER_REGEX ]]; then
        echo "error: invalid semver: $version" >&2
        return 1
    fi

    echo "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}"
}

# -------------------------------------------------------------------
# vc_format_version: output version string
# -------------------------------------------------------------------
vc_format_version() {
    local major="$1"
    local minor="$2"
    local patch="$3"
    echo "${major}.${minor}.${patch}"
}

# -------------------------------------------------------------------
# vc_bump_version: increment version
# -------------------------------------------------------------------
vc_bump_version() {
    local version="$1"
    local increment="${2:-patch}"

    local major minor patch
    read -r major minor patch < <(vc_parse_semver "$version")

    case "$increment" in
        major)
            major=$((major + 1))
            minor=0
            patch=0
            ;;
        minor)
            minor=$((minor + 1))
            patch=0
            ;;
        patch|*)
            patch=$((patch + 1))
            ;;
    esac

    vc_format_version "$major" "$minor" "$patch"
}

# -------------------------------------------------------------------
# vc_next_version: get next version for a chain
# -------------------------------------------------------------------
vc_next_version() {
    local chain_dir="$1"
    local increment="${2:-patch}"

    local chain_file="$chain_dir/chain.json"

    if [[ ! -f "$chain_file" ]]; then
        echo "1.0.0"
        return 0
    fi

    local current_version
    current_version=$(jq -r '.version // "1.0.0"' "$chain_file" 2>/dev/null || echo "1.0.0")

    if [[ ! "$current_version" =~ $SEMVER_REGEX ]]; then
        echo "1.0.0"
        return 0
    fi

    vc_bump_version "$current_version" "$increment"
}

# -------------------------------------------------------------------
# vc_get_versions_dir: get versions directory for chain
# -------------------------------------------------------------------
vc_get_versions_dir() {
    local chain_dir="$1"
    echo "$chain_dir/versions"
}

# -------------------------------------------------------------------
# vc_version_path: get path to specific version
# -------------------------------------------------------------------
vc_version_path() {
    local chain_dir="$1"
    local version="$2"

    # strip leading v if present
    version="${version#v}"

    echo "$(vc_get_versions_dir "$chain_dir")/v${version}/chain.json"
}

# -------------------------------------------------------------------
# vc_version_exists: check if version exists
# -------------------------------------------------------------------
vc_version_exists() {
    local chain_dir="$1"
    local version="$2"

    local version_path
    version_path="$(vc_version_path "$chain_dir" "$version")"

    [[ -f "$version_path" ]]
}

# -------------------------------------------------------------------
# vc_create_version: archive current chain as a version
# -------------------------------------------------------------------
vc_create_version() {
    local chain_dir="$1"
    local version="$2"
    local message="${3:-}"

    local chain_file="$chain_dir/chain.json"
    local versions_dir="$(vc_get_versions_dir "$chain_dir")"
    local version_dir="$versions_dir/v${version}"
    local version_chain="$version_dir/chain.json"

    if [[ ! -f "$chain_file" ]]; then
        echo "error: chain file not found: $chain_file" >&2
        return 1
    fi

    mkdir -p "$version_dir"

    # copy chain.json
    cp "$chain_file" "$version_chain"

    # create metadata
    local metadata_file="$version_dir/metadata.json"
    local timestamp
    timestamp=$(date -Iseconds)
    local author="${GIT_AUTHOR_NAME:-${USER:-unknown}}"

    jq -n \
        --arg version "$version" \
        --arg timestamp "$timestamp" \
        --arg message "$message" \
        --arg author "$author" \
        '{
            version: $version,
            created: $timestamp,
            message: $message,
            author: $author
        }' > "$metadata_file"

    # copy changelog if exists
    if [[ -f "$chain_dir/CHANGELOG.md" ]]; then
        cp "$chain_dir/CHANGELOG.md" "$version_dir/"
    fi

    # update versions array in current chain
    local versions_array
    versions_array=$(jq --arg v "$version" --arg ts "$timestamp" --arg msg "$message" \
        '.versions += [{version: $v, created: $ts, message: $msg}] | .versions | sort_by(.created) | reverse' \
        "$chain_file" 2>/dev/null || echo '[]')

    jq --argjson versions "$versions_array" '.versions = $versions' "$chain_file" > "${chain_file}.tmp"
    mv "${chain_file}.tmp" "$chain_file"

    echo "v${version}"
}

# -------------------------------------------------------------------
# vc_list_versions: list all versions for a chain
# -------------------------------------------------------------------
vc_list_versions() {
    local chain_dir="$1"
    local versions_dir="$(vc_get_versions_dir "$chain_dir")"

    if [[ ! -d "$versions_dir" ]]; then
        return 0
    fi

    for v_dir in "$versions_dir"/v*; do
        if [[ -d "$v_dir" ]]; then
            local basename
            basename=$(basename "$v_dir")
            local version="${basename#v}"

            local metadata_file="$v_dir/metadata.json"
            local message=""
            local created=""

            if [[ -f "$metadata_file" ]]; then
                message=$(jq -r '.message // ""' "$metadata_file")
                created=$(jq -r '.created // ""' "$metadata_file")
            fi

            echo "$version|$created|$message"
        fi
    done | sort -V -r
}

# -------------------------------------------------------------------
# vc_rollback: restore chain to a specific version
# -------------------------------------------------------------------
vc_rollback() {
    local chain_dir="$1"
    local target_version="$2"

    local chain_file="$chain_dir/chain.json"
    local version_path
    version_path="$(vc_version_path "$chain_dir" "$target_version")"

    if [[ ! -f "$version_path" ]]; then
        echo "error: version not found: v${target_version}" >&2
        return 1
    fi

    # backup current before rollback
    local backup_dir="$chain_dir/.rollback-backup"
    mkdir -p "$backup_dir"
    local backup_file="$backup_dir/chain.json.$(date +%Y%m%d-%H%M%S)"
    cp "$chain_file" "$backup_file"
    echo "backed up current to: $backup_file"

    # restore version
    cp "$version_path" "$chain_file"

    # update version (keep same version but mark as rollback)
    local current_version
    current_version=$(jq -r '.version' "$chain_file")
    local new_version
    new_version="$(vc_next_version "$chain_dir" "patch")"

    jq --arg new_ver "$new_version" \
        '.version = $new_ver' "$chain_file" > "${chain_file}.tmp"
    mv "${chain_file}.tmp" "$chain_file"

    echo "rolled back from v${current_version} to v${target_version} (saved as v${new_version})"
    echo "backup at: $backup_file"
}

# -------------------------------------------------------------------
# vc_diff_versions: show diff between two versions
# -------------------------------------------------------------------
vc_diff_versions() {
    local chain_dir="$1"
    local from_version="${2:-}"
    local to_version="${3:-}"

    local chain_file="$chain_dir/chain.json"
    local versions_dir="$(vc_get_versions_dir "$chain_dir")"

    # if no versions specified, diff current vs latest versioned
    if [[ -z "$from_version" ]]; then
        from_version="current"
    fi
    if [[ -z "$to_version" ]]; then
        # get latest version
        to_version=$(ls -1 "$versions_dir" 2>/dev/null | grep -E '^v[0-9]' | sort -V | tail -1 || true)
        to_version="${to_version#v}"
    fi

    local from_path to_path

    if [[ "$from_version" == "current" ]]; then
        from_path="$chain_file"
    else
        from_path="$(vc_version_path "$chain_dir" "$from_version")"
    fi

    if [[ "$to_version" == "current" ]]; then
        to_path="$chain_file"
    else
        to_path="$(vc_version_path "$chain_dir" "$to_version")"
    fi

    if [[ ! -f "$from_path" ]]; then
        echo "error: version not found: $from_version" >&2
        return 1
    fi

    if [[ ! -f "$to_path" ]]; then
        echo "error: version not found: $to_version" >&2
        return 1
    fi

    echo "diff: $from_version -> $to_version"
    echo "---"
    diff -u "$from_path" "$to_path" || true
}

# -------------------------------------------------------------------
# vc_compare_agents: compare agents between versions
# -------------------------------------------------------------------
vc_compare_agents() {
    local chain_dir="$1"
    local from_version="${2:-}"
    local to_version="${3:-}"

    local from_path to_path

    if [[ "$from_version" == "current" ]] || [[ -z "$from_version" ]]; then
        from_path="$chain_dir/chain.json"
    else
        from_path="$(vc_version_path "$chain_dir" "$from_version")"
    fi

    if [[ "$to_version" == "current" ]] || [[ -z "$to_version" ]]; then
        to_path="$chain_dir/chain.json"
    else
        to_path="$(vc_version_path "$chain_dir" "$to_version")"
    fi

    if [[ ! -f "$from_path" ]] || [[ ! -f "$to_path" ]]; then
        echo "error: cannot find version files" >&2
        return 1
    fi

    # get agent lists
    local from_agents to_agents
    from_agents=$(jq -r '.agents[].id' "$from_path" 2>/dev/null | sort)
    to_agents=$(jq -r '.agents[].id' "$to_path" 2>/dev/null | sort)

    # added agents
    echo "agents added:"
    comm -13 <(echo "$from_agents") <(echo "$to_agents") | while read -r agent; do
        [[ -n "$agent" ]] && echo "  + $agent"
    done

    # removed agents
    echo ""
    echo "agents removed:"
    comm -23 <(echo "$from_agents") <(echo "$to_agents") | while read -r agent; do
        [[ -n "$agent" ]] && echo "  - $agent"
    done

    # modified agents (compare prompts)
    echo ""
    echo "agents modified:"
    for agent in $(comm -12 <(echo "$from_agents") <(echo "$to_agents")); do
        if [[ -n "$agent" ]]; then
            local from_prompt to_prompt
            from_prompt=$(jq -r --arg id "$agent" '.agents[] | select(.id == $id) | .prompt // ""' "$from_path" | md5 || echo "")
            to_prompt=$(jq -r --arg id "$agent" '.agents[] | select(.id == $id) | .prompt // ""' "$to_path" | md5 || echo "")

            if [[ "$from_prompt" != "$to_prompt" ]]; then
                echo "  ~ $agent"
            fi
        fi
    done
}

# -------------------------------------------------------------------
# vc_validate_version: check if version is valid semver
# -------------------------------------------------------------------
vc_validate_version() {
    local version="$1"
    [[ "$version" =~ $SEMVER_REGEX ]]
}

# -------------------------------------------------------------------
# vc_get_metadata: get metadata for a version
# -------------------------------------------------------------------
vc_get_metadata() {
    local chain_dir="$1"
    local version="$2"

    local version_dir="$(vc_get_versions_dir "$chain_dir")/v${version}"
    local metadata_file="$version_dir/metadata.json"

    if [[ -f "$metadata_file" ]]; then
        cat "$metadata_file"
    else
        echo '{"version":"'"$version"'","created":null,"message":"","author":""}'
    fi
}

# export functions
export -f vc_parse_semver
export -f vc_format_version
export -f vc_bump_version
export -f vc_next_version
export -f vc_get_versions_dir
export -f vc_version_path
export -f vc_version_exists
export -f vc_create_version
export -f vc_list_versions
export -f vc_rollback
export -f vc_diff_versions
export -f vc_compare_agents
export -f vc_validate_version
export -f vc_get_metadata
