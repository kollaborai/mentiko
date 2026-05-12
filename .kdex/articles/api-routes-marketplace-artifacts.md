---
title: "API Routes: Marketplace & Artifacts"
type: component
linked_files:
  - web/app/api/marketplace/chains/route.ts
  - web/app/api/marketplace/artifacts/route.ts
  - web/app/api/marketplace/plugins/route.ts
  - web/app/api/marketplace/refresh/route.ts
  - web/app/api/marketplace/sync/route.ts
  - web/app/api/plugins/route.ts
  - web/app/api/artifact-templates/route.ts
  - web/app/api/generation-templates/route.ts
file_hashes:
  web/app/api/artifact-templates/route.ts: sha256:787a58f2c3b10634
  web/app/api/generation-templates/route.ts: sha256:fb51d45e4bbbf9ab
  web/app/api/marketplace/artifacts/route.ts: sha256:26897af62b0f61b1
  web/app/api/marketplace/chains/route.ts: sha256:ff635c4c977e2790
  web/app/api/marketplace/plugins/route.ts: sha256:4bc8527ec4a86a2b
  web/app/api/marketplace/refresh/route.ts: sha256:9bf1a36d54dd7030
  web/app/api/marketplace/sync/route.ts: sha256:136b22571550e625
  web/app/api/plugins/route.ts: sha256:efff219c525002ad
tags: [api, marketplace, plugins, artifacts, templates, routes]
created: 2026-04-07T09:42:59.757714
updated: 2026-04-07T09:42:59.757714
status: current
related: []
---

```yaml
---
title: API Routes: Marketplace & Artifacts
type: component
tags: [api, marketplace, plugins, artifacts, templates, routes]
related: []
---

## overview

These routes handle the marketplace system for sharing chains, agents, plugins, and artifacts, plus org-scoped template management. The marketplace is a git-backed registry at `~/.mentiko/namespaces/{id}/marketplace/` that can be synced from an external GitHub repo.

## key interfaces

### artifact-templates
- `GET /api/artifact-templates` - list all artifact templates
- `POST /api/artifact-templates` - create new template
- valid types: markdown, json, code, patch, csv, text, image

### generation-templates
- `GET /api/generation-templates` - list all generation templates
- `PUT /api/generation-templates` - bulk update templates
- valid IDs: chain_generation, agent_generation, task_generation, chain_recommendation, decision_research, decision_steering, decision_retrospective, agent_edit, webhook_inbound, webhook_outbound, event_trigger

### marketplace
- `GET /api/marketplace/chains` - list marketplace chains (filter by category, source, tag)
- `GET /api/marketplace/artifacts` - list marketplace artifacts (YAML frontmatter + markdown body)
- `GET /api/marketplace/plugins` - list marketplace plugins
- `POST /api/marketplace/refresh` - refresh marketplace cache
- `POST /api/marketplace/sync` - clone/sync marketplace from GitHub (requires `manage_org` permission)

### plugins
- `GET /api/plugins` - list installed org plugins with masked configs (requires `view_chains` permission)

## how it works

### marketplace scanning
All marketplace routes scan the filesystem:
1. base dir = `{globalRoot}/marketplace/{entity}/`
2. recurse directories, parse JSON or YAML+markdown files
3. extract metadata (id, name, description, tags, category)
4. filter by query params (category, source, tag)
5. return filtered list

### artifact parsing
Artifacts use YAML frontmatter format:
```markdown
---
id: example
name: Example Artifact
format: markdown
category: report
tags: [template, output]
description: An example artifact
author: marco
---
# Artifact Body

The actual content goes here.
```

### chain tag extraction
`extractTags()` in chains route auto-generates tags from chain structure:
- 3+ agents → "multi-agent"
- webhooks enabled → "webhooks"
- branches exist → "branching"
- agent roles → "code", "research", "testing", etc.

### plugin config masking
`maskConfig()` hides sensitive plugin config values based on the config schema, returning only safe/visible fields to the UI.

## patterns

- all routes use `withErrorHandling()` wrapper
- auth via `checkAuth()` or `requirePermission()`
- namespace/org isolation via `getNamespaceIdFromRequest()` / `getOrgIdFromRequest()`
- consistent response format: `apiSuccess({ data })`
- filtering via query params (category, source, tag) is consistent across marketplace routes

## gotchas

- marketplace sync requires GitHub URL (https or git@)
- marketplace sync checks for existing non-git directory and throws Conflict unless `force=true`
- artifact templates use POST (create), generation templates use PUT (bulk update)
- artifact template IDs must match regex `^[a-zA-Z0-9_-]+$`
- generation templates use a fixed set of valid IDs (no dynamic creation)

## dependencies

- `@/lib/config` - for globalRoot path resolution
- `@/lib/api-auth` - checkAuth for session validation
- `@/lib/rbac-auth` - requirePermission for scoped access
- `@/lib/namespace-config` - getNamespaceIdFromRequest, getOrgIdFromRequest
- `@/lib/artifact-template-storage` - getArtifactTemplates, saveArtifactTemplates
- `@/lib/generation-template-storage` - getTemplates, saveTemplates
- `@/lib/marketplace-sync` - syncMarketplace function
- `@/lib/plugin-registry` - getPlugins, maskConfig
- `@/lib/plugin-types` - PluginManifest type
- `@/lib/api-errors` - error classes (Unauthorized, BadRequest, Conflict, InternalServerError)
- `@/lib/api-response` - withErrorHandling, apiSuccess
- `js-yaml` - YAML frontmatter parsing for artifacts
- `fs` - filesystem operations for marketplace scanning
```