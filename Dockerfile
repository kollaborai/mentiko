# syntax=docker/dockerfile:1.4
# Dockerfile - mentiko platform (self-hosted)
#
# builds the mentiko platform image. inherits the tools layer from
# ghcr.io/kollaborai/mentiko-base — see Dockerfile.base in this repo.
#
# multi-arch: docker will auto-pick amd64 or arm64 based on host.
#
# quick start:
#   cp .env.example .env
#   docker compose -f docker-compose.production.yml up -d
#   open http://localhost:3000
#
# or build directly:
#   docker build -t mentiko .
#   docker run --rm -p 3000:3000 -p 3099:3099 -v mentiko-data:/app mentiko
#
# ports:
#   3000  web ui (next.js)
#   3099  terminal websocket bridge (pty-manager)
#
# data:
#   /app  persistent volume (auth.db, chains, runs, agents, etc.)
#
# bumping the base image:
#   ARG BASE_TAG controls which mentiko-base is used. default is :latest.
#   for reproducible builds, pass --build-arg BASE_TAG=<commit-sha>.
#   see docs/DOCKER_BUILD.md.

# BASE_TAG must be declared BEFORE the first FROM to be usable in a later
# FROM line. controls which mentiko-base is consumed. default :latest.
# for reproducible builds, pass --build-arg BASE_TAG=<commit-sha>.
ARG BASE_TAG=latest

# ===========================================================================
# BUILDER STAGE — npm build + assemble platform
# (uses plain node:22-slim — needs npm + full source, no tools layer needed)
# ===========================================================================

FROM node:22-slim AS builder
ARG TARGETARCH
ARG BUILD_COMMIT=unknown
ARG BUILD_VERSION=unknown
ARG BUILD_REPO=kollaborai/mentiko
# phase 4: when SKIP_NEXT_BUILD=1 the build context already contains
# web/.next/standalone and web/.next/static from a single upstream
# build-js CI job that ran on BUILDPLATFORM (amd64). the next build
# RUN below becomes a no-op and the assemble step reads those paths
# directly. on a normal build (SKIP_NEXT_BUILD=0, default) next build
# runs in-image as before.
ARG SKIP_NEXT_BUILD=0

COPY web/package.json web/package-lock.json /build/web/
WORKDIR /build/web

RUN echo "=== npm ci ===" && \
    npm ci

COPY . /build/
WORKDIR /build/web

RUN --mount=type=cache,target=/build/web/.next/cache,id=next-${TARGETARCH} \
    if [ "$SKIP_NEXT_BUILD" = "1" ]; then \
      echo "=== next.js build skipped (SKIP_NEXT_BUILD=1; using prebuilt artifact) ===" && \
      test -f .next/standalone/server.js || (echo "FATAL: SKIP_NEXT_BUILD=1 but .next/standalone/server.js missing — artifact not staged" && exit 1); \
    else \
      echo "=== next.js build (webpack) ===" && \
      ./node_modules/.bin/next build --webpack && \
      test -f .next/standalone/server.js || (echo "FATAL: standalone build missing server.js" && exit 1); \
    fi

# assemble platform context
RUN echo "=== assembling platform ===" && \
    mkdir -p /context/.next/static /context/public /context/bin \
             /context/lib /context/server && \
    cp -r .next/standalone/. /context/ && \
    cp -r .next/static/. /context/.next/static/ && \
    cp -r public/. /context/public/ 2>/dev/null || true && \
    cp -r /build/bin/. /context/bin/ 2>/dev/null || true && \
    cp -r /build/lib/. /context/lib/ 2>/dev/null || true && \
    cp -r /build/web/lib/. /context/lib/ 2>/dev/null || true && \
    cp -r server/. /context/server/ 2>/dev/null || true && \
    test -d /build/kollab/agent-bundles/mentiko || (echo "FATAL: missing kollab/agent-bundles/mentiko (kollabor bar bootstrap)" && exit 1) && \
    mkdir -p /context/kollab/agent-bundles && \
    cp -r /build/kollab/agent-bundles/mentiko /context/kollab/agent-bundles/mentiko && \
    { cp processes.json /context/processes.json 2>/dev/null || true; } && \
    printf '{"version":"%s","commit":"%s","builtAt":"%s","repo":"%s"}\n' \
      "$BUILD_VERSION" "$BUILD_COMMIT" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$BUILD_REPO" \
      > /context/version.json

# compile ws-terminal.ts
# IMPORTANT: esbuild reads tsconfig.json by walking up from the INPUT file,
# not cwd. so we use the source path /build/web/server/*.ts (which is under
# the tsconfig tree) and cd into /build/web first to anchor relative imports
# correctly.
RUN if [ -f /build/web/server/ws-terminal.ts ]; then \
      echo "=== compiling ws-terminal.ts ===" && \
      cd /build/web && \
      npx --yes esbuild /build/web/server/ws-terminal.ts \
        --bundle --platform=node --target=node20 \
        --external:ws \
        --outfile=/context/server/ws-terminal.js && \
      rm -f /context/server/ws-terminal.ts; \
    fi

