---
title: "Security Review: Control Plane, Tenants, Webhooks, Terminal, Secrets"
type: security-report
linked_files:
  - web/app/api/git/route.ts
  - web/app/api/fs/search/route.ts
  - web/app/api/conversations/[id]/steer/route.ts
  - web/app/api/chains/run/route.ts
  - lib/chain-runner.mjs
  - web/app/api/terminal/spawn/route.ts
  - web/app/api/terminal/status/route.ts
  - web/app/api/terminal/capture/route.ts
  - web/server/ws-terminal.ts
  - web/app/api/agent-profiles/[id]/resolved-env/route.ts
  - web/lib/secrets-store.ts
  - web/app/api/webhooks/route.ts
  - web/app/api/webhooks/[id]/receive/route.ts
  - web/app/api/secrets/route.ts
  - ../mentiko-control-plane/app/api/admin/platform-status/route.ts
  - ../mentiko-control-plane/lib/infra/platform-deploy.ts
  - ../mentiko-control-plane/app/api/admin/test-provision/route.ts
  - ../mentiko-control-plane/lib/infra/cloud-init.ts
status: current
created: 2026-05-20
updated: 2026-05-20
tags: [security, control-plane, tenant, terminal, webhooks, secrets, dependencies]
---

# Security Review: Control Plane, Tenants, Webhooks, Terminal, Secrets

## Executive read

Mentiko is a dev platform. It is supposed to run commands, open terminals,
execute chains, trigger work from webhooks, and inject secrets into controlled
runtime environments.

That part is not the problem.

The problem is when the platform cannot prove who is allowed to do the powerful
thing, where it is allowed to happen, which workspace owns it, whether the
secret should be visible, or whether a string is data versus shell syntax.

The fix is not to make Mentiko less powerful. The fix is to make the power
explicit, scoped, auditable, and hard to accidentally turn into a tenant
compromise.

## Rule of thumb

Intended dev-platform power:

- owner starts a terminal in an authorized workspace
- agent job receives scoped env vars server-side
- signed webhook triggers a selected chain
- control-plane deploys an allowlisted Mentiko image
- scheduler runs an admin-created raw command with shell:false

Bad boundary:

- any authenticated user can capture another PTY session
- user-controlled values are interpolated into shell strings
- decrypted vault values are returned to browser API clients
- webhook URL alone can trigger execution
- release metadata is trusted as a shell-safe image ref
- deploy key can create infrastructure outside its narrow job

## Findings and why they matter

### 1. Tenant command injection in git, fs search, conversation steer, chain runner

Why this is bad:

These paths are not just "running developer commands." They let request data
shape shell syntax. A file path, cwd, conversation id, or task id can become
part of a command line. That changes the user from "asking Mentiko to do a
supported thing" into "smuggling a second command through the shell."

If intentional:

The intentional capability is command execution. The unintentional capability is
command construction from untrusted strings. Keep command execution, but move to
spawn/execFile argument arrays, strict ids, and authorized cwd resolution.

What happens if we do not fix:

- authenticated tenant users can execute arbitrary commands
- tenant files, auth DBs, workspaces, logs, and secrets can be read or changed
- attacker can install persistence inside the tenant runtime
- later security controls become less useful because the shell is already owned
- a low-trust invite/member account becomes a full tenant compromise path

### 2. Terminal sessions are auth-only, not owner/workspace scoped

Why this is bad:

Terminal sessions are high-trust objects. They contain command history, output,
open processes, working directories, and often secrets. checkAuth proves the
caller is some user. It does not prove the caller owns that session.

If intentional:

Shared terminal collaboration can be intentional, but it needs an explicit
sharing model: owner, org, workspace, session id, allowed users, audit log, and
revocation. "Logged in somewhere in this tenant" is not a collaboration model.

What happens if we do not fix:

- one tenant user can read another user's terminal output
- one user can send input to another running session
- secrets printed by tools or commands leak cross-user
- customer data or code shown in terminals leaks to unrelated members
- debugging becomes dangerous because terminal output is a secret sink

### 3. Terminal spawn accepts arbitrary cwd and injects secrets

Why this is bad:

The spawn endpoint can place the shell in a caller-provided directory and inject
profile/workspace/org secrets into the environment. That combines three sharp
edges: filesystem reach, live shell, and decrypted secrets.

If intentional:

Agents may need secrets to do real work. That should happen in a server-side
job/terminal that is bound to an authorized workspace and a specific profile.
The user should not be able to pick any cwd and receive broad env injection.

What happens if we do not fix:

- users can run shells outside intended workspaces
- env secrets become available to commands, child processes, logs, and history
- accidental commands like env, npm scripts, or debug output leak credentials
- one overbroad terminal becomes enough to exfiltrate third-party API keys

### 4. Profile resolved-env endpoint returns decrypted vault env

Why this is bad:

This turns the secrets store into a plaintext API. Even if the product needs to
resolve secrets for runtime, the browser should usually see names, refs, or
masked values, not decrypted credentials.

If intentional:

If the UI needs to show what is wired, return metadata: key names, source,
scope, missing/present state, and last updated. Keep actual values server-side.

What happens if we do not fix:

- any authenticated org user with a profile id may retrieve secret values
- browser extensions, screenshots, logs, and frontend errors become secret sinks
- vault access cannot be meaningfully audited as "used by job" versus "viewed"
- rotating secrets becomes recurring cleanup instead of rare incident response

### 5. Control-plane trusts platform imageTag then uses it in tenant-host shell

