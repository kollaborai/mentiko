---
title: "Integration & Communication Layer"
type: component
linked_files:
  - lib/git-integration.sh
  - lib/webhook-sender.sh
  - lib/slack-integration.sh
  - lib/email-integration.sh
  - lib/github-integration.sh
  - lib/integrations.sh
  - lib/notification-dispatcher.sh
  - lib/routing-lib.sh
  - lib/plugin-runner.sh
  - lib/approval-gate.sh
file_hashes:
  lib/approval-gate.sh: sha256:6682e712049a8bdc
  lib/email-integration.sh: sha256:85c9a0c92d73ae57
  lib/git-integration.sh: sha256:c1ea93eb26950f53
  lib/github-integration.sh: sha256:effedca8cca65cd7
  lib/integrations.sh: sha256:fac46cd272890545
  lib/notification-dispatcher.sh: sha256:ad7d841f2def1366
  lib/plugin-runner.sh: sha256:941cf1ffcb2ba3b0
  lib/routing-lib.sh: sha256:870453529208e212
  lib/slack-integration.sh: sha256:0737cd9c81059ff5
  lib/webhook-sender.sh: sha256:44f09d6ec4c16052
tags: [integrations, webhook, slack, email, github, bash]
created: 2026-04-07T09:39:44.569263
updated: 2026-04-07T09:39:44.569263
status: current
related: []
---

done. article at `.kdex/articles/integration-communication-layer.md`

covers:
- all 10 modules with their public interfaces
- config priority chains (env > chain.json > defaults)
- event subscription pattern
- fan-out/fan-in flow
- retry/backoff patterns
- required dependencies (jq, curl, git, etc)
- gotchas (macOS date syntax, state cleanup, silent failures)