# compile background-worker.ts (same cd-into-web pattern for @/* alias resolution)
RUN if [ -f /build/web/server/background-worker.ts ]; then \
      echo "=== compiling background-worker.ts ===" && \
      cd /build/web && \
      npx --yes esbuild /build/web/server/background-worker.ts \
        --bundle --platform=node --target=node20 \
        --outfile=/context/server/background-worker.js && \
      rm -f /context/server/background-worker.ts /context/server/background-worker.cjs; \
    fi

# compile runner-v2 completion bridge so tenant runtime does not need ts-node.
RUN if [ -f /build/web/lib/runner-v2/complete-cli.ts ]; then \
      echo "=== compiling runner-v2 completion bridge ===" && \
      cd /build/web && \
      npx --yes esbuild /build/web/lib/runner-v2/complete-cli.ts \
        --bundle --platform=node --target=node20 \
        --outfile=/context/lib/runner-v2-complete.js; \
    fi

# compile the typed completion-contract builder used by the compatibility
# boundary. Shell forwards primitive paths and never derives this contract.
RUN if [ -f /build/web/lib/runner-v2/completion-contract-cli.ts ]; then \
      echo "=== compiling typed completion contract ===" && \
      cd /build/web && \
      npx --yes esbuild /build/web/lib/runner-v2/completion-contract-cli.ts \
        --bundle --platform=node --target=node20 \
        --outfile=/context/lib/runner-completion-contract.js; \
    fi

# compile the typed completion PTY launcher. It transfers the allowlisted
# environment through a private one-shot file, keeping secrets out of PTY argv.
RUN if [ -f /build/web/lib/runner-v2/completion-launch-cli.ts ]; then \
      echo "=== compiling runner-v2 completion launcher ===" && \
      cd /build/web && \
      npx --yes esbuild /build/web/lib/runner-v2/completion-launch-cli.ts \
        --bundle --platform=node --target=node20 \
        --outfile=/context/lib/runner-v2-completion-launch.js; \
    fi

# compile typed routed-agent launcher; routed completion must not re-enter chain-runner.sh.
RUN if [ -f /build/web/lib/runner-v2/launch-agent-cli.ts ]; then \
      echo "=== compiling runner-v2 routed-agent launcher ===" && \
      cd /build/web && \
      npx --yes esbuild /build/web/lib/runner-v2/launch-agent-cli.ts \
        --bundle --platform=node --target=node20 \
        --outfile=/context/lib/runner-v2-launch-agent.js; \
    fi

# compile typed direct local initial launch; bin/mentiko only forwards argv.
RUN if [ -f /build/web/lib/runner-v2/direct-run-cli.ts ]; then \
      cd /build/web && \
      npx --yes esbuild /build/web/lib/runner-v2/direct-run-cli.ts \
        --bundle --platform=node --target=node20 \
        --outfile=/context/lib/runner-v2-direct-run.js; \
    fi

# compile typed graph rendering; `mentiko graph` must not use chain-runner
# dry-run as a hidden second orchestration path.
RUN if [ -f /build/web/lib/runner-v2/chain-graph-cli.ts ]; then \
      cd /build/web && \
      npx --yes esbuild /build/web/lib/runner-v2/chain-graph-cli.ts \
        --bundle --platform=node --target=node20 \
        --outfile=/context/lib/runner-chain-graph.js; \
    fi

# compile typed chained-run launch. Completion routing creates its linked child
# run and initial agent without re-entering the legacy shell runner.
RUN if [ -f /build/web/lib/runner-v2/next-chain-launch-cli.ts ]; then \
      cd /build/web && \
      npx --yes esbuild /build/web/lib/runner-v2/next-chain-launch-cli.ts \
        --bundle --platform=node --target=node20 \
        --outfile=/context/lib/runner-v2-next-chain.js; \
    fi

# compile typed existing-run launch; callers provide only a preallocated run id.
RUN if [ -f /build/web/lib/runner-v2/existing-run-launch-cli.ts ]; then \
      cd /build/web && \
      npx --yes esbuild /build/web/lib/runner-v2/existing-run-launch-cli.ts \
        --bundle --platform=node --target=node20 \
        --outfile=/context/lib/runner-v2-existing-run.js; \
    fi

# compile monitor-v2 bridge so tenant runtime does not need tsx.
RUN if [ -f /build/web/lib/runner-v2/monitor-cli.ts ]; then \
      echo "=== compiling runner-v2 monitor bridge ===" && \
      cd /build/web && \
      npx --yes esbuild /build/web/lib/runner-v2/monitor-cli.ts \
        --bundle --platform=node --target=node20 \
        --outfile=/context/lib/monitor-v2.js; \
    fi

# compile standalone-spec monitor/launch paths. The compatibility scripts only
# forward argv; PTY allocation, monitor state, and lifecycle writes stay typed.
RUN if [ -f /build/web/lib/runner-v2/standalone-monitor-cli.ts ]; then \
      echo "=== compiling typed standalone monitor ===" && \
      cd /build/web && \
      npx --yes esbuild /build/web/lib/runner-v2/standalone-monitor-cli.ts \
        --bundle --platform=node --target=node20 \
        --outfile=/context/lib/runner-v2-standalone-monitor.js; \
    fi

