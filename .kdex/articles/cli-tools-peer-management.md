---
title: "CLI Tools & Peer Management"
type: component
linked_files:
  - bin/mentiko
  - bin/peer-manager
  - bin/peer-chain
  - bin/peer-send
  - bin/peer-watch
  - bin/peer-swarm
  - bin/peer-swarm-watch
  - bin/docker-entrypoint.sh
  - bin/secrets-resolve.mjs
  - bin/validate-artifacts
  - bin/test-relay-prompt
file_hashes:
  bin/docker-entrypoint.sh: sha256:8513f87977d4e82d
  bin/mentiko: sha256:1552106db40f03be
  bin/peer-chain: sha256:7641fa180c88e735
  bin/peer-manager: sha256:d8803db6edd7a1b7
  bin/peer-send: sha256:90dc7d1f6ceb9771
  bin/peer-swarm: sha256:944d261b3c3d11ae
  bin/peer-swarm-watch: sha256:b341a3e194757e67
  bin/peer-watch: sha256:af487ed20a087697
  bin/secrets-resolve.mjs: sha256:af7e1cdb18253674
  bin/test-relay-prompt: sha256:f46b25066b13ba36
  bin/validate-artifacts: sha256:b2d03a55fa583c49
tags: [cli, pty, peer, bin]
created: 2026-04-07T09:39:27.386567
updated: 2026-04-07T09:39:27.386567
status: current
related: []
---

article written: `.kdex/cli-tools-peer-management.md`

covers:
- mentiko CLI entry point and all subcommands
- peer-manager orchestration flow (relay, escalation, activity capture)
- peer-chain, peer-swarm, peer-send, peer-watch tools
- secrets-resolve.mjs decryption logic
- validate-artifacts schema checks
- docker-entrypoint startup sequence
- session transport abstraction layer
- agent profile resolution order and env sourcing
- gotchas: CLAUDECODE, mktemp cross-platform, md5 wrapper