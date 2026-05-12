---
title: "Infrastructure & Configuration"
type: component
linked_files:
  - web/lib/docker-provisioner.ts
  - web/lib/linux-users.ts
  - web/lib/config.ts
  - web/lib/pty-client.ts
  - web/lib/pm-client.ts
  - web/lib/compute-store.ts
  - web/lib/circuit-breaker.ts
  - web/lib/infra/setup-scripts.ts
  - web/lib/infra/provider-registry.ts
  - web/lib/infra/provider-types.ts
file_hashes:
  web/lib/circuit-breaker.ts: sha256:10d0e14130d531b8
  web/lib/compute-store.ts: sha256:fe410aecc5084146
  web/lib/config.ts: sha256:870682b238fc5e78
  web/lib/docker-provisioner.ts: sha256:7031ea5b5989b605
  web/lib/infra/provider-registry.ts: sha256:2f277b91e01ad848
  web/lib/infra/provider-types.ts: sha256:1c2bbbab19ebed72
  web/lib/infra/setup-scripts.ts: sha256:734de08d4ad1cea4
  web/lib/linux-users.ts: sha256:876a5b300383b411
  web/lib/pm-client.ts: sha256:d7c885e9181d858e
  web/lib/pty-client.ts: sha256:f400eab9f130b288
tags: [infra, docker, pty, config, provisioning, typescript]
created: 2026-04-07T09:41:37.506660
updated: 2026-04-07T09:41:37.506660
status: current
related: []
---

```yaml
---
title: Infrastructure & Configuration
type: component
tags: infra, docker, pty, config, provisioning, typescript
related: []
---

## Overview

This subsystem handles platform infrastructure, configuration resolution, and runtime process management. It provides the foundational services that mentiko builds upon: path resolution, compute provisioning, PTY session isolation, cost tracking, and safety mechanisms.

### Core responsibilities

- **config.ts**: single source of truth for all filesystem paths in the 3-tier hierarchy (global > namespace > org > project)
- **pty-client.ts**: client for pty-manager daemon, the session isolation layer for all agent execution
- **pm-client.ts**: IPC client for process manager, controls supervised processes (pty-mgr, ws-terminal, next.js)
- **circuit-breaker.ts**: prevents runaway scheduled chains via concurrency limits and manual trip/kill-switch
- **compute-store.ts**: tracks VPS uptime and container resource usage for cost aggregation
- **docker-provisioner.ts**: provisions isolated Docker containers as execution environments
- **infra/provider-{registry,types,setup-scripts}.ts**: cloud provider abstraction for Linode/AWS/Azure VPS provisioning
- **linux-users.ts**: creates and manages linux user accounts on tenant VPSes (platform user -> linux user mapping)

---

## Path Resolution (config.ts)

mentiko uses a **3-tier hierarchy** separating code from data. All paths resolve from ONE source of truth - never hardcode paths.

```
global root (~/.mentiko/)
  └── namespaces/{namespaceId}/         ← tier 2: namespace (billing entity)
      └── orgs/{orgId}/                 ← tier 3: org (team/department)
          └── projects/{projectId}/     ← tier 4: project (codebase working dir)
