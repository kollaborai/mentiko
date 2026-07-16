# Authoring Mentiko MCP tools

How to add or enrich a tool in the `mentiko` MCP bridge. Read this before
touching `tools.ts` — the schema is only one of four layers, and there is a
build-and-respawn step that trips everyone up the first time.

## TL;DR

1. **Schema** — add/enrich the `Tool` in `tools.ts` (`ALL_TOOLS`). Add the name
   to `BAR_TOOL_NAMES` only if the floating agent bar should expose it.
2. **Dispatch** — add an `if (name === "…")` branch in `server.ts`. For a write,
   call `checkPermission` first and add the name to `TIER_B` or `TIER_C`.
3. **Handler** — add a function in `handlers/<domain>.ts` that calls the
   ops-client (`opsGet` / `opsPost` / `opsPatch` / `opsDelete`).
4. **Platform op** — add/extend the route under
   `web/app/api/mentiko-mcp/ops/<domain>/route.ts`: `requireOpsAuth` →
   (writes) `requireOpsPermission` → call the `lib/**` store. Identity lives on
   `ctx` — use it for owner/author, never a client-supplied value.
5. **Build + respawn** — `npm run typecheck && npm run build`, then have the MCP
   host **respawn** the subprocess (see "Loading changes"). Route-only changes
   hot-reload in the dev server; bridge changes do not.

## Architecture: three layers + the platform

```
 Claude Code / Claude Desktop / floating bar
        │  (stdio, MCP protocol)
        ▼
 server.ts          dispatch + permission tiers + result formatting
        │  calls
        ▼
 handlers/*.ts      thin functions: opsGet/opsPost/opsPatch/opsDelete
        │  HTTP (Bearer session JWT, self-healing on 401)
        ▼
 web/app/api/mentiko-mcp/ops/**   requireOpsAuth + requireOpsPermission
        │  calls
        ▼
 lib/** stores      the real work (e.g. web/lib/tasks/task-store.ts)
```

- **`tools.ts`** — the tool catalog. `ALL_TOOLS: Tool[]` holds every
  name/description/`inputSchema`. `BAR_TOOL_NAMES` is the allowlist for the
  reduced "bar" scope. The bottom of the file exports the scope-filtered list.
- **`server.ts`** — one big `CallToolRequestSchema` handler: an `if (name ===
  "…")` chain. Helpers: `textResult(text)`, `errorResult(msg)`,
  `checkPermission(name, args)`, `dispatchEffect(effect, payload)` (bar-mode UI
  nudges like `navigate`). Permission tiers `TIER_B` / `TIER_C` live near the top.
- **`handlers/*.ts`** — grouped by domain (`tasks.ts`, `chains.ts`, …). Each
  function just shapes a call to the ops-client. No business logic here.
- **`handlers/ops-client.ts`** — the HTTP client for `/api/mentiko-mcp/ops/*`.
  Bearer token precedence: explicit `MENTIKO_SESSION_TOKEN` (including a
  runner-injected token) > typed validated sidecar
  (`~/.mentiko/mcp/session.json`). On 401 it still auto-refreshes from the
  sidecar, device flow, or engine and retries once.
- **`web/app/api/mentiko-mcp/ops/**`** — the platform side. This is where auth,
  permission, workspace authorization, and the actual store calls happen. The
  bridge is a dumb pipe; the ops route is the trust boundary.

## Step 1 — schema (`tools.ts`)

Add an object to `ALL_TOOLS`:

```ts
{
  name: "comment_task",
  description: "Add a comment to a task. Author is the authenticated MCP user.",
  inputSchema: {
    type: "object",
    properties: {
      id:   { type: "string", description: "Task id to comment on." },
      text: { type: "string", description: "Comment body." },
    },
    required: ["id", "text"],
  },
},
```

Write descriptions for a model, not a human: say what defaults are, what an
argument accepts (e.g. "a user id/name OR a chain id/name"), and cross-reference
sibling tools. Add the name to `BAR_TOOL_NAMES` **only** if the floating agent
bar should be able to call it.

## Step 2 — dispatch (`server.ts`)

```ts
if (name === "comment_task") {
  const { allowed } = await checkPermission(name, args);
  if (!allowed) return textResult("Permission denied by user.");
  await tasks.commentTask(args.id, args.text);
  return textResult(`Comment added to ${args.id}.`);
}
```

- **Reads** return `textResult(JSON.stringify(result, null, 2))` and skip
  `checkPermission`.
- **Writes** call `checkPermission(name, args)` first, and the name must be in a
  tier (below) or the check is a no-op.
- Let ops-client errors propagate — `server.ts` wraps them and converts auth
  failures (401 / "session auth required") into a friendly "run `reconnect`"
  message via `isAuthFailure` / `authRecoveryResult`.

### Permission tiers

`checkPermission` gates by tier:

- **`TIER_B`** — moderate writes (`create_task`, `update_task`, `comment_task`,
  `write_file`, …).
- **`TIER_C`** — destructive/expensive (`delete_chain`, `start_run`,
  `create_secret`, `run_task_chain`, …).
- **untiered** — reads and safe ops: always allowed.

The prompt only fires in **application/bar mode** (signalled by
`MENTIKO_INBOX_KEY`, injected when the Mentiko app launches the bar). Under a
standard host (Claude Code, Desktop, CI) `checkPermission` returns `allowed`
immediately, because the host already obtained the user's approval before
invoking the tool — re-gating there would be double-gating. Still assign the
right tier so bar mode behaves.

