---
title: "Web Utilities & Services"
type: component
linked_files:
  - web/lib/utils.ts
  - web/lib/utils/colorUtils.ts
  - web/lib/scheduler-service.ts
  - web/lib/auto-run-service.ts
  - web/lib/auto-run.ts
  - web/lib/analytics.ts
  - web/lib/analytics-index.ts
  - web/lib/fuzzy-search.ts
  - web/lib/copy-to-clipboard.ts
  - web/lib/version-utils.ts
file_hashes:
  web/lib/analytics-index.ts: sha256:2cad2a83af560cb6
  web/lib/analytics.ts: sha256:17f3cb27e6b879e7
  web/lib/auto-run-service.ts: sha256:59966ebaa9c9bf98
  web/lib/auto-run.ts: sha256:24110cc30c337284
  web/lib/copy-to-clipboard.ts: sha256:e0926161d77c671c
  web/lib/fuzzy-search.ts: sha256:9a7ceb6c2b24c97c
  web/lib/scheduler-service.ts: sha256:5a1af8e615eee0e2
  web/lib/utils.ts: sha256:dee4c6eeeab165b3
  web/lib/utils/colorUtils.ts: sha256:8b97eb07a46f6610
  web/lib/version-utils.ts: sha256:a374d67765b25c43
tags: [utils, analytics, scheduler, auto-run, typescript]
created: 2026-04-07T09:41:27.414504
updated: 2026-04-07T09:41:27.414504
status: current
related: []
---

created `.kdex/web-utils-services.md` covering:

✔ analytics system (ga4/plausible abstraction, unified api)
✔ auto-run service (60s polling, dependency resolution, health check)
✔ scheduler service (cron execution, fire-and-forget pattern)
✔ utility functions (formatting, clipboard, fuzzy search, colors, semver)
✔ gotchas (dev analytics disabled, globalThis state for reloads, cron dependency)