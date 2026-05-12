---
title: "Event & Stream Management"
type: component
linked_files:
  - web/lib/event-bus.ts
  - web/lib/platform-events.ts
  - web/lib/process-manager.ts
  - web/lib/sync-queue.ts
  - web/lib/notification-server.ts
  - web/lib/push-notifications.ts
  - web/lib/analytics-events.ts
  - web/lib/background-worker-control.ts
  - web/lib/background-worker-state.ts
file_hashes:
  web/lib/analytics-events.ts: sha256:7d78a8e25e2fe351
  web/lib/background-worker-control.ts: sha256:729d5778c543eec7
  web/lib/background-worker-state.ts: sha256:7ee0a603d790d04f
  web/lib/event-bus.ts: sha256:8df1d615321ebeb0
  web/lib/notification-server.ts: sha256:a1da176267b5cf55
  web/lib/platform-events.ts: sha256:b5e06183aefb0c46
  web/lib/process-manager.ts: sha256:d850e77b91951da8
  web/lib/push-notifications.ts: sha256:0686361362bf3dc8
  web/lib/sync-queue.ts: sha256:c35fb64d1b2f6bd6
tags: [events, streams, websocket, notifications, typescript]
created: 2026-04-07T09:41:14.815450
updated: 2026-04-07T09:41:14.815450
status: current
related: []
---

done. wrote `.kdex/event-stream-management.md` covering:

- analytics event definitions with track helpers
- event bus pub/sub with history and replay
- platform events registry (canonical catalog)
- background worker state and control
- server-side fire-and-forget notifications
- web push api client with react hook
- offline sync queue with localStorage persistence
- process manager (pid 2 supervisor) with readiness probes and ipc

the article is structured for quick LLM consumption: overview, key interfaces, control flow, patterns, and gotchas.