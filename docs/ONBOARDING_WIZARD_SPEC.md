# Onboarding Wizard Spec


## Flow

```
  welcome -> cli setup -> project setup -> done
```

4 steps. Linear.


## Step 1: Welcome

Same as current. No changes.


## Step 2: CLI Tool Setup

Pick your AI tool, then auth it.

Two auth paths per tool:
  - interactive login (claude auth login, codex auth login, etc)
  - paste an API key

### Pick Your Tool

Cards for each supported CLI:

  - claude code (anthropic)
  - codex (openai)
  - aider (open source)
  - antigravity cli (google)

Click a card -> goes to that tool's auth screen.
Once configured, card shows checkmark.
[next] appears when >= 1 tool configured.
"you can add more later in settings" at the bottom.

### Auth Screen (per tool)

Each tool gets the same two-option layout:

  option A: interactive login
    - runs `claude auth login` (or codex/antigravity equivalent)
    - opens browser for oauth
    - backend runs CLI in PTY, captures auth URL
    - frontend shows status: waiting... -> signed in
    - no API key needed, CLI manages its own token

  option B: API key
    - paste key into masked input
    - stored in secrets vault (uses existing secrets-store.ts)
    - validated inline (quick API call to check key works)
    - link to "get a key at console.anthropic.com/keys"

  claude also gets option C: custom gateway / proxy
    - base URL + auth token
    - for corporate proxies, openrouter, litellm

  model dropdown at the bottom:
    - claude-sonnet-4 (default), claude-opus-4, claude-haiku-4
    - saved to workspace model config

  aider is different -- no own auth, uses provider keys.
  if user already configured claude with API key, offer to
  reuse the same ANTHROPIC_API_KEY.

On [save]:
  - store credentials in secrets vault
  - mark tool as configured
  - return to tool picker with checkmark on that tool


## Step 3: Project Setup

### Pick How

Cards:
  - clone a git repository
  - use an existing folder
  - start from scratch
  - upload a zip

More options (text links below cards):
  - SSH remote
  - Docker container

### Clone a Git Repository

```
  repository URL
  [https://github.com/user/repo.git       ]

  visibility
  ( ) public
  ( ) private

  {if private: inline secrets panel}
  +-----------------------------------------+
  | this repo needs credentials.            |
  | add a secret to authenticate:           |
  |                                         |
  | [quick presets: GitHub Token]           |
  |                                         |
  | label:    [GitHub Token            ]    |
  | env var:  [GITHUB_TOKEN            ]    |
  | value:    [ghp_...                 ]    |
  |                                         |
  | [save secret]                           |
  +-----------------------------------------+
  ^ this is the existing secrets dialog     ^
  ^ from settings/secrets/page.tsx, reused  ^

  clone into
  [~/dev                          ] [browse]

  branch (optional)
  [                                        ]

  workspace name
  [repo-name              ] (auto-filled)
```

Key point: when user selects "private", the existing secrets
create dialog opens inline (not as a modal -- embedded in the
form). It already has the GitHub Token preset. User fills it
in, saves, and the clone uses that token.

This is the EXISTING component from settings/secrets/page.tsx.
We extract the dialog form into a reusable component:

  web/components/secrets/secret-form.tsx

That component is used by:
  1. settings/secrets/page.tsx (existing, in a Dialog)
  2. onboarding git clone step (inline panel, not dialog)

The preset pills (Anthropic, OpenAI, Google, GitHub, Custom)
are already built. The form fields (label, env var, value,
description) are already built. We just lift them out.

Workspace name auto-fills from repo URL.

### Use an Existing Folder

Folder browser as primary UI (not a toggle).
Name auto-fills from folder name.

### Start From Scratch

Only case where name is typed.
Name input + parent dir browser.
Optional template picker (empty, marketplace).

### Upload a Zip

Drag-and-drop zone + browse button.
Extract to a target dir.
Name from zip filename.

### SSH Remote (under more options)

Host, username, port, remote path, SSH key picker.
Test connection button.
Name from last path segment.

### Docker (under more options)

