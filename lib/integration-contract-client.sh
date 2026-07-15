#!/usr/bin/env bash
# Shell may invoke the typed integration boundary but never parse or mutate
# webhook/email JSON itself. curl, mail, and sendmail remain external effects.

_integration_contract_cli() {
  local cli="${MENTIKO_CODE_ROOT:?MENTIKO_CODE_ROOT must be configured}/lib/runner-integration-contract.js"
  if ! command -v node >/dev/null 2>&1; then
    echo "  mentiko: node is required for typed integration contracts" >&2
    return 1
  fi
  if [[ ! -f "$cli" ]]; then
    echo "  mentiko: typed runner-integration-contract bundle missing: $cli" >&2
    return 1
  fi
  node "$cli" "$@"
}

integration_webhook_plans() { _integration_contract_cli webhook-plans "$@"; }
integration_metadata_webhook_plans() { _integration_contract_cli metadata-webhook-plans "$@"; }
integration_webhook_deliver() { _integration_contract_cli webhook-deliver "$@"; }
integration_metadata_webhook_deliver() { _integration_contract_cli metadata-webhook-deliver "$@"; }
integration_plan_field() { _integration_contract_cli plan-field --kind "$1" --plan "$2" --field "$3"; }
integration_webhook_headers() { _integration_contract_cli webhook-headers --plan "$1"; }
integration_delivery_init() { _integration_contract_cli delivery-init "$@"; }
integration_delivery_update() { _integration_contract_cli delivery-update "$@"; }
integration_delivery_status() { _integration_contract_cli delivery-status "$@"; }
integration_delivery_cleanup() { _integration_contract_cli delivery-cleanup "$@"; }
integration_email_config() { _integration_contract_cli email-config "$@"; }
integration_email_report_plan() { _integration_contract_cli email-report-plan "$@"; }
integration_email_api_payload() { _integration_contract_cli email-api-payload "$@"; }
integration_email_report_send() { _integration_contract_cli email-report-send "$@"; }

export -f _integration_contract_cli integration_webhook_plans integration_metadata_webhook_plans integration_webhook_deliver integration_metadata_webhook_deliver integration_plan_field integration_webhook_headers integration_delivery_init integration_delivery_update integration_delivery_status integration_delivery_cleanup integration_email_config integration_email_report_plan integration_email_api_payload integration_email_report_send