```

### Key functions

- `nsPath(nsId, ...segments)` - resolve under a namespace
- `orgPath(nsId, orgId, ...segments)` - resolve under an org (default org collapses into namespace root)
- `projectPath(...segments)` - resolve under current project
- `globalPath(...segments)` - resolve under global root
- `codePath(...segments)` - resolve under code root (git checkout)

### Path collapse (backward compatibility)

The "default" org and "default" project collapse to avoid unnecessary nesting:
- Default org: `~/.mentiko/namespaces/default/` (not `/orgs/default/`)
- Default project: `{orgRoot}/` directly (not `/projects/{encoded-cwd}/`)

This keeps local dev paths identical to the old flat namespace structure.

### Environment overrides

All paths can be overridden via env vars (MENTIKO_GLOBAL_ROOT, MENTIKO_CODE_ROOT, etc.) - critical for production and containerization.

---

## PTY Session Management (pty-client.ts)

All agent execution happens in isolated PTY sessions managed by the **pty-manager daemon**. The web tier never spawns processes directly - it always goes through this client.

### Daemon communication

Unix socket at `~/.pty-manager/{name}.sock` with JSON-newline protocol:

```json
{"cmd":"spawn","name":"agent-1","args":{"cmd":"claude","args":["run","chain.json"]}}
{"ok":true,"name":"agent-1","pid":12345}
```

### Key methods

- `spawn(name, cmd, args, opts)` - create new PTY session
- `sendKeys(name, text)` - send text + newline
- `sendRaw(name, text)` - send without newline
- `capture(name, lines?)` - get session output
- `alive(name)` - check if session is running
- `list()` - get all sessions with metadata
- `info(name)` - detailed session info (pid, cmd, cwd, exit status)

### Auto-start behavior

If daemon isn't running, `ensureDaemon()` spawns it automatically and polls until ready. The binary location is resolved via `findPtyMgr()` which checks both `lib/pty-manager.mjs` (production) and `bin/pty-mgr` (dev).

### Session caching

`getLiveSessions()` caches alive session names for 3 seconds to avoid repeated daemon queries during hot loops.

---

## Process Manager IPC (pm-client.ts)

The **process manager** (lib/process-manager.ts compiled to .js) supervises critical platform processes: pty-mgr, ws-terminal, and next.js. pm-client is the IPC interface.

### Socket protocol

Unix socket at `~/.mentiko-pm/pm.sock` with request/response pattern:

```typescript
interface IPCRequest {
  id: string;      // random UUID for response correlation
  cmd: string;     // 'status' | 'list' | 'start' | 'stop' | 'remove' | 'restart'
  data?: unknown;  // command-specific payload
}
```

### Key methods

- `status()` - full process info with uptime/restart counts
- `list()` - lightweight process listing (name, status, pid)
- `start(config)` - start a supervised process
- `stop(name)` - stop a process
- `restart(name)` - restart a process
- `remove(name)` - stop and remove from supervision

### Timeout handling

All commands have 5-second timeout. Pending requests are rejected on disconnect with cleanup of timers.

---

## Circuit Breaker (circuit-breaker.ts)

Prevents runaway scheduled chains from consuming all resources. Acts as a safety valve for the scheduler.

### State file

`~/.mentiko/circuit-breaker.json` stores:
- `enabled` - master on/off switch
- `tripped` - manual trip or auto-trip flag
- `maxConcurrentRuns` - concurrency limit (default: 3)
- `activeRuns` - current run count
- `totalRunsToday` - daily run counter

### Key functions

- `canExecute()` - check if new run allowed (returns `{allowed, reason?}`)
- `incrementActiveRuns()` - auto-trips if exceeds max
- `decrementActiveRuns()` - call on run completion
- `tripCircuitBreaker(reason)` - manual trip
- `resetCircuitBreaker()` - clear trip state
- `killSwitch()` - disable entirely (global stop)
- `enableCircuitBreaker()` - re-enable after kill switch

### Auto-trip behavior

If `activeRuns` exceeds `maxConcurrentRuns`, the breaker auto-trips and records the reason. This prevents runaway chains from spawning indefinitely.

---

## Compute Cost Tracking (compute-store.ts)

Tracks VPS/container resource usage and aggregates with token costs for total cost per run/chain.

### Storage structure

```
namespaces/{ns}/compute/
  {workspaceId}/sessions.json    - per-session uptime records
  _run_index.json                - per-run compute aggregates
