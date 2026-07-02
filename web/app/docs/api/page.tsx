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
    method: "PATCH",
    path: "/api/workspaces/:id/task-provider",
    auth: true,
    description: "set task provider",
    body: [{ name: "provider", type: "string", required: true, description: "provider name" }],
    response: { success: true },
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
    path: "/api/tasks",
    auth: true,
    description: "create task",
    body: [
      { name: "subject", type: "string", required: true, description: "task subject" },
      { name: "description", type: "string", required: true, description: "task description" },
      { name: "parentId", type: "string", required: false, description: "parent task id" },
      { name: "workspacePath", type: "string", required: false, description: "workspace path" },
    ],
    response: { task: {} },
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
    method: "DELETE",
    path: "/api/tasks/:id",
    auth: true,
    description: "delete task",
    response: { success: true },
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
    path: "/api/links",
    auth: true,
    description: "list agent links",
    response: { links: [] },
  },
  {
    method: "POST",
    path: "/api/links",
    auth: true,
    description: "create agent link",
    body: [
      { name: "name", type: "string", required: true, description: "link name" },
      { name: "agentA", type: "string", required: true, description: "first agent id" },
      { name: "agentB", type: "string", required: true, description: "second agent id" },
    ],
    response: { link: {} },
  },
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
    method: "PATCH",
    path: "/api/links/:id",
    auth: true,
    description: "update agent link",
    body: [
      { name: "name", type: "string", required: false, description: "link name" },
      { name: "agentA", type: "string", required: false, description: "first agent id" },
      { name: "agentB", type: "string", required: false, description: "second agent id" },
    ],
    response: { success: true, link: {} },
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
    method: "GET",
    path: "/api/webhooks/:id",
    auth: true,
    description: "get webhook",
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
    method: "PATCH",
    path: "/api/webhooks/:id",
    auth: true,
    description: "update webhook",
    body: [
      { name: "name", type: "string", required: false, description: "webhook name" },
      { name: "url", type: "string", required: false, description: "webhook url" },
      { name: "events", type: "string[]", required: false, description: "events to trigger on" },
    ],
    response: { success: true, webhook: {} },
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
    method: "GET",
    path: "/api/integrations/test",
    auth: true,
    description: "test integration endpoint",
    body: [
      { name: "integration", type: "string", required: true, description: "github|teams|slack|email" },
      { name: "config", type: "object", required: false, description: "integration config" },
    ],
    response: { success: true, message: "string", details: "string" },
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
    path: "/api/templates/:source/:dirName/use",
    auth: true,
    description: "copy template to namespace chains",
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
    method: "POST",
    path: "/api/pty/sessions",
    auth: true,
    description: "create pty session",
    body: [
      { name: "name", type: "string", required: true, description: "session name" },
      { name: "command", type: "string", required: false, description: "command to run" },
    ],
    response: { session: {} },
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
  {
    method: "POST",
    path: "/api/pty/sessions/:name/restart",
    auth: true,
    description: "restart pty session",
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
    method: "DELETE",
    path: "/api/fs/file",
    auth: true,
    description: "delete file",
    params: [{ name: "path", type: "string", required: true, description: "file path" }],
    response: { success: true },
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
    method: "PATCH",
    path: "/api/orgs/:id",
    auth: true,
    description: "update organization",
    body: [{ name: "name", type: "string", required: false, description: "organization name" }],
    response: { success: true, org: {} },
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
    method: "PATCH",
    path: "/api/orgs/:id/members/:userId",
    auth: true,
    description: "update organization member",
    body: [{ name: "role", type: "string", required: false, description: "member role" }],
    response: { success: true, member: {} },
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
    method: "PATCH",
    path: "/api/system/settings",
    auth: true,
    description: "update system settings",
    body: [{ name: "settings", type: "object", required: true, description: "settings object" }],
    response: { success: true },
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
    path: "/api/secrets/:name",
    auth: true,
    description: "delete secret",
    response: { success: true },
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
    path: "/api/ssh-keys/:name",
    auth: true,
    description: "delete ssh key",
    response: { success: true },
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
    method: "GET",
    path: "/api/events/triggers/:id",
    auth: true,
    description: "get trigger",
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
];

const methodColors: Record<string, string> = {
  GET: "text-green-400",
  POST: "text-blue-400",
  PUT: "text-yellow-400",
  PATCH: "text-purple-400",
  DELETE: "text-red-400",
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
