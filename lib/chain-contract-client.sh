#!/usr/bin/env bash
# Thin external-command boundary for typed chain, agent, and config-profile contracts.
# Shell callers may pass primitive values to the product process, but never parse or
# mutate definition JSON themselves.

_chain_contract_cli() {
  local cli="${MENTIKO_CODE_ROOT:?MENTIKO_CODE_ROOT must be configured}/lib/runner-chain-contract.js"
  if ! command -v node >/dev/null 2>&1; then
    echo "  mentiko: node is required for typed chain contracts" >&2
    return 1
  fi
  if [[ ! -f "$cli" ]]; then
    echo "  mentiko: typed runner-chain-contract bundle missing: $cli" >&2
    return 1
  fi
  node "$cli" "$@"
}

chain_contract_resolve() {
  _chain_contract_cli resolve --chain-path "$1" --agents-dir "$2" --config-profiles-dir "$3"
}

chain_contract_raw_field() { _chain_contract_cli raw-field --chain-path "$1" --agents-dir "$2" --config-profiles-dir "$3" --field "$4"; }

chain_contract_field() {
  local chain_path="$1" agents_dir="$2" profiles_dir="$3" field="$4" cli_override="${5:-}"
  if [[ -n "$cli_override" ]]; then
    _chain_contract_cli chain-field --chain-path "$chain_path" --agents-dir "$agents_dir" --config-profiles-dir "$profiles_dir" --field "$field" --cli-override "$cli_override"
  else
    _chain_contract_cli chain-field --chain-path "$chain_path" --agents-dir "$agents_dir" --config-profiles-dir "$profiles_dir" --field "$field"
  fi
}

chain_contract_agent_field() { _chain_contract_cli agent-field --chain-path "$1" --agents-dir "$2" --config-profiles-dir "$3" --agent-id "$4" --field "$5" --default "${6:-}"; }
chain_contract_agent_array() { _chain_contract_cli agent-array --chain-path "$1" --agents-dir "$2" --config-profiles-dir "$3" --agent-id "$4" --field "$5"; }
chain_contract_agent_authorities() { _chain_contract_cli agent-authorities --chain-path "$1" --agents-dir "$2" --config-profiles-dir "$3" --agent-id "$4"; }
chain_contract_agent_artifacts() { _chain_contract_cli agent-artifacts --chain-path "$1" --agents-dir "$2" --config-profiles-dir "$3" --agent-id "$4" --direction "$5"; }
chain_contract_agent_profile_field() { _chain_contract_cli agent-profile-field --chain-path "$1" --agents-dir "$2" --config-profiles-dir "$3" --agent-id "$4" --field "$5"; }
chain_contract_gateway_field() { _chain_contract_cli gateway-field --chain-path "$1" --agents-dir "$2" --config-profiles-dir "$3" --gateway "$4" --field "$5"; }
chain_contract_gateway_env() { _chain_contract_cli gateway-env --chain-path "$1" --agents-dir "$2" --config-profiles-dir "$3" --gateway "$4"; }
chain_contract_agent_count() { _chain_contract_cli agent-count --chain-path "$1" --agents-dir "$2" --config-profiles-dir "$3"; }
chain_contract_agent_ids() { _chain_contract_cli agent-ids --chain-path "$1" --agents-dir "$2" --config-profiles-dir "$3"; }
chain_contract_first_agent() { _chain_contract_cli first-agent --chain-path "$1" --agents-dir "$2" --config-profiles-dir "$3" --event "${4:-manual-start}"; }

export -f _chain_contract_cli chain_contract_resolve chain_contract_raw_field chain_contract_field chain_contract_agent_field chain_contract_agent_array chain_contract_agent_authorities chain_contract_agent_artifacts chain_contract_agent_profile_field chain_contract_gateway_field chain_contract_gateway_env chain_contract_agent_count chain_contract_agent_ids chain_contract_first_agent
