#!/bin/bash
set -e

# create required directories if missing (parameterized by NAMESPACE_ID)
NS_ID=${NAMESPACE_ID:-default}
mkdir -p "/app/namespaces/$NS_ID/chains"
mkdir -p "/app/namespaces/$NS_ID/events"
mkdir -p "/app/namespaces/$NS_ID/state"
mkdir -p "/app/namespaces/$NS_ID/runs"
mkdir -p "$HOME/.pty-manager"

# --- mentiko-mcp shared secret + env -----------------------------------------
# Generate a random inbox key for mentiko-mcp → mentiko-web communication,
# unless one is already provided (e.g. by a deployer that wants a known key).
if [ -z "$MENTIKO_INBOX_KEY" ]; then
  export MENTIKO_INBOX_KEY="$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | base64 | tr -d '=+/')"
fi
export MENTIKO_WEB_URL=${MENTIKO_WEB_URL:-http://127.0.0.1:3000}
export MENTIKO_NAMESPACE_ID=${MENTIKO_NAMESPACE_ID:-$NS_ID}
export MENTIKO_ORG_ID=${MENTIKO_ORG_ID:-default}
echo "[entrypoint] mentiko-mcp inbox key generated (len=${#MENTIKO_INBOX_KEY})"

# 1. start pty-manager daemon (required for terminal sessions)
echo "[entrypoint] starting pty-manager daemon..."
/app/bin/pty-mgr daemon &
PTY_PID=$!
sleep 1

# verify daemon started
if /app/bin/pty-mgr status >/dev/null 2>&1; then
  echo "[entrypoint] pty-manager daemon running (pid: $PTY_PID)"
else
  echo "[entrypoint] WARNING: pty-manager daemon failed to start"
fi

# 2. start ws-terminal bridge (bridges browser websocket to pty-manager)
if [ -f /app/web/server/ws-terminal.ts ]; then
  echo "[entrypoint] starting ws-terminal bridge on port 3099..."
  npx tsx /app/web/server/ws-terminal.ts &
  WS_PID=$!
  sleep 1
  echo "[entrypoint] ws-terminal bridge pid: $WS_PID"
fi

# 3. register mentiko-mcp with kollabor-engine
# Note: the engine spawns MCP subprocesses with env INHERITED from its own
# process. As long as kollabor-engine is started as a child of this entrypoint
# (or shares the same env), MENTIKO_INBOX_KEY / MENTIKO_WEB_URL will flow
# through to the MCP subprocess. If the engine is launched separately, make
# sure to pass those vars into its environment.
echo "[entrypoint] registering mentiko-mcp with kollabor-engine..."
node /app/lib/runner-kollabor-mcp-settings.js register --command /app/bin/mentiko-mcp

# 4. start next.js (foreground - main process)
echo "[entrypoint] starting next.js on port 3000..."
exec npm start --prefix web
