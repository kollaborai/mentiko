#!/bin/bash
# email-integration.sh - Email notifications for chain completion
#
# sends email reports when chains complete, including:
# - run summary
# - agent results
# - output links
#
# usage:
#   source email-integration.sh
#   send-chain-report <run-id> <chain.json> <status>

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/run-lib.sh"
source "$SCRIPT_DIR/integration-contract-client.sh"

# -------------------------------------------------------------------
# email config from env or chain.json
# -------------------------------------------------------------------
# env vars (highest priority):
#   CHAIN_EMAIL_TO, CHAIN_EMAIL_FROM, CHAIN_EMAIL_SMTP
#   CHAIN_EMAIL_API_KEY, CHAIN_EMAIL_API_URL
#
# chain.json config (medium priority):
#   config.email.to, config.email.from, config.email.smtp
#   config.email.api_key, config.email.api_url
#
# defaults (lowest priority):
#   from: noreply@mentiko.local
#   method: auto (typed transport policy)

# get-email-config: read email config from env and chain.json
# args: <chain.json>
# outputs: json with email config
get-email-config() {
    local chain_file="$1"
    integration_email_config --chain-path "$chain_file"
}

# -------------------------------------------------------------------
# build-email-body: create email body from run data
# -------------------------------------------------------------------
# args: <run-id> <chain.json> <status>
build-email-body() {
    local run_id="$1"
    local chain_file="$2"
    local status="${3:-complete}"

    local plan
    plan=$(integration_email_report_plan --chain-path "$chain_file" --runs-dir "$RUNS_DIR" --run-id "$run_id" --status "$status" --reports-dir "$REPORTS_DIR") || return 1
    integration_plan_field email "$plan" body
}

# -------------------------------------------------------------------
# send-chain-report: main entry point
# -------------------------------------------------------------------
# args: <run-id> <chain.json> <status>
send-chain-report() {
    local run_id="$1"
    local chain_file="$2"
    local status="${3:-complete}"

    local plan
    plan=$(integration_email_report_plan --chain-path "$chain_file" --runs-dir "$RUNS_DIR" --run-id "$run_id" --status "$status" --reports-dir "$REPORTS_DIR") || return 1
    integration_email_report_send --plan "$plan"
}

# export functions
export -f get-email-config
export -f build-email-body
export -f send-chain-report