RUN if [ -f /build/web/lib/runner-v2/standalone-agent-launch-cli.ts ]; then \
      echo "=== compiling typed standalone agent launcher ===" && \
      cd /build/web && \
      npx --yes esbuild /build/web/lib/runner-v2/standalone-agent-launch-cli.ts \
        --bundle --platform=node --target=node20 \
        --outfile=/context/lib/runner-v2-standalone-agent-launch.js; \
    fi

# compile the manual profile-aware monitor. The CLI owns its state, profile
# parsing, advisor invocation, and PTY loop; bin/mentiko only invokes it.
RUN if [ -f /build/web/lib/runner-v2/manual-monitor-cli.ts ]; then \
      echo "=== compiling typed manual monitor ===" && \
      cd /build/web && \
      npx --yes esbuild /build/web/lib/runner-v2/manual-monitor-cli.ts \
        --bundle --platform=node --target=node20 \
        --outfile=/context/lib/runner-manual-monitor.js; \
    fi

RUN if [ -f /build/web/lib/system/native-plugin-handler-cli.ts ]; then \
      echo "=== compiling typed builtin plugin handler boundary ===" && \
      cd /build/web && \
      npx --yes esbuild /build/web/lib/system/native-plugin-handler-cli.ts \
        --bundle --platform=node --target=node20 \
        --outfile=/context/lib/runner-native-plugin.js; \
    fi

# compile the sole runner-event writer used by shell invocation boundaries.
RUN if [ -f /build/web/lib/runner-v2/event-emitter-cli.ts ]; then \
      echo "=== compiling typed runner event emitter ===" && \
      cd /build/web && \
      npx --yes esbuild /build/web/lib/runner-v2/event-emitter-cli.ts \
        --bundle --platform=node --target=node20 \
        --outfile=/context/lib/runner-event-emitter.js; \
    fi

# compile the sole system-log writer used by shell invocation boundaries.
RUN if [ -f /build/web/lib/system/system-log-cli.ts ]; then \
      echo "=== compiling typed system log boundary ===" && \
      cd /build/web && \
      npx --yes esbuild /build/web/lib/system/system-log-cli.ts \
        --bundle --platform=node --target=node20 \
        --outfile=/context/lib/runner-system-log.js; \
    fi

# compile the strict event lifecycle boundary used by shell invocation surfaces.
RUN if [ -f /build/web/lib/runner-v2/event-lifecycle-cli.ts ]; then \
      echo "=== compiling typed runner event lifecycle ===" && \
      cd /build/web && \
      npx --yes esbuild /build/web/lib/runner-v2/event-lifecycle-cli.ts \
        --bundle --platform=node --target=node20 \
        --outfile=/context/lib/runner-event-lifecycle.js; \
    fi

# compile the sole Run Record parser/writer/query boundary used by shell callers.
RUN if [ -f /build/web/lib/runner-v2/run-record-cli.ts ]; then \
      echo "=== compiling typed runner Run Record boundary ===" && \
      cd /build/web && \
      npx --yes esbuild /build/web/lib/runner-v2/run-record-cli.ts \
        --bundle --platform=node --target=node20 \
        --outfile=/context/lib/runner-run-record.js; \
    fi

# compile the typed agent activity/provenance capture boundary.
RUN if [ -f /build/web/lib/runner-v2/activity-capture-cli.ts ]; then \
      echo "=== compiling typed agent activity capture boundary ===" && \
      cd /build/web && \
      npx --yes esbuild /build/web/lib/runner-v2/activity-capture-cli.ts \
        --bundle --platform=node --target=node20 \
        --outfile=/context/lib/runner-activity-capture.js; \
    fi

# compile typed counters, gauges, timers, active timers, and webhook metric records.
RUN if [ -f /build/web/lib/runner-v2/legacy-metrics-cli.ts ]; then \
      echo "=== compiling typed legacy metrics boundary ===" && \
      cd /build/web && \
      npx --yes esbuild /build/web/lib/runner-v2/legacy-metrics-cli.ts \
        --bundle --platform=node --target=node20 \
        --outfile=/context/lib/runner-legacy-metrics.js; \
    fi

# compile typed retry/circuit state ownership; shell only forwards operation arguments.
RUN if [ -f /build/web/lib/runner-v2/retry-circuit-cli.ts ]; then \
      echo "=== compiling typed retry circuit boundary ===" && \
      cd /build/web && \
      npx --yes esbuild /build/web/lib/runner-v2/retry-circuit-cli.ts \
        --bundle --platform=node --target=node20 \
        --outfile=/context/lib/runner-retry-circuit.js; \
    fi

# compile typed approval and error lifecycle boundaries. Legacy shell callers
# only forward primitive arguments; request/retry/error JSON and mutations stay
# in the compiled TypeScript owners.
RUN if [ -f /build/web/lib/runner-v2/approval-gate-cli.ts ]; then \
      echo "=== compiling typed runner approval gate boundary ===" && \
      cd /build/web && \
      npx --yes esbuild /build/web/lib/runner-v2/approval-gate-cli.ts \
        --bundle --platform=node --target=node20 \
        --outfile=/context/lib/runner-approval-gate.js; \
    fi

