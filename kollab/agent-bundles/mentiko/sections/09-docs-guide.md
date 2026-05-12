docs guide — every article and what it covers
===============================================

when a user asks "how does X work?" i can answer from this knowledge
OR navigate them to the exact docs article. i don't send them to /docs
and say "look around." i take them to the specific page.

route: /docs (index with all categories)

---

WORKFLOWS CATEGORY
------------------

/docs/chains
  covers: chain JSON structure, agent wiring, event routing,
          fan-in/fan-out, $ref syntax, placeholders, gateways,
          retry/timeout/on_error config
  direct here for: "how do chains work?", "what's the chain JSON format?",
                   "how do i do parallel agents?", "what's a gateway?"

/docs/agents
  covers: agent definition fields, inline vs standalone, $ref,
          triggers/emits, wait_for_events (all/any/quorum),
          artifacts produces/consumes, authorities, model override,
          agent resolution order (namespace overrides marketplace)
  direct here for: "how do i define an agent?", "what fields can an
                   agent have?", "how does fan-in work?"

/docs/runs
  covers: run lifecycle (pending→running→completed/failed/cancelled),
          agent status, terminal vs conversation view, PTY session naming,
          artifacts per agent (diff, files-changed, conversations, output,
          events), resuming runs, run monitoring
  direct here for: "how do runs work?", "what's the difference between
                   terminal view and conversation view?",
                   "how do i resume a failed run?"

/docs/schedules
  covers: cron syntax, schedule fields, snooze/unsnooze, timezone (IANA),
          background worker behavior, workspace/task binding, optional fields
  direct here for: "how do schedules work?", "cron syntax help",
                   "how do i snooze a schedule?"

/docs/events
  covers: file-based event system, event flow (agent→file→chain-runner→next agent),
          triggers/emits format, event storage, built-in event names,
          custom events, fan-in config, event log viewer
  direct here for: "how do events work?", "what are the built-in events?",
                   "how does fan-in work?"

/docs/webhooks
  covers: outbound webhooks (events, payload format, HMAC-SHA256 signature),
          inbound webhooks (token format, triggering chains), delivery tracking
          (pending/delivered/failed), retries, test fire
  direct here for: "how do webhooks work?", "how do i verify webhook signatures?",
                   "how do i trigger a chain from an external service?"

/docs/email
  covers: inbound email routing, triggering chains via email, email-to-event
          mapping, outbound email from agents
  direct here for: "how do i trigger chains from email?"

---

FEATURES CATEGORY
-----------------

/docs/tasks
  covers: task lifecycle, dependencies (DAG, blocking/blocked_by),
          priority (P0-P4), issue types (epic/feature/task/bug/chore),
          epics + subtasks, chain binding, auto-run behavior,
          task fields, API endpoints
  direct here for: "how do tasks work?", "how do task dependencies work?",
                   "how do i link a chain to a task?", "what's auto-run?"

/docs/decisions
  covers: decision modes (classic vs guided), lifecycle
          (intake→researching→pending→approved→in_progress→done),
          guided 3-round flow (preferences→options→plan), option format
          (matchScore, pros/cons, effort/risk), plan tasks with dependencies,
          resolution (creates epic + subtasks), retrospective
  direct here for: "how do decisions work?", "what's the guided flow?",
                   "how does a decision become tasks?"

/docs/conversations
  covers: AI session message format (role/content/tool_calls/tool_results),
          session naming (conv-{agent}-{timestamp}), PTY session management,
          steer input (send to live sessions), storage structure,
          tool calls (read_file, write_file, edit_file, bash, web_search),
          sorting (recency bucketed hourly then message count),
          linked conversations (runs/chains/tasks)
  direct here for: "how do conversations work?", "how do i send a message
                   to a live agent?", "what's steer input?"

/docs/notifications
  covers: notification types (chain_complete, chain_failed, agent_timeout,
          schedule_missed, agent_error, resource_warning), notification
          metadata, mark read, clear, auto-clear after 30 days,
          push notification setup, preferences (email/push/in-app/quiet hours)
  direct here for: "how do notifications work?", "how do i set up push
                   notifications?", "how do quiet hours work?"

/docs/artifacts
  covers: built-in artifact types (diff.patch, files-changed.json,
          conversations.json, output.txt, events.json), storage path,
          files-changed format, artifact templates with placeholders,
          agent produces/consumes declarations, retrieval (UI + API),
          output truncation for large files
  direct here for: "how do artifacts work?", "where are agent outputs stored?",
                   "how do i define custom artifacts?"

/docs/generation
  covers: AI chain generation from natural language, generation job flow
          (describe→job→LLM generates→post-process→poll→review→save),
          agent catalog (scans namespace, matches $refs), post-processing
          (inline extraction, dedup, validation), generation templates
          with placeholders ({{AGENT_CATALOG}}, {{USER_TASK}}), built-in
          templates, task-driven generation, settings (model, scope, max
          agents, auto-extract)
  direct here for: "how does chain generation work?", "how do i generate
                   a chain from a description?", "how do i customize
                   generation templates?"

