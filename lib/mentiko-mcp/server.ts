import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { TOOLS } from "./tools.js";
import { dispatchEffect, waitForResult } from "./dispatch.js";
import * as chains from "./handlers/chains.js";
import * as agents from "./handlers/agents.js";
import * as tasks from "./handlers/tasks.js";
import * as files from "./handlers/files.js";
import * as context from "./handlers/context.js";
import * as templates from "./handlers/templates.js";
import * as filesystem from "./handlers/filesystem.js";
import * as terminal from "./handlers/terminal.js";
import * as meta from "./handlers/meta.js";
import * as notifications from "./handlers/notifications.js";
import * as decisionsHandler from "./handlers/decisions.js";
import * as onboarding from "./handlers/onboarding.js";
import * as schedules from "./handlers/schedules.js";
import * as applications from "./handlers/applications.js";
import * as jobs from "./handlers/jobs.js";
import * as runtime from "./handlers/runtime.js";
import * as auth from "./handlers/auth.js";
import * as uiControl from "./handlers/ui-control.js";

// Simple fuzzy matching: score based on substring presence and position
function fuzzyMatch(query: string, target: string): number {
  if (!query) return 0;
  if (!target) return 0;
  const idx = target.indexOf(query);
  if (idx === 0) return 1.0; // exact prefix match
  if (idx > 0) return 0.6; // substring match
  // Check if all chars in query are in target (in order)
  let qIdx = 0;
  let tIdx = 0;
  while (qIdx < query.length && tIdx < target.length) {
    if (query[qIdx] === target[tIdx]) qIdx++;
    tIdx++;
  }
  if (qIdx === query.length) return 0.3; // all chars found, out of order
  return 0;
}

const SERVER_VERSION = "0.1.0";

const server = new Server(
  { name: "mentiko-mcp", version: SERVER_VERSION },
  { capabilities: { tools: {} } },
);

// ---------- permission tier system ----------
//
// Tier A: auto-execute (read-only + navigation + UI effects)
// Tier B: require user approval once per session (recoverable writes)
//         "approve always" stores in approvedAlways set — skips future prompts
// Tier C: require user approval every time (destructive ops)
//         no "approve always" option
//
// approval is MCP-side via ask_confirm, independent of engine permission_request.

const TIER_B = new Set([
  "create_chain_draft",
  "save_chain_json",
  "rename_chain",
  "create_agent",
  "attach_agent_to_chain",
  "detach_agent_from_chain",
  "create_task",
  "generate_tasks",
  "mark_task_done",
  "update_task",
  "comment_task",
  "add_task_dependency",
  "remove_task_dependency",
  "create_workspace",
  "write_file",
  "show_terminal",
  "start_new_decision",
  "install_template",
  "set_notification_prefs",
  "select_decision_option",
  "approve_decision",
  "start_cli_auth",
]);

const TIER_C = new Set([
  "delete_chain",
  "create_schedule",
  "update_schedule",
  "delete_schedule",
  "run_schedule_now",
  "register_application",
  "update_application",
  "delete_application",
  "send_command",
  "start_run",
  "run_task_chain",
  "cancel_run",
  "create_secret",
]);

// session-scoped: tools approved-always by the user this session
const approvedAlways = new Set<string>();

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function errorResult(message: string) {
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    isError: true,
  };
}

// ---------- auth-failure recovery (Phase 1) ----------
//
// Ops calls fail with these shapes when the session token is expired/invalid:
//   - "MENTIKO_SESSION_TOKEN not set — session auth required"  (no token at all)
//   - "GET <path> failed: 401 <body>"                          (401 after refresh retry)
//   - "...Invalid or expired session token"                    (verifySessionToken rejected)
// Instead of surfacing a raw 401, tell the user how to recover. Phase 3 upgrades
// this to auto-start the device flow and embed a live sign-in link.
function isAuthFailure(message: string): boolean {
  return (
    /session auth required/i.test(message) ||
    /failed:\s*401\b/.test(message) ||
    /invalid or expired session token/i.test(message)
  );
}

