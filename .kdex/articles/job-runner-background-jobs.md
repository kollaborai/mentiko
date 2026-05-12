---
title: "Job Runner & Background Jobs"
type: component
linked_files:
  - lib/job-runner.mjs
  - web/app/api/jobs/route.ts
  - web/app/api/jobs/[id]/route.ts
  - web/app/api/jobs/[id]/complete/route.ts
  - web/lib/job-store.ts
  - web/hooks/use-job-status.ts
  - web/lib/auto-run.ts
  - web/lib/auto-run-service.ts
file_hashes:
  lib/job-runner.mjs: sha256:4968f14f53eb0c1c
  web/app/api/jobs/[id]/complete/route.ts: sha256:f8fa3baf8885ec7b
  web/app/api/jobs/[id]/route.ts: sha256:27abc8d44e434377
  web/app/api/jobs/route.ts: sha256:c4156195eedb0dcc
  web/hooks/use-job-status.ts: sha256:973d440f7aab1cef
  web/lib/auto-run-service.ts: sha256:59966ebaa9c9bf98
  web/lib/auto-run.ts: sha256:b70f154ac3a1a687
  web/lib/job-store.ts: sha256:a7c385c42db52651
tags: [job-runner, background-jobs, auto-run, agent-profiles, cli-pipe]
created: 2026-04-07T14:44:39.631607
updated: 2026-04-07T14:44:39.631607
status: current
related: []
---

Done. Created `docs/kb/job-runner-background-jobs.md` covering:

- overview of the detached job runner architecture
- job lifecycle from creation to completion callback
- key interfaces (Job type, JobStore API)
- detailed flow for job creation, execution, callback, and frontend polling
- auto-run system (candidate detection, background service)
- patterns (atomic writes, secret resolution, detached processes, stale detection)
- gotchas (template resolution, agent profile paths, SSE fallbacks, etc.)