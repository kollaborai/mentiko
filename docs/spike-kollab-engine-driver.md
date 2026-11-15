# Spike: Mentiko chain agent through kollabor_engine (claude-code over ACP)

Branch `spike/kollab-engine-driver`, 2026-11-14. Findings only — no product code changed.
Probe script: `scripts/spike-kollab-engine-probe.sh` (exact working calls, self-teardown).
Raw evidence: `~/backups/glm-kollab-spike-work/logs/` (SSE captures), engine log alongside.

Verdict: **the path works.** A driver can create an engine session, deliver a prompt,
watch SSE for `AGENT_COMPLETE`, verify the declared event file, nudge by re-POSTing a
message, and tear down with DELETE. Four gaps below must shape the driver design.

## 1. Engine startup — one landmine

`KOLLAB_CONFIG_DIR=<dir> python -m kollabor_engine serve --port N` works and writes
`<dir>/engine.token` (Bearer auth) — **but only from the kollab repo venv**
(`/Users/malmazan/dev/kollab/.venv`, editable install). The pip site-packages
kollabor-engine 0.18.7 (pyenv 3.14.7) has an older `auth.py` with no
`KOLLAB_CONFIG_DIR` override: it silently writes its token to the shared
`~/.kollab/engine.token`, clobbering the token other engines' clients read.
Observed live: my first engine start replaced the shared token file (7443 kept
working because it validates against the file at request time, but a client holding
the old token would break). Driver must pin the engine to the repo venv or a release
that includes the fix (kollab repo commit has `auth.py:_token_file` honoring the env var).

Isolation is partial even with the fix: profiles (`GET /profiles`) and MCP server
configs (`~/.kollab/mcp/mcp_settings.json` via `get_config_directory()`) resolve from
the shared `~/.kollab` regardless of `KOLLAB_CONFIG_DIR`. A tenant-isolated engine is
not achievable with that env var alone.

## 2. Session + turn — verified end to end

```
POST /sessions {"profile":"claude-code","workspace":"<abs dir>"}
  -> {"session_id":"2611142030-logic-surge-4qwr","harness":"Claude Code over ACP", ...}   (~1s)
POST /sessions/{id}/message {"content":"<prompt: write events/test_done.event, then print AGENT_COMPLETE>"}
  -> SSE stream (data:-only lines, no event: names), closes after turn_complete
GET  /sessions/{id}/mcp      -> {"servers":{"mentiko":{"status":"connected","tool_count":69}}}
POST /sessions/{id}/cancel   -> {"ok":true}   (but see gap 4a)
POST /sessions/{id}/message  -> accepted mid-turn AND after completion (nudge path)
DELETE /sessions/{id}        -> {"ok":true}, ACP daemon exits (verified no orphan claude procs)
```

Turn 1 results: event file written byte-exact; `AGENT_COMPLETE` in the token stream;
`turn_complete {stop_reason:"end_turn", input_tokens, output_tokens, turn_usage
{cached_read_tokens,...}}`; ~18.6s wall for a trivial task (claude-code routed through
the api.z.ai gateway, i.e. GLM backend — matches Marco's setup, no Anthropic credits).

SSE event stream order observed: `turn_start, state_snapshot, tool_call_update,
tool_start/tool_call/tool_result, token, message, usage_update, acp_update,
acp_waiting, history_updated, available_commands_update, turn_complete`. Two message
shapes matter to a driver: `token` (raw text — scan for `AGENT_COMPLETE`) and `message`
with `message_type` (`user|assistant|agent|tool`) for fuller turns.

## 3. MCP + x-mentiko-session-token — works

Session created with `mcp_servers:["mentiko"]` + header `x-mentiko-session-token:
<dummy>`: header accepted (it becomes `user_token`, injected into the daemon env,
sessions.py:312). The mentiko MCP server connected (69 tools) and the agent
successfully called `mcp__mentiko__detect_cli_status` (`tool_status:"success"`) even
with the dummy token — that tool evidently needs no valid mentiko auth; ops tools that
do were not exercised (untested, not claimed).

Permissions: `approval_mode` defaults to `"trust_all"` — zero `permission_request`
events across all turns; auto-grant is the default and needs nothing. If a stricter
mode is ever set, the answer endpoint is `POST /sessions/{id}/permission {tool_id,
scope}` (routes/permissions.py:23).

## 4. Gaps / blockers for the driver

a) **Cancel is a no-op for ACP turns.** `POST /cancel` returns `{"ok":true}` but the
claude-code turn ran to full completion (counted 1..200, `stop_reason:"end_turn"`).
Hard stop = `DELETE /sessions/{id}`. Treat cancel as advisory only.

b) **Hub cross-talk.** Sessions auto-join the per-folder kollab hub (kollab-hub MCP is
injected even when `mcp_servers` is empty; `state_snapshot` shows `hub_identity`).
Two sessions sharing a workspace saw each other's prompts as hub messages and acked
via `mcp__kollab-hub__hub_msg`. Mentiko runs must use per-run workspace directories
(or disable hub via agent.json `"hub": false` — disable path for profile launches
unverified).

c) **`GET /sessions/{id}/events` is a live stream, not a replay** — it blocks (first
event: `state_snapshot` with `is_processing`, mcp status). Use the POST /message SSE
response as the primary feed (engine subscribes before submitting, so no gap);
`GET /sessions/{id}/history` exists for replay.

d) **Stale site-packages engine clobbers the shared token** (see section 1).

## 5. Map to MonitorDriverIO (web/lib/runner-v2/monitor.ts:22)

| MonitorDriverIO | Engine equivalent |
|---|---|
| `hasSession(id)` | `GET /sessions/{id}` (200 vs 404) |
| `observe(id)` | consume POST /message SSE: `token` events (md5-of-tail equivalent = last tokens), completion = declared event file on disk (unchanged) + `AGENT_COMPLETE` seen in stream |
| `sendNudge(id, msg)` | `POST /sessions/{id}/message` — accepted mid-turn (queued) and between turns; replaces tmux send-keys |
| `onComplete(id)` | same completion bridge trigger: `AGENT_COMPLETE` in stream AND event file on disk (monitor-live-io.ts:151 rule carries over verbatim) |
| `onDied(id)` | message POST returns 409 "Session daemon is not running", or SSE `error` event; dead != succeeded rule unchanged |
| hard stop | `DELETE /sessions/{id}` (cancel unreliable) |

Completion semantics port cleanly: the event-file-on-disk requirement the monitor
already enforces is engine-agnostic, and `AGENT_COMPLETE` arrives as a `token` event.

## 6. Latency / cost notes

Session create ~1s. Trivial turn end-to-end ~19s (model-bound, gateway GLM).
`turn_usage` gives per-turn token counts including cached reads — usable for run
cost accounting, something the PTY path never had.