function authRecoveryResult(originalMessage: string) {
  return {
    content: [
      {
        type: "text" as const,
        text:
          "🔑 Your Mentiko session has expired or isn't authenticated.\n\n" +
          "Run the `reconnect` tool to get a one-time sign-in link, then approve it in " +
          "the Mentiko app. After you approve, this connection refreshes automatically — " +
          "no restart needed.\n\n" +
          `(underlying error: ${originalMessage})`,
      },
    ],
    isError: true,
  };
}

function genToolId(name: string): string {
  return `${name}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function formatArgsPreview(args: Record<string, any>): string {
  const str = JSON.stringify(args, null, 2);
  return str.length > 300 ? str.slice(0, 300) + "…" : str;
}

// Returns true if the tool is allowed to proceed. For tier-B/C, dispatches
// an ask_confirm to the user and blocks until they respond.
async function checkPermission(
  toolName: string,
  args: Record<string, any>,
): Promise<{ allowed: boolean; approvedAlwaysGranted: boolean }> {
  const isB = TIER_B.has(toolName);
  const isC = TIER_C.has(toolName);

  if (!isB && !isC) return { allowed: true, approvedAlwaysGranted: false };

  // Approval is the bridge's responsibility ONLY in application/bar mode — i.e.
  // when the Mentiko app launched this subprocess wired to the portal's approval
  // UI. The signal is MENTIKO_INBOX_KEY, the dispatch-channel credential the app
  // injects (see web/lib/kollabor-mcp-server-env.ts; the same launch sets
  // MENTIKO_MCP_TOOL_SCOPE=bar). Without it, the bridge is running under a standard
  // MCP host (Claude Code, Claude Desktop, CI) that has ALREADY obtained the user's
  // approval for this tool call before invoking it — re-gating here is redundant
  // double-gating. Defer to the host and allow.
  if (!process.env.MENTIKO_INBOX_KEY) {
    return { allowed: true, approvedAlwaysGranted: false };
  }

  // ----- application/bar mode: per-call approval through the portal -----
  // tier-B: skip if already approved-always this session
  if (isB && approvedAlways.has(toolName)) {
    return { allowed: true, approvedAlwaysGranted: false };
  }

  const riskLabel = isC ? "high" : "medium";
  const preview = formatArgsPreview(args);
  const question = isC
    ? `allow ${toolName}? (high risk — no "always" option)\n\n${preview}`
    : `allow ${toolName}?\n\n${preview}`;

  const options = isC
    ? ["approve", "deny"]
    : ["approve", "approve always", "deny"];

  const toolId = genToolId(`perm_${toolName}`);
  let result: unknown;
  try {
    await dispatchEffect(
      "ask_choice",
      {
        prompt: question,
        options,
        toolId,
        _riskLevel: riskLabel,
      },
      { waitForDelivery: true },
    );
    result = await waitForResult(toolId);
  } catch {
    // No UI response means no approval. Permission-gated tools must fail closed.
    return { allowed: false, approvedAlwaysGranted: false };
  }
  const choice =
    typeof result === "string"
      ? result
      : (result as any)?.value ?? (result as any)?.choice ?? "";

  if (choice === "deny") return { allowed: false, approvedAlwaysGranted: false };

  const grantedAlways = !isC && choice === "approve always";
  if (grantedAlways) approvedAlways.add(toolName);

  return { allowed: true, approvedAlwaysGranted: grantedAlways };
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
  const { name, arguments: rawArgs } = request.params;
  const args = (rawArgs || {}) as Record<string, any>;

  try {
    // ---------- context (tier A) ----------
    if (name === "get_current_page") {
      const result = await chains.getCurrentPage();
      if (!result?.page) {
        return textResult(
          "No current page reported yet. The user's bar hasn't pushed a location — usually means the bar isn't mounted or they just opened the app.",
        );
      }
      const { pathname, search, label, updatedAt } = result.page;
      const age = Math.round((Date.now() - updatedAt) / 1000);
      return textResult(
        JSON.stringify({ pathname, search, label, ageSec: age }, null, 2),
      );
    }

    if (name === "get_user_context") {
      const result = await context.getUserContext();
      return textResult(JSON.stringify(result, null, 2));
    }

    if (name === "get_active_workspace") {
      const result = await context.getActiveWorkspace();
      return textResult(JSON.stringify(result, null, 2));
    }

    if (name === "get_recent_activity") {
      const result = await context.getRecentActivity();
      return textResult(JSON.stringify(result, null, 2));
    }

    // ---------- chains (tier A reads, tier B/C writes) ----------
    if (name === "list_chains") {
      const result = await chains.listChains();
      return textResult(JSON.stringify(result, null, 2));
    }

    if (name === "create_chain_draft") {
      const { allowed } = await checkPermission(name, args);
      if (!allowed) return textResult("Permission denied by user.");
      const result = await chains.createChainDraft(args.name, args.template);
      await dispatchEffect("navigate", { route: `/chains/${result.id}/edit` });
      return textResult(`Chain draft created: ${result.id}`);
    }

    if (name === "save_chain_json") {
      const { allowed } = await checkPermission(name, args);
      if (!allowed) return textResult("Permission denied by user.");
      const chainName = args.name || (args.chain as any)?.name;
      if (!chainName) return textResult("Error: missing 'name' field.");
      const result = await chains.saveChainJson(
        chainName,
        args.chain,
        !!args.overwrite,
      );
      await dispatchEffect("navigate", { route: `/chains/${result.id}/edit` });
      return textResult(
        `Chain saved: ${result.id} (${result.agentCount ?? 0} agents)`,
      );
    }

    if (name === "open_chain") {
      await dispatchEffect("navigate", { route: `/chains/${args.id}/edit` });
      return textResult(`Opening chain: ${args.id}`);
    }

    if (name === "rename_chain") {
      const { allowed } = await checkPermission(name, args);
      if (!allowed) return textResult("Permission denied by user.");
      const result = await chains.renameChain(args.id, args.name);
      await dispatchEffect("navigate", { route: `/chains/${result.id}/edit` });
      return textResult(`Chain renamed: ${args.id} → ${result.id}`);
    }

    if (name === "delete_chain") {
      const { allowed } = await checkPermission(name, args);
      if (!allowed) return textResult("Permission denied by user.");
      await chains.deleteChain(args.id);
      await dispatchEffect("navigate", { route: "/chains" });
      return textResult(`Chain deleted: ${args.id}`);
    }

    if (name === "attach_agent_to_chain") {
      const { allowed } = await checkPermission(name, args);
      if (!allowed) return textResult("Permission denied by user.");
      const result = await chains.attachAgent(args.chainId, args.agentId, args.position);
      await dispatchEffect("navigate", { route: `/chains/${result.chainId}/edit` });
      return textResult(
        `Agent ${result.agentId} attached to chain ${result.chainId} (${result.agentCount} agents total)`,
      );
    }

    if (name === "detach_agent_from_chain") {
      const { allowed } = await checkPermission(name, args);
      if (!allowed) return textResult("Permission denied by user.");
      const result = await chains.detachAgent(args.chainId, args.agentId);
      await dispatchEffect("navigate", { route: `/chains/${result.chainId}/edit` });
      return textResult(
        `Agent ${result.agentId} removed from chain ${result.chainId} (${result.agentCount} agents remaining)`,
      );
    }

    // ---------- agents (tier A reads, tier B writes) ----------
    if (name === "list_agents") {
      const result = await agents.listAgents(args.scope);
      return textResult(JSON.stringify(result, null, 2));
    }

    if (name === "create_agent") {
      const { allowed } = await checkPermission(name, args);
      if (!allowed) return textResult("Permission denied by user.");
      const result = await agents.createAgent(args.name, args.prompt, args.profile);
      await dispatchEffect("navigate", { route: `/agents/${result.id}/edit` });
      return textResult(`Agent created: ${result.id}`);
    }

    if (name === "open_agent") {
      await dispatchEffect("navigate", { route: `/agents/${args.id}/edit` });
      return textResult(`Opening agent: ${args.id}`);
    }

    // ---------- tasks (tier A reads, tier B writes) ----------
    if (name === "list_tasks") {
      const result = await tasks.listTasks({
        status: args.status,
        query: args.query,
        limit: args.limit,
        offset: args.offset,
      });
      return textResult(JSON.stringify(result, null, 2));
    }

    if (name === "create_task") {
      const { allowed } = await checkPermission(name, args);
      if (!allowed) return textResult("Permission denied by user.");
      const result = await tasks.createTask({
        subject: args.subject,
        desc: args.desc,
        parentId: args.parentId,
        workspacePath: args.workspace_path,
        issue_type: args.issue_type,
        priority: args.priority,
        owner: args.owner,
        assignee: args.assignee,
        labels: args.labels,
        notes: args.notes,
        acceptance_criteria: args.acceptance_criteria,
        design: args.design,
        estimated_minutes: args.estimated_minutes,
        due_at: args.due_at,
      });
      const taskId = result?.task?.id;
      if (taskId) await dispatchEffect("navigate", { route: `/tasks/${taskId}` });
      return textResult(`Task created: ${taskId || JSON.stringify(result)}`);
    }

    if (name === "get_task") {
      const result = await tasks.getTask(args.id);
      return textResult(JSON.stringify(result, null, 2));
    }

    if (name === "update_task") {
      const { allowed } = await checkPermission(name, args);
      if (!allowed) return textResult("Permission denied by user.");
      const { id, ...fields } = args;
      const result = await tasks.updateTask(id, fields);
      return textResult(`Task updated: ${id}\n${JSON.stringify(result, null, 2)}`);
    }

    if (name === "comment_task") {
      const { allowed } = await checkPermission(name, args);
      if (!allowed) return textResult("Permission denied by user.");
      await tasks.commentTask(args.id, args.text);
      return textResult(`Comment added to ${args.id}.`);
    }

    if (name === "add_task_dependency") {
      const { allowed } = await checkPermission(name, args);
      if (!allowed) return textResult("Permission denied by user.");
      await tasks.addTaskDependency(args.taskId, args.dependsOnId);
      return textResult(`Dependency added: ${args.taskId} depends on ${args.dependsOnId}.`);
    }

    if (name === "remove_task_dependency") {
      const { allowed } = await checkPermission(name, args);
      if (!allowed) return textResult("Permission denied by user.");
      await tasks.removeTaskDependency(args.taskId, args.dependsOnId);
      return textResult(`Dependency removed: ${args.taskId} no longer depends on ${args.dependsOnId}.`);
    }

    if (name === "generate_tasks") {
      const { allowed } = await checkPermission(name, args);
      if (!allowed) return textResult("Permission denied by user.");
      const autoRun = args.auto_run === true || args.autoRun === true;
      const sendToDecisionIfWarranted = args.send_to_decision_if_warranted !== false;
      const mode = args.mode === "decision" ? "decision" : "task";
      const result = await tasks.generateTasks(
        args.description,
        args.workspace_path,
        autoRun,
        sendToDecisionIfWarranted,
        mode,
      );
      // Decision routing (warranted heuristic or explicit mode=decision)
      if (result && typeof result === "object" && "routedTo" in result) {
        const { decisionId, taskId } = result;
        await dispatchEffect("navigate", { route: `/decisions?id=${encodeURIComponent(decisionId)}` });
        return textResult(
          `Routed to a decision (prompt looked strategic/complex, or mode=decision). `
          + `decisionId: ${decisionId}, taskId: ${taskId}. The human steps through it in /decisions.`
          + ` To force a task tree instead, retry with send_to_decision_if_warranted: false.`,
        );
      }
      const runId = result?.runId;
      const jobId = result?.jobId;
      if (runId) await dispatchEffect("navigate", { route: `/runs/${runId}` });
      return textResult(
        `Task generation started — async. runId: ${runId || "?"}, jobId: ${jobId || "?"}. `
        + `Poll get_job { id: "${jobId}" } until status is "complete"; the result carries the created task IDs (parentId/createdTaskIds).`
        + `${autoRun ? " auto-run enabled (fires on completion)." : ""}`,
      );
    }

    if (name === "mark_task_done") {
      const { allowed } = await checkPermission(name, args);
      if (!allowed) return textResult("Permission denied by user.");
      await tasks.markTaskDone(args.id);
      return textResult(`Task marked done: ${args.id}`);
    }

    if (name === "open_task") {
      await dispatchEffect("navigate", { route: `/tasks/${args.id}` });
      return textResult(`Opening task: ${args.id}`);
    }

    // ---------- schedules (tier A reads, tier C writes/runs) ----------
    if (name === "list_schedules") {
      const result = await schedules.listSchedules();
      return textResult(JSON.stringify(result, null, 2));
    }

    if (name === "create_schedule") {
      const { allowed } = await checkPermission(name, args);
      if (!allowed) return textResult("Permission denied by user.");
      const result = await schedules.createSchedule(args);
      const scheduleId = result?.schedule?.id;
      return textResult(`Schedule created: ${scheduleId || JSON.stringify(result)}`);
    }

    if (name === "update_schedule") {
      const { allowed } = await checkPermission(name, args);
      if (!allowed) return textResult("Permission denied by user.");
      const result = await schedules.updateSchedule(args);
      const scheduleId = result?.schedule?.id;
      return textResult(`Schedule updated: ${scheduleId || args.id}`);
    }

    if (name === "delete_schedule") {
      const { allowed } = await checkPermission(name, args);
      if (!allowed) return textResult("Permission denied by user.");
      await schedules.deleteSchedule(args.id);
      return textResult(`Schedule deleted: ${args.id}`);
    }

    if (name === "run_schedule_now") {
      const { allowed } = await checkPermission(name, args);
      if (!allowed) return textResult("Permission denied by user.");
      const result = await schedules.runScheduleNow(args.id);
      return textResult(JSON.stringify(result, null, 2));
    }

    // ---------- scheduled applications (tier A reads, tier C writes) ----------
    if (name === "list_applications") {
      const result = await applications.listApplications();
      return textResult(JSON.stringify(result, null, 2));
    }

    if (name === "register_application") {
      const { allowed } = await checkPermission(name, args);
      if (!allowed) return textResult("Permission denied by user.");
      const result = await applications.registerApplication(args);
      const appId = result?.application?.id;
      return textResult(`Application registered: ${appId || JSON.stringify(result)}`);
    }

    if (name === "update_application") {
      const { allowed } = await checkPermission(name, args);
      if (!allowed) return textResult("Permission denied by user.");
      const result = await applications.updateApplication(args);
      const appId = result?.application?.id;
      return textResult(`Application updated: ${appId || args.id}`);
    }

    if (name === "delete_application") {
      const { allowed } = await checkPermission(name, args);
      if (!allowed) return textResult("Permission denied by user.");
      await applications.deleteApplication(args.id);
      return textResult(`Application deleted: ${args.id}`);
    }

    // ---------- decisions (tier A) ----------
    if (name === "open_decision") {
      await dispatchEffect("navigate", { route: `/decisions?id=${args.id}` });
      return textResult(`Opening decision: ${args.id}`);
    }

    if (name === "start_new_decision") {
      const { allowed } = await checkPermission(name, args);
      if (!allowed) return textResult("Permission denied by user.");
      const mode = args.mode || "guided";
      const decision = await decisionsHandler.startNewDecision(args.topic, mode);
      await dispatchEffect("navigate", {
        route: `/decisions?id=${encodeURIComponent(decision.id)}`,
      });
      return textResult(
        JSON.stringify({
          decisionId: decision.id,
          topic: decision.prompt || decision.title || args.topic,
          mode: decision.mode || mode,
        }, null, 2),
      );
    }

    if (name === "list_decisions") {
      await dispatchEffect("navigate", {
        route: args.status ? `/decisions?status=${args.status}` : "/decisions",
      });
      return textResult("Navigated to decisions.");
    }

    if (name === "get_decision") {
      const result = await decisionsHandler.getDecision(args.id);
      return textResult(JSON.stringify(result, null, 2));
    }

    if (name === "answer_decision_question") {
      const result = await decisionsHandler.answerDecisionQuestion(
        args.decisionId,
        args.questionId,
        args.choice
      );
      return textResult(JSON.stringify(result, null, 2));
    }

    if (name === "select_decision_option") {
      const { allowed } = await checkPermission(name, args);
      if (!allowed) return textResult("Permission denied by user.");
      const result = await decisionsHandler.selectDecisionOption(
        args.decisionId,
        args.optionId
      );
      return textResult(JSON.stringify(result, null, 2));
    }

    if (name === "approve_decision") {
      const { allowed } = await checkPermission(name, args);
      if (!allowed) return textResult("Permission denied by user.");
      const result = await decisionsHandler.approveDecision(
        args.decisionId,
        args.selectedOptionId || args.optionId,
        args.workspacePath,
        args.notes
      );
      await dispatchEffect("navigate", { route: "/tasks" });
      return textResult(JSON.stringify(result, null, 2));
    }

    if (name === "poll_decision_ready") {
      const result = await decisionsHandler.pollDecisionReady(
        args.decisionId,
        args.round
      );
      return textResult(JSON.stringify(result, null, 2));
    }

    // ---------- runs (tier A reads, tier C writes) ----------
    if (name === "open_run") {
      const tab = args.tab ? `?tab=${args.tab}` : "";
      await dispatchEffect("navigate", { route: `/runs/${args.id}${tab}` });
      return textResult(`Opening run: ${args.id}`);
    }

    if (name === "list_runs") {
      await dispatchEffect("navigate", { route: "/runs" });
      return textResult("Navigated to runs list.");
    }

    if (name === "start_run") {
      const { allowed } = await checkPermission(name, args);
      if (!allowed) return textResult("Permission denied by user.");
      const result = await context.startRun(args.chainId, args.task, args.workspaceId);
      if (result.runId) {
        await dispatchEffect("navigate", { route: `/runs/${result.runId}` });
      }
      return textResult(`Run started: ${result.runId}`);
    }

    if (name === "run_task_chain") {
      const { allowed } = await checkPermission(name, args);
      if (!allowed) return textResult("Permission denied by user.");
      const result = await context.runTaskChain(args.taskId, args.workspaceId);
      if (result.runId) {
        await dispatchEffect("navigate", { route: `/runs/${result.runId}` });
      }
      return textResult(
        result.runId
          ? `Task chain started for ${args.taskId} (tied to the task): ${result.runId}`
          : `Run requested for task ${args.taskId}, but no run id was returned.`,
      );
    }

    if (name === "cancel_run") {
      const { allowed } = await checkPermission(name, args);
      if (!allowed) return textResult("Permission denied by user.");
      await context.cancelRun(args.id);
      return textResult(`Run cancelled: ${args.id}`);
    }

    if (name === "get_job") {
      // tier A (read-only poll) — no approval prompt
      const result = await jobs.getJob(args.id);
      return textResult(JSON.stringify(result, null, 2));
    }

    // ---------- workspaces (tier A) ----------
    if (name === "list_workspaces") {
      const result = await context.listWorkspaces();
      return textResult(JSON.stringify(result, null, 2));
    }

    if (name === "select_workspace") {
      await dispatchEffect("select_workspace", { id: args.id });
      return textResult(`Workspace selected: ${args.id}`);
    }

    // ---------- templates (tier A reads, tier B installs) ----------
    if (name === "list_templates") {
      const result = await templates.listTemplates(args.category);
      return textResult(JSON.stringify(result, null, 2));
    }

    if (name === "install_template") {
      const { allowed } = await checkPermission(name, args);
      if (!allowed) return textResult("Permission denied by user.");
      const result = await templates.installTemplate(args.templateId);
      await dispatchEffect("navigate", { route: `/chains/${result.id}/edit` });
      return textResult(`Template installed: ${result.name} (${result.agentCount} agents)`);
    }

    // ---------- filesystem (tier A reads) ----------
    if (name === "list_dir") {
      const result = await filesystem.listDir(args.path);
      return textResult(JSON.stringify(result, null, 2));
    }

    if (name === "tree") {
      const result = await filesystem.tree(args.path, args.depth ?? 2);
      return textResult(JSON.stringify(result, null, 2));
    }

    if (name === "find_files") {
      const result = await filesystem.findFiles(args.path || ".", args.pattern || "", args.maxResults);
      return textResult(JSON.stringify(result, null, 2));
    }

    // ---------- runtime diagnostics (tier A reads) ----------
    if (name === "read_runtime_file") {
      const result = await runtime.readRuntimeFile(args.path);
      return textResult(result.content ?? JSON.stringify(result, null, 2));
    }

    if (name === "list_runtime_dir") {
      const result = await runtime.listRuntimeDir(args.path);
      return textResult(JSON.stringify(result, null, 2));
    }

    if (name === "get_run_state") {
      const result = await runtime.getRunState(args.runId);
      return textResult(JSON.stringify(result, null, 2));
    }

    if (name === "get_run_events") {
      const result = await runtime.getRunEvents(args.runId);
      return textResult(JSON.stringify(result, null, 2));
    }

    if (name === "get_system_logs") {
      const result = await runtime.getSystemLogs(args);
      return textResult(JSON.stringify(result, null, 2));
    }

    // ---------- terminal (tier B show, tier C send) ----------
    if (name === "show_terminal") {
      const { allowed } = await checkPermission(name, args);
      if (!allowed) return textResult("Permission denied by user.");
      await dispatchEffect("show_terminal", args);
      return textResult("Terminal panel opened.");
    }

    if (name === "read_terminal") {
      const result = await terminal.readTerminal(args.ptySid || args.session, args.lines);
      return textResult(JSON.stringify(result, null, 2));
    }

    if (name === "send_command") {
      const { allowed } = await checkPermission(name, args);
      if (!allowed) return textResult("Permission denied by user.");
      const session = args.ptySid || args.session;
      const cmd = args.enter === false ? args.cmd : `${args.cmd}\n`;
      const result = await terminal.sendCommand(session, cmd);
      return textResult(JSON.stringify(result, null, 2));
    }

    // ---------- notify ----------
    if (name === "notify") {
      const webUrl = process.env.MENTIKO_WEB_URL || "http://127.0.0.1:3000";
      const inboxKey = process.env.MENTIKO_INBOX_KEY || "";
      await fetch(`${webUrl}/api/mentiko-mcp/ops/notify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Mentiko-Inbox-Key": inboxKey },
        body: JSON.stringify(args),
      });
      return textResult("Notification sent.");
    }

    // ---------- meta / introspection (tier A) ----------
    if (name === "get_settings_pages") {
      const result = await meta.getSettingsPages();
      return textResult(JSON.stringify(result, null, 2));
    }

    if (name === "get_docs_index") {
      const result = await meta.getDocsIndex();
      return textResult(JSON.stringify(result, null, 2));
    }

    if (name === "get_nav_structure") {
      const result = await meta.getNavStructure();
      return textResult(JSON.stringify(result, null, 2));
    }

    if (name === "get_system_info") {
      const result = await meta.getSystemInfo();
      return textResult(JSON.stringify(result, null, 2));
    }

    if (name === "navigate_to_doc") {
      const topic = args.topic || "";
      const result = await meta.getDocsIndex();
      // Fuzzy match topic against doc titles and tags
      let bestMatch = null;
      let bestScore = 0;
      for (const article of result.articles) {
        const titleScore = fuzzyMatch(topic.toLowerCase(), article.title.toLowerCase());
        const tagsScore = Math.max(...article.tags.map(t => fuzzyMatch(topic.toLowerCase(), t.toLowerCase())));
        const score = Math.max(titleScore, tagsScore);
        if (score > bestScore) {
          bestScore = score;
          bestMatch = article;
        }
      }
      if (bestMatch && bestScore > 0) {
        await dispatchEffect("navigate", { route: bestMatch.route });
        return textResult(`Navigated to ${bestMatch.title}: ${bestMatch.route}`);
      } else {
        await dispatchEffect("navigate", { route: "/docs" });
        await dispatchEffect("show_toast", {
          level: "info",
          message: `I couldn't find a specific article for "${topic}" — browse from the docs home.`,
        });
        return textResult(`No matching doc found for "${topic}", navigated to /docs`);
      }
    }

    // ---------- notifications (tier A reads, tier B writes) ----------
    if (name === "get_notification_prefs") {
      const result = await notifications.getNotificationPrefs();
      return textResult(JSON.stringify(result, null, 2));
    }

    if (name === "set_notification_prefs") {
      const { allowed } = await checkPermission(name, args);
      if (!allowed) return textResult("Permission denied by user.");
      const result = await notifications.setNotificationPrefs(args.updates);
      return textResult(JSON.stringify(result, null, 2));
    }

    // ---------- onboarding: CLI status, auth, secrets (tier A reads, tier B spawns, tier C writes) ----------
    if (name === "detect_cli_status") {
      const result = await onboarding.detectCliStatus();
      return textResult(JSON.stringify(result, null, 2));
    }

    if (name === "start_cli_auth") {
      const { allowed } = await checkPermission(name, args);
      if (!allowed) return textResult("Permission denied by user.");
      const result = await onboarding.startCliAuth(args.tool);
      return textResult(JSON.stringify(result, null, 2));
    }

    if (name === "poll_cli_auth") {
      const result = await onboarding.pollCliAuth(args.sessionId);
      return textResult(JSON.stringify(result, null, 2));
    }

    // re-authenticate this MCP connection (device flow → refresh token)
    if (name === "reconnect") {
      const message = await auth.reconnect();
      return textResult(message);
    }

    // request user-approved control of one browser window's UI (signaling grant)
    if (name === "request_ui_control") {
      const message = await uiControl.requestUiControl();
      return textResult(message);
    }

    if (name === "list_secrets") {
      const result = await onboarding.listSecrets();
      return textResult(JSON.stringify(result, null, 2));
    }

    if (name === "create_secret") {
      // For permission gate: mask the value in the preview
      const argsForPermission = { ...args, value: "***" };
      const { allowed } = await checkPermission(name, argsForPermission);
      if (!allowed) return textResult("Permission denied by user.");
      const result = await onboarding.createSecret(args.name, args.envVar, args.value, args.description);
      return textResult(JSON.stringify(result, null, 2));
    }

    // ---------- files (tier A reads, tier B/C writes) ----------
    if (name === "open_file") {
      await dispatchEffect("navigate", {
        route: `/editor?path=${encodeURIComponent(args.path)}`,
      });
      return textResult(`Opening file in editor: ${args.path}`);
    }

    if (name === "read_file") {
      const result = await files.readFile(args.path);
      return textResult(result.content ?? JSON.stringify(result));
    }

    if (name === "write_file") {
      const { allowed } = await checkPermission(name, args);
      if (!allowed) return textResult("Permission denied by user.");
      const result = await files.writeFile(args.path, args.content, args.mode);
      return textResult(`File written: ${result.path} (${result.bytes} bytes)`);
    }

    if (name === "show_diff") {
      await dispatchEffect("show_diff", args);
      return textResult("Diff displayed.");
    }

    // ---------- synchronous user prompts ----------
    if (name === "ask_confirm" || name === "ask_input" || name === "ask_choice") {
      const toolId = genToolId(name);
      await dispatchEffect(name, { ...args, toolId }, { waitForDelivery: true });
      const result = await waitForResult(toolId);
      return textResult(JSON.stringify(result));
    }

    // ---------- fire-and-forget UI effects ----------
    if (name === "highlight") {
      await dispatchEffect("highlight", args);
      return textResult("Highlighting element.");
    }

    if (name === "clear_highlight") {
      await dispatchEffect("clear_highlight", {});
      return textResult("Highlight cleared.");
    }

    await dispatchEffect(name, args);
    return textResult(`Effect dispatched: ${name}`);

  } catch (err: any) {
    const msg = err?.message || String(err);
    console.error(`[mentiko-mcp] tool ${name} failed:`, msg);
    // recoverable auth failure → guide the user to reconnect instead of a raw 401
    if (isAuthFailure(msg)) {
      return authRecoveryResult(msg);
    }
    // surface error to user in the bar immediately
    dispatchEffect("show_toast", {
      level: "error",
      message: `${name} failed: ${msg}`,
      durationMs: 8000,
    }).catch(() => {});
    return errorResult(msg);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `[mentiko-mcp] stdio server ready v${SERVER_VERSION} (INBOX_KEY=${process.env.MENTIKO_INBOX_KEY ? "set" : "MISSING"}, WEB_URL=${process.env.MENTIKO_WEB_URL || "http://127.0.0.1:3000"})`,
  );
}

main().catch((err) => {
  console.error("[mentiko-mcp] fatal:", err);
  process.exit(1);
});
