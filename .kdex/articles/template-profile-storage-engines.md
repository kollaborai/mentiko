---
title: "Template & Profile Storage Engines"
type: component
linked_files:
  - web/lib/artifact-template-storage.ts
  - web/lib/generation-template-storage.ts
  - web/lib/agent-profile-storage.ts
  - web/lib/org-storage.ts
  - web/lib/inbound-webhook-storage.ts
file_hashes:
  web/lib/agent-profile-storage.ts: sha256:e71a66c694c8fa8a
  web/lib/artifact-template-storage.ts: sha256:2658a4cfd80d20fb
  web/lib/generation-template-storage.ts: sha256:b6bfe5dca172c362
  web/lib/inbound-webhook-storage.ts: sha256:01a88400a3cfce76
  web/lib/org-storage.ts: sha256:998033baaff4eb04
tags: [storage, templates, artifacts, generation, typescript]
created: 2026-04-07T09:41:19.991013
updated: 2026-04-07T09:41:19.991013
status: current
related: []
---

article written to `.kdex/template-profile-storage-engines.md`.

covers:
- 4 storage modules (agent-profile, artifact-template, generation-template, inbound-webhook)
- interfaces for each
- default profile/template semantics
- webhook token security (sha256 only, never plaintext)
- validation rules and slug format
- org-scoped path pattern via `orgPath()`