---
title: "API Routes: Agent Management"
type: component
linked_files:
  - web/app/api/agents/route.ts
  - web/app/api/agents/[session]/route.ts
  - web/app/api/agents/[session]/message/route.ts
  - web/app/api/agents/[session]/output/route.ts
  - web/app/api/agents/resume/route.ts
  - web/app/api/agents/registry/route.ts
  - web/app/api/agents/registry/[id]/route.ts
  - web/app/api/agents/registry/scan/route.ts
  - web/app/api/agents/registry/generate/route.ts
  - web/app/api/agents/registry/edit/route.ts
  - web/app/api/agents/registry/import/route.ts
  - web/app/api/agents/registry/save/route.ts
  - web/app/api/agents/marketplace/route.ts
file_hashes:
  web/app/api/agents/[session]/message/route.ts: sha256:736c14c07f553c6c
  web/app/api/agents/[session]/output/route.ts: sha256:269cadc48d63a7e9
  web/app/api/agents/[session]/route.ts: sha256:f41364d2320e2644
  web/app/api/agents/marketplace/route.ts: sha256:0c20e4f4211e158a
  web/app/api/agents/registry/[id]/route.ts: sha256:91ca5e90c92ce810
  web/app/api/agents/registry/edit/route.ts: sha256:3d23e0fc6a497fc5
  web/app/api/agents/registry/generate/route.ts: sha256:35db8b7ca96221e0
  web/app/api/agents/registry/import/route.ts: sha256:db903907c3f15dcb
  web/app/api/agents/registry/route.ts: sha256:bc203c64e3361d4e
  web/app/api/agents/registry/save/route.ts: sha256:0a2e47f4eee82119
  web/app/api/agents/registry/scan/route.ts: sha256:90a38f5ea42d3f48
  web/app/api/agents/resume/route.ts: sha256:f6892593450ef8e1
  web/app/api/agents/route.ts: sha256:b66cba74f532480f
tags: [api, agents, registry, marketplace, routes]
created: 2026-04-07T09:42:26.976362
updated: 2026-04-07T09:42:26.976362
status: current
related: []
---

article written to .kdex/articles/api-routes-agent-management.md

covers:
- 16 agent management routes with session/registry/marketplace split
- session lifecycle (list, send, capture, kill)
- registry operations (CRUD + scan + import + generate + edit)
- marketplace discovery with builtin/community precedence
- resume flow for Claude conversations
- validation patterns, auth patterns, path resolution
- gotchas: session encoding, output limits, job isolation, S3 unavailability
- dependency table

next: type "`kdex: generate knowledge base article" to document another module, or "cat .kdex/articles/articles/api-routes-agent-management.md" to review