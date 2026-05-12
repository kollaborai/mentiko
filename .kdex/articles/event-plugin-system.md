---
title: Event Plugin System
type: component
linked_files:
  - lib/plugins/notify-slack/on-event.sh
  - lib/plugins/notify-email/on-event.sh
  - lib/plugins/email-digest/on-event.sh
  - lib/plugins/github-pr/on-event.sh
  - lib/plugins/linear/on-event.sh
  - lib/plugins/pagerduty/on-event.sh
  - lib/plugins/custom-webhook/on-event.sh
file_hashes:
  lib/plugins/custom-webhook/on-event.sh: sha256:175d4c2ff6c14a49
  lib/plugins/email-digest/on-event.sh: sha256:352887397343f692
  lib/plugins/github-pr/on-event.sh: sha256:74ada3806983acca
  lib/plugins/linear/on-event.sh: sha256:4441786d352ce17c
  lib/plugins/notify-email/on-event.sh: sha256:83adb55196ccc901
  lib/plugins/notify-slack/on-event.sh: sha256:fffd58dc5363d1d2
  lib/plugins/pagerduty/on-event.sh: sha256:cdcfe528507a32de
tags: [plugins, events, slack, email, github, pagerduty, webhook]
created: 2026-04-07T09:40:38.484436
updated: 2026-04-07T09:40:38.484436
status: current
related: []
---

