# api route auth coverage (as of 2026-07-28)

## summary
- total routes: 358
- authenticated: 342   (doc mechanically matches disk via scripts/check-auth-coverage.mjs)
- public-by-design: 17
- unclear (needs human review): 0
- likely bug (probably accidentally public): 0

## CI gate

A GitHub Actions workflow (.github/workflows/auth-coverage.yml) runs on
every PR that touches `web/app/api/**/route.ts` or this doc. It calls
`scripts/check-auth-coverage.mjs`, which enumerates every route file
and fails CI if any is missing from this document.

Run locally:

```
node scripts/check-auth-coverage.mjs            # CI mode (exit 1 on drift)
node scripts/check-auth-coverage.mjs --report   # report-only (exit 0)
```

When you add a new route, pick a category (authenticated, public-by-design,
unclear, likely bug) and add an entry under the matching heading.

## authenticated

Routes with explicit auth checks via `checkAuth`, `getServerSession`, `requirePermission`, `getSessionUser`, `checkOpsAuth`, or `BETTER_AUTH_SECRET` bearer token verification:

- activity/route.ts
- account/finish-password-setup/route.ts
- account/mcp-tokens/[id]/route.ts
- account/mcp-tokens/route.ts
- ai-gateway/local/v1/chat/completions/route.ts
- agent-health/route.ts
- agent-profiles/[id]/resolved-env/route.ts
- agent-profiles/[id]/route.ts
- agent-profiles/[id]/test-session/route.ts
- agent-profiles/[id]/test/route.ts
- agent-profiles/bundles/route.ts
- agent-profiles/install-bundle/route.ts
- agent-profiles/route.ts
- agents/[session]/message/route.ts
- agents/[session]/output/route.ts
- agents/[session]/route.ts
- agents/marketplace/[id]/install/route.ts
- agents/marketplace/[id]/rate/route.ts
- agents/marketplace/install/route.ts
- agents/marketplace/route.ts
- agents/registry/edit/route.ts
- agents/registry/generate/route.ts
- agents/registry/scan/route.ts
- agents/resume/route.ts
- agents/route.ts
- agents/registry/[id]/route.ts
- agents/registry/import/route.ts
- agents/registry/route.ts
- agents/registry/save/route.ts
- approvals/[id]/route.ts
- approvals/route.ts
- artifact-templates/[id]/route.ts
- artifact-templates/generate/route.ts
- artifact-templates/route.ts
- audit/explain/route.ts
- audit/route.ts
- auth/[...all]/route.ts
- chains/[id]/breakpoints/route.ts
- chains/[id]/debug/route.ts
- chains/[id]/debug/state/route.ts
- chains/[id]/duplicate/route.ts
- chains/[id]/git/branches/route.ts
- chains/[id]/git/commit/route.ts
- chains/[id]/git/diff/route.ts
- chains/[id]/git/history/route.ts
- chains/[id]/git/init/route.ts
- chains/[id]/git/merge/route.ts
- chains/[id]/git/revert/route.ts
- chains/[id]/git/status/route.ts
- chains/[id]/publish/route.ts
- chains/[id]/route.ts
- chains/[id]/versions/[version]/route.ts
- chains/[id]/versions/diff/route.ts
- chains/[id]/versions/restore/route.ts
- chains/[id]/versions/route.ts
- chains/[id]/webhooks/route.ts
- chains/import/route.ts
- chains/list/route.ts
- chains/recommend/route.ts
- chains/run-batch/route.ts
- chains/run/route.ts
- chains/save/route.ts
- chains/seed-sample/route.ts
- chains/status/route.ts
- chains/validate/route.ts
- chain-triggers/route.ts
- code/tasks-db/route.ts
- config/route.ts
- conversations/[id]/route.ts
- conversations/[id]/steer/route.ts
- conversations/find-by-agent/route.ts
- conversations/route.ts
- decisions/[id]/guided/answer/route.ts
- decisions/[id]/guided/options/route.ts
- decisions/[id]/guided/plan/route.ts
- decisions/[id]/guided/questions/route.ts
- decisions/[id]/guided/synthesize/route.ts
- decisions/[id]/import/route.ts
- decisions/[id]/research/route.ts
- decisions/[id]/resolve/route.ts
- decisions/[id]/retrospective/route.ts
- decisions/[id]/route.ts
- data-shapes/route.ts
- decisions/route.ts
- gdpr/delete/route.ts
- gdpr/export/route.ts
- email/inboxes/route.ts
- email/inboxes/[id]/route.ts
- email/inboxes/[id]/messages/route.ts
- email/inboxes/[id]/messages/[messageId]/move/route.ts
- email/poll/route.ts
- email/process/route.ts
- email/quota/route.ts
- email/reputation/route.ts
- email/reputation/history/route.ts
- email/secret/rotate/route.ts
- email/send/route.ts
- email/smtp-status/route.ts
- email/smtp-test/route.ts
- email/suppressed/route.ts
- email/suppressed/resubscribe/route.ts
- events/emit/route.ts
- events/registry/route.ts
- events/route.ts
- events/stream/route.ts
- events/triggers/generate/route.ts
- export/route.ts
- fs/browse/route.ts
- fs/create/route.ts
- fs/delete/route.ts
- fs/file/route.ts
- fs/git-clone/route.ts
- fs/git-status/route.ts
- fs/mkdir/route.ts
- fs/rename/route.ts
- fs/search/route.ts
- fs/tree/route.ts
- fs/upload/route.ts
- generation-templates/route.ts
- generation-templates/test/route.ts
- git/route.ts
- health/route.ts
- integrations/save/route.ts
- integrations/test/route.ts
- invite/[token]/route.ts
- jobs/[id]/route.ts
- jobs/[id]/status/route.ts
- jobs/route.ts
- kollabor/engine/[...path]/route.ts
- kollabor/engine/sessions/[id]/refresh-token/route.ts
- jobs/[id]/complete/route.ts
- kollabor/profiles/active/route.ts
- kollabor/profiles/save/route.ts
- kollabor/setup/mentiko/route.ts
- links/generate/route.ts
- links/generate/apply/route.ts
- links/list/route.ts
- links/run/route.ts
- links/runs/[runId]/escalate/route.ts
- links/runs/[runId]/escalations/route.ts
- links/runs/[runId]/generate-summary/route.ts
- links/runs/[runId]/moderator/route.ts
- links/runs/[runId]/reply/route.ts
- links/runs/[runId]/stop/route.ts
- links/runs/[runId]/summary/route.ts
- links/runs/[runId]/transcript/route.ts
- links/save/route.ts
- links/[id]/route.ts
- marketplace/artifacts/[id]/route.ts
- marketplace/artifacts/route.ts
- marketplace/chains/route.ts
- marketplace/plugins/route.ts
- marketplace/sync/route.ts
- meetings/route.ts
- meetings/[id]/transcript/route.ts
- mentiko-mcp/auth/device/approve/route.ts
- mentiko-mcp/auth/device/info/route.ts
- mentiko-mcp/current-page/route.ts
- mentiko-mcp/dispatch/route.ts
- mentiko-mcp/ops/agents/route.ts
- mentiko-mcp/ops/applications/route.ts
- mentiko-mcp/ops/chains/route.ts
- mentiko-mcp/ops/context/activity/route.ts
- mentiko-mcp/ops/context/route.ts
- mentiko-mcp/ops/context/runs/route.ts
- mentiko-mcp/ops/context/runs/cancel/route.ts
- mentiko-mcp/ops/context/user/route.ts
- mentiko-mcp/ops/context/workspace/route.ts
- mentiko-mcp/ops/context/workspaces/route.ts
- mentiko-mcp/ops/decisions/answer/route.ts
- mentiko-mcp/ops/decisions/approve/route.ts
- mentiko-mcp/ops/decisions/route.ts
- mentiko-mcp/ops/decisions/select/route.ts
- mentiko-mcp/ops/files/route.ts
- mentiko-mcp/ops/fs/route.ts
- mentiko-mcp/ops/jobs/[id]/route.ts
- mentiko-mcp/ops/meta/docs/route.ts
- mentiko-mcp/ops/meta/nav/route.ts
- mentiko-mcp/ops/meta/settings/route.ts
- mentiko-mcp/ops/monitor/status/route.ts
- mentiko-mcp/ops/notifications/prefs/route.ts
- mentiko-mcp/ops/notify/route.ts
- mentiko-mcp/ops/runtime/route.ts
- mentiko-mcp/ops/schedules/route.ts
- mentiko-mcp/ops/schedules/run/route.ts
- mentiko-mcp/ops/secrets/route.ts
- mentiko-mcp/ops/system/cli-auth/route.ts
- mentiko-mcp/ops/system/cli-status/route.ts
- mentiko-mcp/ops/tasks/generate/route.ts
- mentiko-mcp/ops/tasks/run-chain/route.ts
- mentiko-mcp/ops/tasks/comment/route.ts
- mentiko-mcp/ops/tasks/deps/route.ts
- mentiko-mcp/ops/tasks/route.ts
- mentiko-mcp/ops/templates/route.ts
- mentiko-mcp/ops/terminal/route.ts
- mentiko-mcp/reply/route.ts
- mentiko-mcp/stream/route.ts
- metrics/route.ts
- metrics/endpoints/route.ts
- monitor/prompts/route.ts
- monitor/status/route.ts
- notifications/[id]/route.ts
- notifications/dispatch/route.ts
- notifications/preferences/route.ts
- notifications/route.ts
- operations/timeline/route.ts
- orgs/[id]/invite/route.ts
- orgs/[id]/invites/[inviteId]/route.ts
- orgs/[id]/invites/route.ts
- orgs/[id]/join/route.ts
- orgs/[id]/marketplace/route.ts
- orgs/[id]/members/[userId]/route.ts
- orgs/[id]/members/route.ts
- orgs/[id]/route.ts
- orgs/[id]/shared/chains/route.ts
- orgs/[id]/shared/profiles/route.ts
- orgs/[id]/shared/secrets/route.ts
- orgs/[id]/stats/route.ts
- orgs/route.ts
- performance/route.ts
- plugins/[id]/route.ts
- plugins/route.ts
- preview/[port]/[[...path]]/route.ts
- profiles/route.ts
- prometheus/route.ts
- pty/sessions/[name]/route.ts
- pty/sessions/[name]/send/route.ts
- pty/sessions/route.ts
- retry/circuit/route.ts
- retry/config/route.ts
- retry/state/route.ts
- reviews/[id]/assignments/[assignmentId]/route.ts
- reviews/[id]/assignments/route.ts
- reviews/[id]/comments/[commentId]/route.ts
- reviews/[id]/comments/route.ts
- reviews/[id]/route.ts
- reviews/route.ts
- runs/[id]/agents/[agentId]/activity/route.ts
- runs/[id]/agents/[agentId]/heartbeat/route.ts
- runs/[id]/approve/route.ts
- runs/[id]/cost/route.ts
- runs/[id]/artifacts/route.ts
- runs/[id]/event-artifacts/[executionId]/apply/route.ts
- runs/[id]/event-artifacts/route.ts
- runs/[id]/output/route.ts
- runs/[id]/resume/route.ts
- runs/[id]/route.ts
- runs/[id]/status/route.ts
- runs/[id]/stop/route.ts
- runs/compare/route.ts
- runs/pinned/route.ts
- runs/reconcile/route.ts
- runs/route.ts
- runs/status/route.ts
- runtime-env/route.ts
- schedules/circuit-breaker/route.ts
- schedules/daemon/route.ts
- schedules/history/route.ts
- schedules/next/route.ts
- schedules/route.ts
- schedules/run/route.ts
- schedules/snooze/route.ts
- search/route.ts
- secrets/route.ts
- secrets/rotate/route.ts
- seed/route.ts
- sessions/[name]/recording/route.ts
- settings/decisions/core-chains/route.ts
- settings/data/route.ts
- settings/notifications/route.ts
- setup/route.ts
- ssh-keys/route.ts
- system/ai-gateway/route.ts
- system/cli-auth/route.ts
- system/codex-token/route.ts
- system/detect-cli/route.ts
- system/logs/route.ts
- system/settings/route.ts
- system/storage-scope/route.ts
- system/stop-all/route.ts
- system/viewport/route.ts
- system/web-proxy/route.ts
- tasks/[id]/attempts/route.ts
- tasks/[id]/auto-run/route.ts
- tasks/[id]/close/route.ts
- tasks/[id]/comments/route.ts
- tasks/[id]/deps/route.ts
- tasks/[id]/outcome-summary/route.ts
- tasks/[id]/route.ts
- tasks/[id]/run-chain/route.ts
- tasks/activity/route.ts
- tasks/auto-run/route.ts
- tasks/bulk/route.ts
- tasks/create/route.ts
- tasks/decision-plan-recovery/route.ts
- tasks/decision-plan-regeneration/route.ts
- tasks/deps/route.ts
- tasks/epics/route.ts
- tasks/generate/route.ts
- tasks/graph/route.ts
- tasks/reconcile/route.ts
- tasks/route.ts
- templates/[id]/chain/route.ts
- templates/[id]/rate/route.ts
- templates/[id]/readme/route.ts
- templates/[id]/use/route.ts
- templates/list/route.ts
- templates/route.ts
- terminal/capture/route.ts
- terminal/config/route.ts
- terminal/spawn/route.ts
- terminal/status/route.ts
- terminal/token/route.ts
- tokens/record/route.ts
- tools/check/route.ts
- validate/route.ts
- webhooks/generate/route.ts
- webhooks/[id]/route.ts
- webhooks/config/[id]/route.ts
- webhooks/config/[id]/test/route.ts
- webhooks/config/route.ts
- webhooks/inbound/config/route.ts
- webhooks/inbound/config/[id]/route.ts
- webhooks/logs/route.ts
- webhooks/route.ts
- workspaces/[id]/route.ts
- workspaces/[id]/task-provider/route.ts
- workspaces/logs/route.ts
- workspaces/provision/docker/route.ts
- workspaces/route.ts
- workspaces/ssh-keys/route.ts

