# CLI Readiness Advisor Recovery Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Goal: replace the startup anti-patch with config-driven readiness, richer advisor recovery context, and an interactive run terminal toggle.

Architecture: keep readiness matching in a focused bash module used by `chain-runner.sh`; store readiness policy on agent profiles; keep advisor recovery prompt construction in a focused monitor/recovery module; expose terminal input from the run UI only by explicit user toggle.

Tech Stack: bash runner scripts, pty-manager, Next.js 16, React 19, Jest, bash tests.

---

### Task 1: Remove Anti-Patch And Fix Codex Defaults

Files:
- Modify: `Dockerfile.base`
- Modify: `bin/docker-entrypoint.sh`
- Modify: `lib/agent-functions.sh`
- Modify: `lib/chain-runner.sh`
- Modify: `web/config/agent-provider-catalog.json`
- Modify: `web/e2e/engine/engine-e2e.sh`
- Modify: `web/e2e/engine/fixtures/stub-agent-cli.sh`
- Delete: `lib/cli-startup-prompts.sh`
- Delete: `lib/seed-agent-cli-config.sh`
- Delete: `tests/bash/test-cli-startup-prompts.sh`
- Delete: `tests/bash/test-seed-agent-cli-config.sh`
- Delete: `err`

- [ ] Remove Codex pinning from `Dockerfile.base` and keep `@openai/codex` in the normal AI CLI install list.
- [ ] Remove entrypoint seeding of `.claude.json` and `.codex/config.toml`.
- [ ] Remove startup prompt auto-answer code and tests.
- [ ] Keep the source catalog removal of `--skip-git-repo-check`.

### Task 2: Add Profile-Driven Readiness

Files:
- Create: `lib/cli-readiness.sh`
- Create: `tests/bash/test-cli-readiness.sh`
- Modify: `lib/chain-runner.sh`
- Modify: `web/lib/types.ts`
- Modify: `web/lib/agents/agent-profile-storage.ts`
- Modify: `web/lib/agents/agent-provider-catalog.ts`
- Modify: `web/app/api/agent-profiles/route.ts`
- Modify: `web/app/api/agent-profiles/[id]/route.ts`

- [ ] Add tests for ready, blocked, recoverable, retry, disabled, and unknown captures.
- [ ] Implement `cli_readiness_check <profile_file> <capture_file>`.
- [ ] Add readiness typing and validation.
- [ ] Thread readiness through create/update profile APIs.
- [ ] Call readiness check before instruction injection.

### Task 3: Add Advisor Recovery Contract

Files:
- Create: `lib/advisor-recovery.sh`
- Create: `tests/bash/test-advisor-recovery.sh`
- Modify: `lib/monitor-completion.sh`
- Modify: `lib/chain-runner.sh`

- [ ] Add tests proving recovery prompt includes Mentiko context, run id, profile id, cwd, command, state, and terminal capture.
- [ ] Add JSON contract parsing helpers.
- [ ] Do not auto-apply high-risk recovery.
- [ ] Keep stale-running plain text nudges separate from startup recovery JSON.

### Task 4: Add Run Terminal Interactivity Toggle

Files:
- Create: `web/components/run/__tests__/run-detail-panel-source.test.ts`
- Modify: `web/components/run/run-detail-panel.tsx`

- [ ] Add source test that `TerminalPanel` is not hardcoded `readOnly={true}`.
- [ ] Add an interactive toggle shown only for running, blocked, or startup recovery sessions.
- [ ] Pass `readOnly={!terminalInputEnabled}`.

### Task 5: Verification

Commands:
- `bash tests/bash/test-cli-readiness.sh`
- `bash tests/bash/test-advisor-recovery.sh`
- `cd web && npm test -- chain-runner-ai-gateway-source.test.ts --runInBand`
- `cd web && npm test -- run-detail-panel-source.test.ts --runInBand`
- `git diff --check`

Browser proof:
- Open an active or blocked run.
- Select output tab.
- Select an agent session.
- Enable interactive terminal.
- Confirm the terminal accepts input without opening the physical terminal.
