---
title: Integration & Communication Layer
type: component
tags: [integrations, webhook, slack, email, github, bash, notifications, routing]
related: [chain-runner, event-system, namespace-hierarchy]
---

## Overview

The integration layer provides external communication for agent chains - notifications, approvals, version control, and third-party integrations. These bash modules form the bridge between mentiko's internal execution and the outside world.

All modules are sourced into `chain-runner.sh` and called at specific lifecycle points: agent start/completion/error, chain start/completion/failure, watchdog events, and user-triggered actions.

## Core Modules

### `approval-gate.sh` - Human-in-the-loop pauses

**Purpose**: Pause chain execution until a human approves via web UI or API.

**Key function**: `wait_for_approval <chain-id> <run-id> <agent-name> <step-name> <action> <description> [timeout-mins]`

**Flow**:
1. Creates approval request file: `$MENTIKO_PROJECT_ROOT/approvals/{uuid}.json`
2. Polls every 10 seconds for status change
3. Returns: 0=approved, 1=rejected, 2=timed out, 3=error

**Request file format**:
```json
{
  "id": "uuid",
  "status": "pending|approved|rejected|cancelled",
  "chainId": "...",
  "runId": "...",
  "agentName": "...",
  "action": "deploy|delete|etc",
  "description": "why approval needed",
  "expiresAt": "ISO-timestamp",
  "approvedBy": "user-id",
  "rejectionReason": "..."
}
```

**Gotchas**:
- macOS vs Linux date syntax for timeout calculation (`-v+${min}M` vs `-d "+${min} minutes"`)
- Requires `jq` for JSON parsing
- Approval files survive chain restart (must be cleaned up manually)

---

### `email-integration.sh` - Chain completion reports

**Purpose**: Send email summaries when chains finish (success or failure).

**Key function**: `send-chain-report <run-id> <chain.json> <status>`

**Config priority** (highest to lowest):
1. Environment vars: `CHAIN_EMAIL_TO`, `CHAIN_EMAIL_FROM`, `CHAIN_EMAIL_SMTP`, `CHAIN_EMAIL_METHOD`
2. chain.json: `config.email.to`, `config.email.from`, `config.email.smtp`, `config.email.method`
3. Defaults: `from=noreply@mentiko.local`, `method=auto`

**Delivery methods**:
- `mail` - Unix mail command
- `sendmail` - Direct sendmail pipe
- `api` - HTTP API (Mailgun, Sendgrid, or generic JSON)
- `auto` - Tries mail → sendmail → api in order

**Body content**: Run summary, goal, timing, agent status, report file links

**Gotchas**:
- Requires at least one of: `mail` command, `sendmail`, or `curl` (for API)
- Mailgun/Sendgrid require `api_url` and `api_key` in config
- No attachment support - only links to report files

---

### `git-integration.sh` - Version control for chains

**Purpose**: Git operations scoped to individual chains (each chain can be its own repo).

**Key functions**:
- `git_init_chain <chain-dir> [initial-branch]` - Initialize repo
- `git_status <chain-dir> [json|text]` - Working dir status
- `git_commit_chain <chain-dir> <message> [files]` - Commit changes
- `git_get_history <chain-dir> [max-count] [json|text]` - Commit log
- `git_diff_commits <chain-dir> <from> <to> [json]` - Diff between commits
- `git_revert_commit <chain-dir> <commit> [create-branch]` - Revert to previous state
- `git_create_branch <chain-dir> <branch-name> [start-point]`
- `git_list_branches <chain-dir> [json]`
- `git_switch_branch <chain-dir> <branch-name>`
- `git_merge_branch <chain-dir> <source-branch> [strategy]`
- `git_detect_conflicts <chain-dir> [json]`
- `git_resolve_conflict <chain-dir> <file> <ours|theirs|union>`

**Flow**:
- Each chain directory can have its own `.git/` repo
- Initial commit includes `chain.json` + `.gitignore`
- All git operations run from within chain directory

**Gotchas**:
- `.gitignore` excludes state files (`*.state`, `*.event`), temp files, IDE configs
- Branch switching auto-stashes uncommitted changes
- Merge conflicts detected via `git diff --name-only --diff-filter=U`
- Returns JSON or text based on `format` parameter

