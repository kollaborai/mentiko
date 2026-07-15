"use client";

import { useState } from "react";
import { PageBanner } from "@/components/ui/page-banner";
import { CodeFilled } from "@aliimam/icons";

interface ApiEndpoint {
  method: string;
  path: string;
  auth: boolean;
  description: string;
  params?: Array<{ name: string; type: string; required: boolean; description: string }>;
  body?: Array<{ name: string; type: string; required: boolean; description: string }>;
  response: Record<string, unknown> | string;
}

const endpoints: ApiEndpoint[] = [
  {
    method: "GET",
    path: "/api/auth/[...all]",
    auth: false,
    description: "authentication handled by better-auth - see /api/auth/* routes",
    response: { "see better-auth docs": "https://better-auth.com" },
  },
  {
    method: "GET",
    path: "/api/chains/list",
    auth: true,
    description: "list all available chains",
    response: {
      chains: [
        {
          id: "string",
          name: "string",
          description: "string",
          version: "string",
          agentCount: 0,
          cli: "claude",
          monitor: true,
          agents: [],
        },
      ],
      namespaceId: "string",
    },
  },
  {
    method: "GET",
    path: "/api/chains/:id",
    auth: true,
    description: "get chain by id",
    response: { chain: {}, path: "string" },
  },
  {
    method: "POST",
    path: "/api/chains/recommend",
    auth: true,
    description: "generate chain from ai prompt",
    body: [
      { name: "prompt", type: "string", required: true, description: "natural language description" },
      { name: "taskId", type: "string", required: false, description: "task id to bind generation job to" },
      { name: "workspacePath", type: "string", required: false, description: "workspace path for context" },
    ],
    response: { jobId: "string", status: "string" },
  },
  {
    method: "POST",
    path: "/api/chains/import",
    auth: true,
    description: "import chain to namespace chains dir",
    body: [
      { name: "chain", type: "object", required: true, description: "chain configuration" },
      { name: "name", type: "string", required: true, description: "chain name" },
    ],
    response: { chain: {}, path: "string" },
  },
  {
    method: "POST",
    path: "/api/chains/save",
    auth: true,
    description: "save chain to namespace dir",
    body: [
      { name: "chain", type: "object", required: true, description: "chain data" },
      { name: "name", type: "string", required: true, description: "chain name" },
    ],
    response: { success: true, path: "string", version: "string" },
  },
  {
    method: "POST",
    path: "/api/chains/run",
    auth: true,
    description: "execute a chain",
    body: [
      { name: "chain", type: "object", required: true, description: "chain config" },
      { name: "userPrompt", type: "string", required: false, description: "task description" },
      { name: "debug", type: "boolean", required: false, description: "enable debug mode" },
    ],
    response: { success: true, runId: "string", chainId: "string", output: "string" },
  },
  {
    method: "POST",
    path: "/api/chains/validate",
    auth: true,
    description: "validate chain against schema",
    body: [{ name: "chain", type: "object", required: true, description: "chain to validate" }],
    response: { valid: true, errors: [] },
  },
  {
    method: "GET",
    path: "/api/chains/status",
    auth: true,
    description: "get a chain status document",
    params: [
      { name: "id", type: "string", required: true, description: "chain id" },
      { name: "expand", type: "boolean", required: false, description: "expand referenced agents" },
    ],
    response: { chain: {} },
  },
  {
    method: "GET",
    path: "/api/chains/:id/debug",
    auth: true,
    description: "get debug state for a run",
    response: { steps: [], status: "string", breakpoints: [], last_action: "string", last_action_at: "string" },
  },
  {
    method: "POST",
    path: "/api/chains/:id/debug",
    auth: true,
    description: "control debug run (pause/resume/step/set_breakpoints/continue/skip/retry/abort)",
    body: [
      { name: "action", type: "string", required: true, description: "pause|resume|step|set_breakpoints|continue|skip|retry|abort" },
      { name: "stepIndex", type: "number", required: false, description: "step to act on" },
      { name: "breakpoints", type: "number[]", required: false, description: "breakpoint step indices" },
    ],
    response: { success: true, state: {} },
  },
  {
    method: "DELETE",
    path: "/api/chains/:id/debug",
    auth: true,
    description: "clear debug state",
    response: { success: true, message: "string" },
  },
  // Decision Management
  {
    method: "POST",
    path: "/api/decisions",
    auth: true,
    description: "create decision",
    body: [
      { name: "topic", type: "string", required: true, description: "decision topic" },
      { name: "mode", type: "string", required: false, description: "guided|classic" },
      { name: "workspacePath", type: "string", required: false, description: "workspace path" },
    ],
    response: { id: "string", topic: "string", status: "string" },
  },
  {
    method: "GET",
    path: "/api/decisions",
    auth: true,
    description: "list decisions",
    response: { decisions: [] },
  },
  {
    method: "GET",
    path: "/api/decisions/:id",
    auth: true,
    description: "get decision details",
    response: { decision: {} },
  },
  {
    method: "PATCH",
    path: "/api/decisions/:id",
    auth: true,
    description: "update decision",
    body: [
      { name: "topic", type: "string", required: false, description: "decision topic" },
      { name: "status", type: "string", required: false, description: "draft|research|options|plan|approved" },
    ],
    response: { success: true, decision: {} },
  },
  {
    method: "DELETE",
    path: "/api/decisions/:id",
    auth: true,
    description: "delete decision",
    response: { success: true },
  },
  {
    method: "POST",
    path: "/api/decisions/:id/guided/questions",
    auth: true,
    description: "submit guided decision answer (round 1)",
    body: [
      { name: "questionId", type: "string", required: true, description: "question id" },
      { name: "choice", type: "string", required: true, description: "a|b|skip" },
    ],
    response: { success: true },
  },
  {
    method: "POST",
    path: "/api/decisions/:id/guided/options",
    auth: true,
    description: "generate options (round 2)",
    response: { options: [] },
  },
  {
    method: "POST",
    path: "/api/decisions/:id/guided/plan",
    auth: true,
    description: "generate plan (round 3)",
    response: { plan: {} },
  },
  {
    method: "POST",
    path: "/api/decisions/:id/resolve",
    auth: true,
    description: "approve decision and create tasks",
    body: [
      { name: "selectedOptionId", type: "string", required: true, description: "selected option id" },
      { name: "workspacePath", type: "string", required: false, description: "workspace path" },
    ],
    response: { success: true, tasks: [] },
  },
  {
    method: "POST",
    path: "/api/decisions/:id/research",
    auth: true,
    description: "start research phase",
    response: { jobId: "string" },
  },
  {
    method: "POST",
    path: "/api/decisions/:id/retrospective",
    auth: true,
    description: "post-decision review",
    response: { success: true, retrospective: {} },
  },
  // Agent Profiles
  {
    method: "GET",
    path: "/api/agent-profiles",
    auth: true,
    description: "list agent profiles",
    response: { profiles: [] },
  },
  {
    method: "POST",
    path: "/api/agent-profiles",
    auth: true,
    description: "create agent profile",
    body: [
      { name: "name", type: "string", required: true, description: "profile name" },
      { name: "cli", type: "string", required: true, description: "claude|codex|kollab|aider" },
      { name: "model", type: "string", required: false, description: "model identifier" },
      { name: "env", type: "object", required: false, description: "environment variables" },
    ],
    response: { profile: {} },
  },
  {
    method: "GET",
    path: "/api/agent-profiles/:id",
    auth: true,
    description: "get agent profile",
    response: { profile: {} },
  },
  {
    method: "DELETE",
    path: "/api/agent-profiles/:id",
    auth: true,
    description: "delete agent profile",
    response: { success: true },
  },
  {
    method: "PATCH",
    path: "/api/agent-profiles/:id",
    auth: true,
    description: "update agent profile",
    body: [
      { name: "name", type: "string", required: false, description: "profile name" },
      { name: "cli", type: "string", required: false, description: "claude|codex|kollab|aider" },
      { name: "model", type: "string", required: false, description: "model identifier" },
    ],
    response: { success: true, profile: {} },
  },
  {
    method: "GET",
    path: "/api/agent-profiles/:id/resolved-env",
    auth: true,
    description: "get resolved environment",
    response: { env: {} },
  },
  {
    method: "POST",
    path: "/api/agent-profiles/:id/test",
    auth: true,
    description: "test agent profile",
    response: { success: true, output: "string" },
  },
  {
    method: "GET",
    path: "/api/agents/:session",
    auth: true,
    description: "get pty session output",
    response: { output: "string", session: "string" },
  },
  {
    method: "POST",
    path: "/api/agents/:session/message",
    auth: true,
    description: "send message to pty session",
    body: [{ name: "message", type: "string", required: true, description: "text to send" }],
    response: { success: true, session: "string" },
  },
  {
    method: "DELETE",
    path: "/api/agents/:session/output",
    auth: true,
    description: "kill pty session",
    response: { success: true, session: "string" },
  },
  // Workspaces
  {
    method: "GET",
    path: "/api/workspaces",
    auth: true,
    description: "list workspaces",
    response: { workspaces: [] },
  },
  {
    method: "POST",
    path: "/api/workspaces",
    auth: true,
    description: "create workspace",
    body: [
      { name: "name", type: "string", required: true, description: "workspace name" },
      { name: "type", type: "string", required: true, description: "local|ssh|docker" },
      { name: "config", type: "object", required: false, description: "workspace config" },
    ],
    response: { workspace: {} },
  },
  {
    method: "GET",
    path: "/api/workspaces/:id",
    auth: true,
    description: "get workspace",
    response: { workspace: {} },
  },
  {
    method: "PATCH",
    path: "/api/workspaces/:id",
    auth: true,
    description: "update workspace",
    body: [
      { name: "name", type: "string", required: false, description: "workspace name" },
      { name: "config", type: "object", required: false, description: "workspace config" },
    ],
    response: { success: true, workspace: {} },
  },
  {
    method: "DELETE",
    path: "/api/workspaces/:id",
    auth: true,
    description: "delete workspace",
    response: { success: true },
  },
  {
    method: "GET",
    path: "/api/workspaces/:id/task-provider",
    auth: true,
    description: "get a workspace's task provider config (credentials masked)",
    response: { config: {}, meta: {}, available: [] },
  },
  {
    method: "PUT",
    path: "/api/workspaces/:id/task-provider",
    auth: true,
    description: "set a workspace's task provider config; masked credential fields (••••••••) are preserved from the existing config",
    body: [
      { name: "type", type: "string", required: true, description: "task provider type, e.g. native|linear|github|jira" },
      { name: "credentials", type: "object", required: false, description: "provider credentials" },
      { name: "options", type: "object", required: false, description: "provider-specific options" },
    ],
    response: { config: {} },
  },
  {
    method: "POST",
    path: "/api/workspaces/:id/task-provider",
    auth: true,
    description: "test connectivity to the configured task provider",
    response: { ok: true, error: "string" },
  },
  {
    method: "POST",
    path: "/api/workspaces/provision/docker",
    auth: true,
    description: "provision docker workspace",
    body: [
      { name: "image", type: "string", required: true, description: "docker image" },
      { name: "name", type: "string", required: true, description: "workspace name" },
    ],
    response: { workspace: {} },
  },
  // Tasks
  {
    method: "GET",
    path: "/api/tasks",
    auth: true,
    description: "list tasks",
    params: [
      { name: "status", type: "string", required: false, description: "pending|in_progress|completed" },
      { name: "epic", type: "string", required: false, description: "filter by epic id" },
    ],
    response: { tasks: [] },
  },
  {
    method: "POST",
    path: "/api/tasks/create",
    auth: true,
    description: "create task (requires manage_tasks)",
    body: [
      { name: "title", type: "string", required: true, description: "task title" },
      { name: "description", type: "string", required: false, description: "task description" },
      { name: "type", type: "string", required: false, description: "issue type" },
      { name: "priority", type: "number", required: false, description: "0-4" },
      { name: "parent", type: "string", required: false, description: "parent task id" },
      { name: "labels", type: "string[]", required: false, description: "labels" },
      { name: "assignee", type: "string", required: false, description: "assignee" },
      { name: "chainAssignment", type: "object", required: false, description: "{ chainId, chainName, autoRun } to bind a chain, or { autoRun: true } alone to auto-analyze" },
    ],
    response: { issue: {} },
  },
  {
    method: "GET",
    path: "/api/tasks/:id",
    auth: true,
    description: "get task",
    response: { task: {} },
  },
  {
    method: "PATCH",
    path: "/api/tasks/:id",
    auth: true,
    description: "update task",
    body: [
      { name: "status", type: "string", required: false, description: "pending|in_progress|completed" },
      { name: "subject", type: "string", required: false, description: "task subject" },
      { name: "owner", type: "string", required: false, description: "task owner" },
    ],
    response: { success: true, task: {} },
  },
  {
    method: "GET",
    path: "/api/tasks/:id/comments",
    auth: true,
    description: "get task comments",
    response: { comments: [] },
  },
  {
    method: "POST",
    path: "/api/tasks/:id/comments",
    auth: true,
    description: "add task comment",
    body: [{ name: "text", type: "string", required: true, description: "comment text" }],
    response: { comment: {} },
  },
  {
    method: "POST",
    path: "/api/tasks/:id/close",
    auth: true,
    description: "close task",
    response: { success: true },
  },
  {
    method: "POST",
    path: "/api/tasks/:id/run-chain",
    auth: true,
    description: "run chain for task",
    body: [{ name: "chainId", type: "string", required: true, description: "chain id" }],
    response: { runId: "string" },
  },
  {
    method: "GET",
    path: "/api/tasks/activity",
    auth: true,
    description: "get task activity",
    response: { activity: [] },
  },
  {
    method: "POST",
    path: "/api/tasks/generate",
    auth: true,
    description: "generate tasks from description",
    body: [
      { name: "description", type: "string", required: true, description: "work description" },
      { name: "workspacePath", type: "string", required: false, description: "workspace path" },
      { name: "autoRun", type: "boolean", required: false, description: "auto-run generated tasks" },
    ],
    response: { parentTask: "string", tasks: [] },
  },
  {
    method: "POST",
    path: "/api/tasks/auto-run",
    auth: true,
    description: "auto-run ready tasks",
    response: { tasksStarted: 0 },
  },
  {
    method: "GET",
    path: "/api/tasks/graph",
    auth: true,
    description: "get dependency graph",
    response: { nodes: [], edges: [] },
  },
  {
    method: "GET",
    path: "/api/tasks/epics",
    auth: true,
    description: "list epics",
    response: { epics: [] },
  },
  // Links
  {
    method: "GET",
    path: "/api/links/:id",
    auth: true,
    description: "get agent link",
    response: { link: {} },
  },
  {
    method: "DELETE",
    path: "/api/links/:id",
    auth: true,
    description: "delete agent link",
    response: { success: true },
  },
  {
    method: "POST",
    path: "/api/links/generate",
    auth: true,
    description: "generate agent link",
    body: [{ name: "prompt", type: "string", required: true, description: "link description" }],
    response: { link: {} },
  },
  {
    method: "POST",
    path: "/api/links/run",
    auth: true,
    description: "run agent link",
    body: [{ name: "linkId", type: "string", required: true, description: "link id" }],
    response: { sessionId: "string" },
  },
  {
    method: "GET",
    path: "/api/runs",
    auth: true,
    description: "list all runs",
    params: [
      { name: "chain", type: "string", required: false, description: "filter by chain id" },
      { name: "limit", type: "number", required: false, description: "max results (default 50)" },
    ],
    response: { runs: [] },
  },
  {
    method: "GET",
    path: "/api/runs/:id",
    auth: true,
    description: "get run details with live agent states",
    response: { run: {} },
  },
  {
    method: "GET",
    path: "/api/runs/compare",
    auth: true,
    description: "compare two runs",
    params: [
      { name: "runA", type: "string", required: true, description: "first run id" },
      { name: "runB", type: "string", required: true, description: "second run id" },
    ],
    response: { runA: {}, runB: {}, metricsDiff: {}, agentComparison: [] },
  },
  {
    method: "GET",
    path: "/api/events",
    auth: true,
    description: "list agent events",
    params: [{ name: "dir", type: "string", required: false, description: "events directory path" }],
    response: { events: [] },
  },
  {
    method: "GET",
    path: "/api/events/stream",
    auth: true,
    description: "sse stream for run events",
    params: [{ name: "run-id", type: "string", required: true, description: "run to watch" }],
    response: "text/event-stream",
  },
  {
    method: "GET",
    path: "/api/schedules",
    auth: true,
    description: "list all scheduled chains",
    response: { schedules: [] },
  },
  {
    method: "PUT",
    path: "/api/schedules",
    auth: true,
    description: "enable/disable schedule",
    body: [
      { name: "chainId", type: "string", required: true, description: "chain id" },
      { name: "enabled", type: "boolean", required: true, description: "schedule status" },
    ],
    response: { success: true, enabled: true },
  },
  {
    method: "PATCH",
    path: "/api/schedules",
    auth: true,
    description: "update schedule expression",
    body: [
      { name: "chainId", type: "string", required: true, description: "chain id" },
      { name: "schedule", type: "string", required: false, description: "cron expression" },
      { name: "timezone", type: "string", required: false, description: "timezone name" },
    ],
    response: { success: true, schedule: "string", timezone: "string" },
  },
  // Webhooks
  {
    method: "GET",
    path: "/api/webhooks",
    auth: true,
    description: "list webhooks",
    response: { webhooks: [] },
  },
  {
    method: "POST",
    path: "/api/webhooks",
    auth: true,
    description: "create webhook",
    body: [
      { name: "name", type: "string", required: true, description: "webhook name" },
      { name: "url", type: "string", required: true, description: "webhook url" },
      { name: "events", type: "string[]", required: true, description: "events to trigger on" },
    ],
    response: { webhook: {} },
  },
  {
    method: "DELETE",
    path: "/api/webhooks/:id",
    auth: true,
    description: "delete webhook",
    response: { success: true },
  },
  {
    method: "POST",
    path: "/api/webhooks/:id",
    auth: true,
    description: "test webhook with a sample payload; delivers to the real endpoint URL if one is configured",
    body: [
      { name: "source", type: "string", required: false, description: "webhook source tag, default custom" },
      { name: "type", type: "string", required: false, description: "webhook event type tag, default custom" },
      { name: "payload", type: "object", required: false, description: "custom test payload" },
    ],
    response: { test: true, event: {}, delivery: { status: 0, ok: true, statusText: "string" } },
  },
  {
    method: "POST",
    path: "/api/webhooks/generate",
    auth: true,
    description: "generate webhook",
    body: [{ name: "prompt", type: "string", required: true, description: "webhook description" }],
    response: { webhook: {} },
  },
  {
    method: "GET",
    path: "/api/webhooks/inbound/config",
    auth: true,
    description: "get inbound webhook config",
    response: { config: {} },
  },
  {
    method: "POST",
    path: "/api/webhooks/inbound/config",
    auth: true,
    description: "set inbound webhook config",
    body: [{ name: "enabled", type: "boolean", required: true, description: "enable inbound webhooks" }],
    response: { success: true },
  },
  {
    method: "POST",
    path: "/api/webhooks/inbound/:token",
    auth: false,
    description: "receive inbound webhook",
    response: { success: true },
  },
  {
    method: "GET",
    path: "/api/webhooks/status",
    auth: false,
    description: "list webhook deliveries",
    params: [{ name: "chain", type: "string", required: false, description: "filter by chain name" }],
    response: { deliveries: [] },
  },
  {
    method: "POST",
    path: "/api/integrations/save",
    auth: true,
    description: "save integration config",
    body: [
      { name: "github", type: "object", required: false, description: "github config" },
      { name: "slack", type: "object", required: false, description: "slack config" },
      { name: "teams", type: "object", required: false, description: "teams config" },
      { name: "email", type: "object", required: false, description: "email config" },
    ],
    response: { success: true },
  },
  {
    method: "GET",
    path: "/api/templates/list",
    auth: true,
    description: "list templates and examples",
    response: { templates: [] },
  },
  {
    method: "POST",
    path: "/api/templates/:id/use",
    auth: true,
    description: "copy a template into namespace chains; :id is a URL-encoded composite path like 'examples/my-template', 'templates/foo', or 'community/chains/slug'",
    response: { chain: {} },
  },
  {
    method: "POST",
    path: "/api/templates/:id/rate",
    auth: true,
    description: "rate a template",
    body: [{ name: "rating", type: "number", required: true, description: "1-5 stars" }],
    response: { templateId: "string", rating: 0, count: 0, distribution: {} },
  },
  {
    method: "GET",
    path: "/api/templates/:id/rate",
    auth: true,
    description: "get template rating",
    response: { templateId: "string", rating: 0, count: 0, distribution: {} },
  },
  // Email
  {
    method: "POST",
    path: "/api/email/send",
    auth: true,
    description: "send email",
    body: [
      { name: "to", type: "string", required: true, description: "recipient email" },
      { name: "subject", type: "string", required: true, description: "email subject" },
      { name: "body", type: "string", required: true, description: "email body" },
    ],
    response: { success: true, messageId: "string" },
  },
  {
    method: "POST",
    path: "/api/email/inbound",
    auth: false,
    description: "receive inbound email",
    response: { success: true },
  },
  {
    method: "GET",
    path: "/api/email/inboxes",
    auth: true,
    description: "list email inboxes",
    response: { inboxes: [] },
  },
  {
    method: "POST",
    path: "/api/email/inboxes",
    auth: true,
    description: "create email inbox",
    body: [
      { name: "name", type: "string", required: true, description: "inbox name" },
      { name: "email", type: "string", required: true, description: "inbox email address" },
    ],
    response: { inbox: {} },
  },
  {
    method: "GET",
    path: "/api/email/inboxes/:id",
    auth: true,
    description: "get email inbox",
    response: { inbox: {} },
  },
  {
    method: "DELETE",
    path: "/api/email/inboxes/:id",
    auth: true,
    description: "delete email inbox",
    response: { success: true },
  },
  {
    method: "PATCH",
    path: "/api/email/inboxes/:id",
    auth: true,
    description: "update email inbox",
    body: [
      { name: "name", type: "string", required: false, description: "inbox name" },
      { name: "email", type: "string", required: false, description: "inbox email address" },
    ],
    response: { success: true, inbox: {} },
  },
  {
    method: "GET",
    path: "/api/email/inboxes/:id/messages",
    auth: true,
    description: "get inbox messages",
    response: { messages: [] },
  },
  {
    method: "POST",
    path: "/api/email/smtp-test",
    auth: true,
    description: "test smtp connection",
    response: { success: true, message: "string" },
  },
  {
    method: "GET",
    path: "/api/email/smtp-status",
    auth: true,
    description: "get smtp status",
    response: { status: "string", details: {} },
  },
  {
    method: "GET",
    path: "/api/email/quota",
    auth: true,
    description: "get email quota",
    response: { quota: {}, usage: {} },
  },
  // Marketplace
  {
    method: "POST",
    path: "/api/marketplace/sync",
    auth: true,
    description: "sync from marketplace",
    body: [{ name: "entityType", type: "string", required: false, description: "chains|agents|artifacts|plugins" }],
    response: { synced: [] },
  },
  {
    method: "GET",
    path: "/api/marketplace/chains",
    auth: true,
    description: "list marketplace chains",
    response: { chains: [] },
  },
  {
    method: "GET",
    path: "/api/marketplace/artifacts",
    auth: true,
    description: "list marketplace artifacts",
    response: { artifacts: [] },
  },
  {
    method: "GET",
    path: "/api/marketplace/plugins",
    auth: true,
    description: "list marketplace plugins",
    response: { plugins: [] },
  },
  // Terminal Sessions
  {
    method: "POST",
    path: "/api/terminal/spawn",
    auth: true,
    description: "spawn pty session",
    body: [
      { name: "name", type: "string", required: true, description: "session name" },
      { name: "command", type: "string", required: false, description: "command to run" },
    ],
    response: { sessionId: "string", token: "string" },
  },
  {
    method: "GET",
    path: "/api/terminal/token",
    auth: true,
    description: "get terminal token",
    response: { token: "string" },
  },
  {
    method: "GET",
    path: "/api/terminal/status",
    auth: true,
    description: "get terminal status",
    response: { status: "string", sessions: [] },
  },
  {
    method: "GET",
    path: "/api/pty/sessions",
    auth: true,
    description: "list pty sessions",
    response: { sessions: [] },
  },
  {
    method: "GET",
    path: "/api/pty/sessions/:name",
    auth: true,
    description: "get pty session",
    response: { session: {} },
  },
  {
    method: "DELETE",
    path: "/api/pty/sessions/:name",
    auth: true,
    description: "delete pty session",
    response: { success: true },
  },
  {
    method: "POST",
    path: "/api/pty/sessions/:name/send",
    auth: true,
    description: "send to pty session",
    body: [{ name: "cmd", type: "string", required: true, description: "command to send" }],
    response: { success: true },
  },
  // File System
  {
    method: "GET",
    path: "/api/fs/browse",
    auth: true,
    description: "browse directory",
    params: [{ name: "path", type: "string", required: true, description: "directory path" }],
    response: { files: [] },
  },
  {
    method: "GET",
    path: "/api/fs/file",
    auth: true,
    description: "read file",
    params: [{ name: "path", type: "string", required: true, description: "file path" }],
    response: { content: "string" },
  },
  {
    method: "PUT",
    path: "/api/fs/file",
    auth: true,
    description: "write file content (overwrites existing, max 2MB)",
    params: [{ name: "path", type: "string", required: true, description: "file path" }],
    body: [{ name: "content", type: "string", required: true, description: "file content" }],
    response: { success: true, path: "string" },
  },
  {
    method: "POST",
    path: "/api/fs/create",
    auth: true,
    description: "create file",
    body: [
      { name: "path", type: "string", required: true, description: "file path" },
      { name: "content", type: "string", required: true, description: "file content" },
    ],
    response: { success: true },
  },
  {
    method: "POST",
    path: "/api/fs/upload",
    auth: true,
    description: "upload file",
    body: [
      { name: "path", type: "string", required: true, description: "destination path" },
      { name: "file", type: "file", required: true, description: "file to upload" },
    ],
    response: { success: true },
  },
  {
    method: "POST",
    path: "/api/fs/rename",
    auth: true,
    description: "rename file",
    body: [
      { name: "oldPath", type: "string", required: true, description: "current path" },
      { name: "newPath", type: "string", required: true, description: "new path" },
    ],
    response: { success: true },
  },
  {
    method: "POST",
    path: "/api/fs/delete",
    auth: true,
    description: "delete files/directories",
    body: [{ name: "paths", type: "string[]", required: true, description: "paths to delete" }],
    response: { success: true },
  },
  {
    method: "POST",
    path: "/api/fs/mkdir",
    auth: true,
    description: "create directory",
    body: [{ name: "path", type: "string", required: true, description: "directory path" }],
    response: { success: true },
  },
  {
    method: "GET",
    path: "/api/fs/search",
    auth: true,
    description: "search files",
    params: [
      { name: "path", type: "string", required: true, description: "search path" },
      { name: "pattern", type: "string", required: true, description: "search pattern" },
    ],
    response: { files: [] },
  },
  {
    method: "GET",
    path: "/api/fs/tree",
    auth: true,
    description: "get directory tree",
    params: [
      { name: "path", type: "string", required: true, description: "directory path" },
      { name: "depth", type: "number", required: false, description: "max depth" },
    ],
    response: { tree: {} },
  },
  {
    method: "POST",
    path: "/api/fs/git-clone",
    auth: true,
    description: "clone git repo",
    body: [
      { name: "url", type: "string", required: true, description: "repo url" },
      { name: "path", type: "string", required: true, description: "destination path" },
    ],
    response: { success: true },
  },
  {
    method: "GET",
    path: "/api/fs/git-status",
    auth: true,
    description: "get git status",
    params: [{ name: "path", type: "string", required: true, description: "repo path" }],
    response: { status: "string" },
  },
  // Organizations
  {
    method: "GET",
    path: "/api/orgs",
    auth: true,
    description: "list organizations",
    response: { orgs: [] },
  },
  {
    method: "POST",
    path: "/api/orgs",
    auth: true,
    description: "create organization",
    body: [
      { name: "name", type: "string", required: true, description: "organization name" },
      { name: "slug", type: "string", required: true, description: "organization slug" },
    ],
    response: { org: {} },
  },
  {
    method: "GET",
    path: "/api/orgs/:id",
    auth: true,
    description: "get organization",
    response: { org: {} },
  },
  {
    method: "DELETE",
    path: "/api/orgs/:id",
    auth: true,
    description: "delete organization",
    response: { success: true },
  },
  {
    method: "GET",
    path: "/api/orgs/:id/members",
    auth: true,
    description: "list organization members",
    response: { members: [] },
  },
  {
    method: "DELETE",
    path: "/api/orgs/:id/members/:userId",
    auth: true,
    description: "remove organization member",
    response: { success: true },
  },
  {
    method: "GET",
    path: "/api/orgs/:id/invites",
    auth: true,
    description: "list organization invites",
    response: { invites: [] },
  },
  {
    method: "POST",
    path: "/api/orgs/:id/invites",
    auth: true,
    description: "create organization invite",
    body: [
      { name: "email", type: "string", required: true, description: "invitee email" },
      { name: "role", type: "string", required: true, description: "invite role" },
    ],
    response: { invite: {} },
  },
  {
    method: "POST",
    path: "/api/orgs/:id/invite",
    auth: true,
    description: "accept organization invite",
    response: { success: true },
  },
  {
    method: "POST",
    path: "/api/orgs/:id/join",
    auth: true,
    description: "join organization",
    response: { success: true },
  },
  // System & Settings
  {
    method: "GET",
    path: "/api/system/logs",
    auth: true,
    description: "get system logs",
    params: [
      { name: "level", type: "string", required: false, description: "error|warn|info" },
      { name: "limit", type: "number", required: false, description: "max results" },
    ],
    response: { logs: [] },
  },
  {
    method: "GET",
    path: "/api/system/settings",
    auth: true,
    description: "get system settings",
    response: { settings: { max_concurrent_runs: 0, auto_run_enabled: true } },
  },
  {
    method: "PUT",
    path: "/api/system/settings",
    auth: true,
    description: "update system settings (max_concurrent_runs clamped to 1-50)",
    body: [
      { name: "max_concurrent_runs", type: "number", required: false, description: "1-50, clamped" },
      { name: "auto_run_enabled", type: "boolean", required: false, description: "enable auto-run globally" },
    ],
    response: { settings: { max_concurrent_runs: 0, auto_run_enabled: true } },
  },
  {
    method: "POST",
    path: "/api/system/cli-auth",
    auth: true,
    description: "cli auth session",
    response: { sessionId: "string" },
  },
  {
    method: "GET",
    path: "/api/system/detect-cli",
    auth: true,
    description: "detect installed clis",
    response: { claude: false, codex: false, antigravity: false },
  },
  {
    method: "GET",
    path: "/api/secrets",
    auth: true,
    description: "list secrets",
    response: { secrets: [] },
  },
  {
    method: "POST",
    path: "/api/secrets",
    auth: true,
    description: "create secret",
    body: [
      { name: "name", type: "string", required: true, description: "secret name" },
      { name: "value", type: "string", required: true, description: "secret value" },
      { name: "envVar", type: "string", required: true, description: "environment variable name" },
    ],
    response: { secret: {} },
  },
  {
    method: "DELETE",
    path: "/api/secrets",
    auth: true,
    description: "delete a secret by id (requires manage_org); fails if still referenced by an agent profile",
    params: [{ name: "id", type: "string", required: true, description: "secret id, e.g. sec-<ts>-<hash>" }],
    response: { ok: true },
  },
  {
    method: "POST",
    path: "/api/secrets/rotate",
    auth: true,
    description: "rotate secret",
    body: [{ name: "name", type: "string", required: true, description: "secret name" }],
    response: { secret: {} },
  },
  {
    method: "GET",
    path: "/api/ssh-keys",
    auth: true,
    description: "list ssh keys",
    response: { keys: [] },
  },
  {
    method: "POST",
    path: "/api/ssh-keys",
    auth: true,
    description: "create ssh key",
    body: [
      { name: "name", type: "string", required: true, description: "key name" },
      { name: "publicKey", type: "string", required: true, description: "public key" },
    ],
    response: { key: {} },
  },
  {
    method: "DELETE",
    path: "/api/ssh-keys",
    auth: true,
    description: "remove an ssh key by fingerprint",
    params: [{ name: "fingerprint", type: "string", required: true, description: "key fingerprint" }],
    response: { removed: true },
  },
  {
    method: "GET",
    path: "/api/config",
    auth: true,
    description: "get config",
    response: { config: {} },
  },
  // Events & Triggers
  {
    method: "POST",
    path: "/api/events/emit",
    auth: true,
    description: "emit event",
    body: [
      { name: "eventType", type: "string", required: true, description: "event type" },
      { name: "data", type: "object", required: true, description: "event data" },
    ],
    response: { success: true },
  },
  {
    method: "GET",
    path: "/api/events/triggers",
    auth: true,
    description: "list triggers",
    response: { triggers: [] },
  },
  {
    method: "POST",
    path: "/api/events/triggers",
    auth: true,
    description: "create trigger",
    body: [
      { name: "name", type: "string", required: true, description: "trigger name" },
      { name: "eventType", type: "string", required: true, description: "event type to listen for" },
      { name: "chainId", type: "string", required: true, description: "chain to run" },
    ],
    response: { trigger: {} },
  },
  {
    method: "DELETE",
    path: "/api/events/triggers/:id",
    auth: true,
    description: "delete trigger",
    response: { success: true },
  },
  {
    method: "PATCH",
    path: "/api/events/triggers/:id",
    auth: true,
    description: "update trigger",
    body: [
      { name: "name", type: "string", required: false, description: "trigger name" },
      { name: "eventType", type: "string", required: false, description: "event type" },
      { name: "chainId", type: "string", required: false, description: "chain to run" },
    ],
    response: { success: true, trigger: {} },
  },
  {
    method: "POST",
    path: "/api/events/triggers/generate",
    auth: true,
    description: "generate trigger",
    body: [{ name: "prompt", type: "string", required: true, description: "trigger description" }],
    response: { trigger: {} },
  },
  {
    method: "GET",
    path: "/api/events/registry",
    auth: true,
    description: "get event registry",
    response: { events: [] },
  },
  {
    method: "GET",
    path: "/api/conversations",
    auth: true,
    description: "list claude conversations",
    params: [
      { name: "cwd", type: "string", required: false, description: "project path" },
      { name: "limit", type: "number", required: false, description: "max results" },
      { name: "countAll", type: "boolean", required: false, description: "count all messages" },
    ],
    response: { conversations: [], dir: "string" },
  },
  {
    method: "GET",
    path: "/api/conversations/:id",
    auth: true,
    description: "get conversation messages",
    params: [
      { name: "cwd", type: "string", required: false, description: "project path" },
      { name: "mode", type: "string", required: false, description: "tail|page" },
      { name: "tail", type: "number", required: false, description: "last n messages" },
      { name: "offset", type: "number", required: false, description: "page offset" },
      { name: "limit", type: "number", required: false, description: "page limit" },
    ],
    response: { messages: [], total: 0, sessionId: "string", slug: "string" },
  },
  {
    method: "GET",
    path: "/api/health",
    auth: false,
    description: "health check for probes",
    response: {
      status: "healthy",
      timestamp: "string",
      uptime_seconds: 0,
      checks: {},
    },
  },
  {
    method: "GET",
    path: "/api/metrics",
    auth: true,
    description: "get system metrics",
    params: [{ name: "format", type: "string", required: false, description: "json|prometheus" }],
    response: {
      runs: { total: 0, by_status: {}, by_chain: {}, success_rate: 0 },
      agents: { total: 0, by_status: {} },
      webhooks: { total: 0, delivered: 0, failed: 0, success_rate: 0 },
      system: { uptime_ms: 0, timestamp: "string" },
    },
  },
  {
    method: "GET",
    path: "/api/prometheus",
    auth: true,
    description: "prometheus metrics export",
    response: "text/plain",
  },
  {
    method: "GET",
    path: "/api/performance",
    auth: true,
    description: "get performance data",
    params: [{ name: "run-id", type: "string", required: false, description: "specific run" }],
    response: "{ runs: [] } | { run_id: string, agents: {}, summary: {} }",
  },
  // Agent Registry & Marketplace
  {
    method: "GET",
    path: "/api/agents",
    auth: true,
    description: "list active agent pty sessions",
    response: { agents: [{ session: "string", name: "string", pid: 0, createdAt: "string", status: "running" }] },
  },
  {
    method: "GET",
    path: "/api/agents/:session/output",
    auth: true,
    description: "get sanitized pty session output with alive status",
    response: { output: "string", status: "running" },
  },
  {
    method: "POST",
    path: "/api/agents/resume",
    auth: true,
    description: "resume a claude conversation in a new pty session",
    body: [
      { name: "conversationId", type: "string", required: true, description: "claude conversation UUID to resume" },
      { name: "agentId", type: "string", required: true, description: "agent id to attach the resumed session to" },
      { name: "runId", type: "string", required: false, description: "run id to patch with the new session name" },
      { name: "cwd", type: "string", required: false, description: "working directory (defaults to code root)" },
    ],
    response: { session: "string" },
  },
  {
    method: "GET",
    path: "/api/agents/registry",
    auth: true,
    description: "list all standalone + chain-referenced agents with usage stats",
    response: { agents: [] },
  },
  {
    method: "GET",
    path: "/api/agents/registry/scan",
    auth: true,
    description: "scan CLI tool skill directories for importable agents",
    response: { skills: [], total: 0, available: 0, imported: 0 },
  },
  {
    method: "GET",
    path: "/api/agents/registry/:id",
    auth: true,
    description: "get a single standalone agent definition",
    response: { id: "string", name: "string", role: "string", prompt: "string", triggers: [], emits: "string" },
  },
  {
    method: "PUT",
    path: "/api/agents/registry/:id",
    auth: true,
    description: "update a standalone agent (merges into existing agent.json)",
    body: [
      { name: "id", type: "string", required: true, description: "agent id" },
      { name: "name", type: "string", required: true, description: "agent name" },
      { name: "triggers", type: "string[]", required: true, description: "trigger events" },
      { name: "emits", type: "string", required: true, description: "emitted event" },
    ],
    response: { success: true, path: "string", id: "string" },
  },
  {
    method: "DELETE",
    path: "/api/agents/registry/:id",
    auth: true,
    description: "delete a standalone agent",
    response: { deleted: true, id: "string" },
  },
  {
    method: "POST",
    path: "/api/agents/registry/save",
    auth: true,
    description: "create a new standalone agent",
    body: [
      { name: "agent", type: "object", required: true, description: "agent definition with id, name, triggers, emits" },
      { name: "name", type: "string", required: false, description: "display name used to derive the slug" },
    ],
    response: { path: "string", id: "string" },
  },
  {
    method: "POST",
    path: "/api/agents/registry/edit",
    auth: true,
    description: "ai-edit an existing agent definition from natural-language instructions",
    body: [
      { name: "agentJson", type: "object", required: true, description: "current agent definition" },
      { name: "instructions", type: "string", required: true, description: "natural-language edit instructions" },
      { name: "workspacePath", type: "string", required: false, description: "workspace path for context" },
    ],
    response: { jobId: "string", status: "string" },
  },
  {
    method: "POST",
    path: "/api/agents/registry/generate",
    auth: true,
    description: "ai-generate a new agent definition from a prompt",
    body: [
      { name: "prompt", type: "string", required: true, description: "natural language description" },
      { name: "workspacePath", type: "string", required: false, description: "workspace path for context" },
    ],
    response: { jobId: "string", status: "string" },
  },
  {
    method: "POST",
    path: "/api/agents/registry/import",
    auth: true,
    description: "import scanned CLI skills as standalone agents",
    body: [
      { name: "skillIds", type: "string[]", required: false, description: "skill ids to import" },
      { name: "all", type: "boolean", required: false, description: "import all available skills" },
    ],
    response: { imported: [], errors: [], total: 0 },
  },
  {
    method: "GET",
    path: "/api/agents/marketplace",
    auth: true,
    description: "list builtin + community marketplace agents with install status and ratings",
    response: { agents: [], total: 0, installed: 0 },
  },
  {
    method: "POST",
    path: "/api/agents/marketplace/install",
    auth: true,
    description: "install a marketplace agent into the namespace by id",
    body: [{ name: "agentId", type: "string", required: true, description: "marketplace or builtin agent id" }],
    response: { installed: true, agentId: "string" },
  },
  {
    method: "POST",
    path: "/api/agents/marketplace/:id/install",
    auth: true,
    description: "install a specific marketplace agent by path id and bump its use count",
    response: { agent: {}, installed: true },
  },
  {
    method: "GET",
    path: "/api/agents/marketplace/:id/rate",
    auth: true,
    description: "get a marketplace agent's rating",
    response: { agentId: "string", rating: 0, count: 0, distribution: {}, use_count: 0 },
  },
  {
    method: "POST",
    path: "/api/agents/marketplace/:id/rate",
    auth: true,
    description: "rate a marketplace agent",
    body: [{ name: "rating", type: "number", required: true, description: "1-5 stars" }],
    response: { agentId: "string", rating: 0, count: 0, distribution: {}, use_count: 0 },
  },
  {
    method: "GET",
    path: "/api/agent-health",
    auth: true,
    description: "list live agent pty sessions parsed from pty-manager (pid, status, run/chain/agent id)",
    response: { sessions: [] },
  },
  {
    method: "DELETE",
    path: "/api/agent-health",
    auth: true,
    description: "kill an agent pty session by name",
    params: [{ name: "session", type: "string", required: true, description: "pty session name" }],
    response: { success: true, killed: "string" },
  },
  {
    method: "GET",
    path: "/api/agent-profiles/bundles",
    auth: true,
    description: "list provider bundles (claude|codex|etc) with per-profile install status",
    response: { bundles: [] },
  },
  {
    method: "POST",
    path: "/api/agent-profiles/install-bundle",
    auth: true,
    description: "install or sync all profiles in a provider bundle",
    body: [{ name: "provider", type: "string", required: true, description: "bundle provider id, e.g. claude|codex" }],
    response: { installed: [], skipped: [], synced: [] },
  },
  {
    method: "POST",
    path: "/api/agent-profiles/:id/test-session",
    auth: true,
    description: "run a real readiness-test chain through the selected agent profile",
    body: [
      { name: "cwd", type: "string", required: false, description: "terminal working directory, validated against allowed roots" },
      { name: "workspaceId", type: "string", required: false, description: "workspace to run in" },
    ],
    response: { runId: "string", chainId: "string", profileId: "string", message: "string" },
  },
  {
    method: "GET",
    path: "/api/profiles",
    auth: true,
    description: "list captured performance profiles (cpu/memory/token samples per agent run) — distinct from agent-profiles CLI configs",
    response: { profiles: [] },
  },
  // Email
  {
    method: "GET",
    path: "/api/email/bounce",
    auth: false,
    description: "list unmatched bounces or suppressions (debugging) - requires Bearer bounce:v{version}:{namespaceId}:{signature} token, not session auth",
    params: [{ name: "type", type: "string", required: true, description: "unmatched|suppressions" }],
    response: { bounces: [], count: 0 },
  },
  {
    method: "POST",
    path: "/api/email/bounce",
    auth: false,
    description: "process bounce webhook from haraka - requires Bearer bounce:v{version}:{namespaceId}:{signature} token, not session auth",
    body: [
      { name: "outboundId", type: "string", required: true, description: "originating send id" },
      { name: "recipient", type: "string", required: true, description: "bounced recipient address" },
      { name: "bounceType", type: "string", required: true, description: "hard|soft|auto_reply|vacation" },
      { name: "action", type: "string", required: true, description: "failed|delayed|relayed|delivered" },
    ],
    response: { ok: true, result: { duplicate: false, unmatched: false, autoReplyDiscarded: false, suppressionWritten: false, recordId: "string" } },
  },
  {
    method: "GET",
    path: "/api/email/poll",
    auth: true,
    description: "unread email counts per inbox, for UI badge counts",
    response: { counts: {}, total: 0 },
  },
  {
    method: "POST",
    path: "/api/email/process",
    auth: true,
    description: "process unread emails across all inboxes and fire their configured chain triggers",
    response: { processed: 0, skipped: 0, errors: ["string"] },
  },
  {
    method: "GET",
    path: "/api/email/reputation",
    auth: true,
    description: "sender reputation status (bounce/complaint rates, suspension state, thresholds)",
    response: { status: "string", bounceRate: 0, complaintRate: 0, sentLast7Days: 0, sentLast30Days: 0, suspendedReason: "string", thresholds: {} },
  },
  {
    method: "GET",
    path: "/api/email/reputation/history",
    auth: true,
    description: "daily reputation metrics history",
    params: [{ name: "days", type: "number", required: false, description: "lookback window, default 30, max 90" }],
    response: { history: [], count: 0 },
  },
  {
    method: "GET",
    path: "/api/email/suppressed",
    auth: true,
    description: "list suppressed email addresses",
    params: [
      { name: "limit", type: "number", required: false, description: "default 50, max 200" },
      { name: "offset", type: "number", required: false, description: "pagination offset" },
      { name: "reason", type: "string", required: false, description: "hard_bounce|soft_bounce|complaint|manual|unsubscribe" },
    ],
    response: { suppressions: [], total: 0 },
  },
  {
    method: "POST",
    path: "/api/email/suppressed",
    auth: true,
    description: "manually suppress an email address (requires manage_org)",
    body: [
      { name: "email", type: "string", required: true, description: "address to suppress" },
      { name: "reason", type: "string", required: false, description: "hard_bounce|soft_bounce|complaint|manual|unsubscribe, default manual" },
      { name: "expiresAt", type: "string", required: false, description: "ISO date suppression expires" },
    ],
    response: { suppressed: true },
  },
  {
    method: "DELETE",
    path: "/api/email/suppressed",
    auth: true,
    description: "remove a suppression (requires manage_org)",
    body: [{ name: "email", type: "string", required: true, description: "address to unsuppress" }],
    response: { removed: true },
  },
  {
    method: "POST",
    path: "/api/email/suppressed/resubscribe",
    auth: true,
    description: "resubscribe an address - only removes soft_bounce or unsubscribe suppressions, not hard_bounce/complaint",
    body: [{ name: "email", type: "string", required: true, description: "address to resubscribe" }],
    response: { resubscribed: true },
  },
  {
    method: "POST",
    path: "/api/email/resubscribe",
    auth: false,
    description: "public token-based resubscribe link handler, rate limited 10 req/min per IP",
    body: [{ name: "token", type: "string", required: true, description: "signed resubscribe token from email link" }],
    response: { ok: true, email: "string", message: "string" },
  },
  {
    method: "OPTIONS",
    path: "/api/email/resubscribe",
    auth: false,
    description: "CORS preflight for the resubscribe link handler",
    response: "204 No Content",
  },
  {
    method: "POST",
    path: "/api/email/unsubscribe",
    auth: false,
    description: "public token-based unsubscribe link handler, rate limited 10 req/min per IP",
    body: [{ name: "token", type: "string", required: true, description: "signed unsubscribe token from email link" }],
    response: { ok: true, email: "string", message: "string" },
  },
  {
    method: "OPTIONS",
    path: "/api/email/unsubscribe",
    auth: false,
    description: "CORS preflight for the unsubscribe link handler",
    response: "204 No Content",
  },
  {
    method: "POST",
    path: "/api/email/secret/rotate",
    auth: true,
    description: "rotate an inbox's inbound HMAC secret (requires manage_org); previous version stays valid 24h",
    body: [{ name: "inboxId", type: "string", required: true, description: "inbox to rotate" }],
    response: { ok: true, secret: "string", version: 0 },
  },
  {
    method: "POST",
    path: "/api/email/inboxes/:id/messages/:messageId/move",
    auth: true,
    description: "move a message between unread/processed/failed subfolders (requires manage_org)",
    body: [
      { name: "from", type: "string", required: true, description: "unread|processed|failed" },
      { name: "to", type: "string", required: true, description: "unread|processed|failed, must differ from from" },
    ],
    response: { ok: true, messageId: "string", from: "string", to: "string" },
  },
  // Notifications
  {
    method: "GET",
    path: "/api/notifications",
    auth: true,
    description: "list notifications, auto-generated from recent runs if none stored yet",
    params: [{ name: "filter", type: "string", required: false, description: "all|unread|runs|system" }],
    response: { notifications: [], unreadCount: 0 },
  },
  {
    method: "POST",
    path: "/api/notifications",
    auth: true,
    description: "create a notification; caps stored history at 200, oldest dropped first",
    body: [
      { name: "title", type: "string", required: true, description: "notification title" },
      { name: "message", type: "string", required: true, description: "notification body" },
      { name: "type", type: "string", required: false, description: "agent_complete|agent_error|chain_complete|chain_failed|webhook_failed|webhook_delivered|chain_started|job_started|job_complete|job_failed|info|warning|error, default info" },
      { name: "metadata", type: "object", required: false, description: "agentId/chainId/runId/actionUrl etc, actionUrl auto-derived from type if omitted" },
    ],
    response: { notification: {} },
  },
  {
    method: "PATCH",
    path: "/api/notifications",
    auth: true,
    description: "bulk operation - mark all read or clear all",
    body: [{ name: "action", type: "string", required: true, description: "markAllRead|clearAll" }],
    response: { success: true },
  },
  {
    method: "DELETE",
    path: "/api/notifications",
    auth: true,
    description: "delete a notification by id",
    params: [{ name: "id", type: "string", required: true, description: "notification id" }],
    response: { success: true },
  },
  {
    method: "PATCH",
    path: "/api/notifications/:id",
    auth: true,
    description: "mark a notification read or unread",
    params: [{ name: "action", type: "string", required: false, description: "read|unread, defaults to read" }],
    response: { notification: {} },
  },
  {
    method: "DELETE",
    path: "/api/notifications/:id",
    auth: true,
    description: "delete a single notification by id",
    response: { success: true },
  },
  {
    method: "GET",
    path: "/api/notifications/preferences",
    auth: true,
    description: "get the current user's notification preferences",
    response: { userId: "string", enabled: true, email: "string", categories: [], quietHours: {} },
  },
  {
    method: "PATCH",
    path: "/api/notifications/preferences",
    auth: true,
    description: "update the current user's notification preferences (merged, not replaced)",
    body: [
      { name: "enabled", type: "boolean", required: false, description: "master toggle" },
      { name: "categories", type: "object[]", required: false, description: "per-category channel config" },
      { name: "quietHours", type: "object", required: false, description: "quiet hours window, shallow-merged" },
    ],
    response: { userId: "string", enabled: true, categories: [], quietHours: {} },
  },
  {
    method: "POST",
    path: "/api/notifications/dispatch",
    auth: true,
    description: "internal endpoint (chain-runner and other services only, X-Internal-Auth) - fans a chain/agent event out to every subscribed user's email/slack/webhook/push/in-app channels per their preferences",
    body: [
      { name: "event", type: "string", required: true, description: "chain-started|chain-completed|chain-stopped|chain-failed|chain-stalled|agent-completed|agent-failed|approval-requested|budget-threshold" },
      { name: "chainId", type: "string", required: false, description: "chain id" },
      { name: "runId", type: "string", required: false, description: "run id" },
      { name: "agentId", type: "string", required: false, description: "agent id" },
      { name: "message", type: "string", required: false, description: "override the default generated message" },
      { name: "namespaceId", type: "string", required: false, description: "defaults to NAMESPACE_ID env" },
    ],
    response: { dispatched: ["string"], event: "string", chainId: "string" },
  },
  {
    method: "POST",
    path: "/api/notifications/email/send",
    auth: true,
    description: "legacy notification email stub (manage_chains) - prefer /api/email/send for production email with quota, suppression, and bounce handling",
    body: [
      { name: "to", type: "string", required: true, description: "recipient email" },
      { name: "subject", type: "string", required: false, description: "email subject, overridden if type template is used" },
      { name: "html", type: "string", required: false, description: "raw html body" },
      { name: "text", type: "string", required: false, description: "plain text body" },
      { name: "type", type: "string", required: false, description: "agent_complete|agent_error|chain_complete|chain_failed|webhook_failed - selects a built-in template" },
    ],
    response: { sent: true },
  },
  {
    method: "GET",
    path: "/api/notifications/push/subscribe",
    auth: true,
    description: "count of active push subscriptions - in-memory only, resets on server restart, not yet persisted",
    response: { count: 0 },
  },
  {
    method: "POST",
    path: "/api/notifications/push/subscribe",
    auth: true,
    description: "register a web push subscription - in-memory only, resets on server restart, not yet persisted",
    body: [
      { name: "endpoint", type: "string", required: true, description: "push service endpoint URL" },
      { name: "keys", type: "object", required: true, description: "p256dh/auth subscription keys" },
    ],
    response: { subscribed: true },
  },
  {
    method: "DELETE",
    path: "/api/notifications/push/subscribe",
    auth: true,
    description: "remove a push subscription by endpoint - in-memory only",
    body: [{ name: "endpoint", type: "string", required: false, description: "endpoint to remove" }],
    response: { unsubscribed: true },
  },
  {
    method: "POST",
    path: "/api/notifications/push/unsubscribe",
    auth: true,
    description: "remove a push subscription by endpoint (alternate route to the DELETE above) - in-memory only",
    body: [{ name: "endpoint", type: "string", required: true, description: "endpoint to remove" }],
    response: { unsubscribed: true },
  },
  {
    method: "POST",
    path: "/api/notifications/push/send",
    auth: true,
    description: "send a push notification to all subscribed devices - simplified demo implementation, does not actually call web-push/VAPID yet",
    body: [{ name: "title", type: "string", required: true, description: "notification title" }],
    response: { success: true, sent: 0, message: "string" },
  },
  // Schedule Control
  {
    method: "POST",
    path: "/api/schedules",
    auth: true,
    description: "create a schedule (cron, event, or one-off target), or trigger a chain immediately if the body is just { chainId }",
    body: [
      { name: "chainId", type: "string", required: false, description: "trigger existing schedule's chain now (omit target/cron for this mode)" },
      { name: "name", type: "string", required: false, description: "schedule display name" },
      { name: "target", type: "object", required: false, description: "chain_run|generate_tasks|run_task|registered_app|raw_exec target (required unless chainId given)" },
      { name: "trigger", type: "object", required: false, description: "cron trigger { type: 'cron', cron, timezone } (default trigger type)" },
      { name: "cron", type: "string", required: false, description: "cron expression, shorthand for trigger.cron" },
      { name: "timezone", type: "string", required: false, description: "IANA timezone, default UTC" },
      { name: "workspacePath", type: "string", required: false, description: "workspace id or path" },
      { name: "goal", type: "string", required: false, description: "task/goal text passed to the chain run" },
      { name: "retryCount", type: "number", required: false, description: "0-3, clamped" },
      { name: "enabled", type: "boolean", required: false, description: "default true" },
    ],
    response: { success: true, schedule: {} },
  },
  {
    method: "DELETE",
    path: "/api/schedules",
    auth: true,
    description: "snooze, unsnooze, or delete a schedule",
    params: [
      { name: "id", type: "string", required: true, description: "schedule id (or chainId)" },
      { name: "action", type: "string", required: true, description: "snooze|unsnooze|delete" },
      { name: "duration", type: "string", required: false, description: "required for snooze, e.g. '30min','2h','1d','1w'" },
    ],
    response: { success: true },
  },
  {
    method: "POST",
    path: "/api/schedules/run",
    auth: true,
    description: "trigger an immediate run of a schedule now, with exponential-backoff retry up to the schedule's retryCount",
    body: [
      { name: "id", type: "string", required: true, description: "schedule id" },
      { name: "triggeredBy", type: "string", required: false, description: "default 'manual'" },
    ],
    response: { success: true, runId: "string", scheduleId: "string", chainId: "string", attempt: 0, totalAttempts: 0 },
  },
  {
    method: "POST",
    path: "/api/schedules/next",
    auth: true,
    description: "calculate the next run time for a cron expression",
    body: [
      { name: "cron", type: "string", required: true, description: "cron expression" },
      { name: "timezone", type: "string", required: false, description: "IANA timezone, default UTC" },
    ],
    response: { next: "string", timezone: "string" },
  },
  {
    method: "GET",
    path: "/api/schedules/history",
    auth: true,
    description: "get execution history for a schedule's chain",
    params: [
      { name: "chainId", type: "string", required: true, description: "chain id" },
      { name: "limit", type: "number", required: false, description: "default 50" },
    ],
    response: { history: [] },
  },
  {
    method: "POST",
    path: "/api/schedules/history",
    auth: true,
    description: "record an execution start (internal, called by /api/schedules/run)",
    body: [
      { name: "chainId", type: "string", required: true, description: "chain id" },
      { name: "chainName", type: "string", required: false, description: "display name" },
      { name: "triggeredBy", type: "string", required: false, description: "default 'manual'" },
      { name: "workspaceId", type: "string", required: false, description: "workspace id" },
      { name: "taskBinding", type: "object", required: false, description: "{ taskId, title }" },
      { name: "retryAttempt", type: "number", required: false, description: "attempt number" },
    ],
    response: { success: true, execution: {} },
  },
  {
    method: "PATCH",
    path: "/api/schedules/history",
    auth: true,
    description: "update an execution's status (internal, called by /api/schedules/run)",
    body: [
      { name: "chainId", type: "string", required: true, description: "chain id" },
      { name: "executionId", type: "string", required: true, description: "execution id" },
      { name: "status", type: "string", required: true, description: "completed|failed|..." },
      { name: "error", type: "string", required: false, description: "error message" },
      { name: "output", type: "string", required: false, description: "captured output" },
    ],
    response: { success: true, execution: {} },
  },
  {
    method: "GET",
    path: "/api/schedules/daemon",
    auth: true,
    description: "background worker status for scheduler, reconciler, auto-run, external effects, chain watcher, and watchdog",
    response: { status: "string", uptimeMs: 0 },
  },
  {
    method: "GET",
    path: "/api/schedules/snooze",
    auth: true,
    description: "get a schedule's snooze state",
    params: [{ name: "scheduleId", type: "string", required: true, description: "schedule id" }],
    response: { snooze: {} },
  },
  {
    method: "POST",
    path: "/api/schedules/snooze",
    auth: true,
    description: "snooze a schedule for a duration",
    body: [
      { name: "scheduleId", type: "string", required: true, description: "schedule id" },
      { name: "duration", type: "string", required: true, description: "e.g. '30min','2h','1d','1w'" },
      { name: "customMinutes", type: "number", required: false, description: "overrides duration if positive" },
    ],
    response: { success: true, snooze: {} },
  },
  {
    method: "DELETE",
    path: "/api/schedules/snooze",
    auth: true,
    description: "remove a schedule's snooze state",
    params: [{ name: "scheduleId", type: "string", required: true, description: "schedule id" }],
    response: { success: true, message: "string" },
  },
  {
    method: "GET",
    path: "/api/schedules/circuit-breaker",
    auth: true,
    description: "get current circuit breaker state",
    response: { enabled: true, maxConcurrentRuns: 0, tripped: false },
  },
  {
    method: "POST",
    path: "/api/schedules/circuit-breaker",
    auth: true,
    description: "trip, reset, kill-switch, or re-enable the circuit breaker",
    body: [
      { name: "action", type: "string", required: true, description: "trip|reset|kill-switch|enable" },
      { name: "reason", type: "string", required: false, description: "required for trip" },
    ],
    response: { enabled: true, maxConcurrentRuns: 0 },
  },
  {
    method: "PUT",
    path: "/api/schedules/circuit-breaker",
    auth: true,
    description: "update circuit breaker config",
    body: [
      { name: "enabled", type: "boolean", required: false, description: "" },
      { name: "maxConcurrentRuns", type: "number", required: false, description: "must be > 0" },
    ],
    response: { enabled: true, maxConcurrentRuns: 0 },
  },
  // Retry & Circuit Breaker
  {
    method: "GET",
    path: "/api/retry/config",
    auth: true,
    description: "get a chain's retry config",
    params: [{ name: "chainId", type: "string", required: true, description: "chain id" }],
    response: { config: {} },
  },
  {
    method: "POST",
    path: "/api/retry/config",
    auth: true,
    description: "save a chain's retry config",
    body: [
      { name: "chainId", type: "string", required: true, description: "chain id" },
      { name: "config", type: "object", required: true, description: "ChainRetryConfig" },
    ],
    response: { success: true, config: {} },
  },
  {
    method: "DELETE",
    path: "/api/retry/config",
    auth: true,
    description: "delete a chain's retry config",
    params: [{ name: "chainId", type: "string", required: true, description: "chain id" }],
    response: { success: true },
  },
  {
    method: "GET",
    path: "/api/retry/circuit",
    auth: true,
    description: "get per-agent circuit breaker state for a chain",
    params: [
      { name: "chainId", type: "string", required: true, description: "chain id" },
      { name: "agent", type: "string", required: true, description: "agent name" },
    ],
    response: { state: {} },
  },
  {
    method: "POST",
    path: "/api/retry/circuit",
    auth: true,
    description: "reset a per-agent circuit breaker state",
    body: [
      { name: "chainId", type: "string", required: true, description: "chain id" },
      { name: "agentName", type: "string", required: true, description: "agent name" },
    ],
    response: { reset: true },
  },
  {
    method: "GET",
    path: "/api/retry/state",
    auth: true,
    description: "get retry state for a run, or list retry states for a chain",
    params: [
      { name: "runId", type: "string", required: false, description: "get one run's state" },
      { name: "chainId", type: "string", required: false, description: "list all states for chain (one of runId/chainId required)" },
    ],
    response: "{ state: {} } | { states: [] }",
  },
  // Organization Sharing
  {
    method: "PUT",
    path: "/api/orgs/:id",
    auth: true,
    description: "update organization",
    body: [
      { name: "name", type: "string", required: false, description: "organization name" },
      { name: "slug", type: "string", required: false, description: "url-safe organization slug" },
      { name: "settings", type: "object", required: false, description: "organization settings" },
    ],
    response: { org: {} },
  },
  {
    method: "PUT",
    path: "/api/orgs/:id/members/:userId",
    auth: true,
    description: "update organization member role",
    body: [
      { name: "role", type: "string", required: true, description: "owner|admin|member|guest" },
    ],
    response: { member: {} },
  },
  {
    method: "DELETE",
    path: "/api/orgs/:id/invites/:inviteId",
    auth: true,
    description: "cancel organization invite",
    response: { cancelled: true },
  },
  {
    method: "GET",
    path: "/api/orgs/:id/stats",
    auth: true,
    description: "get organization statistics (chains, members, tasks, runs)",
    response: { stats: { chainCount: 0, memberCount: 0, taskCount: 0, runCount: 0 } },
  },
  {
    method: "GET",
    path: "/api/orgs/:id/marketplace",
    auth: true,
    description: "list org-private marketplace items (shared chains and agents)",
    params: [
      { name: "type", type: "string", required: false, description: "chain|agent" },
    ],
    response: { items: [], orgId: "string", orgName: "string" },
  },
  {
    method: "POST",
    path: "/api/orgs/:id/marketplace",
    auth: true,
    description: "publish a chain or agent to the org-private marketplace (admin/owner only)",
    body: [
      { name: "type", type: "string", required: true, description: "chain|agent" },
      { name: "name", type: "string", required: true, description: "item name" },
      { name: "description", type: "string", required: false, description: "item description" },
      { name: "data", type: "object", required: true, description: "chain or agent data" },
    ],
    response: { ok: true, item: {} },
  },
  {
    method: "GET",
    path: "/api/orgs/:id/shared/chains",
    auth: true,
    description: "list org-shared chains",
    params: [
      { name: "name", type: "string", required: false, description: "get a single shared chain by name" },
    ],
    response: { chains: [] },
  },
  {
    method: "POST",
    path: "/api/orgs/:id/shared/chains",
    auth: true,
    description: "share a chain with the org (admin/owner only)",
    body: [
      { name: "name", type: "string", required: true, description: "chain name" },
      { name: "description", type: "string", required: false, description: "chain description" },
      { name: "chainData", type: "object", required: true, description: "chain configuration" },
    ],
    response: { name: "string", description: "string", sharedAt: "string", sharedBy: "string", chainData: {} },
  },
  {
    method: "DELETE",
    path: "/api/orgs/:id/shared/chains",
    auth: true,
    description: "unshare a chain (admin/owner only)",
    params: [
      { name: "name", type: "string", required: true, description: "chain name to unshare" },
    ],
    response: { ok: true },
  },
  {
    method: "GET",
    path: "/api/orgs/:id/shared/profiles",
    auth: true,
    description: "list org-shared config profiles",
    params: [
      { name: "type", type: "string", required: false, description: "filter by profile type" },
    ],
    response: { profiles: [] },
  },
  {
    method: "POST",
    path: "/api/orgs/:id/shared/profiles",
    auth: true,
    description: "share a config profile with the org (admin/owner only)",
    body: [
      { name: "type", type: "string", required: true, description: "profile type" },
      { name: "name", type: "string", required: true, description: "profile name" },
      { name: "description", type: "string", required: false, description: "profile description" },
      { name: "profileData", type: "object", required: true, description: "profile configuration" },
    ],
    response: { type: "string", name: "string", description: "string", sharedAt: "string", sharedBy: "string", profileData: {} },
  },
  {
    method: "DELETE",
    path: "/api/orgs/:id/shared/profiles",
    auth: true,
    description: "unshare a config profile (admin/owner only)",
    params: [
      { name: "type", type: "string", required: true, description: "profile type" },
      { name: "name", type: "string", required: true, description: "profile name" },
    ],
    response: { ok: true },
  },
  {
    method: "GET",
    path: "/api/orgs/:id/shared/secrets",
    auth: true,
    description: "list org-shared secrets (value masked unless caller role meets secret's minRole)",
    params: [
      { name: "name", type: "string", required: false, description: "get a single secret by name" },
    ],
    response: { secrets: [] },
  },
  {
    method: "POST",
    path: "/api/orgs/:id/shared/secrets",
    auth: true,
    description: "create or update a shared secret (admin/owner only)",
    body: [
      { name: "name", type: "string", required: true, description: "secret name" },
      { name: "description", type: "string", required: false, description: "secret description" },
      { name: "value", type: "string", required: true, description: "secret value (never echoed back)" },
      { name: "minRole", type: "string", required: false, description: "member|admin|owner, minimum role to read the value; default member" },
    ],
    response: { name: "string", description: "string", minRole: "string", createdAt: "string", updatedAt: "string", createdBy: "string", canRead: true },
  },
  {
    method: "DELETE",
    path: "/api/orgs/:id/shared/secrets",
    auth: true,
    description: "delete a shared secret (admin/owner only)",
    params: [
      { name: "name", type: "string", required: true, description: "secret name to delete" },
    ],
    response: { ok: true },
  },
  // Agent Links
  {
    method: "GET",
    path: "/api/links/list",
    auth: true,
    description: "list agent links (namespace/org scoped)",
    response: { links: [], namespaceId: "string" },
  },
  {
    method: "POST",
    path: "/api/links/save",
    auth: true,
    description: "create or update an agent link",
    body: [
      { name: "link", type: "object", required: true, description: "link definition — requires name, agents.agent1, agents.agent2, config.mode" },
    ],
    response: { link: {} },
  },
  {
    method: "POST",
    path: "/api/links/generate/apply",
    auth: true,
    description: "apply an AI-generated link from a completed generation job, creating referenced agents if the AI defined new ones inline",
    body: [
      { name: "jobId", type: "string", required: true, description: "completed link-generation job id" },
    ],
    response: { link: {}, createdAgents: [] },
  },
  {
    method: "GET",
    path: "/api/links/runs/:runId/transcript",
    auth: true,
    description: "get chronological peer transcript for a link run, reconstructed from peer output files",
    response: { transcript: [], runId: "string" },
  },
  {
    method: "GET",
    path: "/api/links/runs/:runId/summary",
    auth: true,
    description: "get the generated run summary, or whether generation is pending",
    response: { summary: {}, hasSummary: true, hasPendingJob: false },
  },
  {
    method: "POST",
    path: "/api/links/runs/:runId/generate-summary",
    auth: true,
    description: "start AI generation of a run summary from the transcript, moderator relay data, and escalations",
    params: [
      { name: "cli", type: "string", required: false, description: "comma-separated CLI providers to search session logs (default codex,claude-code)" },
    ],
    response: { jobId: "string", status: "generating" },
  },
  {
    method: "GET",
    path: "/api/links/runs/:runId/moderator",
    auth: true,
    description: "get moderator relay sessions (CLI JSONL logs) detected during the run's time window",
    params: [
      { name: "cli", type: "string", required: false, description: "comma-separated CLI providers to search session logs" },
    ],
    response: { sessions: [], runId: "string" },
  },
  {
    method: "GET",
    path: "/api/links/runs/:runId/escalations",
    auth: true,
    description: "list escalations for a link run and whether one is pending a human reply",
    response: { runId: "string", escalations: [], pending: true, telegram_connected: true },
  },
  {
    method: "POST",
    path: "/api/links/runs/:runId/escalate",
    auth: true,
    description: "record an escalation (agents stalled, need human input); auto-generates a one-sentence disagreement summary via the default agent profile",
    body: [
      { name: "escalation_id", type: "string", required: false, description: "defaults to esc-<timestamp>" },
      { name: "round", type: "number", required: false, description: "round number" },
      { name: "trigger", type: "string", required: false, description: "defaults to STALL" },
      { name: "consecutive_continues", type: "number", required: false, description: "consecutive continue count" },
      { name: "peer1_last", type: "string", required: false, description: "peer 1's last message, used for the auto-summary" },
      { name: "peer2_last", type: "string", required: false, description: "peer 2's last message, used for the auto-summary" },
    ],
    response: { ok: true, telegram_sent: false, telegram_message_id: null },
  },
  {
    method: "POST",
    path: "/api/links/runs/:runId/reply",
    auth: true,
    description: "submit a human reply to an escalation, unblocking the run",
    body: [{ name: "reply", type: "string", required: true, description: "reply text" }],
    response: { ok: true },
  },
  {
    method: "POST",
    path: "/api/links/runs/:runId/stop",
    auth: true,
    description: "stop a link run — kills manager and agent pty sessions, marks run and running agents stopped",
    response: { stopped: [], runId: "string" },
  },
  // Kollabor Engine Proxy & Integrations
  {
    method: "ANY",
    path: "/api/kollabor/engine/[...path]",
    auth: true,
    description: "reverse proxy to the local Kollabor engine (loopback :7433 by default) — forwards method/body/headers 1:1 and streams SSE responses through. PATCH and DELETE always return 405 except DELETE .../profiles/:name (profile removal). POST .../sessions is special-cased: mints a Mentiko session JWT and injects session_id/user_token into the forwarded body so the engine can hand it to the MCP subprocess at spawn time.",
    response: "passthrough of upstream body/status/content-type",
  },
  {
    method: "POST",
    path: "/api/kollabor/engine/sessions/:id/refresh-token",
    auth: true,
    description: "re-mint a session JWT for an existing engine session. Two auth paths: browser session cookie, or an internal engine-initiated call gated by INTERNAL_SERVICE_SECRET bearer + loopback-origin check + a 10-refreshes-per-60s rate limit (the latter reads the expired token from an x-session-token header to recover claims)",
    response: { session_token: "string" },
  },
  {
    method: "GET",
    path: "/api/kollabor/token",
    auth: true,
    description: "discover the same-origin engine proxy base URL — the browser never talks to the engine directly",
    response: { token: "proxied", baseUrl: "/api/kollabor/engine" },
  },
  {
    method: "GET",
    path: "/api/kollabor/profiles/active",
    auth: true,
    description: "get the active Kollabor LLM profile name; lazily re-registers the mentiko gateway profile once per boot if the AI gateway is enabled but not yet active",
    response: { active: "string" },
  },
  {
    method: "POST",
    path: "/api/kollabor/profiles/active",
    auth: true,
    description: "set the active Kollabor LLM profile — validated against the engine's profile list and must support tool calling",
    body: [{ name: "name", type: "string", required: true, description: "profile name" }],
    response: { ok: true, active: "string" },
  },
  {
    method: "POST",
    path: "/api/kollabor/profiles/save",
    auth: true,
    description: "create or update a Kollabor LLM profile on the engine; api key resolved from a vault secret name or a raw fallback value",
    body: [
      { name: "name", type: "string", required: true, description: "profile name" },
      { name: "provider", type: "string", required: false, description: "provider id" },
      { name: "model", type: "string", required: false, description: "model id" },
      { name: "description", type: "string", required: false, description: "profile description" },
      { name: "base_url", type: "string", required: false, description: "custom provider base url" },
      { name: "api_key_secret", type: "string", required: false, description: "vault secret name to resolve the api key from" },
      { name: "api_key", type: "string", required: false, description: "raw api key, fallback if api_key_secret not set (not recommended)" },
      { name: "editing", type: "boolean", required: false, description: "true = PUT (update existing profile), false = POST (create)" },
    ],
    response: "engine profile response, status code passed through",
  },
  {
    method: "POST",
    path: "/api/kollabor/setup/mentiko",
    auth: true,
    description: "bootstrap the mentiko kollab runtime — syncs the shipped mentiko agent bundle into ~/.kollab/agents/mentiko (content-hash guarded, skips if unchanged) and registers the mentiko MCP server in ~/.kollab/mcp/mcp_settings.json",
    response: { ok: true, agent: {}, mcp: {}, synced: true, agentSynced: true, mcpSynced: true },
  },
  {
    method: "POST",
    path: "/api/integrations/test",
    auth: true,
    description: "test an integration connection (github/teams/slack/email) — sends a real test issue/message where applicable",
    body: [
      { name: "integration", type: "string", required: true, description: "github|teams|slack|email" },
      { name: "config", type: "object", required: false, description: "integration credentials/config; falls back to env vars per integration" },
    ],
    response: { success: true, message: "string", details: "string" },
  },
  {
    method: "POST",
    path: "/api/integrations/github/test",
    auth: true,
    description: "validate a github token, and if owner+repo are given, check repo access and permissions",
    body: [
      { name: "token", type: "string", required: true, description: "github token" },
      { name: "owner", type: "string", required: false, description: "repo owner" },
      { name: "repo", type: "string", required: false, description: "repo name" },
    ],
    response: { token: { success: true, login: "string", name: "string" }, repo: { success: true, full_name: "string", private: false, permissions: {} } },
  },
];

