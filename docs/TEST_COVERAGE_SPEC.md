coverage spec: runtime/node scripts unit test plan

goal
test every runtime Node/TypeScript entry point in this codebase.
shell scripts are out of scope for this spec.

scope
- include .js/.mjs/.ts runtime files under bin and lib
- include every file in this list exactly once
- each file gets at least one dedicated unit-test slice
- each file with side effects gets black-box child-process coverage
- each file gets temp dirs under /tmp and cleanup every run

agent flow
- use up to 5 agents
- start with every file as ☐
- each agent claims exactly one pending file:
  mark as ▶ [agent-#] path
- complete file and add tests:
  mark as ☑ [agent-#] path
- if blocked:
  mark as ⚠ [agent-#] file
  add blocker and next action
- if a file is already covered by handoff or prior work, mark ☑ path

notes
- keep agent id label stable by reusing numeric ids in order
- a completed file must include:
  - behavior tests
  - error-path tests
  - state-change assertions when relevant

bin
☐ [agent-1] bin/secrets-rotate
☐ [agent-3] bin/validate-artifacts

lib
☑ lib/chain-runner.mjs — RETIRED (moved to .trash; production chains run via bash lib/chain-runner.sh)
☑ lib/job-runner.mjs — RETIRED (deleted in ef34d30). Replaced by the typed
  worker web/lib/runner-v2/job-worker.ts, bundled as lib/runner-job-worker.js.
  Covered by tests/job-runner.test.mjs (black-box child-process tests over
  job loading, profile resolution, secret decryption, CLI spawn, output
  parsing, error handling, workspace resolution) plus the bundle-drift guard in
  tests/runner-typed-bundle-parity.test.mjs.
☐ [agent-2] lib/pty-manager.mjs
☐ [agent-3] lib/mentiko-cli-schedules.mjs
☐ [agent-4] lib/mentiko-mcp/server.ts
☐ [agent-1] lib/mentiko-mcp/dispatch.ts
☐ [agent-2] lib/mentiko-mcp/tools.ts
☐ [agent-3] lib/mentiko-mcp/handlers/ops-client.ts
☐ [agent-4] lib/mentiko-mcp/handlers/agents.ts
☐ [agent-1] lib/mentiko-mcp/handlers/applications.ts
☐ [agent-2] lib/mentiko-mcp/handlers/chains.ts
☐ [agent-3] lib/mentiko-mcp/handlers/context.ts
☐ [agent-4] lib/mentiko-mcp/handlers/decisions.ts
☐ [agent-1] lib/mentiko-mcp/handlers/files.ts
☐ [agent-2] lib/mentiko-mcp/handlers/filesystem.ts
☐ [agent-3] lib/mentiko-mcp/handlers/meta.ts
☐ [agent-4] lib/mentiko-mcp/handlers/notifications.ts
☐ [agent-1] lib/mentiko-mcp/handlers/onboarding.ts
☐ [agent-2] lib/mentiko-mcp/handlers/schedules.ts
☐ [agent-3] lib/mentiko-mcp/handlers/tasks.ts
☐ [agent-4] lib/mentiko-mcp/handlers/templates.ts
☐ [agent-1] lib/mentiko-mcp/handlers/terminal.ts

agent priority order
1 lib/pty-manager.mjs
5 bin/secrets-rotate
6 bin/validate-artifacts
7 lib/mentiko-cli-schedules.mjs
8 lib/mentiko-mcp/server.ts
9 lib/mentiko-mcp/dispatch.ts
10 lib/mentiko-mcp/tools.ts
11 ...then handlers in any order by claimed agent

claim cadence
1) get one pending file
2) write tests until green for that file
3) update this spec before claiming next file
4) repeat until all files are ☑
