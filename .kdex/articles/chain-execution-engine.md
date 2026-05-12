---
title: Chain Execution Engine
type: component
linked_files:
  - lib/chain-runner.sh
  - lib/chain-runner-complete.sh
  - lib/chain-event-watcher.sh
  - lib/launch-agent.sh
  - lib/complete-agent.sh
  - lib/event-trigger.sh
file_hashes:
  lib/chain-event-watcher.sh: sha256:65982cd52928e35c
  lib/chain-runner-complete.sh: sha256:a477590a28e10ef3
  lib/chain-runner.sh: sha256:4216750ceeabfb5c
  lib/complete-agent.sh: sha256:6518969acbd3a723
  lib/event-trigger.sh: sha256:af2d6cc9b7b529c9
  lib/launch-agent.sh: sha256:661787762859641c
tags: [chain, orchestration, events, bash]
created: 2026-04-07T09:39:29.754883
updated: 2026-04-07T09:39:29.754883
status: current
related: []
---

done. created `.kdex/chain-execution-engine.md` with:

- overview of chain execution engine
- key files table
- execution flow (init → launch → complete → next agent)
- event system mechanics
- routing patterns (fan-out/fan-in, conditional)
- agent profiles and env security
- workspace types (local/ssh/docker)
- run objects and artifact capture
- monitoring, retry logic, chain chaining
- event-driven triggers via chain-event-watcher
- gotchas: namespace collapse, stop ambiguity, process persistence, mktemp issues
- dependencies

the article covers all 6 source files plus the supporting libs (routing-lib, session-transport, run-lib). an LLM should be able to understand how chains execute without reading the actual files.