# Workspaces

Execution environments for agent chains.

## Overview

Workspaces define where and how agents execute code. Each workspace type provides different isolation and capabilities.

## Types

### Local Workspace

Default mode. Agents execute in the current working directory.

**Use case:** Development, local testing

**Configuration:**
```json
{
  "type": "local",
  "path": "/path/to/project"
}
```

**Capabilities:**
- Full filesystem access
- Direct file editing
- Fast iteration

### SSH Workspace

Remote execution via SSH. Agents run on a remote server.

**Use case:** Remote servers, cloud instances

**Configuration:**
```json
{
  "type": "ssh",
  "host": "user@hostname",
  "path": "/remote/path"
}
```

**Capabilities:**
- Remote filesystem access
- SSH key authentication
- Portable workspace

### Docker Workspace

Containerized execution. Agents run in isolated containers.

**Use case:** Production, clean environments

**Configuration:**
```json
{
  "type": "docker",
  "image": "node:20",
  "path": "/workspace"
}
```

**Capabilities:**
- Full isolation
- Reproducible environments
- Resource limits

## Configuration

Workspaces are configured at the org level in `workspaces/` directory.

**Example workspace file:**
```json
{
  "id": "local-dev",
  "name": "Local Development",
  "type": "local",
  "path": "/Users/dev/project",
  "default": true
}
```

## Path Resolution

Workspace paths respect the 3-tier data hierarchy:

- **Default namespace:** `~/.mentiko/namespaces/default/workspaces/`
- **Non-default:** `~/.mentiko/namespaces/{id}/orgs/{org}/workspaces/`

## Security

- SSH keys stored in secrets vault
- Docker containers run as non-root
- Workspace permissions scoped to org

**TODO:** Docker volume mounts, networking, resource limits
