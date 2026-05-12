# webhook setup

webhooks let mentiko notify external systems when events happen during
chain execution.

## how it works
1. configure webhook urls in your chain.json
2. subscribe to specific event types
3. mentiko POSTs json payloads to your urls when events occur
4. failed deliveries retry with exponential backoff
5. delivery status tracked in ~/.mentiko_webhooks/

event types
------------------------------------------------------------
chain_started     - chain execution begins
agent_started     - individual agent starts
agent_complete    - agent finishes successfully
agent_error       - agent fails/errors
chain_complete    - entire chain finishes
chain_error       - chain fails/aborts

configuration
------------------------------------------------------------
add webhooks to your chain.json config section:

{
  "name": "My Webhook Chain",
  "config": {
    "webhooks": {
      "enabled": true,
      "urls": [
        "https://your-app.com/webhooks/mentiko",
        "https://webhook.site/your-unique-id"
      ],
      "events": [
        "chain_started",
        "agent_complete",
        "chain_complete"
      ],
      "retry": {
        "max_attempts": 3,
        "backoff_base": 2,
        "initial_delay": 1,
        "max_delay": 60
      },
      "headers": {
        "X-Custom-Header": "my-value",
        "X-Environment": "production"
      },
      "secret": "your-signature-secret"
    }
  },
  "agents": [...]
}

webhook config fields:
  enabled       - toggle webhooks on/off
  urls          - list of endpoints to notify
  events        - which events trigger webhooks
  retry         - retry policy for failed deliveries
  headers       - custom http headers
  secret        - hmac signing secret

payload format
------------------------------------------------------------
every webhook POST contains:

{
  "event": "agent_complete",
  "event_id": "my-chain-agent-complete-1740500000-12345",
  "chain": "My Webhook Chain",
  "timestamp": "2026-02-25T10:00:00-07:00",
  "agent": "researcher",
  "agent_id": "researcher",
  "session": "mychain-researcher-20260225-1000"
}

headers
------------------------------------------------------------
mentiko adds these headers to every webhook request:

content-type           - application/json
x-webhook-event        - event type (e.g., agent_complete)
x-webhook-id           - unique event id
x-webhook-timestamp    - iso timestamp
x-webhook-signature    - hmac sha256 (if secret set)
user-agent             - mentiko/1.0
(custom headers)       - from your config

signature verification
------------------------------------------------------------
if you set a secret, webhooks include x-webhook-signature:

x-webhook-signature: sha256=abc123def456...

verify on your end (python):

import hmac
import hashlib

def verify_signature(payload, signature, secret):
    expected = hmac.new(
        secret.encode(),
        payload.encode(),
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(f"sha256={expected}", signature)

verify on your end (javascript):

import crypto from 'crypto';

function verifySignature(payload, signature, secret) {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  return `sha256=${expected}` === signature;
}

retry behavior
------------------------------------------------------------
when a webhook delivery fails:

attempt 1 (immediate)  - 0s
attempt 2              - 1s
attempt 3              - 2s
attempt 4              - 4s

delay caps at max_delay (default 60s).

delivery fails if:
  - http status not 2xx
  - connection timeout
  - dns resolution failure
  - ssl/tls error

retry config:
  max_attempts  - how many times to retry (default: 3)
  backoff_base  - exponential multiplier (default: 2)
  initial_delay - first retry delay in seconds (default: 1)
  max_delay     - cap on retry delay (default: 60)

testing webhooks
------------------------------------------------------------
use webhook.site for quick testing:

1. go to https://webhook.site and get your unique url
2. add it to your chain.json:
   "urls": ["https://webhook.site/your-unique-id"]
3. run your chain
4. watch requests arrive on webhook.site

or use httpbin.org:
"urls": ["https://httpbin.org/post"]

checking delivery status
------------------------------------------------------------
from the command line:

# show recent webhook deliveries
mentiko webhook-status

# show webhooks for a specific chain
mentiko webhook-status examples/my-chain/chain.json

output:

webhook status:
  ✔ chain_started    https://your-app.com/webhook  attempts: 1  10:00
  ✔ agent_complete   https://your-app.com/webhook  attempts: 1  10:05
  ✖ chain_complete   https://your-app.com/webhook  attempts: 3  10:10

troubleshooting
------------------------------------------------------------
webhooks not firing?

1. check enabled is true
2. check urls array is not empty
3. check events includes the type you expect
4. check chain.json is valid json
5. run mentiko webhook-status to see delivery attempts

signature verification failing?

1. make sure secret matches on both ends
2. verify you're hashing the raw payload body (not parsed json)
3. check your encoding (utf-8)

example: slack notifications
------------------------------------------------------------
send chain events to slack:

1. create a slack incoming webhook
   https://api.slack.com/messaging/webhooks

2. configure chain.json:

{
  "config": {
    "webhooks": {
      "enabled": true,
      "urls": ["https://example.test/slack-webhook"],
      "events": ["chain_complete", "chain_error"],
      "headers": {
        "Content-type": "application/json"
      }
    }
  }
}

note: slack expects a different payload format, so you'll need a
middleware adapter to transform mentiko events into slack messages.

example: discord notifications
------------------------------------------------------------
similar to slack, use a discord webhook url:

{
  "config": {
    "webhooks": {
      "enabled": true,
      "urls": ["https://discord.com/api/webhooks/YOUR/WEBHOOK"],
      "events": ["chain_complete", "agent_complete"]
    }
  }
}

security considerations
------------------------------------------------------------
- use https urls only in production
- set a secret and verify signatures
- don't log full webhook payloads (may contain sensitive data)
- rotate secrets periodically
- implement replay protection (check timestamp, cache event_id)

cleanup
------------------------------------------------------------
old webhook state files accumulate in ~/.mentiko_webhooks/. clean them:

# remove state files older than 7 days
mentiko webhook-cleanup 7