Dropdown of running containers (from docker ps).
Or create new from image.
Working dir, user.
Name from container name.


## Step 4: Done

Summary of what was configured:
  - ai tool: claude code (signed in)
  - model: claude-sonnet-4
  - workspace: mentiko
  - source: cloned from github

Skipped items omitted.

Links: go to dashboard, chains, agents, settings.


## What Gets Reused (existing code)

secrets dialog form
  FROM: web/app/settings/secrets/page.tsx (lines 243-332)
  EXTRACT TO: web/components/secrets/secret-form.tsx
  USED IN: settings secrets page (in Dialog) + onboarding git clone (inline)
  includes: preset pills, label/envvar/value/desc fields, save handler
  already has: ANTHROPIC_AUTH_TOKEN, OPENAI_API_KEY, GOOGLE_API_KEY,
               GITHUB_TOKEN presets

secrets store
  AS-IS: web/lib/secrets-store.ts
  no changes needed. createSecret/listSecrets/getSecretsEnvVars all work.

folder browser
  AS-IS: web/components/workspace/folder-browser.tsx
  used in: existing folder, clone parent dir, start from scratch parent dir

git clone API
  FROM: web/app/api/fs/git-clone/route.ts
  MODIFY: add auth field (public/pat/ssh), token field, sshKeyId, branch
  clone command becomes: git clone --depth 1 -b <branch> https://<token>@...

workspace API
  FROM: web/app/api/workspaces/route.ts
  MODIFY: add execution.ssh, execution.docker, model, project.branch fields


## New API Endpoints

```
GET  /api/system/detect-cli
  -> { tools: [{ name, found, version?, path?, authenticated? }] }

POST /api/system/cli-auth
  body: { tool: "claude" | "codex" | "antigravity" }
  -> { sessionId }
  (triggers interactive login in PTY)

GET  /api/system/cli-auth/{sessionId}/status
  -> { status: "pending" | "complete" | "failed", user?, error? }

POST /api/fs/upload
  body: FormData { file, extractTo }
  -> { path, name, fileCount }

POST /api/workspaces/{id}/test-connection
  body: { type: "ssh" | "docker", ...config }
  -> { ok, error?, latency? }

GET  /api/docker/containers
  -> { containers: [{ id, name, image, status }] }

POST /api/docker/create
  body: { image, name?, workdir? }
  -> { id, name, status }

POST /api/ssh-keys/generate
  body: { name }
  -> { id, publicKey, fingerprint }

GET  /api/ssh-keys
  -> { keys: [{ id, name, publicKey, fingerprint }] }
```


## Component Structure

```
web/components/secrets/
  secret-form.tsx               EXTRACTED from settings/secrets
                                (preset pills, form fields, save)

web/components/onboarding/
  welcome-wizard.tsx            step state machine + animation
  steps/
    welcome-step.tsx            step 1: hero
    cli-setup-step.tsx          step 2: tool picker + auth
    project-setup-step.tsx      step 3: method picker + sub-forms
    done-step.tsx               step 4: summary
  cli-auth/
    claude-auth.tsx             login vs key vs gateway
    codex-auth.tsx              login vs key
    aider-auth.tsx              provider key (reuse existing)
    antigravity-auth.tsx        login vs key
  project-setup/
    git-clone-setup.tsx         clone + inline secret-form for private
    local-folder-setup.tsx      folder browser (existing component)
    new-project-setup.tsx       name + template
    upload-setup.tsx            drag & drop
    ssh-setup.tsx               host/user/port/key
    docker-setup.tsx            container picker
```


## State

```typescript
interface WizardState {
  step: "welcome" | "cli-setup" | "project-setup" | "done"
  configuredTools: Array<{
    tool: string
    authMethod: "login" | "api-key" | "gateway"
    model?: string
  }>
  projectMethod?: "git" | "local" | "fresh" | "upload" | "ssh" | "docker"
  workspaceId?: string
  workspaceName?: string
  workspacePath?: string
}
```

Each sub-component owns its own form state.
Wizard only stores the results (what tool, what workspace).
localStorage persists step + state between refreshes.
Cleared on "go to dashboard."
