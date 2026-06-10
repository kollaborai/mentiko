#!/bin/bash
# routing-lib.sh - Advanced routing patterns for agent chains
#
# provides:
#   - fan-out: single event triggers multiple agents in parallel
#   - fan-in: wait for multiple agents before triggering next
#   - error handling: route to specific agents on failure
#   - timeout detection: route to fallback agents on timeout
#   - retry logic: exponential backoff retry on failure

# -------------------------------------------------------------------
# portable critical-section lock (mkdir-based)
# -------------------------------------------------------------------
#
# Why mkdir and not flock(1): flock is absent on macOS/darwin (the engine ships
# to linux in prod, but the test suite must also pass on a developer mac), and
# it is not used anywhere else in this repo. mkdir(2) is atomic on POSIX
# filesystems — exactly one caller wins the create when the directory is absent —
# and it works identically under bash 3.2 (macOS) and bash 5.x (CI/linux).
#
# scheduler.sh uses a timestamp+pid "is it still running?" probe; that is a
# liveness check, NOT a mutual-exclusion primitive, so it is unsuitable for the
# read-modify-write here. This is a deliberate divergence, documented inline.
#
# Stale-lock strategy: the winning holder writes its pid into <lock>/pid. A
# caller that loses the mkdir breaks the lock only if the holder is provably gone
# — either the pid is dead (kill -0 fails) or the lock dir is older than
# FAN_LOCK_STALE_SECS (guards against a crashed holder, and against a recycled
# pid number that happens to be live). Breaking is itself raced safely: we
# rmdir the stale dir and immediately re-attempt the atomic mkdir, so two
# breakers cannot both proceed.

FAN_LOCK_STALE_SECS="${FAN_LOCK_STALE_SECS:-120}"   # a held fan lock older than this is treated as crashed
FAN_LOCK_WAIT_SECS="${FAN_LOCK_WAIT_SECS:-30}"      # max time to spin waiting for the lock

# _fan_lock_age <lock_dir> -> echoes age in seconds (0 if unknown)
_fan_lock_age() {
    local lock_dir="$1" mtime now
    # portable mtime: try GNU stat, then BSD stat; fall back to 0 (treat as fresh)
    mtime="$(stat -c %Y "$lock_dir" 2>/dev/null || stat -f %m "$lock_dir" 2>/dev/null || echo 0)"
    now="$(date +%s)"
    if [[ "$mtime" -gt 0 ]]; then echo $(( now - mtime )); else echo 0; fi
}

# _fan_lock_acquire <lock_dir> -> 0 on success, 1 on timeout
# Spins on an atomic mkdir; breaks a provably-stale lock (dead pid or aged out).
_fan_lock_acquire() {
    local lock_dir="$1"
    local waited=0
    while true; do
        if mkdir "$lock_dir" 2>/dev/null; then
            echo "$$" > "$lock_dir/pid" 2>/dev/null || true
            return 0
        fi
        # could not acquire — decide whether the current holder is dead/stale.
        local holder age
        holder="$(cat "$lock_dir/pid" 2>/dev/null || echo "")"
        age="$(_fan_lock_age "$lock_dir")"
        if { [[ -n "$holder" ]] && ! kill -0 "$holder" 2>/dev/null; } \
           || [[ "$age" -ge "$FAN_LOCK_STALE_SECS" ]]; then
            # holder is gone (or lock aged out). break it, then retry the mkdir.
            # rmdir is atomic; if another breaker already removed+recreated it,
            # our rmdir simply fails and we loop back to mkdir contention.
            rm -f "$lock_dir/pid" 2>/dev/null || true
            rmdir "$lock_dir" 2>/dev/null || true
            continue
        fi
        # holder alive and lock fresh — back off briefly and retry.
        if [[ "$waited" -ge "$FAN_LOCK_WAIT_SECS" ]]; then
            return 1
        fi
        sleep 0.05 2>/dev/null || sleep 1
        waited=$((waited + 1))
    done
}

# _fan_lock_release <lock_dir>
_fan_lock_release() {
    local lock_dir="$1"
    rm -f "$lock_dir/pid" 2>/dev/null || true
    rmdir "$lock_dir" 2>/dev/null || true
}

