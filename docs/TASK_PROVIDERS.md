# task providers

connect mentiko to external task trackers (Linear, Notion, etc).

## setup

1. go to workspace settings
2. select task provider type (Linear, Notion, Jira, etc)
3. enter credentials using secret references

## credential storage

credentials use the `{secret:NAME}` pattern — never stored in plain text.

  workspace config (workspaces.json):
    taskProvider:
      type: "linear"
      credentials:
        api_key: "{secret:workspace-myws-linear-api_key}"
        team_id: "TEAM-123"

  encrypted secrets (namespaces/{ns}/orgs/{org}/secrets/):
    each secret is AES-256-GCM encrypted
    key derived from BETTER_AUTH_SECRET env var
    file permissions: 0o600 (owner only)

## migration from plain text

if workspace has plain-text credentials, the UI shows a migration banner:

  1. detects plain text values (not matching `{secret:...}` pattern)
  2. offers bulk migration button
  3. for each field: creates encrypted secret, updates workspace config
  4. original plain text values are replaced with references

to migrate manually via API:
  POST /api/secrets
    { "name": "workspace-{id}-linear-api_key", "envVar": "LINEAR_API_KEY", "value": "lin_api_..." }

  PUT /api/workspaces/{id}/task-provider
    { "type": "linear", "credentials": { "api_key": "{secret:workspace-{id}-linear-api_key}" } }

## runtime resolution

when the system needs actual credentials (e.g. ping test, task sync):

  createTaskProvider(config, nsId, orgId)
    -> resolveSecretReferences(config.credentials, nsId, orgId)
    -> for each {secret:NAME}: decrypt via secrets-store.ts
    -> pass plaintext to provider constructor

credentials never appear in:
  - API responses (masked as "........")
  - terminal output (sanitize-output.ts strips them)
  - log files
  - temp files (agent-profile.sh sources + deletes immediately)

## API endpoints

  GET  /api/workspaces/{id}/task-provider     config + masked creds
  PUT  /api/workspaces/{id}/task-provider     save config (merges masked values)
  POST /api/workspaces/{id}/task-provider     ping test (resolves secrets server-side)

  GET  /api/secrets                           list all secrets (no plaintext)
  POST /api/secrets                           create/update encrypted secret
  DELETE /api/secrets?id={id}                 delete (blocked if in use)

## troubleshooting

  error: "Secret not found: workspace-xxx-linear-api_key"
    -> secret was deleted or name doesn't match workspace config
    -> fix: recreate via POST /api/secrets or re-migrate in UI

  error: "Failed to decrypt secret"
    -> BETTER_AUTH_SECRET changed since secret was created
    -> fix: re-create all secrets with current key

  error: "Task provider ping failed"
    -> credentials resolved but API rejected them
    -> check: is the API key valid? is the team_id correct?
    -> test: curl the provider API directly with the key

  credentials showing as "........" in UI
    -> this is correct. masked values are never sent to the client.
    -> the {secret:NAME} reference is preserved internally.

## supported providers

  linear:    api_key (secret), team_id (string)
  notion:    api_key (secret), database_id (string)
  jira:      api_token (secret), email (string), domain (string), project_key (string)
  github:    token (secret), owner (string), repo (string)
  native:    built-in sqlite task store (no credentials needed, default provider)

## files

  web/lib/task-provider/index.ts           factory + secret resolution
  web/lib/task-provider/types.ts           TASK_PROVIDER_META field definitions
  web/lib/secrets-store.ts                 encrypted storage + resolution
  web/lib/workspace-storage.ts             workspace config (holds references)
  web/components/workspace/workspace-settings.tsx  UI + migration
  web/app/api/workspaces/[id]/task-provider/route.ts  API endpoints
  web/app/api/secrets/route.ts             secrets CRUD
  bin/secrets-resolve.mjs                  bash-side secret decryption
