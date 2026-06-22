# CLI Readiness And Advisor Recovery Design

Goal: prevent Mentiko from typing agent instructions into a CLI startup, install,
auth, update, or error screen, while giving the advisor enough Mentiko context to
recover safe cases.

Current problem: `chain-runner.sh` starts a configured CLI in a pty session and
then sends the instruction pointer. If the CLI exits or lands at a startup screen,
the monitor may later ask the advisor for a generic nudge even though no agent is
actually running. The advisor only sees terminal text and stale count; it does not
know the run contract, attempted command, profile, cwd, or safe recovery actions.

Architecture:
- Agent profiles own CLI readiness policy because readiness is CLI/profile-specific.
- Advisor settings own advisor prompt templates and recovery policy because this is
  Mentiko-level diagnosis, not a single agent command flag.
- `chain-runner.sh` asks a small bash readiness module before instruction injection.
- Unknown startup output is never considered ready. It becomes `startup_recovery`
  or `blocked`, with the session kept alive for human/AI recovery.
- Advisor recovery returns strict JSON. Plain text nudges remain only for stale
  already-running agents.

Agent profile readiness fields:
- `readiness.enabled`
- `readiness.ready_patterns[]`
- `readiness.blocked_patterns[]`
- `readiness.recoverable_patterns[]`
- `readiness.retry_patterns[]`
- `readiness.startup_timeout_ms`
- `readiness.max_recovery_attempts`

Pattern shape:
- `name`
- `enabled`
- `type`: `text` or `regex`
- `value`
- `action`: `ready`, `block`, `recover`, `retry`, `ignore`
- `risk`: `low`, `medium`, `high`
- `notes`

Advisor recovery context:
- Mentiko explanation: CLI orchestration in pty-manager sessions
- run id, agent id, profile id, CLI binary, cwd
- attempted command
- whether instructions were already injected
- run status and state file status
- current terminal capture
- matched readiness rule, if any
- allowed actions

Advisor recovery JSON:
- `action`: `send_keys`, `wait`, `block`, `retry_launch`, `restart_agent_session`,
  `stop_run`, or `suggest_profile_fix`
- `confidence`
- `risk`
- `keys`
- `reason`
- `evidence`

Safe defaults:
- Never mutate vendor config files under `$HOME`.
- Never pin Codex just to freeze prompt text.
- Never hardcode vendor prompt copy as product logic.
- Never auto-accept trust, auth, API-key, or bypass-consent screens.
- Auto-apply only low-risk, high-confidence actions allowed by policy.

Run UI:
- Run detail already has `TerminalPanel` and pty websocket support.
- Active, blocked, and recovering agent sessions should expose an interactive
  toggle. Default stays read-only. When enabled, `TerminalPanel` receives
  `readOnly={false}`.

Dev-mode note:
- This work is unreleased local development. Do not frame cleanup as tenant
  migration unless Marco says the code has shipped.