RUN if [ -f /build/web/lib/runner-v2/error-handling-cli.ts ]; then \
      echo "=== compiling typed runner error handling boundary ===" && \
      cd /build/web && \
      npx --yes esbuild /build/web/lib/runner-v2/error-handling-cli.ts \
        --bundle --platform=node --target=node20 \
        --outfile=/context/lib/runner-error-handling.js; \
    fi

# compile the typed team-mux interoperability boundary. The legacy shell
# command only invokes this bundle; agent, chain, and memory JSON stay typed.
RUN if [ -f /build/web/lib/runner-v2/teammux-bridge-cli.ts ]; then \
      echo "=== compiling typed team-mux bridge boundary ===" && \
      cd /build/web && \
      npx --yes esbuild /build/web/lib/runner-v2/teammux-bridge-cli.ts \
        --bundle --platform=node --target=node20 \
        --outfile=/context/lib/runner-teammux-bridge.js; \
    fi

# compile the typed audit ship boundary. The legacy shell entrypoint only
# forwards stdin; entry parsing, S3 key derivation, rclone upload, retry backoff,
# and failure-record construction stay in the compiled TypeScript owner.
RUN if [ -f /build/web/lib/runner-v2/audit-ship-cli.ts ]; then \
      echo "=== compiling typed audit ship boundary ===" && \
      cd /build/web && \
      npx --yes esbuild /build/web/lib/runner-v2/audit-ship-cli.ts \
        --bundle --platform=node --target=node20 \
        --outfile=/context/lib/runner-audit-ship.js; \
    fi

# compile the typed notification dispatcher boundary. The legacy shell wrappers
# only forward primitive arguments; payload construction, HTTP dispatch, and
# response parsing stay in the compiled TypeScript owner.
RUN if [ -f /build/web/lib/runner-v2/notification-dispatcher-cli.ts ]; then \
      echo "=== compiling typed notification dispatcher boundary ===" && \
      cd /build/web && \
      npx --yes esbuild /build/web/lib/runner-v2/notification-dispatcher-cli.ts \
        --bundle --platform=node --target=node20 \
        --outfile=/context/lib/runner-notification-dispatcher.js; \
    fi

# compile the typed cap claim and count/promote admission boundary.
RUN if [ -f /build/web/lib/runner-v2/concurrency-admission-cli.ts ]; then \
      echo "=== compiling typed concurrency admission boundary ===" && \
      cd /build/web && \
      npx --yes esbuild /build/web/lib/runner-v2/concurrency-admission-cli.ts \
        --bundle --platform=node --target=node20 \
        --outfile=/context/lib/runner-concurrency-admission.js; \
    fi

# compile the typed batch record worker; the API never shells through bash to orchestrate batches.
RUN if [ -f /build/web/lib/runner-v2/batch-runner-cli.ts ]; then \
      echo "=== compiling typed runner batch worker ===" && \
      cd /build/web && \
      npx --yes esbuild /build/web/lib/runner-v2/batch-runner-cli.ts \
        --bundle --platform=node --target=node20 \
        --outfile=/context/lib/runner-batch-runner.js; \
    fi

# compile the detached typed job worker. It owns job-record parsing and
# lifecycle persistence; only the selected agent CLI remains an external child.
RUN if [ -f /build/web/lib/runner-v2/job-worker.ts ]; then \
      echo "=== compiling typed job worker ===" && \
      cd /build/web && \
      npx --yes esbuild /build/web/lib/runner-v2/job-worker.ts \
        --bundle --platform=node --target=node20 \
        --outfile=/context/lib/runner-job-worker.js; \
    fi

# compile the typed PTY transport adapter. session-transport.sh may invoke the
# external pty manager, but daemon/session queries and names remain typed.
RUN if [ -f /build/web/lib/pty/pty-transport-cli.ts ]; then \
      echo "=== compiling typed PTY transport ===" && \
      cd /build/web && \
      npx --yes esbuild /build/web/lib/pty/pty-transport-cli.ts \
        --bundle --platform=node --target=node20 \
        --outfile=/context/lib/runner-pty-transport.js; \
    fi

# compile the typed generation payload resolver/importer. The command boundary
# may call the completion API, but artifact, event, and transcript parsing stay
# in the TypeScript-owned resolver.
RUN if [ -f /build/web/lib/generation/payload-import-cli.ts ]; then \
      echo "=== compiling typed generation payload importer ===" && \
      cd /build/web && \
      npx --yes esbuild /build/web/lib/generation/payload-import-cli.ts \
        --bundle --platform=node --target=node20 \
        --outfile=/context/lib/runner-generation-payload-import.js; \
    fi

# compile the sole runner agent-state owner used by shell invocation boundaries.
RUN if [ -f /build/web/lib/runner-v2/agent-state-cli.ts ]; then \
      echo "=== compiling typed runner agent-state boundary ===" && \
      cd /build/web && \
      npx --yes esbuild /build/web/lib/runner-v2/agent-state-cli.ts \
        --bundle --platform=node --target=node20 \
        --outfile=/context/lib/runner-agent-state.js; \
    fi

