#!/bin/bash
# register-telegram-webhook.sh
# register the bot webhook URL with Telegram
#
# usage: ./scripts/register-telegram-webhook.sh [URL]
#
# if URL is not provided, reads BETTER_AUTH_URL or prompts.
# requires: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET in env or .env

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# load .env if present and not already in environment
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

# --- validate required env ---

if [[ -z "${TELEGRAM_BOT_TOKEN:-}" ]]; then
  echo "error: TELEGRAM_BOT_TOKEN not set"
  echo "  set it in .env or export it before running this script"
  exit 1
fi

if [[ -z "${TELEGRAM_WEBHOOK_SECRET:-}" ]]; then
  echo "error: TELEGRAM_WEBHOOK_SECRET not set"
  echo "  set it in .env or export it before running this script"
  exit 1
fi

# --- resolve webhook URL ---

WEBHOOK_URL="${1:-}"

if [[ -z "$WEBHOOK_URL" ]]; then
  # fall back to BETTER_AUTH_URL (same domain the app is hosted on)
  BASE_URL="${BETTER_AUTH_URL:-}"
  if [[ -n "$BASE_URL" ]]; then
    WEBHOOK_URL="${BASE_URL%/}/api/telegram/webhook"
  fi
fi

if [[ -z "$WEBHOOK_URL" ]]; then
  echo "error: webhook URL not provided"
  echo "  usage: $0 <https://your-domain.com>"
  echo "  or set BETTER_AUTH_URL in .env"
  exit 1
fi

# normalize: strip trailing slash from base, ensure /api/telegram/webhook suffix
if [[ "$WEBHOOK_URL" != */api/telegram/webhook ]]; then
  WEBHOOK_URL="${WEBHOOK_URL%/}/api/telegram/webhook"
fi

echo "  token:   ${TELEGRAM_BOT_TOKEN:0:10}..."
echo "  secret:  ${TELEGRAM_WEBHOOK_SECRET:0:6}..."
echo "  url:     $WEBHOOK_URL"
echo ""

# --- register ---

RESPONSE=$(curl -s -X POST \
  "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -H "content-type: application/json" \
  -d "{
    \"url\": \"${WEBHOOK_URL}\",
    \"secret_token\": \"${TELEGRAM_WEBHOOK_SECRET}\",
    \"allowed_updates\": [\"message\"]
  }")

OK=$(echo "$RESPONSE" | grep -o '"ok":true' || echo "")

if [[ -n "$OK" ]]; then
  echo "  registered successfully"
  echo "  response: $RESPONSE"
else
  echo "  error: registration failed"
  echo "  response: $RESPONSE"
  exit 1
fi

# --- verify ---

echo ""
echo "  verifying..."

INFO=$(curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo")
CURRENT_URL=$(echo "$INFO" | grep -o '"url":"[^"]*"' | cut -d'"' -f4 || echo "")

if [[ "$CURRENT_URL" == "$WEBHOOK_URL" ]]; then
  echo "  confirmed: webhook active at $CURRENT_URL"
else
  echo "  warning: expected $WEBHOOK_URL but got $CURRENT_URL"
  echo "  full info: $INFO"
fi
