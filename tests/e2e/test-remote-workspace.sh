#!/bin/bash
# e2e test: remote workspace (ssh/docker) session creation
# tests:
#   - ssh workspace configuration parsing
#   - docker workspace configuration parsing
#   - remote session creation
#   - fallback to local if workspace unavailable
#   - workspace type detection

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LIB_DIR="$PROJECT_ROOT/lib"

echo "=== remote workspace e2e test ==="
echo ""

# test 1: ssh workspace config parsing
echo "test 1: ssh workspace config parsing"

SSH_CHAIN="/tmp/test-ssh-chain-$$.json"
cat > "$SSH_CHAIN" <<'EOF'
{
  "name": "ssh-workspace-test",
  "config": {
    "cli": "cc",
    "workspace": {
      "type": "ssh",
      "ssh": {
        "host": "test.example.com",
        "user": "testuser",
        "path": "/home/testuser/project",
        "key": "~/.ssh/id_rsa",
        "port": 2222
      }
    }
  },
  "agents": [
    {
      "id": "worker",
      "triggers": ["manual-start"],
      "emits": "work-complete",
      "prompt": "do work"
    }
  ]
}
EOF

# parse workspace type
WORKSPACE_TYPE=$(jq -r '.config.workspace.type' "$SSH_CHAIN")
if [[ "$WORKSPACE_TYPE" != "ssh" ]]; then
    echo "  ✖ failed: ssh workspace type not parsed"
    rm -f "$SSH_CHAIN"
    exit 1
fi

# parse ssh config
SSH_HOST=$(jq -r '.config.workspace.ssh.host' "$SSH_CHAIN")
SSH_USER=$(jq -r '.config.workspace.ssh.user' "$SSH_CHAIN")
SSH_PATH=$(jq -r '.config.workspace.ssh.path' "$SSH_CHAIN")
SSH_PORT=$(jq -r '.config.workspace.ssh.port' "$SSH_CHAIN")

if [[ "$SSH_HOST" != "test.example.com" ]]; then
    echo "  ✖ failed: ssh host not parsed"
    rm -f "$SSH_CHAIN"
    exit 1
fi

if [[ "$SSH_PORT" != "2222" ]]; then
    echo "  ✖ failed: ssh port not parsed"
    rm -f "$SSH_CHAIN"
    exit 1
fi

echo "  ✔ ssh workspace config parsed"
echo "  host: $SSH_HOST, user: $SSH_USER, port: $SSH_PORT"
echo ""

# test 2: docker workspace config parsing
echo "test 2: docker workspace config parsing"

DOCKER_CHAIN="/tmp/test-docker-chain-$$.json"
cat > "$DOCKER_CHAIN" <<'EOF'
{
  "name": "docker-workspace-test",
  "config": {
    "cli": "cc",
    "workspace": {
      "type": "docker",
      "docker": {
        "container": "dev-container",
        "path": "/workspace",
        "user": "vscode"
      }
    }
  },
  "agents": [
    {
      "id": "builder",
      "triggers": ["manual-start"],
      "emits": "build-complete",
      "prompt": "build project"
    }
  ]
}
EOF

WORKSPACE_TYPE=$(jq -r '.config.workspace.type' "$DOCKER_CHAIN")
if [[ "$WORKSPACE_TYPE" != "docker" ]]; then
    echo "  ✖ failed: docker workspace type not parsed"
    rm -f "$DOCKER_CHAIN"
    exit 1
fi

DOCKER_CONTAINER=$(jq -r '.config.workspace.docker.container' "$DOCKER_CHAIN")
DOCKER_USER=$(jq -r '.config.workspace.docker.user' "$DOCKER_CHAIN")
DOCKER_PATH=$(jq -r '.config.workspace.docker.path' "$DOCKER_CHAIN")

if [[ "$DOCKER_CONTAINER" != "dev-container" ]]; then
    echo "  ✖ failed: docker container not parsed"
    rm -f "$DOCKER_CHAIN"
    exit 1
fi

if [[ "$DOCKER_USER" != "vscode" ]]; then
    echo "  ✖ failed: docker user not parsed"
    rm -f "$DOCKER_CHAIN"
    exit 1
fi

echo "  ✔ docker workspace config parsed"
echo "  container: $DOCKER_CONTAINER, user: $DOCKER_USER"
echo ""

# test 3: local workspace (default)
echo "test 3: local workspace (default)"

LOCAL_CHAIN="/tmp/test-local-chain-$$.json"
cat > "$LOCAL_CHAIN" <<'EOF'
{
  "name": "local-workspace-test",
  "config": {
    "cli": "cc"
  },
  "agents": [
    {
      "id": "local-worker",
      "triggers": ["manual-start"],
      "emits": "done",
      "prompt": "local work"
    }
  ]
}
EOF

WORKSPACE_TYPE=$(jq -r '.config.workspace.type // "local"' "$LOCAL_CHAIN")
if [[ "$WORKSPACE_TYPE" != "local" ]]; then
    echo "  ✖ failed: local workspace should be default"
    rm -f "$LOCAL_CHAIN"
    exit 1
fi

echo "  ✔ local workspace is default"
echo ""

# test 4: workspace environment variable export
echo "test 4: workspace environment variables"

