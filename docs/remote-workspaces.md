remote workspaces
===============================================================================

run agents on remote servers via ssh or inside docker containers.

why remote workspaces
------------------------------------------------------------
  - run on powerful remote machines
  - execute inside containerized environments
  - keep heavy operations off your local machine
  - access remote filesystems and resources

workspace types
------------------------------------------------------------
  local   - default, runs on your machine
  ssh     - remote server via ssh connection
  docker  - inside a running docker container

ssh workspace
------------------------------------------------------------
configuration in chain.json:

{
  "config": {
    "workspace": {
      "type": "ssh",
      "ssh": {
        "host": "example.com",
        "user": "ubuntu",
        "path": "/home/ubuntu/projects/my-project",
        "key": "~/.ssh/id_rsa",
        "port": 22
      }
    }
  }
}

fields:
  host   - hostname or ip address (required)
  user   - ssh user (required)
  path   - working directory on remote host (required)
  key    - path to ssh private key (optional, uses default)
  port   - ssh port (default: 22)

how ssh workspace works:
  1. mentiko creates a local PTY session via pty-manager
  2. the session SSHs into the remote host
  3. commands execute in the remote directory
  4. file operations work on remote filesystem

example: remote build server

{
  "name": "Remote Build Chain",
  "config": {
    "workspace": {
      "type": "ssh",
      "ssh": {
        "host": "build-server.internal",
        "user": "builder",
        "path": "/builds/current-project"
      }
    }
  },
  "agents": [
    {
      "id": "builder",
      "name": "Remote Builder",
      "triggers": ["manual-start"],
      "emits": "build-complete",
      "prompt": "Run the build process on the remote server"
    }
  ]
}

ssh setup:
  1. ensure passwordless ssh to the remote host
  2. verify remote directory exists
  3. check ai cli is installed on remote host
  4. test connection: ssh user@host pwd

docker workspace
------------------------------------------------------------
configuration in chain.json:

{
  "config": {
    "workspace": {
      "type": "docker",
      "docker": {
        "container": "dev-container",
        "path": "/workspace",
        "user": "vscode"
      }
    }
  }
}

fields:
  container - container name or id (required)
  path      - working directory inside container (required)
  user      - user to run commands as (optional)

how docker workspace works:
  1. mentiko creates a local PTY session via pty-manager
  2. the session docker-execs into the container
  3. commands execute inside container filesystem
  4. file operations are container-local

example: containerized development

{
  "name": "Container Build Chain",
  "config": {
    "workspace": {
      "type": "docker",
      "docker": {
        "container": "my-dev-container",
        "path": "/workspace",
        "user": "root"
      }
    }
  },
  "agents": [
    {
      "id": "tester",
      "name": "Container Tester",
      "triggers": ["manual-start"],
      "emits": "tests-done",
      "prompt": "Run tests inside the container"
    }
  ]
}

docker setup:
  1. container must be running before chain starts
  2. verify docker exec works: docker exec -it <container> pwd
  3. check ai cli is available inside container
  4. ensure working directory exists inside container

per-agent workspace override
------------------------------------------------------------
you can override the chain-level workspace per agent:

{
  "agents": [
    {
      "id": "local-agent",
      "name": "Runs Locally",
      "context": {
        "workspace": "local/"
      }
    },
    {
      "id": "remote-agent",
      "name": "Runs on Remote",
      "context": {
        "workspace": "ssh:user@host:/remote/path"
      }
    }
  ]
}

session naming with remote workspaces
------------------------------------------------------------
local:
  mychain-agent-20260225-1000

ssh:
  mychain-agent-20260225-1000  (runs on remote host)

docker:
  mychain-agent-20260225-1000  (runs inside container)

the session name is the same, but execution context differs.

troubleshooting
------------------------------------------------------------
ssh connection fails:

  1. test ssh manually:
     ssh user@host pwd

  2. check key permissions:
     chmod 600 ~/.ssh/id_rsa

  3. verify host is in known_hosts:
     ssh-keyscan host >> ~/.ssh/known_hosts

docker exec fails:

  1. check container is running:
     docker ps | grep container-name

  2. test exec manually:
     docker exec -it container-name pwd

  3. verify path exists inside container:
     docker exec container-name ls /workspace

agent not found:

  1. ssh: check ai cli is installed on remote host
  2. docker: check ai cli is available inside container
  3. verify cli is in $path on the target

file not found errors:

  1. local: check path from project root
  2. ssh: check path exists on remote host
  3. docker: check path exists inside container

examples
------------------------------------------------------------
see examples/workspace-ssh-example.json and
examples/workspace-docker-example.json for full working configs.

security considerations
------------------------------------------------------------
ssh:
  - use ssh keys, not passwords
  - limit user permissions on remote host
  - consider using a bastion host
  - rotate keys periodically

docker:
  - avoid running as root if possible
  - use non-privileged containers
  - limit container resources
  - don't mount sensitive directories

general:
  - remote workspaces have access to their filesystem
  - be careful with destructive operations
  - test chains with non-destructive tasks first
