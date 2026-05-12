#!/bin/bash
#
# vps-security-hardening.sh - harden VPS for multi-tenant PTY isolation
#
# usage:
#   sudo ./vps-security-hardening.sh    # dry run (shows what would change)
#   sudo ./vps-security-hardening.sh --apply   # actually apply changes
#
# security measures:
# 1. ptrace scope shield (prevent cross-user debugging)
# 2. sudoers restriction (mentiko user can only run bash as other users)
# 3. kernel hardening (ASLR, core dumps restricted)
#

set -euo pipefail

DRY_RUN=true
if [[ "${1:-}" == "--apply" ]]; then
  DRY_RUN=false
fi

log() {
  echo "[$(date +'%Y-%m-%d %H:%M:%S')] $*"
}

log "--- VPS Security Hardening ---"
log "mode: $([ "$DRY_RUN" = true ] && echo 'DRY RUN (no changes)' || echo 'APPLY CHANGES')"
echo

# ---------------------------------------------------------------------------
# 1. ptrace scope shield
# ---------------------------------------------------------------------------
# prevent users from debugging each other's processes with ptrace
# https://www.kernel.org/doc/Documentation/sysctl/kernel.txt
#
# 0 = traditional ptrace permissions (any process can trace any other)
# 1 = restricted ptrace (a process can only trace its descendants)
# 2 = only processes with CAP_SYS_PTRACE or /proc/{pid}/mode set to 1 can trace
# 3 = no process can trace another (breaks debuggers, don't use)
#

PTRACE_CURRENT=$(sysctl -n kernel.yama.ptrace_scope 2>/dev/null || echo "0")
PTRACE_TARGET=1

log "1. ptrace scope shield"
log "   current: kernel.yama.ptrace_scope = $PTRACE_CURRENT"
log "   target:  kernel.yama.ptrace_scope = $PTRACE_TARGET"

if [[ "$PTRACE_CURRENT" -lt "$PTRACE_TARGET" ]]; then
  log "   action: set ptrace_scope to $PTRACE_TARGET (restricted)"

  if [[ "$DRY_RUN" = true ]]; then
    log "   [dry run] would run: sysctl -w kernel.yama.ptrace_scope=$PTRACE_TARGET"
  else
    sysctl -w kernel.yama.ptrace_scope=$PTRACE_TARGET
    # persist across reboots
    if ! grep -q "kernel.yama.ptrace_scope" /etc/sysctl.conf 2>/dev/null; then
      echo "kernel.yama.ptrace_scope = $PTRACE_TARGET" >> /etc/sysctl.conf
      log "   persisted to /etc/sysctl.conf"
    fi
  fi
else
  log "   already hardened (no change needed)"
fi
echo

# ---------------------------------------------------------------------------
# 2. sudoers restriction
# ---------------------------------------------------------------------------
# mentiko user should only be able to run shells as other users
# not arbitrary commands. this prevents:
#   sudo -u marco cat /home/marco/.ssh/id_rsa   # blocked
#   sudo -u marco bash -l                        # allowed (login shell)
#

SUDOERS_FILE="/etc/sudoers.d/mentiko"
SUDOERS_CONTENT="# mentiko user sudoers rule for multi-tenant PTY isolation
# allow mentiko to run login shells as any user (for workspace terminals)
# but NOT arbitrary commands (must use -l flag for restricted login)
mentiko ALL=(ALL) NOPASSWD: /bin/bash -l *, /bin/zsh -l *, /bin/sh -l *
"

log "2. sudoers restriction"
log "   target: $SUDOERS_FILE"

if [[ ! -f "$SUDOERS_FILE" ]]; then
  log "   action: create restricted sudoers file"

  if [[ "$DRY_RUN" = true ]]; then
    log "   [dry run] would create:"
    echo "$SUDOERS_CONTENT" | sed 's/^/   | /'
  else
    echo "$SUDOERS_CONTENT" > "$SUDOERS_FILE"
    chmod 0440 "$SUDOERS_FILE"
    visudo -c -f "$SUDOERS_FILE" && log "   sudoers syntax validated" || log "   ERROR: sudoers syntax invalid!"
  fi
