# Plugin Architecture Spec

## Current State (Problems)

1. All plugins use `on-event.sh` with no standardized payload contract.
2. Categories (`notification` | `integration`) are too broad — behavior differs significantly.
3. `custom-webhook` is named ambiguously (outbound vs inbound).
4. Event strings use legacy hyphen format (`chain-completed`) while platform event
   registry uses dot notation (`chain.completed`). Need alignment.
5. Plugin events field is not validated against the platform event registry.
6. No distinction between "fire and forget" plugins vs "bidirectional sync" plugins.

---

## Plugin Category Taxonomy

### notification
Fire-and-forget outbound push. No acknowledgment expected.
- **Contract**: receive context, format message, send to external service.
- **Exit codes**: 0 = sent, 1 = failed (logged, chain continues).
- **Examples**: notify-slack, notify-email, pagerduty, email-digest

### task-provider
Bidirectional sync with external task/issue tracking systems.
- **Contract**: read chain context + external task state, create/update issue in system.
- **May call external API to look up existing issue before creating.**
- **Examples**: linear (current), notion, monday, jira (future)

### ci-cd
Trigger or update external CI/CD pipelines/artifacts on chain events.
- **Contract**: create external resources (PRs, releases, deployments).
- **Examples**: github-pr (current), gitlab, jenkins (future)

### outbound-webhook
Send structured event payload to any HTTP endpoint.
- **Distinct from inbound webhooks** (which RECEIVE events and start chains).
- Renamed from confusing "custom-webhook".
- **Examples**: custom-webhook (renamed)

### custom
User-defined scripts. No enforced contract beyond env vars.

---

## Event Naming Alignment

Platform registry uses dot notation: `chain.completed`, `agent.completed`, etc.
Plugin manifests use legacy hyphen format: `chain-completed`, `agent-completed`.

Resolution: support both. In `plugin-types.ts`, `PluginEventType` accepts both forms.
When running `on-event.sh`, `$EVENT_TYPE` is passed in dot notation going forward.
Legacy hyphen format is translated by `chain-runner-complete.sh`.

Mapping:
  chain-completed   → chain.completed
  chain-stopped     → chain.stopped / chain.failed
  agent-completed   → agent.completed
  agent-started     → agent.started
  chain-started     → chain.started
  approval-*        → approval.*
  webhook-received  → webhook.received

---

## Plugin API Contract (on-event.sh)

Every `on-event.sh` receives the following environment variables:

### Always present
  EVENT_TYPE          Dot-notation event name, e.g. chain.completed
  CHAIN_ID            Chain identifier
  CHAIN_NAME          Human-readable chain name
  RUN_ID              Run identifier
  NAMESPACE_ID        Namespace the plugin is running in
  MENTIKO_ROOT        Root directory of the mentiko installation
  PLUGIN_ID           This plugin's identifier
  PLUGIN_DIR          Absolute path to this plugin's directory

### Event-specific (present when applicable)
  AGENT_ID            Set for agent.* events
  AGENT_NAME          Set for agent.* events
  EXIT_STATUS         0=success, 1=failure (for chain.stopped)
  DURATION_SECONDS    Chain/agent run duration

### Config values
  Plugin config keys are uppercased and prefixed: PLUGIN_CFG_{KEY}
  Secret fields are already decrypted by the time on-event.sh runs.
  Example: config key `webhook_url` → env var `PLUGIN_CFG_WEBHOOK_URL`

### Payload (optional, structured)
  PLUGIN_PAYLOAD      JSON string with event-specific payload (mirrors platform event schema)

### Exit codes
  0   Success
  1   Non-fatal failure (logged, chain continues)
  2   Fatal failure (chain marked as failed — reserved, not yet used)

### Timeout
  30 seconds default. SIGTERM then SIGKILL.

---

## Inbound vs Outbound Webhooks (Unification Decision)

  Inbound webhooks (/app/webhooks):
    - External service → POST to /api/webhooks/inbound/{id}
    - Triggers a chain run
    - Managed via /webhooks page
    - NOT a plugin — it's a trigger mechanism

  Outbound webhook plugin (custom-webhook → outbound-webhook):
    - Chain event → POST to external URL
    - Lives in plugin system
    - Configured via /plugins page

  Decision: KEEP SEPARATE. They are inverse operations.
  Action: Rename plugin.json id from "custom-webhook" to "outbound-webhook",
  update name to "Outbound Webhook". Keep backward compat by aliasing.

---

## Updated `PluginManifest.category` Values

  Old:                          New:
  "notification"        →       "notification"    (unchanged)
  "integration"         →       "ci-cd"           (for github-pr type plugins)
  "integration"         →       "task-provider"   (for linear type plugins)
  "integration"         →       "outbound-webhook"(for custom-webhook type)
  "analytics"           →       "analytics"       (unchanged, not yet used)
  "custom"              →       "custom"          (unchanged)

---

## Plugin Scoping

Plugins are currently namespace-scoped (per-namespace registry.json).
This is correct. Orgs share namespaces, so plugin config is org-scoped.

No change needed here. Future work: org-level plugin marketplace where users
can install community plugins into their namespace.

---

## What Changes Now

1. Update `PluginManifest.category` type in `plugin-types.ts` to include new categories.
2. Update `custom-webhook/plugin.json`: rename category to `outbound-webhook`.
3. Update `linear/plugin.json`: rename category to `task-provider`.
4. Update `github-pr/plugin.json`: rename category to `ci-cd`.
5. Update `PluginEventType` in `plugin-types.ts` to include dot notation variants.
6. Update plugin event field in manifests to use dot notation going forward.
7. Document the `PLUGIN_CFG_*` env var contract in each plugin's on-event.sh header.

---

## What Stays the Same

- `on-event.sh` as the plugin execution entrypoint (simple, shellable, no coupling)
- Per-namespace `registry.json` for state + config
- Secret encryption via `enc:` prefix
- Built-in plugins in `lib/plugins/`, namespace plugins in `namespaces/{ns}/plugins/`
- `/api/plugins` REST API for enable/disable/configure
- `maskConfig` for API response masking
