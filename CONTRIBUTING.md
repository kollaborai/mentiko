# Contributing to Mentiko

Thanks for wanting to help. Mentiko is a public-beta agent orchestration platform, so we value changes that make the runtime safer, clearer, and easier to operate.

## Before you start

1. Open or find a GitHub issue for non-trivial work.
2. Keep changes focused and easy to review.
3. Avoid compatibility shims for old internal names or retired systems unless a maintainer explicitly asks for them.
4. Do not commit runtime data, credentials, local databases, generated build output, scratch files, or backup files.

## Local setup

```bash
git clone https://github.com/kollaborai/mentiko.git
cd mentiko
cd web
npm install
npm run dev
```

Open <http://localhost:3000>.

For CLI work, add the repo `bin/` directory to your path:

```bash
cd /path/to/mentiko
export PATH="$PWD/bin:$PATH"
mentiko --help
```

## Project map

```text
bin/      CLI tools and PTY manager wrappers
lib/      Bash/Node orchestration, schemas, plugins, process manager pieces
web/      Next.js app, API routes, components, stores, terminal bridge, tests
scripts/  Operational utilities and release checks
tests/    Bash/Jest/Playwright harnesses
docs/     Public architecture, API, deployment, and security docs
```

Runtime data belongs under `~/.mentiko`, not inside this repository.

## Development standards

- Prefer small, scoped pull requests.
- Use the existing design system and component patterns.
- Use `@aliimam/icons` for new icons; do not add new `lucide-react` imports.
- Keep tenant data paths namespace/org/project aware.
- Do not trust client-supplied namespace, org, or user headers as identity.
- Keep public docs current when behavior changes.
- Do not add legacy aliases, old repo names, or retired tracker formats for convenience.

## Useful checks

Run the checks that match your change:

```bash
node scripts/check-auth-coverage.mjs
cd web && npm test -- --runTestsByPath <test-file>
cd web && npm run build
```

For UI work, also smoke the app in a browser and include screenshots or a short reproduction note in the pull request.

## Pull request checklist

- [ ] The PR explains what changed and why.
- [ ] Public docs are updated when user-visible behavior changes.
- [ ] No secrets, runtime data, local paths, `.bak` files, or generated artifacts are included.
- [ ] Route/auth changes update `docs/AUTH_COVERAGE.md` when needed.
- [ ] Relevant tests or checks are listed in the PR description.
- [ ] Security-sensitive changes explain the threat model and verification performed.

## Security reports

Please do not disclose security issues in public issues or pull requests. Use the repository Security tab and follow [SECURITY.md](SECURITY.md).
