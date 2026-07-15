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

# Typed git status/history/diff contract boundary. Git itself remains the
# external product CLI; shell only forwards primitive arguments and never
# parses or serializes the returned records.
_git_integration_cli() {
    local cli="${MENTIKO_CODE_ROOT:?MENTIKO_CODE_ROOT must be configured}/lib/runner-git-integration.js"
    if ! command -v node >/dev/null 2>&1; then
        echo "  mentiko: node is required for typed git integration" >&2
        return 1
    fi
    if [[ ! -f "$cli" ]]; then
        echo "  mentiko: typed git integration bundle missing: $cli" >&2
        return 1
    fi
    node "$cli" "$@"
}

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
    # NOTE: printf, not a heredoc. git_init_chain is `export -f`'d; a heredoc body can fail to
    # serialize through export -f on some bash builds. Multi-arg printf '%s\n' has no embedded
    # newlines, so it round-trips cleanly and emits the same file (trailing newline included).
    printf '%s\n' \
        '# state files' \
        '*.state' \
        '*.event' \
        '' \
        '# temp files' \
        '.tmp/' \
        '*.tmp' \
        '.rollback-backup/' \
        '' \
        '# cache' \
        '.cache/' \
        '' \
        '# IDE' \
        '.idea/' \
        '.vscode/' \
        '*.swp' \
        '*.swo' \
        > .gitignore

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
    _git_integration_cli status \
        --chain-dir "$1" \
        --format "${2:-json}"
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
    _git_integration_cli history \
        --chain-dir "$1" \
        --max-count "${2:-50}" \
        --format "${3:-json}"
}

# -------------------------------------------------------------------
# git_diff_commits: show diff between two commits
# -------------------------------------------------------------------
git_diff_commits() {
    _git_integration_cli diff \
        --chain-dir "$1" \
        --from "${2:-HEAD}" \
        --to "${3:-HEAD}" \
        --format "${4:-json}"
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
    _git_integration_cli branches \
        --chain-dir "$1" \
        --format "${2:-json}"
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
    _git_integration_cli conflicts \
        --chain-dir "$1" \
        --format "${2:-json}"
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
    _git_integration_cli commit-info \
        --chain-dir "$1" \
        --commit "${2:-HEAD}" \
        --format "${3:-json}"
}

# -------------------------------------------------------------------
# git_compare_branches: compare two branches
# -------------------------------------------------------------------
git_compare_branches() {
    _git_integration_cli compare \
        --chain-dir "$1" \
        --branch1 "${2:-HEAD}" \
        --branch2 "${3:-main}" \
        --format "${4:-json}"
}

# -------------------------------------------------------------------
# git_get_stash_list: list stashed changes
# -------------------------------------------------------------------
git_get_stash_list() {
    _git_integration_cli stash-list \
        --chain-dir "$1" \
        --format "${2:-json}"
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
export -f _git_integration_cli
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
