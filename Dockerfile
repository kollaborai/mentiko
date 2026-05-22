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
ARG BUILD_COMMIT=unknown
ARG BUILD_VERSION=unknown
ARG BUILD_REPO=kollaborai/mentiko

COPY web/package.json web/package-lock.json /build/web/
WORKDIR /build/web

RUN echo "=== npm ci ===" && \
    npm ci

COPY . /build/
WORKDIR /build/web

RUN echo "=== next.js build (webpack) ===" && \
    ./node_modules/.bin/next build --webpack && \
    test -f .next/standalone/server.js || (echo "FATAL: standalone build missing server.js" && exit 1)

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

# compile process-manager.ts (tsc — needs same anchor; use relative paths
# from web/ so tsconfig.json auto-discovery picks up web/tsconfig.json)
RUN if [ -f /build/web/lib/process-manager.ts ] && [ ! -f /context/lib/process-manager.js ]; then \
      echo "=== compiling process-manager.ts ===" && \
      cd /build/web && \
      npx --yes tsc --outDir /tmp/pm-out --skipLibCheck --esModuleInterop \
        --module commonjs --target es2022 --moduleResolution node \
        lib/pm-types.ts lib/kollabor-mcp-server-env.ts \
        lib/process-manager-env.ts lib/process-manager.ts && \
      cp /tmp/pm-out/process-manager.js /context/lib/process-manager.js && \
      cp /tmp/pm-out/process-manager-env.js /context/lib/process-manager-env.js && \
      cp /tmp/pm-out/pm-types.js /context/lib/pm-types.js && \
      cp /tmp/pm-out/kollabor-mcp-server-env.js /context/lib/kollabor-mcp-server-env.js && \
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

# ===========================================================================
# RUNTIME STAGE — inherit tools from mentiko-base, drop in the app
# ===========================================================================

FROM ghcr.io/kollaborai/mentiko-base:${BASE_TAG}

WORKDIR /opt/mentiko

# copy assembled app from the builder stage
COPY --from=builder --chown=mentiko:mentiko /context/ /opt/mentiko/

# runtime deps installed AFTER the COPY (next.js standalone bundles some of
# these in its own node_modules and would overwrite a base install)
# ws + @xterm/headless: required by ws-terminal and pty-mgr
# better-sqlite3: required by better-auth
RUN echo "=== runtime deps ===" && \
    cd /opt/mentiko && \
    [ -f package.json ] || echo '{}' > package.json && \
    npm install --no-save ws @xterm/headless better-sqlite3 --build-from-source && \
    chown -R mentiko:mentiko node_modules 2>/dev/null || true

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