# compile the typed agent-profile resolver and command compiler used by every
# remaining shell invocation boundary.
RUN if [ -f /build/web/lib/runner-v2/agent-profile-cli.ts ]; then \
      echo "=== compiling typed runner agent-profile boundary ===" && \
      cd /build/web && \
      npx --yes esbuild /build/web/lib/runner-v2/agent-profile-cli.ts \
        --bundle --platform=node --target=node20 \
      --outfile=/context/lib/runner-agent-profile.js; \
    fi

# compile typed transcript identity/provenance resolution. Shell callers only
# pass capture and primitive identity inputs; they do not scan profile paths.
RUN if [ -f /build/web/lib/runner-v2/agent-transcript-cli.ts ]; then \
      echo "=== compiling typed agent transcript resolver ===" && \
      cd /build/web && \
      npx --yes esbuild /build/web/lib/runner-v2/agent-transcript-cli.ts \
        --bundle --platform=node --target=node20 \
        --outfile=/context/lib/runner-agent-transcript.js; \
    fi

# compile the canonical typed Kollabor MCP-settings writer used at container
# boot. docker-entrypoint invokes it but must not parse or mutate JSON itself.
RUN if [ -f /build/web/lib/runner-v2/kollabor-mcp-settings-cli.ts ]; then \
      echo "=== compiling typed Kollabor MCP settings ===" && \
      cd /build/web && \
      npx --yes esbuild /build/web/lib/runner-v2/kollabor-mcp-settings-cli.ts \
        --bundle --platform=node --target=node20 \
        --outfile=/context/lib/runner-kollabor-mcp-settings.js; \
    fi

RUN if [ -f /build/web/lib/runner-v2/readiness-cli.ts ]; then \
      echo "=== compiling typed runner readiness boundary ===" && \
      cd /build/web && \
      npx --yes esbuild /build/web/lib/runner-v2/readiness-cli.ts \
        --bundle --platform=node --target=node20 \
      --outfile=/context/lib/runner-readiness.js; \
    fi

# compile the typed chain/agent/config-profile decoder used by the remaining
# shell invocation boundary. Shell must never own definition parsing or mutation.
RUN if [ -f /build/web/lib/runner-v2/chain-contract-cli.ts ]; then \
      echo "=== compiling typed runner chain contract boundary ===" && \
      cd /build/web && \
      npx --yes esbuild /build/web/lib/runner-v2/chain-contract-cli.ts \
        --bundle --platform=node --target=node20 \
      --outfile=/context/lib/runner-chain-contract.js; \
    fi

# compile typed raw and normalized chain validation; the shell command is only
# the compatibility entrypoint and never parses chain JSON itself.
RUN if [ -f /build/web/lib/runner-v2/chain-validation-cli.ts ]; then \
      echo "=== compiling typed runner chain validation boundary ===" && \
      cd /build/web && \
      npx --yes esbuild /build/web/lib/runner-v2/chain-validation-cli.ts \
        --bundle --platform=node --target=node20 \
      --outfile=/context/lib/runner-chain-validation.js; \
    fi

# compile the typed runtime-path owner. config.sh only locates this bundle and
# sources its shell-safe export projection; it performs no path derivation.
RUN if [ -f /build/web/lib/runner-v2/runtime-paths-cli.ts ]; then \
      echo "=== compiling typed runtime paths ===" && \
      cd /build/web && \
      npx --yes esbuild /build/web/lib/runner-v2/runtime-paths-cli.ts \
        --bundle --platform=node --target=node20 \
      --outfile=/context/lib/runner-runtime-paths.js; \
    fi

# compile the typed chain generation contract; the legacy shell command only
# forwards arguments to the external model process.
RUN if [ -f /build/web/lib/runner-v2/chain-generation-cli.ts ]; then \
      echo "=== compiling typed runner chain generation boundary ===" && \
      cd /build/web && \
      npx --yes esbuild /build/web/lib/runner-v2/chain-generation-cli.ts \
        --bundle --platform=node --target=node20 \
      --outfile=/context/lib/runner-chain-generation.js; \
    fi

# compile the typed task API/context handoff; chain-runner.sh only sources the
# generated shell-safe environment and never parses task JSON itself.
RUN if [ -f /build/web/lib/runner-v2/task-context-cli.ts ]; then \
      echo "=== compiling typed task context boundary ===" && \
      cd /build/web && \
      npx --yes esbuild /build/web/lib/runner-v2/task-context-cli.ts \
        --bundle --platform=node --target=node20 \
      --outfile=/context/lib/runner-task-context.js; \
    fi

# compile typed chain version/metadata ownership; the legacy shell library
# forwards only primitive version-control operations to this bundle.
RUN if [ -f /build/web/lib/runner-v2/version-control-cli.ts ]; then \
      echo "=== compiling typed runner version-control boundary ===" && \
      cd /build/web && \
      npx --yes esbuild /build/web/lib/runner-v2/version-control-cli.ts \
        --bundle --platform=node --target=node20 \
      --outfile=/context/lib/runner-version-control.js; \
    fi