# _fan_num <state_file> <field> -> echoes the field's value as a clean integer.
# Robust against the leading whitespace `wc -w` injects on macOS (e.g.
# "total:        3"): grep the line, drop the "field:" label, then keep only the
# first run of digits. A non-numeric/empty field yields 0. This closes a latent
# premature-trigger bug: with `cut -d' ' -f2`, "total:    3" parsed as empty,
# making wait_for=all fire on the very first completer.
_fan_num() {
    local state_file="$1" field="$2" raw
    raw="$(grep "^${field}:" "$state_file" 2>/dev/null | head -1)"
    raw="${raw#${field}:}"                 # strip label
    raw="${raw//[!0-9]/}"                  # keep digits only
    [[ -z "$raw" ]] && raw=0
    printf '%s' "$raw"
}

# -------------------------------------------------------------------
# fan-out / fan-in state management
# -------------------------------------------------------------------

# create a fan-out group tracking state
fan-group-create() {
    local group_id="$1"
    local event_name="$2"
    local fan_out_agents="$3"  # space-separated agent ids
    local fan_in_agent="${4:-}"
    local wait_for="${5:-all}"
    local quorum="${6:-0}"
    local on_error="${7:-}"

    local state_dir="$STATE_DIR/fan-groups"
    mkdir -p "$state_dir"

    local state_file="$state_dir/${group_id}.state"

    cat > "$state_file" <<FEOF
status: running
started: $(date -Iseconds)
event: $event_name
fan_out_agents: $fan_out_agents
fan_in_agent: ${fan_in_agent:-}
wait_for: $wait_for
quorum: ${quorum:-0}
on_error: ${on_error:-}
completed: 0
failed: 0
total: $(echo "$fan_out_agents" | wc -w)
FEOF

    echo "$state_file"
}

# mark a fan-out agent as complete
#
# Concurrency: under N parallel completers the read -> increment -> full rewrite
# of the state file is a classic lost-update race, and the trigger decision has a
# TOCTOU against the running->triggered status flip. Both are now performed
# inside ONE critical section per group (a mkdir lock adjacent to the state
# file). The status flip and the launch-claim happen under the same lock, so the
# fan-in fires EXACTLY ONCE even if every completer evaluates should_trigger as
# true simultaneously. We launch the fan-in only AFTER releasing the lock, so the
# (potentially slow) child-process spawn never blocks other completers.
fan-group-agent-complete() {
    local group_id="$1"
    local agent_id="$2"
    local status="${3:-complete}"  # complete or failed

    local state_dir="$STATE_DIR/fan-groups"
    local state_file="$state_dir/${group_id}.state"
    local lock_dir="$state_file.lock"

    [[ ! -f "$state_file" ]] && return 1

    # --- critical section: increment counters + claim the trigger atomically ---
    if ! _fan_lock_acquire "$lock_dir"; then
        echo "  fan-group: WARNING could not acquire lock for $group_id (timed out)" >&2
        return 1
    fi

    # read current state (inside the lock — no other writer can interleave).
    # numerics go through _fan_num to survive macOS `wc -w` whitespace.
    local completed=$(_fan_num "$state_file" completed)
    local failed=$(_fan_num "$state_file" failed)

    # update counters
    if [[ "$status" == "complete" ]]; then
        completed=$((completed + 1))
    else
        failed=$((failed + 1))
    fi

    # preserve every other field on rewrite. crucially, preserve the CURRENT
    # status (it may already be "triggered"/"complete" from a prior claim) so the
    # rewrite below never resurrects a claimed group back to "running".
    local cur_status=$(grep "^status:" "$state_file" | cut -d' ' -f2-)
    local started=$(grep "^started:" "$state_file" | cut -d' ' -f2-)
    local event=$(grep "^event:" "$state_file" | cut -d' ' -f2-)
    local fan_out_agents=$(grep "^fan_out_agents:" "$state_file" | cut -d' ' -f2-)
    local fan_in_agent=$(grep "^fan_in_agent:" "$state_file" | cut -d' ' -f2-)
    local wait_for=$(grep "^wait_for:" "$state_file" | cut -d' ' -f2-)
    local quorum=$(_fan_num "$state_file" quorum)
    local on_error=$(grep "^on_error:" "$state_file" | cut -d' ' -f2-)
    local total=$(_fan_num "$state_file" total)   # normalized to a clean int
    # passthrough fields appended by the launcher (chain_file, run_id)
    local extra
    extra=$(grep -E "^(chain_file|run_id):" "$state_file" 2>/dev/null || true)

    {
        printf 'status: %s\n' "${cur_status:-running}"
        printf 'started: %s\n' "$started"
        printf 'event: %s\n' "$event"
        printf 'fan_out_agents: %s\n' "$fan_out_agents"
        printf 'fan_in_agent: %s\n' "${fan_in_agent:-}"
        printf 'wait_for: %s\n' "$wait_for"
        printf 'quorum: %s\n' "${quorum:-0}"
        printf 'on_error: %s\n' "${on_error:-}"
        printf 'completed: %s\n' "$completed"
        printf 'failed: %s\n' "$failed"
        printf 'total: %s\n' "$total"
        [[ -n "$extra" ]] && printf '%s\n' "$extra"
    } > "$state_file"

    # decide + claim the trigger while still holding the lock. _fan_group_claim
    # flips status running->triggered (idempotent) and echoes the launch command
    # parameters on stdout iff THIS call won the claim.
    local claim
    claim="$(_fan_group_claim "$state_file")"
    local claim_rc=$?

    _fan_lock_release "$lock_dir"
    # --- end critical section ---

    # launch outside the lock so a slow spawn never starves other completers.
    [[ $claim_rc -eq 0 && -n "$claim" ]] && _fan_group_launch "$group_id" $claim
    return 0
}

