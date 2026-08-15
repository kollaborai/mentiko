#!/usr/bin/env bash

# Resolve the daemon through the same typed runtime-path owner used by the
# engine. A throwaway data root already makes the name unique; inventing a
# second name here would put test launches and completion cleanup on different
# sockets.
configure_scoped_pty_daemon() {
  local repo_root="$1"
  local global_root="$2"
  local namespace_id="$3"
  local org_id="$4"
  local resolved

  resolved="$(
    env -u PTY_DAEMON \
      MENTIKO_CODE_ROOT="$repo_root" \
      MENTIKO_GLOBAL_ROOT="$global_root" \
      NAMESPACE_ID="$namespace_id" \
      ORG_ID="$org_id" \
      node "$repo_root/lib/runner-runtime-paths.js" shell-exports \
      | sed -n "s/^export PTY_DAEMON='\([^']*\)'$/\1/p"
  )" || return 1
  [[ -n "$resolved" ]] || return 1

  PTY_DAEMON_NAME="$resolved"
  export PTY_DAEMON="$resolved"
}
