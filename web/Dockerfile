# ---- build ----
FROM node:lts-slim AS build
WORKDIR /app

# build tools for better-sqlite3 native module
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# copy package files
COPY package.json package-lock.json ./

# install deps + native platform binaries
RUN npm ci && \
    npm install @parcel/watcher lightningcss @swc/core @tailwindcss/oxide --no-save

# copy source
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN npm run build

# ---- runtime ----
FROM node:lts-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN groupadd --system --gid 1001 mentiko && \
    useradd --system --uid 1001 --gid mentiko mentiko

# no legacy runtime task tools are installed in this image

# standalone output includes everything needed
COPY --from=build --chown=mentiko:mentiko /app/.next/standalone ./
COPY --from=build --chown=mentiko:mentiko /app/.next/static ./.next/static
COPY --from=build --chown=mentiko:mentiko /app/public ./public

# writable dirs for runtime (namespace dirs, file-based data, sqlite auth db)
RUN mkdir -p /app/namespaces /app/data && \
    chown mentiko:mentiko /app/namespaces /app/data

USER mentiko

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', r => process.exit(r.statusCode < 500 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "server.js"]