Why this is bad:

Tenant deploy is a supply-chain boundary. If release metadata can choose the
image ref and that ref later reaches a shell, then a compromised metadata path
can become either attacker image deployment or command injection on tenant hosts.

If intentional:

Automated tenant deploys are intentional. The image ref should be restricted to
known Mentiko GHCR repositories and digest/tag formats, then passed safely to
remote commands.

What happens if we do not fix:

- bad build metadata can steer tenants to the wrong image
- a compromised release ingestion path can affect many tenants
- shell metacharacters in image refs become tenant-host execution risk
- rollback and smoke tests may only prove the attacker image booted

### 6. Secretless webhook receivers can trigger chain events

Why this is bad:

Public webhooks are normal. Public unauthenticated execution triggers are not.
If the receive URL alone can trigger chain events, anyone who obtains the URL
can make the tenant spend work, call tools, mutate files, or run automations.

If intentional:

Secretless webhooks can be acceptable for low-impact event capture. Chain
execution needs HMAC, a generated receiver token, or an explicit "public trigger"
mode with rate limits and low-privilege behavior.

What happens if we do not fix:

- leaked URLs become execution tokens
- bots can trigger token spend and noisy job runs
- integrations can be spoofed
- incident response cannot distinguish partner traffic from attacker traffic

### 7. DEPLOY_API_KEY can hit test-provision and create canary infra

Why this is bad:

Deploy keys should have a narrow job. If the same key can create or resume
tenant provisioning, then a leaked CI or local ops key has infra-spend impact.

If intentional:

Canary provisioning is fine, but use a separate key with separate scope,
hardcoded canary constraints, rate limits, and clear audit logs.

What happens if we do not fix:

- leaked deploy key can create compute, DNS, and storage
- attacker can burn money or clutter tenant state
- canary/test flows become production-impacting admin APIs

### 8. Callback/GHCR secrets land in bootstrap, argv, or cron-like surfaces

Why this is bad:

Host-local exposure is lower than public API exposure, but it still matters.
Secrets in files, argv, or cron command lines are visible to more places than a
root-only secret store or stdin-only handoff.

If intentional:

Bootstrap needs temporary secrets. Write root-only env files, pipe tokens over
stdin, remove setup artifacts, and avoid putting secrets in command arguments.

What happens if we do not fix:

- a weaker local foothold can read callback or registry credentials
- process listings can expose GHCR tokens during deploy
- tenant-host cleanup becomes an incident-response dependency

### 9. Plain /api/secrets needs RBAC, not just checkAuth

Why this is bad:

Even if the route does not return plaintext secret values, create/update/delete
is still privileged. A member who can corrupt secrets can break jobs, redirect
external integrations, or make future runs use attacker-controlled credentials.

If intentional:

Secret management belongs to owner/admin or explicit secrets scopes. The newer
ops/org secret routes already show the better pattern.

What happens if we do not fix:

- lower-role users can delete or overwrite operational credentials
- job failures become hard to distinguish from malicious secret tampering
- secret-store audit semantics stay weak

### 10. Dependency advisories are open in production dependency trees

Why this is bad:

Dependency advisories are not all equal, but the current findings touch public
framework, auth, websocket, PDF, email, diagram/rendering, and parser/server
packages. Those are not dead libraries.

If intentional:

Holding a version can be intentional during a release, but it needs an explicit
risk acceptance, compensating control, and upgrade ticket. Right now the audit
result is a fix queue.

What happens if we do not fix:

- known public exploit research stays applicable longer
- framework/auth advisories can bypass middleware or session assumptions
- future incident review will ask why known fixes were deferred

## What is actually okay

Provisioning callback auth looked reasonably strong in static trace. It uses
bearer plus HMAC by default, timestamp skew, signature validation, body
validation, and replay handling. The production env still needs verification
that HMAC has not been disabled.

Scheduling raw_exec also looked better than the terminal paths. It requires
manage_org and uses spawn with shell:false. That is the model: powerful,
explicit, role-gated, and not shell-string based.

Tenant API response sanitization strips core stored tenant secrets. That does
not erase the bootstrap/argv issues, but it means the normal tenant response
path was not the same leak.

## Fix order

1. Remove shell-string command construction in tenant API and runner paths.
2. Add PTY session ownership and workspace/org authorization.
3. Constrain terminal cwd and de-scope secret env injection.
4. Remove or mask the profile resolved-env plaintext endpoint.
5. Require HMAC or receiver token for chain-triggering webhooks.
6. Allowlist platform image refs and pass deploy args safely.
7. Split deploy key from canary provisioning authority.
8. Move bootstrap/deploy secrets out of argv and world-readable artifacts.
9. Gate /api/secrets writes/deletes with manage_org or secrets scopes.
10. Bump prod dependencies and rerun audit, build, and targeted tests.

## Acceptance tests for the fix

- malicious-looking file paths are treated as data, not shell syntax
- taskId rejects characters outside the intended id format
- user A cannot list, capture, attach to, or send input to user B's PTY
- terminal spawn rejects cwd outside an authorized workspace
- resolved-env returns masked values or is no longer public
- chain-triggering webhooks require valid HMAC or receiver token
- platform deploy rejects non-Mentiko image refs and shell metacharacters
- test-provision rejects DEPLOY_API_KEY unless a canary-only key is used
- secrets create/update/delete rejects non-owner/admin/non-scoped users
- npm audit no longer reports the current prod high/critical set