```

### Pricing model

Hard-coded hourly prices (cents) for common instance types:
- Linode: g6-nanode-1 (0.68¢/hr), g6-standard-1 (1.37¢/hr), etc.
- AWS: t3.micro (1.04¢/hr), t3.small (2.08¢/hr), etc.
- Azure: Standard_B1s (1.04¢/hr), Standard_B2s (4.16¢/hr)
- Docker/local: free (0¢/hr)

### Key functions

- `startComputeSession(ns, org, session)` - record session start
- `endComputeSession(ns, org, workspace, sessionId, markup)` - finalize with cost calculation
- `snapshotComputeSession(...)` - add resource snapshot (CPU%, memory) for container usage
- `getRunComputeSummary(ns, org, runId)` - get compute costs for a run
- `aggregateComputeUsage(ns, org, opts)` - rollup by provider, instance type, day

### Cost calculation

```typescript
costCents = ceil((centsPerHour / 3600) * durationSeconds + markup)
```

Markup percentage is passed at session end (default 0 = pass-through).

---

## Docker Provisioner (docker-provisioner.ts)

Provisions isolated Docker containers as execution environments. Unlike cloud providers, this runs on the local Docker daemon - suitable for self-hosted deployments.

### Naming conventions

- Container: `mentiko-{namespaceId}-{slug}`
- Volume: `mentiko-vol-{namespaceId}-{slug}`
- Network: `mentiko-net-{namespaceId}` (per-namespace bridge)

### Provisioning flow

1. Check Docker availability (`docker info`)
2. Ensure network exists (create if missing)
3. Ensure volume exists (create if missing)
4. Pull image if not present (best-effort)
5. Run container with resource limits (memory, CPU)
6. Bootstrap: install git, curl, jq, nodejs, @anthropic-ai/claude-code

### Key functions

- `provisionContainer(opts)` - create/retrieve container
- `getContainerInfo(ns, name)` - get status, ID, image
- `listMentikoContainers(ns?)` - list all mentiko containers
- `stopContainer(ns, name)` - stop container
- `removeContainer(ns, name, removeVolume)` - stop + remove + optionally delete volume

### Bootstrap script

Runs inside container on first provision:
```bash
apt-get update
apt-get install -y git curl jq build-essential nodejs npm
npm install -g @anthropic-ai/claude-code
mkdir -p /workspace
```

Failure is non-fatal - container runs regardless of whether deps installed.

---

## Cloud Provider Abstraction (infra/)

### provider-types.ts

Defines the `InfraProvider` interface that all cloud providers implement:

```typescript
interface InfraProvider {
  readonly name: string;
  readonly provider: "linode" | "aws" | "hetzner";
  