const methodColors: Record<string, string> = {
  GET: "text-green-400",
  POST: "text-blue-400",
  PUT: "text-yellow-400",
  PATCH: "text-purple-400",
  DELETE: "text-red-400",
  ANY: "text-zinc-400",
};

export default function ApiDocsPage() {
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<ApiEndpoint | null>(null);

  const filtered = endpoints.filter(
    (e) =>
      e.path.toLowerCase().includes(filter.toLowerCase()) ||
      e.description.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div>
      <PageBanner
        title="API Reference"
        subtitle="Mentiko REST API reference. All endpoints for chains, runs, agents, events, and system management."
        icon={CodeFilled}
        sectionColor="#f59e0b"
      />
    <div className="min-h-screen text-zinc-100 p-8">
      <div className="max-w-6xl mx-auto">

        <input
          type="text"
          placeholder="filter endpoints..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full bg-zinc-900 border border-zinc-800 rounded px-4 py-2 mb-6 focus:outline-none focus:border-zinc-600"
        />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 space-y-2 max-h-[70vh] overflow-y-auto">
            {filtered.map((ep, i) => (
              <button
                key={i}
                onClick={() => setSelected(ep)}
                className={`w-full text-left p-3 rounded border transition ${
                  selected === ep
                    ? "bg-zinc-800 border-zinc-600"
                    : "bg-zinc-900/50 border-zinc-800 hover:border-zinc-700"
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs font-mono font-bold ${methodColors[ep.method]}`}>
                    {ep.method}
                  </span>
                  {ep.auth && <span className="text-xs text-zinc-500">[auth]</span>}
                </div>
                <div className="text-sm font-mono text-zinc-300 truncate">{ep.path}</div>
                <div className="text-xs text-zinc-500 mt-1">{ep.description}</div>
              </button>
            ))}
          </div>

          <div className="lg:col-span-2">
            {selected ? (
              <div className="bg-zinc-900 border border-zinc-800 rounded p-6">
                <div className="flex items-center gap-3 mb-4">
                  <span className={`text-sm font-mono font-bold px-2 py-1 rounded bg-zinc-800 ${methodColors[selected.method]}`}>
                    {selected.method}
                  </span>
                  <span className="text-lg font-mono">{selected.path}</span>
                  {selected.auth && (
                    <span className="text-xs bg-yellow-900/50 text-yellow-400 px-2 py-1 rounded">
                      auth required
                    </span>
                  )}
                </div>

                <p className="text-zinc-400 mb-6">{selected.description}</p>

                {selected.params && selected.params.length > 0 && (
                  <div className="mb-6">
                    <h3 className="text-sm font-semibold text-zinc-300 mb-2">Query Params</h3>
                    <div className="bg-zinc-950 rounded p-3">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-zinc-500 border-b border-zinc-800">
                            <th className="text-left pb-2">name</th>
                            <th className="text-left pb-2">type</th>
                            <th className="text-left pb-2">required</th>
                            <th className="text-left pb-2">description</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selected.params.map((p, i) => (
                            <tr key={i} className="border-b border-zinc-800/50">
                              <td className="py-2 font-mono text-zinc-300">{p.name}</td>
                              <td className="py-2 text-zinc-400">{p.type}</td>
                              <td className="py-2">{p.required ? "+" : "-"}</td>
                              <td className="py-2 text-zinc-500">{p.description}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {selected.body && selected.body.length > 0 && (
                  <div className="mb-6">
                    <h3 className="text-sm font-semibold text-zinc-300 mb-2">Request Body</h3>
                    <div className="bg-zinc-950 rounded p-3">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-zinc-500 border-b border-zinc-800">
                            <th className="text-left pb-2">name</th>
                            <th className="text-left pb-2">type</th>
                            <th className="text-left pb-2">required</th>
                            <th className="text-left pb-2">description</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selected.body.map((p, i) => (
                            <tr key={i} className="border-b border-zinc-800/50">
                              <td className="py-2 font-mono text-zinc-300">{p.name}</td>
                              <td className="py-2 text-zinc-400">{p.type}</td>
                              <td className="py-2">{p.required ? "+" : "-"}</td>
                              <td className="py-2 text-zinc-500">{p.description}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <div>
                  <h3 className="text-sm font-semibold text-zinc-300 mb-2">Response</h3>
                  <pre className="bg-zinc-950 rounded p-3 text-sm overflow-x-auto">
                    <code className="text-zinc-300">
                      {JSON.stringify(selected.response, null, 2)}
                    </code>
                  </pre>
                </div>
              </div>
            ) : (
              <div className="bg-zinc-900 border border-zinc-800 rounded p-8 text-center text-zinc-500">
                select an endpoint to view details
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
    </div>
  );
}