```yaml
---
title: Event Plugin System
type: component
tags: plugins, events, slack, email, github, pagerduty, webhook
related: []
---

## overview

the plugin system extends chain execution with external integrations. when chain events fire (chain-completed, chain-stopped, agent-completed), the plugin-runner.sh executes registered plugin scripts. each plugin is a self-contained bash script in lib/plugins/{name}/on-event.sh that receives event context via environment variables and takes action (send notification, create PR, open ticket, etc).

## architecture

plugin lifecycle:
  1. chain config declares plugins: plugins: [{name: slack, config: {WEBHOOK_URL: ...}}]
  2. plugin-runner.sh sources lib/plugins/{name}/plugin.sh (metadata: enabled, events, env vars)
  3. when event fires, plugin-runner.sh exports PLUGIN_* vars and calls lib/plugins/{name}/on-event.sh
  4. plugin script reads env vars, takes action, exits 0 (success) or non-zero (failure)

plugin contract:
  - must live in lib/plugins/{name}/on-event.sh
  - must be executable bash (#!/bin/bash, set -euo pipefail)
  - receives context via PLUGIN_* environment variables (see below)
  - silent success: echo for logging only. exit 0 on success, non-zero on error
  - optional plugin.sh in same dir declares metadata (enabled, events, env_vars, description)

## environment variables

every plugin receives these (exported by plugin-runner.sh):
  PLUGIN_EVENT_TYPE     the event that fired (chain-completed, chain-stopped, agent-completed)
  PLUGIN_CHAIN_ID       chain name or ID
  PLUGIN_RUN_ID         run UUID
  PLUGIN_AGENT_ID       agent ID (only for agent-completed events)

plugin-specific vars come from chain config:
  plugins:
    - name: slack
      config:
        WEBHOOK_URL: https://hooks.slack.com/...
        CHANNEL: "#alerts"
        NOTIFY_ON: "chain-stopped"

becomes:
  PLUGIN_WEBHOOK_URL
  PLUGIN_CHANNEL
  PLUGIN_NOTIFY_ON

## bundled plugins

### notify-slack

posts to slack webhook. icons vary by event type (:white_check_mark:, :warning:, :robot_face:).

vars: PLUGIN_WEBHOOK_URL (required), PLUGIN_CHANNEL (optional), PLUGIN_NOTIFY_ON (filter)
events: all (default) or specific event type

### notify-email

sends transactional email via /api/email/send. uses BETTER_AUTH_URL for API base.

vars: PLUGIN_TO (required), PLUGIN_NOTIFY_ON (filter)
events: chain-completed, chain-stopped, others (fallback subject/body)

### email-digest

accumulates events in jsonl buffer, flushes when threshold hit. reduces spam.

vars: PLUGIN_TO (required), PLUGIN_DIGEST_FILE (default /tmp/mentiko-digest.jsonl), PLUGIN_SEND_AFTER_EVENTS (default 10)
events: accumulates all, sends when threshold reached

### github-pr

creates github pull request after chain-completed. skips if on base branch or no commits ahead.

vars: PLUGIN_TOKEN (github PAT), PLUGIN_OWNER, PLUGIN_REPO (required), PLUGIN_BASE_BRANCH (default main), PLUGIN_DRAFT (default false)
events: chain-completed
checks: not on base branch, has commits ahead of base, PR doesn't already exist

### linear

creates linear issues for chain events. maps events to workflow states (Done, Cancelled).

vars: PLUGIN_API_KEY (linear personal API token), PLUGIN_TEAM_ID (optional, auto-resolves if omitted)
events: chain-completed (Done), chain-stopped (Cancelled), agent-completed (Done)
graphql: uses issueCreate mutation with teamId, description, stateId

### pagerduty

triggers pagerduty incidents via events v2 api. only on chain-stopped (failures).

vars: PLUGIN_ROUTING_KEY (required), PLUGIN_SEVERITY (default error)
events: chain-stopped only (exits 0 on other events)
dedup: "mentiko-{CHAIN_ID}" prevents duplicate incidents

### custom-webhook

generic http webhook sender. posts json payload to any endpoint.

vars: PLUGIN_URL (required), PLUGIN_SECRET (optional, adds X-Webhook-Signature header), PLUGIN_EVENTS (filter, default all)
events: all or filtered
payload: {event_type, chain_id, run_id, timestamp}

## patterns

### event filtering

most plugins support NOTIFY_ON or EVENTS var to filter which events trigger action:
  PLUGIN_NOTIFY_ON="chain-stopped"     # only trigger on failures
  PLUGIN_EVENTS="chain-completed"      # only trigger on success

filter logic:
  if [[ "$NOTIFY_ON" != "all" && "$NOTIFY_ON" != "$EVENT_TYPE" ]]; then
      exit 0
  fi

### silent failure

plugins should log but not chain-explode on external service failures:
  curl -s ... > /dev/null 2>&1 || true

non-zero exit only for config errors (missing required vars).

### jq dependency

all plugins use jq for json construction. ensure jq is installed in target environment.

### base url resolution

plugins that call /api/email/send use BETTER_AUTH_URL (default http://localhost:3000). in container, this should be set to actual domain.

## gotchas

- email plugins use /api/email/send which requires web server running. doesn't work in cli-only mode.
- github-pr checks for existing PRs via github api. rate limit applies for large repos.
- linear graphql requires team ID or auto-resolve (calls teams query). auto-resolve fails if user has no teams.
- pagerduty only triggers on chain-stopped. chain-completed and agent-completed are ignored.
- custom-webhook signature header is just a passthrough, not hmac. not secure for verification.
- email-digest buffer file persists across chain runs. only cleared when threshold hit and email sent.
- plugins are bash scripts. windows users need wsl or git bash.

## plugin discovery

plugin-runner.sh auto-discovers plugins in lib/plugins/*/:
  - sources plugin.sh if exists (metadata: enabled, events, env_vars)
  - executes on-event.sh when matching event fires
  - skips if plugin.sh missing or enabled=false

## adding a new plugin

1. create dir: lib/plugins/{name}/
2. create on-event.sh:
   #!/bin/bash
   set -euo pipefail
   VAR="${PLUGIN_VAR:-}"
   # read PLUGIN_EVENT_TYPE, PLUGIN_CHAIN_ID, etc
   # do work
   # exit 0 on success, 1 on error
3. optional plugin.sh:
   enabled=true
   events="chain-completed,chain-stopped"
   env_vars="WEBHOOK_URL,CHANNEL"
   description="my plugin"
4. reference in chain config:
   plugins:
     - name: my-plugin
       config:
         VAR: value
```