## public-by-design

Routes intentionally public with explicit security justifications:

- auth/providers/route.ts — detects available auth providers (GitHub, Google, Microsoft); no sensitive data
- chains/route.ts — redirects to /api/chains/list for consistency
- email/bounce/route.ts — email bounce webhook receiver; authenticated via HMAC signature in bearer token
- email/inbound/route.ts — email inbound receiver; authenticated via HMAC signature with IP rate limiting
- email/resubscribe/route.ts — user resubscribe from email link; validated with signed token and IP rate limiting
- email/unsubscribe/route.ts — user unsubscribe from email link; validated with signed token and IP rate limiting
- unsubscribe/[token]/route.ts — email unsubscribe with signed token validation
- webhooks/[id]/receive/route.ts — generic webhook receiver; authenticated via HMAC signature
- webhooks/github/route.ts — GitHub webhook receiver; authenticated via GitHub signature verification
- webhooks/inbound/[token]/route.ts — inbound webhook receiver; authenticated with signed token in URL
- webhooks/inbound/triggers/[triggerId]/route.ts — inbound webhook trigger status lookup; authenticated with status token in query/header
- version/route.ts — version info for health checks and monitoring
- mentiko-mcp/auth/device/start/route.ts — device-authorization bootstrap; unauthenticated by design (standalone MCP client calls it with no token). Security anchor is the cookie-authed /device/approve step that follows.
- mentiko-mcp/auth/device/poll/route.ts — device-code poll; possession of the secret device_code is the authorization (single-use token pickup, mirroring RFC 8628).
- mentiko-mcp/auth/token/route.ts — refresh-token exchange; possession of the long-lived refresh token is the authorization. Rate-limited per token; revocable at /api/account/mcp-tokens.
- mentiko-mcp/ui-control/start/route.ts — UI-control grant bootstrap; unauthenticated by design (mirrors device/start). Anchor is the cookie-authed approve step that binds a specific window's sessionId.
- mentiko-mcp/ui-control/poll/route.ts — UI-control grant poll; possession of the secret device_code is the authorization (single-use signaling-token pickup).