# compile typed git status/history/diff projections. Git remains the external
# CLI product boundary; shell callers only invoke this parser/serializer.
RUN if [ -f /build/web/lib/runner-v2/git-integration-cli.ts ]; then \
      echo "=== compiling typed runner git integration boundary ===" && \
      cd /build/web && \
      npx --yes esbuild /build/web/lib/runner-v2/git-integration-cli.ts \
        --bundle --platform=node --target=node20 \
      --outfile=/context/lib/runner-git-integration.js; \
    fi

# Compile typed monitor completion resolution. Shell monitors only supply
# primitive session, run, and directory inputs; TypeScript owns all chain/event matching.
RUN if [ -f /build/web/lib/runner-v2/monitor-completion-cli.ts ]; then \
      echo "=== compiling typed runner monitor completion boundary ===" && \
      cd /build/web && \
      npx --yes esbuild /build/web/lib/runner-v2/monitor-completion-cli.ts \
        --bundle --platform=node --target=node20 \
      --outfile=/context/lib/runner-monitor-completion.js; \
    fi

# compile typed routing and schedule contracts; shell compatibility boundaries
# may invoke these processes but never parse or mutate their JSON records.
RUN if [ -f /build/web/lib/runner-v2/routing-contract-cli.ts ]; then \
      echo "=== compiling typed runner routing contract boundary ===" && \
      cd /build/web && \
      npx --yes esbuild /build/web/lib/runner-v2/routing-contract-cli.ts \
        --bundle --platform=node --target=node20 \
      --outfile=/context/lib/runner-routing-contract.js; \
    fi

RUN if [ -f /build/web/lib/runner-v2/schedule-contract-cli.ts ]; then \
      echo "=== compiling typed runner schedule contract boundary ===" && \
      cd /build/web && \
      npx --yes esbuild /build/web/lib/runner-v2/schedule-contract-cli.ts \
        --bundle --platform=node --target=node20 \
      --outfile=/context/lib/runner-schedule-contract.js; \
    fi

# compile typed legacy webhook/email contract access; shell only invokes the
# external delivery commands and never owns persisted JSON or path resolution.
RUN if [ -f /build/web/lib/runner-v2/integration-contract-cli.ts ]; then \
      echo "=== compiling typed runner integration contract boundary ===" && \
      cd /build/web && \
      npx --yes esbuild /build/web/lib/runner-v2/integration-contract-cli.ts \
        --bundle --platform=node --target=node20 \
      --outfile=/context/lib/runner-integration-contract.js; \
    fi

# compile typed debugger state access; shell invocation boundaries never parse
# or mutate debug JSON directly.
RUN if [ -f /build/web/lib/runner-v2/debug-state-cli.ts ]; then \
      echo "=== compiling typed runner debug-state boundary ===" && \
      cd /build/web && \
      npx --yes esbuild /build/web/lib/runner-v2/debug-state-cli.ts \
        --bundle --platform=node --target=node20 \
      --outfile=/context/lib/runner-debug-state.js; \
    fi

# compile typed breakpoint record access; shell orchestration may only invoke
# this boundary and never parse or mutate breakpoints.json directly.
RUN if [ -f /build/web/lib/runner-v2/breakpoint-cli.ts ]; then \
      echo "=== compiling typed runner breakpoint boundary ===" && \
      cd /build/web && \
      npx --yes esbuild /build/web/lib/runner-v2/breakpoint-cli.ts \
        --bundle --platform=node --target=node20 \
      --outfile=/context/lib/runner-breakpoint.js; \
    fi

# compile typed plugin registry dispatch; plugin hook scripts remain external
# commands, but they never parse registry state or resolve their own paths.
RUN if [ -f /build/web/lib/system/plugin-dispatch-cli.ts ]; then \
      echo "=== compiling typed plugin dispatch boundary ===" && \
      cd /build/web && \
      npx --yes esbuild /build/web/lib/system/plugin-dispatch-cli.ts \
        --bundle --platform=node --target=node20 \
        --outfile=/context/lib/runner-plugin-dispatch.js; \
    fi

# compile the audit log/index owner used by web, CLI, and remaining shell
# command boundaries. Remote rclone shipping stays an external command only.
RUN if [ -f /build/web/lib/system/audit-cli.ts ]; then \
      echo "=== compiling typed audit boundary ===" && \
      cd /build/web && \
      npx --yes esbuild /build/web/lib/system/audit-cli.ts \
        --bundle --platform=node --target=node20 \
        --outfile=/context/lib/runner-audit.js; \
    fi

# compile the typed create-only runspace manifest boundary used by chain launch.
RUN if [ -f /build/web/lib/runner-v2/runspace-manifest-cli.ts ]; then \
      echo "=== compiling typed runner runspace manifest ===" && \
      cd /build/web && \
      npx --yes esbuild /build/web/lib/runner-v2/runspace-manifest-cli.ts \
        --bundle --platform=node --target=node20 \
        --outfile=/context/lib/runner-runspace-manifest.js; \
    fi

