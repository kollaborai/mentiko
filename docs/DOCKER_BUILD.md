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
  and runtime config. This is the image self-hosters run; the checked-in
  compose files use `build: .` for source-based development and are not the
  published release-image path.
  built from `Dockerfile` at the repo root.
  published by `.github/workflows/build-platform.yml` on a strict `vX.Y.Z`
  tag push. Manual `workflow_dispatch` runs smoke tests against run-scoped
  staging refs but does not move release tags.
  release tags: `:latest`, `:<commit-sha>`, and `:vX.Y.Z` (when triggered by tag).

Both images are **public**.

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

`mentiko` (the platform image) is built by
`.github/workflows/build-platform.yml`. Same three-job pattern as the
base image:

```
platform-amd64 (ubuntu-latest)        → push :staging-<run_id>-amd64
platform-arm64 (ubuntu-24.04-arm)     → push :staging-<run_id>-arm64
manifest       (tag pushes only)      → promote staging refs to :<sha>,
                                        :latest, and :<semver-tag>
```

Build triggers:
  - push of a strict `vX.Y.Z` tag — creates `:<commit-sha>`, `:latest`,
    and `:<semver-tag>`
  - manual `workflow_dispatch` — creates only run-scoped staging refs and
    does not create or move `:<commit-sha>`, `:latest`, or a semver tag

The workflow accepts a `base_tag` input on `workflow_dispatch` that
controls which `mentiko-base` to FROM. Default `latest`. Pass a SHA
for reproducible builds.

To cut a release:

```
# First bump web/package.json, web/package-lock.json, and the newest
# web/lib/releases.ts entry to the same next +0.0.1 patch version.
git tag vX.Y.Z
git push origin vX.Y.Z
```

That triggers the workflow, builds both arches, and publishes the
manifest tags. Self-hosters should then pull the exact release tag:
`docker pull ghcr.io/kollaborai/mentiko:vX.Y.Z`.

## tags and pinning

`mentiko-base` publishes two tags per build:

  `mentiko-base:<commit-sha>`   pinned, reproducible
  `mentiko-base:latest`         tracks the newest base

The platform `Dockerfile` uses:

```dockerfile
ARG BASE_TAG=latest
FROM ghcr.io/kollaborai/mentiko-base:${BASE_TAG}
```

**For local development only:** `:latest` may be convenient, but it is not a
reproducible production deployment.

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

## one-arch source builds

If you are developing the Dockerfiles on a Linux host, or inside the CI/VM
build harness, you can build for one host architecture:

```
# build the base for your local arch only
docker build -f Dockerfile.base -t mentiko-base:local .

# build the platform against that local base
docker build --build-arg BASE_TAG=local -t mentiko:local .
```

This skips the release workflow and does not create a published release. Do
not build release images locally on an arm64 Mac; release builds run on the
GitHub Actions amd64 and arm64 runners.

## regression test

Two ways to smoke test.

**Pull the published image:**

```
export MENTIKO_VERSION=vX.Y.Z
export BETTER_AUTH_SECRET="$(openssl rand -hex 32)" # generate once; keep stable
docker pull ghcr.io/kollaborai/mentiko:${MENTIKO_VERSION}
docker run --rm -p 3000:3000 -p 3099:3099 -v mentiko-data:/app \
  -e BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET}" \
  -e BETTER_AUTH_URL=http://localhost:3000 \
  ghcr.io/kollaborai/mentiko:${MENTIKO_VERSION}
```

The container ports are fixed at `3000` and `3099`. To use a different host
port, change only the host side, for example `-p 13000:3000`; do not pass
`-e PORT=13000`.

Open `http://localhost:3000/signup` and create the first account. On a fresh
install, the first email/password signup becomes the workspace owner and
platform admin. After that, sign in at `http://localhost:3000/login` with the
same email and password. Passwords must be at least 12 characters.

**Build from source (Linux/CI only):**

```
docker build -t mentiko:local .
docker run --rm -p 3000:3000 -p 3099:3099 -v mentiko-data:/app \
  -e BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET}" \
  -e BETTER_AUTH_URL=http://localhost:3000 \
  mentiko:local
```

Use the same first-account flow: open `http://localhost:3000/signup`, create the
initial owner/admin account, then use `/login` for later sessions.

The published-image path is the self-hosting release path. If behavior differs
between the published image and a source build, test the published image first
and file the regression with the image tag and commit.

## related

  - `Dockerfile.base` — tools layer source
  - `Dockerfile` — platform build that consumes the base
  - `.github/workflows/build-base.yml` — base build pipeline
  - `docker-compose.production.yml` — self-host runtime configuration
