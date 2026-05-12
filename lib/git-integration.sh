#!/bin/bash
# git-integration.sh - git version control for chains
#
# usage:
#   source lib/git-integration.sh
#   git_init_chain <chain-dir>
#   git_commit_chain <chain-dir> <message>
#   git_get_history <chain-dir>
#   git_diff_commits <chain-dir> <from> <to>
#   git_revert_commit <chain-dir> <commit>
#   git_create_branch <chain-dir> <branch-name>
#   git_list_branches <chain-dir>
#   git_switch_branch <chain-dir> <branch-name>
#   git_merge_branch <chain-dir> <branch-name>
#   git_detect_conflicts <chain-dir>
#   git_resolve_conflict <chain-dir> <file> <side>

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# -------------------------------------------------------------------
# git_get_repo_dir: get the git repo dir for a chain
# -------------------------------------------------------------------
git_get_repo_dir() {
    local chain_dir="$1"
    echo "$chain_dir/.git"
}

# -------------------------------------------------------------------
# git_is_repo: check if chain dir is a git repo
# -------------------------------------------------------------------
git_is_repo() {
    local chain_dir="$1"
    local git_dir="$(git_get_repo_dir "$chain_dir")"
    [[ -d "$git_dir" ]]
}

# -------------------------------------------------------------------
# git_init_chain: initialize git repo for chain
# -------------------------------------------------------------------
git_init_chain() {
    local chain_dir="$1"
    local initial_branch="${2:-main}"

    if git_is_repo "$chain_dir"; then
        echo "already a git repo: $chain_dir"
        return 0
    fi

    cd "$chain_dir"
    git init -b "$initial_branch" >/dev/null 2>&1
    git config user.name "Agent Chain" >/dev/null 2>&1
    git config user.email "agent@chain.local" >/dev/null 2>&1

    # create .gitignore for chain-specific files
    cat > .gitignore <<'EOF'
# state files
*.state
*.event

# temp files
.tmp/
*.tmp
.rollback-backup/

# cache
.cache/

# IDE
.idea/
.vscode/
*.swp
*.swo
EOF

    # initial commit if chain.json exists
    if [[ -f "chain.json" ]]; then
        git add chain.json .gitignore 2>/dev/null || true
        git commit -m "Initial import" >/dev/null 2>&1 || true
    fi

    echo "initialized git repo with branch: $initial_branch"
}