# compile typed runtime profiler/performance ownership; shell callers only pass
# live OS/PTY samples through this boundary.
RUN if [ -f /build/web/lib/runner-v2/runtime-metrics-cli.ts ]; then \
      echo "=== compiling typed runner runtime metrics ===" && \
      cd /build/web && \
      npx --yes esbuild /build/web/lib/runner-v2/runtime-metrics-cli.ts \
        --bundle --platform=node --target=node20 \
        --outfile=/context/lib/runner-runtime-metrics.js; \
    fi

# compile typed external transcript path/provenance resolution for legacy shell callers.
RUN if [ -f /build/web/lib/runs/session-log-resolver-cli.ts ]; then \
      echo "=== compiling typed session log resolver ===" && \
      cd /build/web && \
      npx --yes esbuild /build/web/lib/runs/session-log-resolver-cli.ts \
        --bundle --platform=node --target=node20 \
        --outfile=/context/lib/runner-session-log-resolver.js; \
    fi

# compile process-manager.ts (tsc — needs same anchor; use relative paths
# from web/ so tsconfig.json auto-discovery picks up web/tsconfig.json)
RUN if [ -f /build/web/lib/process-manager.ts ] && [ ! -f /context/lib/process-manager.js ]; then \
      echo "=== compiling process-manager.ts ===" && \
      cd /build/web && \
      npx --yes tsc --outDir /tmp/pm-out --skipLibCheck --esModuleInterop \
        --module commonjs --target es2022 --moduleResolution node \
        lib/pm-types.ts lib/kollabor-mcp-server-env.ts lib/kollabor-mcp-settings.ts \
        lib/process-manager-env.ts lib/process-manager.ts && \
      cp /tmp/pm-out/process-manager.js /context/lib/process-manager.js && \
      cp /tmp/pm-out/process-manager-env.js /context/lib/process-manager-env.js && \
      cp /tmp/pm-out/pm-types.js /context/lib/pm-types.js && \
      cp /tmp/pm-out/kollabor-mcp-server-env.js /context/lib/kollabor-mcp-server-env.js && \
      cp /tmp/pm-out/kollabor-mcp-settings.js /context/lib/kollabor-mcp-settings.js && \
      rm -rf /tmp/pm-out; \
    fi

# compile mentiko-mcp — uses the lib/mentiko-mcp workspace package's own
# build, which produces dist/server.js cleanly without cross-project alias
# resolution issues. The bin/mentiko-mcp bash shim prefers this bundle in
# prod and falls back to tsx in dev.
RUN if [ -f /build/lib/mentiko-mcp/package.json ]; then \
      echo "=== building mentiko-mcp package ===" && \
      cd /build/lib/mentiko-mcp && \
      npm install --no-audit --no-fund && \
      npm run build && \
      mkdir -p /context/lib/mentiko-mcp && \
      cp /build/lib/mentiko-mcp/dist/server.js /context/lib/mentiko-mcp/server.js && \
      rm -f /context/lib/mentiko-mcp/server.ts \
            /context/lib/mentiko-mcp/dispatch.ts \
            /context/lib/mentiko-mcp/tools.ts && \
      rm -rf /context/lib/mentiko-mcp/handlers; \
    fi

# build a self-contained runtime-natives lockfile by walking the dependency
# closure of the four target packages in web/package-lock.json and copying
# each entry verbatim — version, resolved url, integrity hash, deps.
#
# the previous approach generated a thin package.json and ran
# `npm install --package-lock-only`, which re-resolved the transitive
# subtree against the public npm registry at build time. that let two
# builds of the same commit install different transitive bytes.
#
# this script (scripts/build-runtime-natives-lock.mjs) copies entries
# directly from web/package-lock.json so npm ci can only fetch the exact
# tarballs the source lockfile committed to. bit-for-bit reproducible.
RUN echo "=== building runtime-natives lockfile from web lockfile ===" && \
    node /build/scripts/build-runtime-natives-lock.mjs \
      /build/web/package-lock.json \
      /context/runtime-natives

# phase 5: split /context into two output roots so the runtime stage can
# COPY them as separate layers. node_modules is the big one (~63MB) and
# only changes when web/package-lock.json bumps — putting it in its own
# layer means most releases only push the small app-code layer.
#
# (we'd use COPY --exclude=node_modules instead, but that requires
# dockerfile syntax 1.19+. splitting in the builder works on any
# buildkit and makes the layer boundary explicit.)
RUN echo "=== splitting context for layered runtime copy ===" && \
    mkdir -p /context-node-modules /context-app && \
    mv /context/node_modules /context-node-modules/node_modules && \
    cp -a /context/. /context-app/ && \
    rm -rf /context

# ===========================================================================
# RUNTIME STAGE — inherit tools from mentiko-base, drop in the app
# ===========================================================================

FROM ghcr.io/kollaborai/mentiko-base:${BASE_TAG}

WORKDIR /opt/mentiko

# (file(1), required by the smoke gate's native arch audit in
# scripts/smoke-platform-image.cjs, is provided by mentiko-base's apt
# block as of commit 627c626 + base build 26351083099.)