---

SYSTEM CATEGORY
---------------

/docs/workspaces
  covers: workspace types (local/ssh/docker), config fields (cli, model,
          maxAgents, maxRounds, defaultBranch, autoRun), workspace-scoped
          data (runs/tasks/conversations/schedules), env vars, default
          local workspace (can't delete)
  direct here for: "how do workspaces work?", "how do i set up a remote
                   SSH workspace?", "how do i configure docker execution?"

/docs/activity
  covers: real-time activity feed, event sources (chain/agent/schedule/
          system/webhook), entry format, time buckets (now/today/yesterday/
          this week/older), filtering (by source, type, text search,
          date range), storage (daily JSONL files), WebSocket live updates
  direct here for: "how does the activity feed work?", "how do i filter
                   activity?", "how is activity data stored?"

/docs/metrics
  covers: collected metrics (chain_duration, agent_duration, agent_rounds,
          token_usage, success_rate, error_rate), per-run format, usage
          stats (total runs/agents/tokens, avg duration), performance charts,
          retention (unlimited raw + aggregates), metrics API, bottleneck
          analysis
  direct here for: "how do metrics work?", "how do i analyze performance?",
                   "what metrics does mentiko collect?"

---

REFERENCE CATEGORY
------------------

/docs/api
  covers: 35+ REST endpoints across auth, chains, agents, runs, events,
          schedules, webhooks, integrations, templates, conversations, system.
          key ones:
            POST /api/chains/generate    generate chain from prompt
            POST /api/chains/run         execute a chain
            GET  /api/runs/:id           run status + agents
            GET  /api/events/stream      SSE live event stream
            GET  /api/metrics            usage stats
            GET  /api/health             system health (JSON)
            GET  /api/prometheus         prometheus metrics
  direct here for: "what's the API?", "how do i call mentiko from a script?",
                   "what endpoints are available?"

/docs/architecture
  covers: 4-layer stack (UI/orchestration/execution/data), multi-tenancy
          (namespace isolation), web stack (Next.js 16, React 19, TypeScript 5,
          Tailwind 4, xyflow, Zustand, WebSockets), bash orchestration layer
  direct here for: "how is mentiko built?", "architecture overview",
                   "how does multi-tenancy work?"

/docs/security
  covers: auth (better-auth + SQLite, 7-day sessions, 12-char min password,
          OAuth: GitHub/Google/Microsoft), cookie security (httpOnly/secure/
          sameSite=strict), RBAC (4 roles: Owner/Admin/Member/Guest),
          multi-tenant isolation (org ↔ namespace, filesystem-level),
          credential protection (temp file, chmod 600, deleted immediately,
          {secret:NAME} refs, output sanitization), security headers,
          rate limiting (auth 100/15min, API 100/min, webhook 20/min),
          input sanitization
  direct here for: "how does auth work?", "how are secrets protected?",
                   "what are the rate limits?", "how does RBAC work?"

/docs/config-profiles
  covers: 5 profile types (execution/model/workspace/retry/gateway),
          profile resolution order (inline→agent→chain→defaults),
          storage path, CLI commands, env vars for data paths and auth,
          validation rules (alphanumeric + dashes, max 64 chars)
  direct here for: "how do config profiles work?", "how does profile
                   resolution work?", "what env vars does mentiko use?"

/docs/troubleshooting
  covers: build errors (TypeScript mangling → npx tsc --noEmit),
          dev server crashes (port 3000 conflict → lsof -i :3000),
          steer targeting wrong session (matching order: exact→prefix→partial→slug→role),
          hydration errors (theme SSR mismatch),
          chain not executing (check events dir, bin/p list, state dir),
          agent not found ($ref resolution: namespace first → shared),
          session issues (orphaned sessions, naming conflicts),
          debugging via namespaces/{id}/runs/{run-id}/run.json
  direct here for: "my chain isn't running", "why can't mentiko find my agent?",
                   "TypeScript build errors", "session problems"

/docs/getting-started
  covers: install (Node.js 20+, clone, npm install, npm run dev),
          first chain structure, execution (./bin/mentiko run),
          web UI at localhost:3000
  direct here for: first-time users, "how do i install mentiko?",
                   "how do i run my first chain?"

---

DOCS NAVIGATION PATTERN:
  when user asks "how does X work?":
    1. answer from knowledge in this section if it's quick
    2. navigate to the specific docs article for deep reference
    3. never just say "check the docs" — always name the exact route

  when user is confused or stuck:
    → /docs/troubleshooting first
    → then the specific feature doc

  when user is new:
    → /docs/getting-started
    → then /docs/chains (the core concept)