  provision(opts: ProvisionOptions): Promise<ProvisionedInstance>;
  getStatus(instanceId: string): Promise<ProvisionedInstance>;
  list(): Promise<ProvisionedInstance[]>;
  stop(instanceId: string): Promise<void>;
  terminate(instanceId: string): Promise<void>;
  waitUntilReady(instanceId: string, timeoutMs?): Promise<ProvisionedInstance>;
}
```

### provider-registry.ts

Resolves the configured provider from env vars:
1. Check `LINODE_CLI_TOKEN` or `LINODE_TOKEN`
2. Check `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY`
3. Check Azure credentials (`AZURE_SUBSCRIPTION_ID`, etc.)
4. Return null if none configured

Auto-detects in order: Linode → AWS → Azure (can override with `preferred` param).

### setup-scripts.ts

Generates cloud-init/user-data scripts for new VPS instances. Covers:

- **Security**: SSH hardening (disable password auth, key-only), firewall (ufw), fail2ban
- **Packages**: git, jq, curl, docker, node via nvm
- **Provider-specific optimizations**:
  - Linode: kernel params for network performance
  - AWS: AWS CLI v2, IMDSv2 enforcement
  - Azure: Azure CLI, waagent tuning
- **Mentiko runtime**: CLI installation, environment variables, swap creation

### Generated script sections

Each section is modular and idempotent:
- `ufwSection(ports)` - firewall rules
- `sshHardeningSection(adminUser)` - sshd_config hardening
- `dockerSection()` - Docker install
- `nodeSection(version)` - Node.js via nvm
- `swapSection(mb)` - swap file creation
- `fail2banSection()` - SSH brute force protection
- `mentikoSection(version)` - mentiko CLI install
- Provider-specific optimizations (Linode/AWS/Azure)

---

## Linux User Management (linux-users.ts)

Creates and manages linux user accounts on tenant VPSes. Maps platform users to linux users with:
- `/home/{username}/` with .bashrc
- Membership in `tenants` + `docker` groups
- Interactive terminal access via pty-manager
- SSH access to the VPS

### VPS tier detection

Only active on VPS (NODE_ENV=production, MENTIKO_TIER≠docker). Checks for `/etc/sudoers.d/mentiko-web` which grants www-data limited sudo (useradd, chpasswd, usermod, chown).

### Key functions

- `deriveUsername(email)` - sanitize email to linux username (e.g., "marco@foo.com" → "marco")
- `findUniqueUsername(email)` - handle collisions (marco → marco2 → marco3...)
- `createLinuxUser(email, password)` - create user with home dir, groups, password, .bashrc
- `disableLinuxUser(username)` - lock account (preserve home dir)
- `addSshKey(username, publicKey)` - add SSH public key to authorized_keys
- `removeSshKey(username, fingerprint)` - remove key by fingerprint
- `listSshKeys(username)` - get all SSH keys for user

### SSH key validation

Uses regex to validate key format:
```
/^(ssh-rsa|ssh-ed25519|ecdsa-sha2-nistp256|...)\s+[A-Za-z0-9+/=]+(\s+.*)?$/
```

Computes SHA256 fingerprint matching `ssh-keygen -l` output.

---

## Gotchas & Edge Cases

### config.ts
- **Code root vs data root**: Code root is the git checkout. Data root (~/.mentiko) is NEVER in the git checkout. Don't look for data under `web/data/`.
- **Path collapse**: Default org/project collapse means you can't just concatenate paths - use the helper functions.

### pty-client.ts
- **Daemon must be running**: All commands fail with "daemon not running" if pty-manager isn't up. `ensureDaemon()` auto-starts but has a 5-second timeout.
- **Binary resolution**: Production uses `lib/pty-manager.mjs`, dev uses `bin/pty-mgr`. The client walks up the directory tree to find them.

### circuit-breaker.ts
- **State file corruption**: If JSON is invalid, defaults are used (graceful degradation).
- **Concurrent updates**: No file locking - rapid concurrent updates could race. Use external locking if needed.

### compute-store.ts
- **Session must end before cost calculated**: `costCents` is 0 at start, only set on `endComputeSession()`.
- **Markup applies at session end**: Markup percentage isn't stored with session - only applied during cost calculation.

### docker-provisioner.ts
- **Bootstrap failures are silent**: If bootstrap script fails, container still runs (just without deps). Check logs manually.
- **Image pull is best-effort**: If offline and image not present, provisioning fails on the `docker run` step.

### linux-users.ts
- **Sudo privileges required**: Only works on VPS with `/etc/sudoers.d/mentiko-web`. Returns no-op on non-VPS environments.
- **Password via stdin**: `chpasswd` requires stdin pipe, not command-line arg (security).
- **SSH key deduplication**: Checks key base (algorithm + key data) to avoid duplicates before adding.

---

## Dependencies

- **fs/fs-extra**: Filesystem operations (all modules)
- **path**: Path manipulation (config.ts)
- **net/Socket**: Unix socket communication (pty-client.ts, pm-client.ts)
- **child_process**: Spawning pty-manager daemon, sudo commands (pty-client.ts, linux-users.ts, docker-provisioner.ts)
- **crypto**: UUID generation (pm-client.ts), SSH key fingerprints (linux-users.ts)

No external npm dependencies for core infra - all use Node.js standard library.
```