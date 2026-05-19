#!/bin/bash
# test-agent-profile-runtime.sh - runtime agent profile resolution regressions

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

TEST_TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_TMP_DIR"' EXIT

export MENTIKO_GLOBAL_ROOT="$TEST_TMP_DIR"
export NAMESPACE_ID="default"
export ORG_ID="default"
export MENTIKO_NAMESPACE_ROOT="$TEST_TMP_DIR/namespaces/default"
export MENTIKO_ORG_ROOT="$MENTIKO_NAMESPACE_ROOT"
export NAMESPACE_ROOT="$MENTIKO_NAMESPACE_ROOT"
export AGENT_PROFILES_DIR="$MENTIKO_ORG_ROOT/agent-profiles"

mkdir -p "$AGENT_PROFILES_DIR"

cat > "$AGENT_PROFILES_DIR/kollabor.json" <<'JSON'
{
  "id": "kollabor",
  "name": "Kollab CLI",
  "cli": "kollab",
  "isDefault": true,
  "log_path": "~/.kollab/projects/"
}
JSON

cat > "$AGENT_PROFILES_DIR/codex-default.json" <<'JSON'
{
  "id": "codex-default",
  "name": "Codex",
  "cli": "codex",
  "isDefault": false,
  "log_path": "~/.codex/sessions/"
}
JSON

cat > "$AGENT_PROFILES_DIR/gemini-pro.json" <<'JSON'
{
  "id": "gemini-pro",
  "name": "Gemini",
  "cli": "gemini",
  "isDefault": false,
  "log_path": "~/.gemini/tmp/"
}
JSON

source "$PROJECT_ROOT/lib/agent-profile.sh"
source "$PROJECT_ROOT/lib/session-log-resolver.sh"

assert_eq() {
  local expected="$1"
  local actual="$2"
  local message="$3"
  if [[ "$expected" != "$actual" ]]; then
    echo "FAIL: $message"
    echo "expected: $expected"
    echo "actual:   $actual"
    exit 1
  fi
  echo "PASS: $message"
}

chain_without_profile="$TEST_TMP_DIR/chain-no-profile.json"
cat > "$chain_without_profile" <<'JSON'
{
  "name": "no-profile-chain",
  "config": {
    "project_root": "/tmp/workspace"
  },
  "agents": [
    {
      "id": "agent-one",
      "name": "Agent One",
      "triggers": ["manual-start"],
      "emits": "done"
    }
  ]
}
JSON

resolved_default="$(resolve_agent_profile_id "$chain_without_profile" "agent-one")"
assert_eq "kollabor" "$resolved_default" "uses namespace default profile when chain has no profile"

chain_with_default="$TEST_TMP_DIR/chain-default.json"
cat > "$chain_with_default" <<'JSON'
{
  "name": "default-profile-chain",
  "default_agent_profile": "codex-default",
  "agents": [
    {
      "id": "agent-one",
      "name": "Agent One",
      "triggers": ["manual-start"],
      "emits": "done"
    }
  ]
}
JSON

resolved_chain_default="$(resolve_agent_profile_id "$chain_with_default" "agent-one")"
assert_eq "codex-default" "$resolved_chain_default" "uses chain default profile before namespace default"

chain_with_agent_profile="$TEST_TMP_DIR/chain-agent-profile.json"
cat > "$chain_with_agent_profile" <<'JSON'
{
  "name": "agent-profile-chain",
  "default_agent_profile": "codex-default",
  "agents": [
    {
      "id": "agent-one",
      "name": "Agent One",
      "agent_profile": "gemini-pro",
      "triggers": ["manual-start"],
      "emits": "done"
    }
  ]
}
JSON

resolved_agent_profile="$(resolve_agent_profile_id "$chain_with_agent_profile" "agent-one")"
assert_eq "gemini-pro" "$resolved_agent_profile" "uses agent profile before chain default"

resolved_file="$(resolve_agent_profile_file "$chain_without_profile" "agent-one")"
assert_eq "$AGENT_PROFILES_DIR/kollabor.json" "$resolved_file" "returns profile file for resolved default"

kollab_log_dir="$(resolve_log_dir "$AGENT_PROFILES_DIR/kollabor.json" "/Users/malmazan/.mentiko/namespaces/default/workspace/mentiko")"
assert_eq "$HOME/.kollab/projects/Users_malmazan_.mentiko_namespaces_default_workspace_mentiko" \
  "$kollab_log_dir" \
  "resolves kollab conversation directory slug"
