# Release Checklist

Before making a public release, verify:

- [ ] Working tree is clean or every local diff is intentionally included.
- [ ] Public README, changelog, license, contribution guide, and security/deployment docs are current.
- [ ] No runtime data, local env files, credentials, databases, scratch files, `.bak` files, or trash directories are tracked.
- [ ] Secret scan has no real credentials or private keys.
- [ ] Route auth coverage check (`node scripts/check-auth-coverage.mjs`) has zero undocumented routes.
- [ ] Targeted tests pass for recently touched auth, audit, task, run, and deployment paths.
- [ ] Web build passes from `web/`.
- [ ] Known lint/type failures are either fixed or documented as non-release-blocking debt.
- [ ] Fresh local smoke covers login, dashboard, chains, agents, runs, tasks, settings, and terminal spawning.
- [ ] Production images are built on the amd64 build path, smoke-tested, tagged by Git SHA, and rollback tag is recorded.
