# Docker build architecture

mentiko ships two images, both published on GitHub Container Registry as
multi-arch fat manifests (amd64 + arm64). Docker and podman pick the right
arch for your host automatically.

## the two images

`ghcr.io/kollaborai/mentiko-base`
  the tools layer. node 22, python, bun, uv, AI CLIs, pty-mgr,
  shell config, mentiko user, native build toolchain (gcc/g++/make),
  etc. rebuilt on tool changes only (monthly or less).
  built from `Dockerfile.base` at the repo root.

  Note: native runtime npm deps (ws, @xterm/headless, better-sqlite3)
  are intentionally NOT pre-installed here. They are installed by the
  consumer Dockerfile after its `COPY`, because next.js standalone
  output may bundle some of them and would overwrite a base install.
  The base provides the build toolchain so the consumer's
  `--build-from-source` step works on either arch.

`ghcr.io/kollaborai/mentiko`
  the platform image. inherits from `mentiko-base`, adds the next.js build
  and runtime config. this is what `docker compose up` runs.
  rebuilt on every code change.
  built from `Dockerfile` at the repo root.

both images are **public**. self-hosters and managed tenants pull the
same `mentiko-base` bytes, so "what we run for hosted customers" and
"what you can run on your own server" share their entire tool layer.

## the build pipelines

`mentiko-base` is built by `.github/workflows/build-base.yml`. The
workflow runs three jobs:

```
base-amd64 (ubuntu-latest)        → push :<sha>-amd64
base-arm64 (ubuntu-24.04-arm)     → push :<sha>-arm64
manifest   (waits on both)        → create + push :<sha> and :latest
                                    as a fat manifest pointing at
                                    both arch-specific tags
```

Rebuild triggers:
  - push to `main` that touches `Dockerfile.base` or the workflow file
  - weekly cron, mondays 04:00 UTC (picks up upstream tool updates)
  - manual `workflow_dispatch`

GitHub-hosted runners are free for public repositories, including the
`ubuntu-24.04-arm` arm64 runner used here.

`mentiko` (the platform image) is built however you build it today
(self-host: `docker build` locally; managed: your existing CI). Its
`FROM` line uses `mentiko-base` via a `BASE_TAG` build arg.

## tags and pinning

`mentiko-base` publishes two tags per build:

  `mentiko-base:<commit-sha>`   pinned, reproducible
  `mentiko-base:latest`         tracks the newest base

The platform `Dockerfile` uses:

```dockerfile
ARG BASE_TAG=latest
FROM ghcr.io/kollaborai/mentiko-base:${BASE_TAG}
```

**For local dev or quickstart:** `:latest` is fine.

**For reproducible production builds:** pass `--build-arg BASE_TAG=<sha>`
to pin a specific base. Example:

```
docker build --build-arg BASE_TAG=abc1234567890abcdef ...
```

## bumping the base

When something in `Dockerfile.base` changes:

  1. open a PR that edits `Dockerfile.base`
  2. merge to `main` — the `build-base` workflow runs automatically
  3. the workflow's summary prints the new SHA and `:latest` tags
  4. if you want to pin platform builds to that specific base, update
     references in your build pipelines or pass `--build-arg BASE_TAG=<sha>`
  5. `:latest` consumers pick up the new base automatically on their
     next build

## first-time public visibility

The first push from `build-base.yml` creates `mentiko-base` as a
**private** package by default. Once, after the first successful run:

  1. visit https://github.com/orgs/kollaborai/packages/container/mentiko-base/settings
  2. change "Package visibility" from Private to Public
  3. link the package to this repo

Subsequent pushes preserve public visibility.

## one-arch local builds

If you don't need the manifest and just want to build for your host arch:

```
# build the base for your local arch only
docker build -f Dockerfile.base -t mentiko-base:local .

# build the platform against that local base
docker build --build-arg BASE_TAG=local -t mentiko:local .
```

This skips the workflow entirely. Useful for iterating on
`Dockerfile.base` before pushing.

## known limitation: inline esbuild/tsc steps

The platform `Dockerfile` runs three inline compile steps (ws-terminal,
background-worker, process-manager, mentiko-mcp). These have a pre-existing
issue: when the source uses TypeScript path aliases (`@/lib/*` etc.), esbuild
can't resolve them because it runs from outside the `web/` tsconfig tree.

This is **not** exercised by the control-plane build pipeline (which
pre-compiles these files via `scripts/deploy/assemble-platform-context.sh`
in a `cd web/` shell before docker even starts). Self-host `docker build .`
hits the issue.

If you're self-hosting and hit `Could not resolve "@/lib/..."` during build,
the workaround is to either:
  - use the pre-built published image: `docker pull ghcr.io/kollaborai/mentiko:latest`
  - or run the cp-style pre-assemble outside docker first (script TBD)

Tracking issue: inline compile steps need the cp pipeline's
`cd web/` + source-input pattern. Fix is independent of the base
extraction work documented above.

## regression test

After any change here, the smoke test is:

```
docker pull ghcr.io/kollaborai/mentiko:latest
docker run --rm -p 3000:3000 -p 3099:3099 -v mentiko-data:/app \
  -e BETTER_AUTH_SECRET=$(openssl rand -hex 32) \
  ghcr.io/kollaborai/mentiko:latest
```

On a fresh Mac (arm64), Linux (amd64), or anywhere else with Docker,
this should boot the platform identically. If behavior changes between
hosts or between releases, that's a regression — file an issue.

## related

  - `Dockerfile.base` — tools layer source
  - `Dockerfile` — platform build that consumes the base
  - `.github/workflows/build-base.yml` — base build pipeline
  - `docker-compose.production.yml` — self-host runtime configuration