# -------------------------------------------------------------------
# git_status: get working dir status
# -------------------------------------------------------------------
git_status() {
    local chain_dir="$1"
    local output_format="${2:-json}"

    if ! git_is_repo "$chain_dir"; then
        if [[ "$output_format" == "json" ]]; then
            echo '{"error":"not a git repo"}'
        else
            echo "not a git repo"
        fi
        return 1
    fi

    cd "$chain_dir"

    local staged=()
    local modified=()
    local untracked=()
    local branch
    branch=$(git branch --show-current 2>/dev/null || echo "HEAD")

    # parse status
    while IFS= read -r line; do
        local status="${line:0:2}"
        local file="${line:3}"
        case "$status" in
            "M ") staged+=("$file") ;;
            " M") modified+=("$file") ;;
            "MM") staged+=("$file"); modified+=("$file") ;;
            "A ") staged+=("$file") ;;
            "??") untracked+=("$file") ;;
        esac
    done < <(git status --porcelain 2>/dev/null || true)

    if [[ "$output_format" == "json" ]]; then
        jq -n \
            --arg branch "$branch" \
            --argjson staged "$(printf '%s\n' "${staged[@]:-}" | jq -R . | jq -s .)" \
            --argjson modified "$(printf '%s\n' "${modified[@]:-}" | jq -R . | jq -s .)" \
            --argjson untracked "$(printf '%s\n' "${untracked[@]:-}" | jq -R . | jq -s .)" \
            '{
                branch: $branch,
                staged: $staged,
                modified: $modified,
                untracked: $untracked,
                has_changes: ($staged | length > 0 or $modified | length > 0 or $untracked | length > 0)
            }'
    else
        echo "branch: $branch"
        [[ ${#staged[@]} -gt 0 ]] && echo "staged: ${staged[*]}"
        [[ ${#modified[@]} -gt 0 ]] && echo "modified: ${modified[*]}"
        [[ ${#untracked[@]} -gt 0 ]] && echo "untracked: ${untracked[*]}"
    fi
}

# -------------------------------------------------------------------
# git_commit_chain: commit changes with message
# -------------------------------------------------------------------
git_commit_chain() {
    local chain_dir="$1"
    local message="${2:-chore: update chain}"
    local files="${3:-.}"  # files to commit (default: all)

    if ! git_is_repo "$chain_dir"; then
        echo "error: not a git repo" >&2
        return 1
    fi

    cd "$chain_dir"

    # stage files
    if [[ "$files" == "." ]]; then
        git add -A 2>/dev/null || true
    else
        git add $files 2>/dev/null || true
    fi

    # check if there's anything to commit
    if git diff --cached --quiet 2>/dev/null; then
        echo "nothing to commit"
        return 0
    fi

    local commit_hash
    commit_hash=$(git commit -m "$message" 2>/dev/null | head -1 || true)

    if [[ -n "$commit_hash" ]]; then
        git rev-parse HEAD 2>/dev/null || echo "unknown"
    else
        git rev-parse HEAD 2>/dev/null || echo "unknown"
    fi
}

# -------------------------------------------------------------------
# git_get_history: get commit history
# -------------------------------------------------------------------
git_get_history() {
    local chain_dir="$1"
    local max_count="${2:-50}"
    local format="${3:-json}"

    if ! git_is_repo "$chain_dir"; then
        if [[ "$format" == "json" ]]; then
            echo '[]'
        else
            echo "not a git repo"
        fi
        return 1
    fi

    cd "$chain_dir"

    if [[ "$format" == "json" ]]; then
        git log -n "$max_count" --pretty=format:'{hash:"%H",short:"%h",author:"%an",date:"%ci",message:"%s"}' \
            | jq -R . | jq -s . '
                map(.message |= gsub("\""; "\\\""))
            '
    else
        git log -n "$max_count" --pretty=format:'%h|%an|%ci|%s' --abbrev-commit
    fi
}

# -------------------------------------------------------------------
# git_diff_commits: show diff between two commits
# -------------------------------------------------------------------
git_diff_commits() {
    local chain_dir="$1"
    local from_commit="${2:-HEAD}"
    local to_commit="${3:-}"
    local output_format="${4:-json}"

    if ! git_is_repo "$chain_dir"; then
        echo "error: not a git repo" >&2
        return 1
    fi

    cd "$chain_dir"

    local from_rev="$from_commit"
    local to_rev="${to_commit:-HEAD}"

    if [[ "$output_format" == "json" ]]; then
        # get diff as structured json
        local files_changed
        files_changed=$(git diff --name-status "$from_rev" "$to_rev" 2>/dev/null || true)

        local diff_array="[]"
        while IFS= read -r line; do
            [[ -z "$line" ]] && continue
            local status="${line:0:1}"
            local file="${line:2}"
            local diff_content=""
            diff_content=$(git diff "$from_rev" "$to_rev" -- "$file" 2>/dev/null | base64 2>/dev/null || echo "")

            diff_array=$(echo "$diff_array" | jq --arg status "$status" --arg file "$file" --arg diff "$diff_content" \
                '. += [{status: $status, file: $file, diff: $diff}]')
        done <<< "$files_changed"

        jq -n \
            --arg from "$from_rev" \
            --arg to "$to_rev" \
            --argjson files "$diff_array" \
            '{from: $from, to: $to, files: $files}'
    else
        git diff "$from_rev" "$to_rev" 2>/dev/null || true
    fi
}

# -------------------------------------------------------------------
# git_get_file_at_commit: get file content at specific commit
# -------------------------------------------------------------------
git_get_file_at_commit() {
    local chain_dir="$1"
    local commit="$2"
    local file="${3:-chain.json}"

    if ! git_is_repo "$chain_dir"; then
        echo "error: not a git repo" >&2
        return 1
    fi

    cd "$chain_dir"
    git show "${commit}:${file}" 2>/dev/null || echo ""
}

# -------------------------------------------------------------------
# git_revert_commit: revert to a specific commit
# -------------------------------------------------------------------
git_revert_commit() {
    local chain_dir="$1"
    local target_commit="$2"
    local create_branch="${3:-false}"

    if ! git_is_repo "$chain_dir"; then
        echo "error: not a git repo" >&2
        return 1
    fi

    cd "$chain_dir"

    # backup current state
    local backup_dir="$chain_dir/.git-backup"
    mkdir -p "$backup_dir"
    local backup_file="$backup_dir/chain.json.$(date +%Y%m%d-%H%M%S)"
    cp "$chain_dir/chain.json" "$backup_file" 2>/dev/null || true

    if [[ "$create_branch" == "true" ]]; then
        # create branch from commit
        local branch_name="revert-$(date +%Y%m%d-%H%M%S)"
        git checkout -b "$branch_name" "$target_commit" >/dev/null 2>&1
        echo "$branch_name"
    else
        # hard reset to commit
        git reset --hard "$target_commit" >/dev/null 2>&1
        echo "$target_commit"
    fi

    echo "backup: $backup_file"
}

# -------------------------------------------------------------------
# git_create_branch: create a new branch
# -------------------------------------------------------------------
git_create_branch() {
    local chain_dir="$1"
    local branch_name="$2"
    local start_point="${3:-HEAD}"

    if ! git_is_repo "$chain_dir"; then
        echo "error: not a git repo" >&2
        return 1
    fi

    cd "$chain_dir"

    # check if branch exists
    if git show-ref --verify --quiet "refs/heads/$branch_name" 2>/dev/null; then
        echo "branch already exists: $branch_name" >&2
        return 1
    fi

    git branch "$branch_name" "$start_point" 2>/dev/null
    echo "$branch_name"
}

# -------------------------------------------------------------------
# git_list_branches: list all branches
# -------------------------------------------------------------------
git_list_branches() {
    local chain_dir="$1"
    local format="${2:-json}"

    if ! git_is_repo "$chain_dir"; then
        if [[ "$format" == "json" ]]; then
            echo '[]'
        else
            echo "not a git repo"
        fi
        return 1
    fi

    cd "$chain_dir"

    local current_branch
    current_branch=$(git branch --show-current 2>/dev/null || echo "")

    if [[ "$format" == "json" ]]; then
        git branch -v --format='%(refname:short)|%(objectname:short)|%(authorname)|%(committerdate:iso8601)|%(contents:subject)' \
            | jq -R . | jq -s --arg current "$current_branch" '
                map(split("|") | {
                    name: .[0],
                    short: .[1],
                    author: .[2],
                    date: .[3],
                    message: .[4],
                    current: (.[0] == $current)
                })
            '
    else
        git branch -v
    fi
}

# -------------------------------------------------------------------
# git_switch_branch: switch to a branch
# -------------------------------------------------------------------
git_switch_branch() {
    local chain_dir="$1"
    local branch_name="$2"

    if ! git_is_repo "$chain_dir"; then
        echo "error: not a git repo" >&2
        return 1
    fi

    cd "$chain_dir"

    # check for uncommitted changes
    if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
        # stash changes
        git stash push -m "auto-stash before switch" >/dev/null 2>&1 || true
    fi

    git checkout "$branch_name" 2>/dev/null
    echo "$branch_name"
}

# -------------------------------------------------------------------
# git_delete_branch: delete a branch
# -------------------------------------------------------------------
git_delete_branch() {
    local chain_dir="$1"
    local branch_name="$2"
    local force="${3:-false}"

    if ! git_is_repo "$chain_dir"; then
        echo "error: not a git repo" >&2
        return 1
    fi

    cd "$chain_dir"

    local current_branch
    current_branch=$(git branch --show-current 2>/dev/null || echo "")

    if [[ "$branch_name" == "$current_branch" ]]; then
        echo "error: cannot delete current branch" >&2
        return 1
    fi

    if [[ "$force" == "true" ]]; then
        git branch -D "$branch_name" 2>/dev/null
    else
        git branch -d "$branch_name" 2>/dev/null
    fi
}

# -------------------------------------------------------------------
# git_merge_branch: merge a branch into current
# -------------------------------------------------------------------
git_merge_branch() {
    local chain_dir="$1"
    local source_branch="$2"
    local strategy="${3:-}"

    if ! git_is_repo "$chain_dir"; then
        echo "error: not a git repo" >&2
        return 1
    fi

    cd "$chain_dir"

    local merge_args=""
    [[ -n "$strategy" ]] && merge_args="--strategy=$strategy"

    local output
    output=$(git merge $merge_args "$source_branch" 2>&1) || true

    # check for conflicts
    if git status --porcelain | grep -q "^UU"; then
        echo "conflicts"
        return 1
    fi

    echo "merged"
}

# -------------------------------------------------------------------
# git_detect_conflicts: check for merge conflicts
# -------------------------------------------------------------------
git_detect_conflicts() {
    local chain_dir="$1"

    if ! git_is_repo "$chain_dir"; then
        return 1
    fi

    cd "$chain_dir"

    local conflicted_files
    conflicted_files=$(git diff --name-only --diff-filter=U 2>/dev/null || true)

    if [[ -z "$conflicted_files" ]]; then
        if [[ "$2" == "json" ]]; then
            echo '[]'
        fi
        return 0
    fi

    if [[ "$2" == "json" ]]; then
        echo "$conflicted_files" | jq -R . | jq -s '{conflicts: .}'
    else
        echo "$conflicted_files"
    fi
}

# -------------------------------------------------------------------
# git_resolve_conflict: resolve a conflict by accepting one side
# -------------------------------------------------------------------
git_resolve_conflict() {
    local chain_dir="$1"
    local file="$2"
    local side="${3:-theirs}"  # ours | theirs | union

    if ! git_is_repo "$chain_dir"; then
        echo "error: not a git repo" >&2
        return 1
    fi

    cd "$chain_dir"

    case "$side" in
        ours)
            git checkout --ours "$file" 2>/dev/null
            git add "$file" 2>/dev/null
            ;;
        theirs)
            git checkout --theirs "$file" 2>/dev/null
            git add "$file" 2>/dev/null
            ;;
        union)
            # merge both sides (simple line-based union)
            git checkout --ours "$file" 2>/dev/null
            local ours_content
            ours_content=$(cat "$file" 2>/dev/null || echo "")
            git checkout --theirs "$file" 2>/dev/null
            local theirs_content
            theirs_content=$(cat "$file" 2>/dev/null || echo "")
            echo "$ours_content" > "$file"
            echo "$theirs_content" >> "$file"
            git add "$file" 2>/dev/null
            ;;
        *)
            echo "error: invalid side. use ours, theirs, or union" >&2
            return 1
            ;;
    esac

    echo "resolved: $file (accepted $side)"
}

# -------------------------------------------------------------------
# git_abort_merge: abort the current merge
# -------------------------------------------------------------------
git_abort_merge() {
    local chain_dir="$1"

    if ! git_is_repo "$chain_dir"; then
        echo "error: not a git repo" >&2
        return 1
    fi

    cd "$chain_dir"
    git merge --abort 2>/dev/null || true
    echo "merge aborted"
}

# -------------------------------------------------------------------
# git_get_commit_info: get detailed info about a commit
# -------------------------------------------------------------------
git_get_commit_info() {
    local chain_dir="$1"
    local commit="$2"
    local format="${3:-json}"

    if ! git_is_repo "$chain_dir"; then
        echo "error: not a git repo" >&2
        return 1
    fi

    cd "$chain_dir"

    if [[ "$format" == "json" ]]; then
        local info
        info=$(git show -s --format='{
            hash: "%H",
            short: "%h",
            author: "%an",
            author_email: "%ae",
            date: "%ci",
            message: "%s",
            body: "%b"
        }' "$commit" 2>/dev/null || echo '{}')

        # get files changed
        local files
        files=$(git show --name-status --format="" "$commit" 2>/dev/null | jq -R . | jq -s . || echo '[]')

        echo "$info" | jq --argjson files "$files" '. + {files: $files}'
    else
        git show --stat "$commit" 2>/dev/null || true
    fi
}

# -------------------------------------------------------------------
# git_compare_branches: compare two branches
# -------------------------------------------------------------------
git_compare_branches() {
    local chain_dir="$1"
    local branch1="${2:-HEAD}"
    local branch2="${3:-main}"

    if ! git_is_repo "$chain_dir"; then
        echo "error: not a git repo" >&2
        return 1
    fi

    cd "$chain_dir"

    local ahead behind
    ahead=$(git rev-list --count "$branch2..$branch1" 2>/dev/null || echo "0")
    behind=$(git rev-list --count "$branch1..$branch2" 2>/dev/null || echo "0")

    if [[ "$4" == "json" ]]; then
        jq -n \
            --arg branch1 "$branch1" \
            --arg branch2 "$branch2" \
            --argjson ahead "$ahead" \
            --argjson behind "$behind" \
            '{branch1: $branch1, branch2: $branch2, ahead: $ahead, behind: $behind}'
    else
        echo "$branch1 is $ahead commits ahead of $branch2"
        echo "$branch1 is $behind commits behind $branch2"
    fi
}

# -------------------------------------------------------------------
# git_get_stash_list: list stashed changes
# -------------------------------------------------------------------
git_get_stash_list() {
    local chain_dir="$1"
    local format="${2:-json}"

    if ! git_is_repo "$chain_dir"; then
        echo "error: not a git repo" >&2
        return 1
    fi

    cd "$chain_dir"

    if [[ "$format" == "json" ]]; then
        git stash list --format='{stash: "%H", branch: "%B", message: "%s", date: "%ci"}' \
            | jq -R . | jq -s .
    else
        git stash list
    fi
}

# -------------------------------------------------------------------
# git_stash_pop: pop the most recent stash
# -------------------------------------------------------------------
git_stash_pop() {
    local chain_dir="$1"
    local stash_ref="${2:-stash@{0}}"

    if ! git_is_repo "$chain_dir"; then
        echo "error: not a git repo" >&2
        return 1
    fi

    cd "$chain_dir"
    git stash pop "$stash_ref" 2>/dev/null
    echo "stash popped"
}

# export functions
export -f git_get_repo_dir
export -f git_is_repo
export -f git_init_chain
export -f git_status
export -f git_commit_chain
export -f git_get_history
export -f git_diff_commits
export -f git_get_file_at_commit
export -f git_revert_commit
export -f git_create_branch
export -f git_list_branches
export -f git_switch_branch
export -f git_delete_branch
export -f git_merge_branch
export -f git_detect_conflicts
export -f git_resolve_conflict
export -f git_abort_merge
export -f git_get_commit_info
export -f git_compare_branches
export -f git_get_stash_list
export -f git_stash_pop