---

### `github-integration.sh` - Issue creation from errors

**Purpose**: Automatically create GitHub issues when agents fail.

**Key functions**:
- `github-create-issue <repo> <title> <body> [labels]` - Generic issue creator
- `github-agent-error-issue <repo> <run-id> <agent-id> <error-msg> [output-file]` - Agent error wrapper
- `github-test-connection` - Verify token works
- `github-validate-repo <owner/repo>` - Check repo access

**Config** (env or `.env` file):
- `GITHUB_TOKEN` - Personal access token (requires `repo` or `public_repo` scope)

**Issue template includes**:
- Run ID, agent ID, chain name
- Goal, error message, status
- Last 100 lines of agent output (if output-file provided)
- Full run info as JSON

**Gotchas**:
- Token must have repo write permissions
- Issues created with labels: `agent-error`, `bug`, `automated`
- Silent failure if token not configured (logs error but doesn't stop chain)

---

### `integrations.sh` - Third-party integration dispatcher

**Purpose**: Unified handler for GitHub and Microsoft Teams integrations.

**Key functions**:
- `integration-send <type> <event-type> <chain-file> [data]`
- `integration-test <type> <chain-file>` - Test connection
- `integration-status <chain-file>` - Show configured integrations

**Supported types**: `github`, `teams`

**Config location**: `chain.json` → `config.integrations.{type}`

**GitHub config**:
```json
{
  "config": {
    "integrations": {
      "github": {
        "enabled": true,
        "token": "...",
        "owner": "org",
        "repo": "repo-name",
        "labels": ["bug", "automated"]
      }
    }
  }
}
```

**Teams config**:
```json
{
  "config": {
    "integrations": {
      "teams": {
        "enabled": true,
        "webhook_url": "...",
        "events": ["chain_*", "agent_*"]
      }
    }
  }
}
```

**Event filtering**: Only triggers for events matching `config.integrations.{type}.events` array (if specified).

**Gotchas**:
- GitHub only creates issues for error events (names ending in `_error`, `_failed`, `_timeout`)
- Teams sends adaptive cards with color-coded status (red=error, yellow=warning, green=success)
- Uses `curl` for all API calls

---

### `notification-dispatcher.sh` - Multi-channel notification router

**Purpose**: Send events to mentiko's dispatch API for fan-out to configured channels.

**Key functions**:
- `dispatch-notification <event-type> <chain-id> <run-id> [agent-id] [message]`
- `dispatch-chain-completed`, `dispatch-chain-failed`, `dispatch-agent-completed`, etc.

**Config**:
- `MENTIKO_DISPATCH_ENDPOINT` - API URL (default: `http://localhost:3000/api/notifications/dispatch`)
- `MENTIKO_DISPATCH_SECRET` - Bearer token (default: `$BETTER_AUTH_SECRET`)
- `MENTIKO_NOTIFICATIONS_ENABLED` - Master switch (default: true)

**Event types**: `chain-completed`, `chain-failed`, `chain-stopped`, `agent-completed`, `agent-failed`, `chain-stalled`, `approval-requested`, `budget-threshold`

**Payload format**:
```json
{
  "event": "chain-completed",
  "chainId": "...",
  "runId": "...",
  "agentId": "...",
  "message": "...",
  "namespaceId": "default"
}
```

**Response**: Returns JSON with `dispatched` array of channel names that received the notification.

**Gotchas**:
- Requires mentiko web server running for dispatch endpoint
- Falls back to unauthenticated localhost if no secret configured
- Silent failure if notifications disabled

---

### `plugin-runner.sh` - Dynamic plugin executor

**Purpose**: Load and execute user-defined plugins in response to events.

**Key function**: `run-plugins <event-type> [chain-id] [run-id] [agent-id] [data-json]`

**Plugin discovery**:
1. Check `$MENTIKO_ORG_ROOT/plugins/registry.json`
2. For each enabled plugin with matching event:
   - Locate script at `pluginDir/onEventScript` (default: `on-event.sh`)
   - Fallback to `$SCRIPT_DIR/plugins/{id}/on-event.sh` for built-ins

**Registry format**:
```json
{
  "plugins": [
    {
      "id": "my-plugin",
      "enabled": true,
      "pluginDir": "/path/to/plugin",
      "manifest": {
        "events": ["chain_complete", "agent_error"],
        "onEventScript": "handler.sh"
      },
      "config": {
        "API_KEY": "...",
        "timeout": "30"
      }
    }
  ]
}
```

**Environment variables passed to plugin**:
- `PLUGIN_EVENT_TYPE`, `PLUGIN_CHAIN_ID`, `PLUGIN_RUN_ID`, `PLUGIN_AGENT_ID`
- `PLUGIN_EVENT_JSON`, `PLUGIN_DATA_JSON`
- `PLUGIN_{KEY}` for each config key (uppercased)

**Execution**: Fire-and-forget background processes (non-blocking).

**Gotchas**:
- Plugins run in parallel with chain execution
- No wait/timeout mechanism - orphaned processes possible
- Plugin failures silent (redirected to `/dev/null`)

---

### `routing-lib.sh` - Advanced chain orchestration patterns

**Purpose**: Fan-out/fan-in, conditional branching, error routing, timeout handling.

**Key functions**:

**Fan-out/fan-in**:
- `fan-group-create <group-id> <event> <fan-out-agents> [fan-in-agent] [wait-for] [quorum] [on-error]`
- `fan-group-agent-complete <group-id> <agent-id> [status]` - Mark agent done
- `fan-group-check-trigger <group-id>` - Check if fan-in condition met
- `fan-group-get <group-id> <field>` - Read state field

**Wait modes**:
- `all` - Wait for all agents (default)
- `any` - Trigger on first completion
- `quorum` - Wait for N successful completions

**Retry logic**:
- `retry-calculate-delay <attempt> [strategy] [initial-delay] [max-delay] [multiplier]`
- Strategies: `fixed`, `exponential` (default), `linear`

**Branch parsing**:
- `branch-parse <branch-json> <event-name>` - Returns `TYPE:DATA`
- Types: `simple`, `parallel`, `fanout`, `conditional`

**Error handling**:
- `error-handler-resolve <chain-file> <agent-id> [error-type]` - Find error handler agent
- `timeout-check-agent <agent-id> <chain-file>` - Check if agent exceeded timeout

**State storage**: `$STATE_DIR/fan-groups/{group-id}.state`

**Gotchas**:
- Fan-in agent gets `AGENT_FAN_GROUP_ID` env var
- On-error handler replaces fan-in agent if any agents failed
- Timeout detection requires agent state file with `started:` timestamp
- Exponential backoff uses `bc` - may fail on minimal installs

---

### `slack-integration.sh` - Slack webhook notifications

**Purpose**: Send formatted Slack messages on chain lifecycle events.

**Key functions**:
- `send-slack <event> <chain-file> [payload-data]` - Generic sender
- `send-slack-chain-start`, `send-slack-chain-complete`, `send-slack-agent-error`
- `slack-config-test <chain-file>` - Test webhook

**Config** (priority order):
1. `SLACK_WEBHOOK_URL` env var
2. `chain.json` → `config.slack.webhook_url`

**Message format**: Attachments with color-coded status:
- Green (`#36a64f`) - start, complete
- Red (`#dc3545`) - error
- Yellow (`#ffc107`) - warning
- Orange (`#fd7e14`) - timeout

**Event filtering**: Only sends events in `config.slack.events` array (if specified).

**Gotchas**:
- Error messages truncated to 300 chars
- Requires `curl` for webhook delivery
- Returns 0 even if webhook fails (logs to stdout only)

---

### `webhook-sender.sh` - Generic webhook delivery with retry

**Purpose**: Send webhook notifications to arbitrary URLs with retry logic.

**Key functions**:
- `send-webhook <event-type> <chain-file> [payload-data]` - Main sender
- `get-webhook-status [chain-file]` - Show recent deliveries
- `cleanup-webhook-state [days]` - Remove old state files
- `fire-chain-webhooks <event-type> <chain-file> [chain-id] [run-id]` - New format handler

**Config**: `chain.json` → `config.webhooks`
```json
{
  "config": {
    "webhooks": {
      "enabled": true,
      "urls": ["https://example.com/webhook", ...],
      "events": ["chain_complete", "agent_error"],
      "retry": {
        "max_attempts": 3,
        "backoff_base": 2,
        "initial_delay": 1,
        "max_delay": 60
      },
      "headers": {
        "Authorization": "Bearer ...",
        "X-Custom": "value"
      },
      "secret": "hmac-signature-key"
    }
  }
}
```

**Headers added automatically**:
- `Content-Type: application/json`
- `X-Webhook-Event`, `X-Webhook-Id`, `X-Webhook-Timestamp`
- `User-Agent: mentiko/1.0`
- `X-Webhook-Signature: sha256=...` (if secret configured)

**State tracking**: `$HOME/.mentiko_webhooks/{event-id}-{url-hash}.json`

**Retry behavior**: Exponential backoff with jitter cap.

**Gotchas**:
- Webhooks fire asynchronously (background curl)
- State files accumulate - requires periodic cleanup
- HMAC signature uses OpenSSL - may fail on minimal installs
- New format (`metadata.webhooks`) uses array of objects with per-webhook config

---

## Common Patterns

### Configuration Priority Chain

Most modules follow this resolution order:
1. Environment variables (highest)
2. chain.json `config.{module}` section
3. Defaults (lowest)

### Event Subscription Pattern

Most integrations support event filtering:
```json
{
  "config": {
    "slack": {
      "events": ["chain_complete", "agent_error"]
    }
  }
}
```
- If `events` array missing: send all events
- If present: only send matching events

### Retry with Backoff Pattern

Used in webhooks, some git operations, and agent retries:
```bash
max_attempts=3
backoff_base=2
initial_delay=1
max_delay=60
```

### Fire-and-Forget Pattern

Plugins and some webhooks use background execution:
```bash
( command... ) 2>/dev/null &
```

### State File Pattern

Fan-out groups, approvals, webhooks all use JSON state files for persistence:
- Location: module-specific directory (usually under `$MENTIKO_PROJECT_ROOT` or `$HOME`)
- Format: JSON with status, timestamps, metadata
- Cleanup: Manual or via cron

## Dependencies

**Required**:
- `jq` - JSON parsing (all modules)
- `curl` - HTTP requests (github, teams, slack, webhooks)

**Optional**:
- `mail` - Unix mail command (email)
- `sendmail` - Direct mail delivery (email)
- `git` - Version control (git-integration)
- `uuidgen` - UUID generation (approval-gate)
- `openssl` - HMAC signatures (webhook-sender)
- `bc` - Math for exponential backoff (routing-lib)

**Internal**:
- `config.sh` - Namespace-aware path resolution
- `run-lib.sh` - Run data access (email-integration)
- `metrics.sh` - Webhook delivery tracking

## Data Flow

```
chain-runner.sh (lifecycle event)
    |
    v
integration module (e.g., send-slack)
    |
    v
external service (slack api)
    |
    v
notification delivered / logged
```

**Fan-out/fan-in flow**:
```
event emitted
    |
    v
fan-group-create (track state)
    |
    v
launch multiple agents in parallel
    |
    v
each agent calls fan-group-agent-complete
    |
    v
fan-group-check-trigger (wait condition met?)
    |
    v
fan-in agent triggered (or error handler)
```

## Gotchas Summary

1. **macOS date syntax**: `-v+${min}M` vs Linux `-d "+${min} minutes"`
2. **Silent failures**: Most integrations log but don't stop chain on failure
3. **State accumulation**: Approval files, webhook state, fan-group state must be cleaned manually
4. **Fire-and-forget**: Plugins and some webhooks don't wait for response
5. **Token scope**: GitHub token needs `repo` permission for issue creation
6. **jq required**: All modules fail silently without `jq` installed
7. **Namespace awareness**: Paths use `$MENTIKO_*` vars from `config.sh` - must be sourced first
8. **Event filtering**: Default is "send all" if events array not specified
