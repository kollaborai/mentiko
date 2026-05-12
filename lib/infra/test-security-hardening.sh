#!/bin/bash
#
# test-security-hardening.sh - verify VPS security hardening is applied
#
# usage:
#   sudo ./test-security-hardening.sh
#

set -euo pipefail

PASS="✔"
FAIL="✖"
WARN="⚠"

log() {
  echo "[$(date +'%Y-%m-%d %H:%M:%S')] $*"
}

# ---------------------------------------------------------------------------
# check if running as root
# ---------------------------------------------------------------------------
if [[ $EUID -ne 0 ]]; then
  echo "error: this script must be run as root (sudo)"
  exit 1
fi

log "--- VPS Security Hardening Tests ---"
echo

# ---------------------------------------------------------------------------
# test 1: ptrace scope
# ---------------------------------------------------------------------------
log "test 1: ptrace scope shield"
PTRACE_CURRENT=$(sysctl -n kernel.yama.ptrace_scope 2>/dev/null || echo "0")
if [[ "$PTRACE_CURRENT" -ge 1 ]]; then
  echo "$PASS ptrace_scope = $PTRACE_CURRENT (hardened)"
else
  echo "$FAIL ptrace_scope = $PTRACE_CURRENT (vulnerable)"
  echo "     run: sudo sysctl -w kernel.yama.ptrace_scope=1"
fi
echo

# ---------------------------------------------------------------------------
# test 2: sudoers restriction
# ---------------------------------------------------------------------------
log "test 2: sudoers restriction"
SUDOERS_FILE="/etc/sudoers.d/mentiko"
if [[ ! -f "$SUDOERS_FILE" ]]; then
  echo "$FAIL sudoers file missing: $SUDOERS_FILE"
  echo "     run: sudo ./vps-security-hardening.sh --apply"
else
  if visudo -c -f "$SUDOERS_FILE" >/dev/null 2>&1; then
    echo "$PASS sudoers syntax valid"
    # check if rule allows only shells with -l flag
    if grep -q "mentiko.*NOPASSWD.*bash -l" "$SUDOERS_FILE"; then
      echo "$PASS mentiko sudoers restricted to shell login"
    else
      echo "$WARN mentiko sudoers may allow arbitrary commands"
    fi
  else
    echo "$FAIL sudoers syntax invalid"
  fi
fi
echo

# ---------------------------------------------------------------------------
# test 3: kernel hardening (ASLR)
# ---------------------------------------------------------------------------
log "test 3: ASLR (address space layout randomization)"
RANDOMIZE_CURRENT=$(sysctl -n kernel.randomize_va_space 2>/dev/null || echo "1")
if [[ "$RANDOMIZE_CURRENT" -ge 2 ]]; then
  echo "$PASS ASLR = $RANDOMIZE_CURRENT (full randomization)"
elif [[ "$RANDOMIZE_CURRENT" -eq 1 ]]; then
  echo "$WARN ASLR = $RANDOMIZE_CURRENT (conservative)"
  echo "     run: sudo sysctl -w kernel.randomize_va_space=2"
else
  echo "$FAIL ASLR = $RANDOMIZE_CURRENT (disabled)"
  echo "     run: sudo sysctl -w kernel.randomize_va_space=2"
fi
echo

# ---------------------------------------------------------------------------
# test 4: core dumps disabled
# ---------------------------------------------------------------------------
log "test 4: core dumps disabled"
CORE_PATTERN=$(cat /proc/sys/kernel/core_pattern 2>/dev/null || echo "core")
if [[ "$CORE_PATTERN" == "|/bin/false" ]]; then
  echo "$PASS core dumps disabled ($CORE_PATTERN)"
else
  echo "$WARN core dumps enabled ($CORE_PATTERN)"
  echo "     run: sudo sh -c \"echo '|/bin/false' > /proc/sys/kernel/core_pattern\""
fi
echo

# ---------------------------------------------------------------------------
# test 5: mentiko user exists
# ---------------------------------------------------------------------------
log "test 5: mentiko system user"
if id mentiko >/dev/null 2>&1; then
  echo "$PASS mentiko user exists"
  # check if mentiko has sudo access
  if sudo -U mentiko -l >/dev/null 2>&1; then
    echo "$PASS mentiko has sudo configured"
  else
    echo "$WARN mentiko sudo not configured"
  fi
else
  echo "$FAIL mentiko user missing"
  echo "     run: sudo useradd -r -s /bin/bash mentiko"
fi
echo

# ---------------------------------------------------------------------------
# test 6: pty-manager directory permissions
# ---------------------------------------------------------------------------
log "test 6: pty-manager directory security"
PTY_DIR="/home/mentiko/.pty-manager"
if [[ -d "$PTY_DIR" ]]; then
  PERMS=$(stat -c %a "$PTY_DIR" 2>/dev/null || stat -f %A "$PTY_DIR" 2>/dev/null)
  OWNER=$(stat -c %U "$PTY_DIR" 2>/dev/null || stat -f %Su "$PTY_DIR" 2>/dev/null)
  if [[ "$OWNER" == "mentiko" ]]; then
    echo "$PASS pty-manager owned by mentiko"
  else
    echo "$FAIL pty-manager owned by $OWNER (should be mentiko)"
  fi
  if [[ "$PERMS" == "700" ]]; then
    echo "$PASS pty-manager permissions are 700"
  else
    echo "$WARN pty-manager permissions are $PERMS (should be 700)"
  fi
else
  echo "$WARN pty-manager directory not found ($PTY_DIR)"
fi
echo

# ---------------------------------------------------------------------------
# test 7: ws-token file permissions
# ---------------------------------------------------------------------------
log "test 7: ws-token file security"
TOKEN_FILE="/home/mentiko/.pty-manager/ws-token"
if [[ -f "$TOKEN_FILE" ]]; then
  PERMS=$(stat -c %a "$TOKEN_FILE" 2>/dev/null || stat -f %A "$TOKEN_FILE" 2>/dev/null)
  OWNER=$(stat -c %U "$TOKEN_FILE" 2>/dev/null || stat -f %Su "$TOKEN_FILE" 2>/dev/null)
  if [[ "$OWNER" == "mentiko" ]]; then
    echo "$PASS ws-token owned by mentiko"
  else
    echo "$FAIL ws-token owned by $OWNER (should be mentiko)"
  fi
  if [[ "$PERMS" == "600" ]]; then
    echo "$PASS ws-token permissions are 600"
  else
    echo "$WARN ws-token permissions are $PERMS (should be 600)"
  fi
else
  echo "$INFO ws-token not found (ws-terminal not running yet)"
fi
echo

# ---------------------------------------------------------------------------
# summary
# ---------------------------------------------------------------------------
log "--- test summary ---"
log "run 'sudo ./vps-security-hardening.sh --apply' to fix any failures"