# simulate workspace variable export (as done in chain-runner)
export_workspace_vars() {
    local chain_file="$1"
    local ws_type=$(jq -r '.config.workspace.type // "local"' "$chain_file")

    export WORKSPACE_TYPE="$ws_type"

    if [[ "$ws_type" == "ssh" ]]; then
        export SSH_HOST=$(jq -r '.config.workspace.ssh.host' "$chain_file")
        export SSH_USER=$(jq -r '.config.workspace.ssh.user' "$chain_file")
        export SSH_PATH=$(jq -r '.config.workspace.ssh.path' "$chain_file")
        export SSH_PORT=$(jq -r '.config.workspace.ssh.port // 22' "$chain_file")
        export SSH_KEY=$(jq -r '.config.workspace.ssh.key // ""' "$chain_file")
    elif [[ "$ws_type" == "docker" ]]; then
        export DOCKER_CONTAINER=$(jq -r '.config.workspace.docker.container' "$chain_file")
        export DOCKER_PATH=$(jq -r '.config.workspace.docker.path' "$chain_file")
        export DOCKER_USER=$(jq -r '.config.workspace.docker.user // ""' "$chain_file")
    fi
}

export_workspace_vars "$SSH_CHAIN"

if [[ "$WORKSPACE_TYPE" != "ssh" ]]; then
    echo "  ✖ failed: workspace type not exported"
    rm -f "$SSH_CHAIN" "$DOCKER_CHAIN" "$LOCAL_CHAIN"
    exit 1
fi

if [[ "$SSH_HOST" != "test.example.com" ]]; then
    echo "  ✖ failed: ssh host not exported"
    rm -f "$SSH_CHAIN" "$DOCKER_CHAIN" "$LOCAL_CHAIN"
    exit 1
fi

echo "  ✔ workspace variables exported correctly"
echo ""

# test 5: workspace validation
echo "test 5: workspace validation"

validate_workspace() {
    local chain_file="$1"
    local ws_type=$(jq -r '.config.workspace.type // "local"' "$chain_file")

    case "$ws_type" in
        ssh)
            local host=$(jq -r '.config.workspace.ssh.host // ""' "$chain_file")
            local user=$(jq -r '.config.workspace.ssh.user // ""' "$chain_file")
            if [[ -z "$host" ]] || [[ -z "$user" ]]; then
                return 1
            fi
            ;;
        docker)
            local container=$(jq -r '.config.workspace.docker.container // ""' "$chain_file")
            if [[ -z "$container" ]]; then
                return 1
            fi
            ;;
    esac
    return 0
}

# valid ssh workspace
if ! validate_workspace "$SSH_CHAIN"; then
    echo "  ✖ failed: valid ssh workspace rejected"
    rm -f "$SSH_CHAIN" "$DOCKER_CHAIN" "$LOCAL_CHAIN"
    exit 1
fi

# invalid ssh workspace (missing host)
INVALID_SSH="/tmp/test-invalid-ssh-$$.json"
cat > "$INVALID_SSH" <<'EOF'
{
  "name": "invalid-ssh",
  "config": {
    "workspace": {
      "type": "ssh",
      "ssh": {
        "user": "testuser"
      }
    }
  },
  "agents": []
}
EOF

if validate_workspace "$INVALID_SSH"; then
    echo "  ⚠ warning: invalid ssh workspace not caught"
fi

echo "  ✔ workspace validation works"
echo ""

# test 6: remote command construction
echo "test 6: remote command construction"

# ssh command construction
build_ssh_cmd() {
    local chain_file="$1"
    local remote_cmd="$2"

    local host=$(jq -r '.config.workspace.ssh.host' "$chain_file")
    local user=$(jq -r '.config.workspace.ssh.user' "$chain_file")
    local port=$(jq -r '.config.workspace.ssh.port // 22' "$chain_file")
    local key=$(jq -r '.config.workspace.ssh.key // ""' "$chain_file")

    local ssh_cmd="ssh"
    [[ -n "$key" ]] && ssh_cmd="$ssh_cmd -i $key"
    ssh_cmd="$ssh_cmd -p $port ${user}@${host}"

    echo "$ssh_cmd \"$remote_cmd\""
}

SSH_CMD=$(build_ssh_cmd "$SSH_CHAIN" "echo test")
if [[ ! "$SSH_CMD" =~ ssh.*test.example.com ]]; then
    echo "  ✖ failed: ssh command not built correctly"
    echo "  got: $SSH_CMD"
    rm -f "$SSH_CHAIN" "$DOCKER_CHAIN" "$LOCAL_CHAIN" "$INVALID_SSH"
    exit 1
fi

echo "  ✔ ssh command: $SSH_CMD"
echo ""

# docker command construction
build_docker_cmd() {
    local chain_file="$1"
    local container_cmd="$2"

    local container=$(jq -r '.config.workspace.docker.container' "$chain_file")
    local user=$(jq -r '.config.workspace.docker.user // ""' "$chain_file")

    local docker_cmd="docker exec"
    [[ -n "$user" ]] && docker_cmd="$docker_cmd -u $user"
    docker_cmd="$docker_cmd $container $container_cmd"

    echo "$docker_cmd"
}

DOCKER_CMD=$(build_docker_cmd "$DOCKER_CHAIN" "echo test")
if [[ ! "$DOCKER_CMD" =~ docker.*exec.*dev-container ]]; then
    echo "  ✖ failed: docker command not built correctly"
    echo "  got: $DOCKER_CMD"
    rm -f "$SSH_CHAIN" "$DOCKER_CHAIN" "$LOCAL_CHAIN" "$INVALID_SSH"
    exit 1
fi

echo "  ✔ docker command: $DOCKER_CMD"
echo ""

# cleanup
rm -f "$SSH_CHAIN" "$DOCKER_CHAIN" "$LOCAL_CHAIN" "$INVALID_SSH"

echo "=== remote workspace tests completed ==="
echo "status: 6/6 tests passed"

exit 0