# phase 5: split the bundle copy so the biggest layer (the standalone
# node_modules, ~63MB) sits in its own image layer. that layer only
# changes when web/package-lock.json bumps — so on a typical release
# where only app code (lib/, bin/, etc.) changed, this layer reuses
# the registry cache and only the small app-code layer gets pushed.
#
# the second COPY brings everything except node_modules. it includes
# .next/ + bin/ + lib/ + server/ + kollab/ + runtime-natives + root
# files (server.js, package.json, version.json, processes.json).
COPY --from=builder --chown=mentiko:mentiko /context-node-modules/node_modules /opt/mentiko/node_modules
COPY --from=builder --chown=mentiko:mentiko /context-app/ /opt/mentiko/

# runtime native deps installed AFTER the COPY because next.js standalone
# bundles some of these in its own node_modules and would overwrite a base
# install. installs done via `npm ci` against a thin runtime-natives manifest
# the builder stage derived from web/package-lock.json — pins exact versions,
# uses upstream prebuilds (no source compile = ~3-4 min savings per arch).
#
#   ws + @xterm/headless                : required by ws-terminal / pty-mgr
#   better-sqlite3                      : required by better-auth
#   better-sqlite3-multiple-ciphers     : required by web/lib/auth-server.ts
#                                         and web/lib/sqlcipher-migrate.ts
#                                         for sqlcipher auth.db encryption.
#                                         WAS MISSING from the prior install
#                                         list and only worked by matching-
#                                         arch coincidence (each arch built
#                                         its own bundle natively).
#
# CRITICAL: we cannot `npm ci` directly in /opt/mentiko because that would
# wipe the standalone bundle's node_modules (next, react, all transitives).
# instead we install to a sibling scratch dir and copy ONLY the four target
# packages into /opt/mentiko/node_modules, overwriting whatever the bundle
# shipped with native-arch-correct, lockfile-pinned versions.
RUN --mount=from=builder,source=/context-app/runtime-natives,target=/runtime-natives-src \
    echo "=== runtime native deps (lockfile-pinned, prebuilds) ===" && \
    mkdir -p /tmp/runtime-natives && \
    cp /runtime-natives-src/package.json /tmp/runtime-natives/package.json && \
    cp /runtime-natives-src/package-lock.json /tmp/runtime-natives/package-lock.json && \
    cd /tmp/runtime-natives && \
    npm ci --omit=dev --no-audit --no-fund --include=optional && \
    echo "installed versions:" && \
    node -p "Object.entries(require('./package.json').dependencies).map(([n,v])=>n+': '+v).join('\n')" && \
    # phase 4: delete sharp's per-arch packages from the bundle before
    # overlay. when amd64 builds the bundle (phase 4 BUILDPLATFORM model),
    # arm64 runtime inherits an amd64-built @img/sharp-linux-x64. that
    # would fail file(1) audit AND crash on first image-optimization.
    # the npm ci above installed the correct-arch sharp variants into
    # /tmp/runtime-natives/node_modules/@img on THIS runner — copy those
    # in fresh. on the amd64 runtime stage this is a no-op overwrite.
    rm -rf /opt/mentiko/node_modules/@img && \
    mkdir -p /opt/mentiko/node_modules/@xterm /opt/mentiko/node_modules/@img && \
    for pkg in ws better-sqlite3 better-sqlite3-multiple-ciphers sharp; do \
      rm -rf "/opt/mentiko/node_modules/$pkg" && \
      cp -a "/tmp/runtime-natives/node_modules/$pkg" "/opt/mentiko/node_modules/$pkg"; \
    done && \
    rm -rf /opt/mentiko/node_modules/@xterm/headless && \
    cp -a /tmp/runtime-natives/node_modules/@xterm/headless /opt/mentiko/node_modules/@xterm/headless && \
    # copy every @img/* sub-package npm ci materialised (sharp-linux-{arch},
    # sharp-libvips-linux-{arch}, sharp-linuxmusl-{arch}, etc — exact set
    # depends on the runner's arch).
    for pkg in /tmp/runtime-natives/node_modules/@img/*; do \
      name=$(basename "$pkg") && \
      cp -a "$pkg" "/opt/mentiko/node_modules/@img/$name"; \
    done && \
    rm -rf /tmp/runtime-natives && \
    chown -R mentiko:mentiko /opt/mentiko/node_modules 2>/dev/null || true

# make scripts executable
RUN chmod +x /opt/mentiko/bin/* 2>/dev/null || true

# ===========================================================================
# RUNTIME CONFIG (lives here, NOT in base)
# ===========================================================================

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV HOME=/home/mentiko
ENV NEXT_TELEMETRY_DISABLED=1
ENV BETTER_AUTH_URL=http://localhost:3000
ENV MENTIKO_GLOBAL_ROOT=/app
ENV MENTIKO_CODE_ROOT=/opt/mentiko
ENV NAMESPACE_ID=default
ENV DATABASE_URL=file:/app/data/auth.db

VOLUME /app

USER mentiko

EXPOSE 3000 3099

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', r => process.exit(r.statusCode < 500 ? 0 : 1)).on('error', () => process.exit(1))"

ENTRYPOINT ["tini", "--"]
CMD ["node", "/opt/mentiko/lib/process-manager.js"]