# _fan_group_claim <state_file>  (MUST be called while holding the group lock)
#
# Evaluates the wait_for condition. If met AND the group has not already been
# claimed, flips status running->complete (the atomic, idempotent claim) and
# prints "<fan_in_agent> <completed> <total> <failed> <chain_file>" on stdout,
# returning 0 to signal "you won, launch it". Any subsequent call (status already
# claimed) is a no-op: prints nothing, returns 1. This is the single source of
# truth for the exactly-once guarantee.
#
# NOTE on the claimed value: we flip to "complete" (not a new "triggered" state)
# so the existing consumer in chain-runner-complete.sh — which reads the group
# status and treats "complete" as "fan-in was launched" — stays correct without
# touching that out-of-scope file. The latch below treats both "triggered" and
# "complete" as already-claimed, so an external caller using either value is safe.
_fan_group_claim() {
    local state_file="$1"

    local cur_status=$(grep "^status:" "$state_file" | cut -d' ' -f2-)
    local completed=$(_fan_num "$state_file" completed)
    local failed=$(_fan_num "$state_file" failed)
    local total=$(_fan_num "$state_file" total)
    local fan_in_agent=$(grep "^fan_in_agent:" "$state_file" | cut -d' ' -f2-)
    local wait_for=$(grep "^wait_for:" "$state_file" | cut -d' ' -f2-)
    local quorum=$(_fan_num "$state_file" quorum)
    local on_error=$(grep "^on_error:" "$state_file" | cut -d' ' -f2-)
    local chain_file=$(grep "^chain_file:" "$state_file" 2>/dev/null | cut -d' ' -f2-)

    # already claimed by a prior completer — re-run is a strict no-op.
    [[ "$cur_status" == "triggered" || "$cur_status" == "complete" ]] && return 1
    [[ -z "$fan_in_agent" ]] && return 1   # no fan-in target, nothing to claim

    local should_trigger=0
    case "$wait_for" in
        all)
            [[ $((completed + failed)) -ge ${total:-0} ]] && should_trigger=1
            ;;
        any)
            [[ ${completed:-0} -ge 1 ]] && should_trigger=1
            ;;
        quorum)
            [[ ${completed:-0} -ge ${quorum:-0} ]] && should_trigger=1
            ;;
    esac

    [[ $should_trigger -ne 1 ]] && return 1

    # WIN: flip running -> complete atomically (still under the lock). Use a
    # temp-file rewrite rather than sed -i for portability across BSD/GNU sed.
    local tmp="$state_file.claim.$$"
    sed 's/^status: .*/status: complete/' "$state_file" > "$tmp" 2>/dev/null \
        && mv -f "$tmp" "$state_file"
    rm -f "$tmp" 2>/dev/null || true

    # error-handler override: if any agent failed and an on_error target exists,
    # route there instead of the normal fan-in agent.
    if [[ ${failed:-0} -gt 0 && -n "$on_error" ]]; then
        fan_in_agent="$on_error"
    fi

    # emit the launch parameters for the winner.
    printf '%s %s %s %s %s\n' "$fan_in_agent" "${completed:-0}" "${total:-0}" "${failed:-0}" "$chain_file"
    return 0
}

# _fan_group_launch <group_id> <fan_in_agent> <completed> <total> <failed> [chain_file...]
# Performs the actual fan-in launch. Called only by the claim winner, OUTSIDE the
# lock. chain_file may contain spaces in theory; the launcher reconstructs it from
# the remaining args.
_fan_group_launch() {
    local group_id="$1" fan_in_agent="$2" completed="$3" total="$4" failed="$5"
    shift 5
    local chain_file="$*"

    echo "  fan-in: triggering $fan_in_agent ($completed/$total completed, $failed failed)"

    if [[ -n "$chain_file" && -f "$chain_file" ]]; then
        export MENTIKO_RUN_ID="${RUN_ID:-}"
        export AGENT_FAN_GROUP_ID="$group_id"
        bash "$SCRIPT_DIR/chain-runner.sh" "$chain_file" --start "$fan_in_agent"
    fi
    return 0
}