else
  log "   already exists (verify content matches):"
  echo "$SUDOERS_CONTENT" | sed 's/^/   | /'
  if [[ "$DRY_RUN" = false ]]; then
    visudo -c -f "$SUDOERS_FILE" && log "   sudoers syntax validated" || log "   WARNING: sudoers syntax invalid!"
  fi
fi
echo

# ---------------------------------------------------------------------------
# 3. kernel hardening
# ---------------------------------------------------------------------------

log "3. kernel hardening"

# randomize VA layout (ASLR)
RANDOMIZE_CURRENT=$(sysctl -n kernel.randomize_va_space 2>/dev/null || echo "1")
RANDOMIZE_TARGET=2

log "   ASLR (kernel.randomize_va_space)"
log "   current: $RANDOMIZE_CURRENT (0=off, 1=conservative, 2=full)"
log "   target:  $RANDOMIZE_TARGET"

if [[ "$RANDOMIZE_CURRENT" -lt "$RANDOMIZE_TARGET" ]]; then
  log "   action: enable full ASLR"
  if [[ "$DRY_RUN" = true ]]; then
    log "   [dry run] would run: sysctl -w kernel.randomize_va_space=$RANDOMIZE_TARGET"
  else
    sysctl -w kernel.randomize_va_space=$RANDOMIZE_TARGET
    if ! grep -q "kernel.randomize_va_space" /etc/sysctl.conf 2>/dev/null; then
      echo "kernel.randomize_va_space = $RANDOMIZE_TARGET" >> /etc/sysctl.conf
      log "   persisted to /etc/sysctl.conf"
    fi
  fi
else
  log "   already hardened (no change needed)"
fi

# restrict core dumps (may contain sensitive data from multi-tenant processes)
CORE_PATTERN_CURRENT=$(cat /proc/sys/kernel/core_pattern 2>/dev/null || echo "core")
CORE_PATTERN_TARGET="|/bin/false"

log "   core dumps (kernel.core_pattern)"
log "   current: $CORE_PATTERN_CURRENT"
log "   target:  $CORE_PATTERN_TARGET (disabled)"

if [[ "$CORE_PATTERN_CURRENT" != "$CORE_PATTERN_TARGET" ]]; then
  log "   action: disable core dumps for security"
  if [[ "$DRY_RUN" = true ]]; then
    log "   [dry run] would run: echo '$CORE_PATTERN_TARGET' > /proc/sys/kernel/core_pattern"
  else
    echo "$CORE_PATTERN_TARGET" > /proc/sys/kernel/core_pattern
    if ! grep -q "^kernel.core_pattern" /etc/sysctl.conf 2>/dev/null; then
      echo "kernel.core_pattern = '$CORE_PATTERN_TARGET'" >> /etc/sysctl.conf
      log "   persisted to /etc/sysctl.conf"
    fi
  fi
else
  log "   already hardened (no change needed)"
fi
echo

# ---------------------------------------------------------------------------
# 4. summary
# ---------------------------------------------------------------------------

log "--- summary ---"
log "ptrace scope:        $([ "$PTRACE_CURRENT" -ge "$PTRACE_TARGET" ] && echo 'hardened' || echo 'needs hardening')"
log "sudoers:             $([ -f "$SUDOERS_FILE" ] && echo 'configured' || echo 'needs setup')"
log "ASLR:                $([ "$RANDOMIZE_CURRENT" -ge "$RANDOMIZE_TARGET" ] && echo 'full' || echo 'needs enable')"
log "core dumps:          $([ "$CORE_PATTERN_CURRENT" = "$CORE_PATTERN_TARGET" ] && echo 'disabled' || echo 'needs disable')"
echo

if [[ "$DRY_RUN" = true ]]; then
  log "this was a dry run. no changes were made."
  log "to apply changes, run: sudo $0 --apply"
else
  log "hardening applied. reboot to ensure all sysctl changes persist."
fi
