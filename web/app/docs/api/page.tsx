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
    path: "/api/auth/me",
    auth: false,
    description: "check authentication status",
    response: { authenticated: true },
  },
  {
    method: "POST",
    path: "/api/auth/login",
    auth: false,
    description: "authenticate with password",
    body: [{ name: "password", type: "string", required: true, description: "login password" }],
    response: { success: true },
  },
  {
    method: "POST",
    path: "/api/auth/logout",
    auth: false,
    description: "destroy current session",
    response: { success: true },
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
    response: { steps: [], status: "string" },
  },
  {
    method: "POST",
    path: "/api/chains/:id/debug",
    auth: true,
    description: "control debug run (continue/skip/retry/abort)",
    body: [
      { name: "action", type: "string", required: true, description: "continue|skip|retry|abort" },
      { name: "stepIndex", type: "number", required: false, description: "step to act on" },
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
      { name: "chain", type: "string", required: false, description: "chain name" },
      { name: "config", type: "object", required: false, description: "integration config" },
    ],
    response: { success: true, message: "string", details: "string" },
  },
  {
    method: "POST",
    path: "/api/integrations/save",
    auth: true,
    description: "save integration config",
    body: [{ name: "github", type: "object", required: false, description: "github config" }],
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