# check if fan-in condition is met and trigger if so.
#
# Public, self-locking entrypoint (also used directly by callers/tests that want
# to poll the trigger). Acquires the group lock, claims atomically via
# _fan_group_claim, releases, then launches outside the lock iff it won. Idempotent:
# calling this repeatedly after the group has been claimed launches the fan-in at
# most once.
fan-group-check-trigger() {
    local group_id="$1"

    local state_dir="$STATE_DIR/fan-groups"
    local state_file="$state_dir/${group_id}.state"
    local lock_dir="$state_file.lock"

    [[ ! -f "$state_file" ]] && return 1

    if ! _fan_lock_acquire "$lock_dir"; then
        echo "  fan-group: WARNING could not acquire lock for $group_id (timed out)" >&2
        return 1
    fi
    local claim
    claim="$(_fan_group_claim "$state_file")"
    local claim_rc=$?
    _fan_lock_release "$lock_dir"

    if [[ $claim_rc -eq 0 && -n "$claim" ]]; then
        _fan_group_launch "$group_id" $claim
        return 0
    fi
    return 1
}

# get fan-group state
fan-group-get() {
    local group_id="$1"
    local field="$2"

    local state_dir="$STATE_DIR/fan-groups"
    local state_file="$state_dir/${group_id}.state"

    [[ ! -f "$state_file" ]] && return 1

    grep "^${field}:" "$state_file" | cut -d' ' -f2-
}

# -------------------------------------------------------------------
# retry delay calculation
# -------------------------------------------------------------------

retry-calculate-delay() {
    local attempt="$1"
    local strategy="${2:-exponential}"
    local initial_delay="${3:-5}"
    local max_delay="${4:-300}"
    local multiplier="${5:-2.0}"

    local delay=0

    case "$strategy" in
        fixed)
            delay="$initial_delay"
            ;;
        exponential)
            # initial_delay * (multiplier ^ attempt), truncated toward zero.
            # awk, NOT bc: the tenant/base images ship awk (mawk) but no bc,
            # and the old bc pipeline's `|| echo` fallback silently collapsed
            # exponential backoff to a constant initial_delay wherever bc was
            # absent (i.e. in production). awk is already a hard dependency of
            # the engine (chain-runner.sh, retry-utils.sh, et al). multiplier
            # may be fractional ("1.5"), so this stays float math; int()
            # truncation matches the old bc+strip behavior (7.5->7, 11.25->11,
            # 12.207->12). clamping to max_delay happens here as a float
            # compare so a huge multiplier^attempt can never overflow the
            # integer printf (the final integer cap below is then a no-op).
            delay=$(awk -v base="$initial_delay" -v mult="$multiplier" -v att="$attempt" -v cap="$max_delay" \
                'BEGIN { d = base * (mult ^ att); if (d > cap) d = cap; printf "%d\n", int(d) }' \
                </dev/null 2>/dev/null) || delay="$initial_delay"
            ;;
        linear)
            delay=$((initial_delay * (attempt + 1)))
            ;;
        *)
            delay="$initial_delay"
            ;;
    esac

    # defense-in-depth: the exponential branch already emits an integer, but
    # keep the float-strip + regex guard so a stray fractional/garbage value
    # (e.g. "12.50" or ".5") can never abort the $(( )) below.
    delay="${delay%.*}"          # drop ".50" -> "12"  /  ".5" -> ""
    [[ -z "$delay" || ! "$delay" =~ ^[0-9]+$ ]] && delay="$initial_delay"

    # cap at max delay
    local delay_int=$((delay))
    [[ $delay_int -gt $max_delay ]] && delay_int="$max_delay"

    echo "$delay_int"
}

# -------------------------------------------------------------------
# branch parsing - handles all branch formats
# -------------------------------------------------------------------