## unclear (needs human review)

(none — all previously-unclear routes were resolved in RBAC-5b on 2026-04-23;
 see "resolved in RBAC-5b" section below)

## resolved in RBAC-5b (2026-04-23)

All 11 routes previously in the unclear bucket have been moved to the
authenticated list above. Each was confirmed to be a latent bug and fixed:

- events/triggers/[id]/route.ts — added checkAuth + getNamespaceIdFromRequest (was trusting x-namespace-id header)
- events/triggers/route.ts — added checkAuth + getNamespaceIdFromRequest (was trusting x-namespace-id header)
- integrations/github/test/route.ts — added checkAuth (was an unauth'd GitHub token validator / SSRF-ish)
- kollabor/token/route.ts — added checkAuth (was returning local ~/.kollab/engine.token to any caller)
- notifications/email/send/route.ts — upgraded to requirePermission("manage_chains") (was an open email relay / phishing launchpad; legacy stub — production path is /api/email/send)
- notifications/push/send/route.ts — added checkAuth
- notifications/push/subscribe/route.ts — added checkAuth on POST/GET/DELETE
- notifications/push/unsubscribe/route.ts — added checkAuth
- sessions/[name]/recording/route.ts — added checkAuth (was serving agent transcripts publicly)
- telegram/webhook/route.ts — fail closed when TELEGRAM_WEBHOOK_SECRET unset (was silently accepting all requests)
- webhooks/status/route.ts — added checkAuth (was exposing webhook URLs + delivery metadata)

## likely bug (probably accidentally public)

Routes with no auth and no signed-token protection that expose or modify data:

- (none detected in final scan — all remaining routes have been categorized as public-by-design or unclear)

---

## notes

1. **grep pattern**: routes checked for `checkAuth`, `getServerSession`, `requireAuth`, `requirePermission`, `getSessionUser`, `checkOpsAuth`, and `BETTER_AUTH_SECRET` or `X-Mentiko-Inbox-Key` header validation.

2. **HMAC-based webhooks**: email bounce, email inbound, and GitHub webhooks are public but authenticated via cryptographic signatures (HMAC or GitHub signature). These are CORRECT by design.

3. **Signed tokens in URLs**: unsubscribe, invite, and webhook inbound endpoints use signed tokens in the URL path or as parameters. These are CORRECT by design.

4. **MCP ops routes**: `/api/mentiko-mcp/ops/*` routes use `checkOpsAuth()` which validates `X-Mentiko-Inbox-Key` — a server-side secret. These are AUTHENTICATED via the inbox-key bypass pattern documented in the spec.

5. **Marketplace endpoints**: All marketplace listing endpoints are PUBLIC-BY-DESIGN because they return template/chain/artifact metadata with no user-specific data.

6. **Unclear routes**: The 11 routes marked UNCLEAR typically do one of the following:
   - Read from `x-namespace-id` header instead of session (potential data-leak risk if header-trust is dropped per ARCH-1)
   - Have no visible auth but may be internal/scheduler-only (need deployment context)
   - Send notifications but rely on caller to validate (if caller is authenticated)

7. **No major bugs found**: contrary to initial expectations, the NONE routes do not reveal accidentally-public user data endpoints. Most public routes are webhooks/tokens (correct), and most API endpoints with user data use session auth.