## Step 3 — handler (`handlers/<domain>.ts`)

```ts
export async function commentTask(id: string, text: string) {
  return await opsPost("/api/mentiko-mcp/ops/tasks/comment", { id, text });
}
```

`opsGet(path, query?)`, `opsPost(path, body)`, `opsPatch(path, body)`,
`opsDelete(path, query?)`. Keep handlers logic-free; put validation and
identity handling in the ops route.

## Step 4 — platform op (`web/app/api/mentiko-mcp/ops/**`)

```ts
export async function POST(req: Request) {
  const ctx = await requireOpsAuth(req);
  if (ctx instanceof NextResponse) return ctx;              // 401
  const perm = requireOpsPermission(ctx, "manage_tasks", "tasks:write");
  if (perm) return perm;                                    // 403

  const { namespaceId, orgId } = ctx;
  const { id, text } = (await req.json()) as { id?: string; text?: string };
  if (!id || !text?.trim()) return new NextResponse("id and text required", { status: 400 });

  // Identity comes from the token, never the client body.
  taskAddComment(orgId, id, ctx.userId, text, namespaceId);
  return NextResponse.json({ ok: true, id });
}
```

- **`requireOpsAuth(req)`** → `OpsContext { userId, orgId, namespaceId, role,
  scopes }` (from the session JWT) or a `NextResponse` to return.
- **`requireOpsPermission(ctx, action, scope?)`** → `null` if allowed, else a
  403 `NextResponse`. Passes if the token has the `scope` (e.g. `tasks:write`)
  or `ops:*`, **or** the `role` can perform `action` (e.g. `manage_tasks`). Gate
  every write; reads can use `requireOpsAuth` alone.
- **Identity rule:** owner / author / actor come from `ctx.userId`. Accept an
  explicit override in the body only as `owner ?? ctx.userId`, never as the sole
  source. This is how "the authenticated MCP user owns the task" works.
- If the op takes a `workspacePath`, authorize it with
  `resolveAuthorizedWorkspacePath(namespaceId, orgId, path, ctx.userId)` before
  trusting it.

## Scope filter (bar vs full)

The tail of `tools.ts`:

```ts
process.env.MENTIKO_MCP_TOOL_SCOPE === "bar"
  ? ALL_TOOLS.filter((t) => BAR_TOOL_NAMES.has(t.name))   // floating bar: reduced set
  : ALL_TOOLS                                             // Claude Code etc.: everything
```

Claude Code gets the full set — a new tool in `ALL_TOOLS` is enough. Only touch
`BAR_TOOL_NAMES` for the bar.

## Loading changes (the gotcha)

- **Typecheck** — `npm run typecheck` (`tsc --noEmit`). The build uses **esbuild,
  which does NOT type-check**, so a broken type ships silently without this step.
- **Build** — `npm run build` → bundles to `dist/server.js`. `dist/` is
  gitignored (build artifact; the tenant image pipeline rebuilds it for prod).
- **Load** — the host launches the bridge **once**:
  `node …/lib/mentiko-mcp/dist/server.js`. New tools and schema changes appear
  only after the host **respawns** that subprocess: in Claude Code, `/mcp` →
  `mentiko` → reconnect, or restart the CLI.
  - The **`reconnect` tool refreshes AUTH only** — it does NOT reload code or
    re-list tools. Rebuilding without a respawn = you keep calling the old bundle.
- **Route-only changes** (`web/app/api/mentiko-mcp/ops/**`) hot-reload in the dev
  server — no rebuild, no respawn.

## Testing

Two independent halves:

- **Server half — no respawn needed.** Curl the ops route with the sidecar token;
  this exercises the exact code the tool will call.

  ```bash
  # Supply an explicit temporary test token. Do not parse the sidecar outside
  # handlers/session-store.ts; it owns validation and credential reads.
  TOKEN="${MENTIKO_SESSION_TOKEN:?set a temporary MCP test token}"
  H=(-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")
  BASE=http://127.0.0.1:3000/api/mentiko-mcp/ops
  curl -s "${H[@]}" -X POST "$BASE/tasks/comment" -d '{"id":"TASK-1","text":"hi"}'
  ```

  (zsh does not word-split — build header lists as arrays, not a bare `$VAR`.)

- **Full stack — after respawn.** Reconnect the MCP, then call the tool in-session.

## Reference implementation: the task tools

The task surface is the worked example of every step above:

- schema + bar names: `tools.ts` (`create_task` … `remove_task_dependency`)
- dispatch + tiers: `server.ts` (`TIER_B`, the `create_task`/`get_task`/… branches)
- handlers: `handlers/tasks.ts`
- ops routes: `web/app/api/mentiko-mcp/ops/tasks/{route,comment,deps}.ts`
- store: `web/lib/tasks/task-store.ts`

## File map

| Layer | File |
| --- | --- |
| Tool catalog / schemas / bar scope | `tools.ts` |
| Dispatch, permission tiers, result helpers | `server.ts` |
| Domain handlers | `handlers/<domain>.ts` |
| HTTP client to the platform | `handlers/ops-client.ts` |
| Session token / device-flow reconnect | `handlers/session-store.ts`, `handlers/auth.ts` |
| Platform ops endpoints | `web/app/api/mentiko-mcp/ops/**` |
| Ops auth + permission | `web/lib/ai-engine/mentiko-mcp-ops-auth.ts` |