branch-parse() {
    local branch_json="$1"
    local event_name="$2"

    # output format: "TYPE:DATA"
    # types: simple, parallel, fanout, conditional

    if echo "$branch_json" | jq -e 'type == "string"' > /dev/null 2>&1; then
        # simple string mapping
        echo "simple:$(echo "$branch_json" | jq -r '.')"
        return 0
    fi

    if echo "$branch_json" | jq -e 'type == "array"' > /dev/null 2>&1; then
        # array = parallel fan-out without fan-in
        local agents=$(echo "$branch_json" | jq -r '.[]' | tr '\n' ' ')
        echo "parallel:$agents"
        return 0
    fi

    if echo "$branch_json" | jq -e '.fan_out' > /dev/null 2>&1; then
        # fan-out with optional fan-in
        local fan_out=$(echo "$branch_json" | jq -r '.fan_out[]?' | tr '\n' ' ')
        local fan_in=$(echo "$branch_json" | jq -r '.fan_in // ""')
        local wait_for=$(echo "$branch_json" | jq -r '.wait_for // "all"')
        local quorum=$(echo "$branch_json" | jq -r '.quorum // 0')
        local on_error=$(echo "$branch_json" | jq -r '.on_error // ""')

        echo "fanout:${fan_out}|${fan_in}|${wait_for}|${quorum}|${on_error}"
        return 0
    fi

    if echo "$branch_json" | jq -e '.conditions' > /dev/null 2>&1; then
        # conditional branching
        local default=$(echo "$branch_json" | jq -r '.default // ""')
        echo "conditional:${default}"
        return 0
    fi

    # unknown format
    echo "unknown:"
    return 1
}

# -------------------------------------------------------------------
# error handler resolution
# -------------------------------------------------------------------

error-handler-resolve() {
    local chain_file="$1"
    local agent_id="$2"
    local error_type="${3:-error}"  # error or timeout

    # agent-level handler takes precedence
    local handler=""
    if [[ "$error_type" == "timeout" ]]; then
        handler=$(jq -r --arg id "$agent_id" \
            '.agents[] | select(.id == $id) | .on_timeout // empty' \
            "$chain_file" 2>/dev/null || echo "")
    fi

    if [[ -z "$handler" ]]; then
        handler=$(jq -r --arg id "$agent_id" \
            '.agents[] | select(.id == $id) | .on_error // empty' \
            "$chain_file" 2>/dev/null || echo "")
    fi

    # fall back to routing defaults
    if [[ -z "$handler" ]]; then
        if [[ "$error_type" == "timeout" ]]; then
            handler=$(jq -r '.routing.timeout_agent // .routing.timeout_handler // ""' \
                "$chain_file" 2>/dev/null || echo "")
        fi
    fi

    if [[ -z "$handler" ]]; then
        handler=$(jq -r '.routing.error_handler // ""' \
            "$chain_file" 2>/dev/null || echo "")
    fi

    echo "$handler"
}

# -------------------------------------------------------------------
# timeout detection helper
# -------------------------------------------------------------------

timeout-check-agent() {
    local agent_id="$1"
    local chain_file="$2"

    # get agent timeout
    local timeout=$(jq -r --arg id "$agent_id" \
        '.agents[] | select(.id == $id) | .timeout // 0' \
        "$chain_file" 2>/dev/null || echo "0")

    [[ "$timeout" -le 0 ]] && return 1  # no timeout configured

    # check default timeout
    if [[ "$timeout" == "-1" ]] || [[ "$timeout" == "null" ]]; then
        timeout=$(jq -r '.routing.default_timeout // 0' "$chain_file" 2>/dev/null || echo "0")
    fi

    [[ "$timeout" -le 0 ]] && return 1

    # check state file for start time
    local state_dir="$STATE_DIR"
    local state_id=$(echo "$agent_id" | tr '-' '_')
    local state_file="$state_dir/${state_id}.state"

    [[ ! -f "$state_file" ]] && return 1

    local started=$(grep "^started:" "$state_file" | cut -d' ' -f2-)
    [[ -z "$started" ]] && return 1

    # calculate elapsed seconds
    local now=$(date +%s)
    local started_sec=$(date -j -f "%Y-%m-%dT%H:%M:%S" "$started" +%s 2>/dev/null || date -d "$started" +%s 2>/dev/null || echo "0")
    [[ "$started_sec" -eq 0 ]] && return 1

    local elapsed=$((now - started_sec))

    if [[ $elapsed -gt $timeout ]]; then
        echo "timeout"
        return 0
    fi

    return 1
}

export -f fan-group-create
export -f fan-group-agent-complete
export -f fan-group-check-trigger
export -f fan-group-get
export -f retry-calculate-delay
export -f branch-parse
export -f error-handler-resolve
export -f timeout-check-agent
# lock + claim internals (exported so background fan-out subshells can reach them)
export -f _fan_lock_acquire
export -f _fan_lock_release
export -f _fan_lock_age
export -f _fan_num
export -f _fan_group_claim
export -f _fan_group_launch
