import { Tool } from "@modelcontextprotocol/sdk/types.js";

const BAR_TOOL_NAMES = new Set([
  "navigate",
  "get_current_page",
  "get_user_context",
  "get_active_workspace",
  "get_recent_activity",
  "show_toast",
  "list_chains",
  "open_chain",
  "create_chain_draft",
  "save_chain_json",
  "list_agents",
  "open_agent",
  "create_agent",
  "list_workspaces",
  "select_workspace",
  "list_decisions",
  "open_decision",
  "start_new_decision",
  "get_decision",
  "answer_decision_question",
  "select_decision_option",
  "approve_decision",
  "list_runs",
  "open_run",
  "start_run",
  "cancel_run",
  "list_tasks",
  "open_task",
  "create_task",
  "generate_tasks",
  "mark_task_done",
  "run_task_chain",
  "get_task",
  "update_task",
  "comment_task",
  "add_task_dependency",
  "remove_task_dependency",
  "open_file",
  "read_file",
  "write_file",
  "show_diff",
  "show_terminal",
  "send_command",
  "read_terminal",
  "list_templates",
  "install_template",
  "list_dir",
  "tree",
  "find_files",
  "read_runtime_file",
  "list_runtime_dir",
  "get_run_state",
  "get_run_events",
  "get_system_logs",
  "notify",
  "ask_confirm",
  "ask_input",
  "ask_choice",
  "get_settings_pages",
  "get_docs_index",
  "get_nav_structure",
  "get_system_info",
  "get_system_status",
  "navigate_to_doc",
  "detect_cli_status",
  "start_cli_auth",
  "poll_cli_auth",
  "list_secrets",
  "create_secret",
]);

const ALL_TOOLS: Tool[] = [
  // ① Navigation
  {
    name: "navigate",
    description: "Navigate the browser to a specific route within the Mentiko app.",
    inputSchema: {
      type: "object",
      properties: {
        route: { type: "string", description: "The route to navigate to (e.g., '/chains', '/agents')" }
      },
      required: ["route"]
    }
  },
  {
    name: "open_in_new_tab",
    description: "Renders a click-to-open button for a specific URL.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to open" }
      },
      required: ["url"]
    }
  },
  {
    name: "go_back",
    description: "Navigate back to the previous page.",
    inputSchema: { type: "object", properties: {} }
  },

  // ① Navigation (context)
  {
    name: "get_current_page",
    description:
      "Get the route the user is currently looking at in the Mentiko app (pathname, search params, and a human label). ALWAYS call this first when the user refers to 'this page', 'here', 'the chain I'm looking at', or anything else where context matters.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "get_user_context",
    description: "Get the current logged-in user's identity, org, namespace, and role.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "get_active_workspace",
    description: "Get the currently active workspace (name, path, type).",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "get_recent_activity",
    description: "Get the last 5 runs and recent chains the user has touched. Use this to pick up where they left off.",
    inputSchema: { type: "object", properties: {} }
  },

  // ② UI Control
  {
    name: "show_toast",
    description: "Show a transient notification toast.",
    inputSchema: {
      type: "object",
      properties: {
        level: { type: "string", enum: ["success", "info", "warning", "error"] },
        message: { type: "string" },
        durationMs: { type: "number" }
      },
      required: ["level", "message"]
    }
  },
  {
    name: "show_modal",
    description: "Show a dismissable modal dialog.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        body: { type: "string", description: "Markdown or plain text content" },
        cta: { type: "string", description: "Optional call to action button text" }
      },
      required: ["title", "body"]
    }
  },
  {
    name: "show_drawer",
    description: "Show a right drawer with content.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        contents: { type: "string", description: "Markdown or embedded route" }
      },
      required: ["title", "contents"]
    }
  },
  {
    name: "focus",
    description: "Scrolls and focuses a tagged element on the page.",
    inputSchema: {
      type: "object",
      properties: {
        dataMentikoId: { type: "string", description: "The data-mentiko-id of the element" }
      },
      required: ["dataMentikoId"]
    }
  },

  // ③ Chain Operations
  {
    name: "list_chains",
    description: "List all chains in the current namespace.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "open_chain",
    description: "Navigate to a specific chain and focus the editor.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The ID of the chain" }
      },
      required: ["id"]
    }
  },
  {
    name: "create_chain_draft",
    description: "Create a new chain draft and open the editor.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        template: { type: "string", description: "Optional template name" }
      },
      required: ["name"]
    }
  },
  {
    name: "rename_chain",
    description: "Rename an existing chain.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" }
      },
      required: ["id", "name"]
    }
  },
  {
    name: "save_chain_json",
    description:
      "Save a complete chain definition in one shot. Use when the user describes a multi-agent workflow and you already know the agents, triggers, and emit wiring. Provide the full chain.json body — the tool merges missing fields with defaults, creates or overwrites the directory, and opens the chain editor.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Chain name (will be slugified). Example: 'customer-intake'"
        },
        chain: {
          type: "object",
          description:
            "Full chain definition. Expected shape: { name, version, description, config: { session_prefix, max_rounds, monitor, monitor_interval, event_triggers }, agents: [{ $ref: 'agent-id' } | { id, name, role, prompt, triggers: [...], emits: '...' }] }. Unprovided fields get sensible defaults.",
          additionalProperties: true
        },
        overwrite: {
          type: "boolean",
          description: "If true, replace an existing chain with the same slug. Default false.",
          default: false
        }
      },
      required: ["name", "chain"]
    }
  },
  {
    name: "delete_chain",
    description: "Delete an existing chain (destructive).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" }
      },
      required: ["id"]
    }
  },
  {
    name: "attach_agent_to_chain",
    description: "Add an existing agent to a chain's agents array. Use after create_agent to wire it into a chain.",
    inputSchema: {
      type: "object",
      properties: {
        chainId: { type: "string", description: "The chain slug to attach to" },
        agentId: { type: "string", description: "The agent slug to attach" },
        position: { type: "number", description: "Optional 0-based index to insert at. Omit to append." }
      },
      required: ["chainId", "agentId"]
    }
  },
  {
    name: "detach_agent_from_chain",
    description: "Remove an agent from a chain's agents array.",
    inputSchema: {
      type: "object",
      properties: {
        chainId: { type: "string" },
        agentId: { type: "string" }
      },
      required: ["chainId", "agentId"]
    }
  },

  // ④ Agent Ops
  {
    name: "list_agents",
    description: "List all agents.",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["global", "namespace", "org"] }
      }
    }
  },
  {
    name: "open_agent",
    description: "Navigate to a specific agent's page.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" }
      },
      required: ["id"]
    }
  },
  {
    name: "create_agent",
    description: "Create a new agent.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        prompt: { type: "string" },
        profile: { type: "string" }
      },
      required: ["name", "prompt"]
    }
  },

  // ⑤ Workspaces
  {
    name: "list_workspaces",
    description: "List all workspaces.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "select_workspace",
    description: "Set the active workspace.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" }
      },
      required: ["id"]
    }
  },
  {
    name: "create_workspace",
    description: "Create a new workspace.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        type: { type: "string", enum: ["local", "ssh", "docker"] },
        config: { type: "object" }
      },
      required: ["name", "type", "config"]
    }
  },

  // ⑥ Decisions
  {
    name: "list_decisions",
    description: "List all decisions.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "open_decision",
    description: "Navigate to a specific decision page.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" }
      },
      required: ["id"]
    }
  },
  {
    name: "start_new_decision",
    description: "Start a new decision and open the guided wizard.",
    inputSchema: {
      type: "object",
      properties: {
        topic: { type: "string" },
        mode: { type: "string", enum: ["guided", "classic"] }
      },
      required: ["topic"]
    }
  },

  // ⑯ Decisions (full flow)
  {
    name: "get_decision",
    description: "Get full state of a decision: status, pending questions, options, plan.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The decision ID" }
      },
      required: ["id"]
    }
  },
  {
    name: "answer_decision_question",
    description: "Answer a round 1 tradeoff question in the guided decision flow.",
    inputSchema: {
      type: "object",
      properties: {
        decisionId: { type: "string" },
        questionId: { type: "string" },
        choice: { type: "string", enum: ["a", "b", "skip"] }
      },
      required: ["decisionId", "questionId", "choice"]
    }
  },
  {
    name: "select_decision_option",
    description: "Select an option in round 2 of the guided decision flow. Triggers plan generation.",
    inputSchema: {
      type: "object",
      properties: {
        decisionId: { type: "string" },
        optionId: { type: "string" }
      },
      required: ["decisionId", "optionId"]
    }
  },
  {
    name: "approve_decision",
    description: "Approve a decision and create the task epic. Advances to in_progress.",
    inputSchema: {
      type: "object",
      properties: {
        decisionId: { type: "string" },
        selectedOptionId: { type: "string", description: "Option id to approve. Defaults to the selected/recommended option when omitted." },
        optionId: { type: "string", description: "Alias for selectedOptionId." },
        workspacePath: { type: "string", description: "Workspace path for workspace-scoped decisions." },
        notes: { type: "string", description: "Optional approval notes." }
      },
      required: ["decisionId"]
    }
  },
  {
    name: "poll_decision_ready",
    description: "Check if async generation (round 2 options or round 3 plan) is complete.",
    inputSchema: {
      type: "object",
      properties: {
        decisionId: { type: "string" },
        round: { type: "number", enum: [1, 2, 3] }
      },
      required: ["decisionId", "round"]
    }
  },

  // ⑦ Run Control
  {
    name: "list_runs",
    description: "List execution runs.",
    inputSchema: {
      type: "object",
      properties: {
        chainId: { type: "string" },
        status: { type: "string" }
      }
    }
  },
  {
    name: "open_run",
    description: "Navigate to a specific run page.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        tab: { type: "string", enum: ["goal", "output", "agents", "activity"] }
      },
      required: ["id"]
    }
  },
  {
    name: "start_run",
    description: "Spawn a chain run by chain id with an ad-hoc prompt (the `task` field is free-text injected as the prompt). Does NOT tie the run to a task. To run a TASK's assigned chain so the run links back to the task, use run_task_chain instead.",
    inputSchema: {
      type: "object",
      properties: {
        chainId: { type: "string" },
        task: { type: "string" },
        workspaceId: { type: "string" }
      },
      required: ["chainId"]
    }
  },
  {
    name: "run_task_chain",
    description: "Run the chain ASSIGNED TO A TASK, tied back to that task (the task UI 'Run chain' button): writes last_run_id onto the task, sets it in_progress, injects the task's title/description/acceptance-criteria/notes/comments as the agent prompt, and reads the chain binding from the task's own metadata. Use this — NOT start_run — whenever running a task's chain, so the run links to the task.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        workspaceId: { type: "string" }
      },
      required: ["taskId"]
    }
  },
  {
    name: "cancel_run",
    description: "Kills a live run.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" }
      },
      required: ["id"]
    }
  },
  {
    name: "get_job",
    description: "Poll an async generation job (e.g. the { jobId, runId } handle returned by generate_tasks). Returns status (pending|running|complete|failed); on completion the result carries the created task IDs (parentId/createdTaskIds) plus runId. Poll until status is complete or failed.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The jobId returned by generate_tasks." }
      },
      required: ["id"]
    }
  },

  // ⑧ Task Ops
  {
    name: "list_tasks",
    description: "List tasks, paginated, as a SUMMARY (id/title/status/priority/owner/assignee/labels/counts). Heavy text (description/notes/design/acceptance_criteria) is NOT included — call get_task for a single task's full record. Response: { tasks, total, limit, offset, has_more }. Page by passing offset = prevOffset + limit while has_more is true. Defaults to 50 rows.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", description: "Filter by lifecycle status: open, in_progress, blocked, closed, or all. Omit for not-closed." },
        query: { type: "string", description: "Title substring filter (case-insensitive)." },
        limit: { type: "number", description: "Page size, 1-200. Default 50." },
        offset: { type: "number", description: "Skip this many rows for pagination. Default 0." }
      }
    }
  },
  {
    name: "open_task",
    description: "Navigate to a specific task page.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" }
      },
      required: ["id"]
    }
  },
  {
    name: "create_task",
    description: "Create a task, or an epic/feature/bug/chore via issue_type. Owner defaults to the authenticated MCP user unless you pass owner. Use issue_type:'epic' to mint an EPIC, then add_task_dependency to wire prerequisites. assignee is a free field — a user id/name OR a chain id/name.",
    inputSchema: {
      type: "object",
      properties: {
        subject: { type: "string", description: "Task title." },
        desc: { type: "string", description: "Task description / body." },
        parentId: { type: "string", description: "Parent task or epic id (e.g. EPIC-011)." },
        workspace_path: {
          type: "string",
          description: "Absolute path to the workspace. Tasks without this won't appear in the /tasks UI workspace filter."
        },
        issue_type: {
          type: "string",
          enum: ["epic", "feature", "task", "decision", "link", "bug", "chore"],
          description: "Defaults to 'task'. 'epic' mints EPIC-###, 'feature' FEAT-###, 'bug' BUG-###, etc."
        },
        priority: { type: "number", description: "1 = highest. Defaults to 2." },
        owner: { type: "string", description: "Responsible identity. Defaults to the authenticated MCP user." },
        assignee: { type: "string", description: "Who/what works it — a user id/name or a chain id/name." },
        labels: { type: "array", items: { type: "string" }, description: "Label strings, e.g. [\"backend\",\"notifications\"]." },
        notes: { type: "string", description: "Free-form notes." },
        acceptance_criteria: { type: "string", description: "Given/when/then acceptance criteria." },
        design: { type: "string", description: "Design / approach notes." },
        estimated_minutes: { type: "number", description: "Estimate in minutes." },
        due_at: { type: "string", description: "Due date, ISO 8601." }
      },
      required: ["subject"]
    }
  },
  {
    name: "get_task",
    description: "Get one task's full record plus its dependencies (blockers it waits on), dependents (tasks waiting on it), and comments.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Task id, e.g. TASK-160 or EPIC-011." }
      },
      required: ["id"]
    }
  },
  {
    name: "update_task",
    description: "Update fields on an existing task (any subset). Setting status to 'closed' stamps closed_at. issue_type, owner and parent are set at creation and are not updatable here — use create_task for those.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Task id to update." },
        title: { type: "string" },
        description: { type: "string" },
        status: {
          type: "string",
          enum: ["open", "in_progress", "blocked", "closed"],
          description: "Lifecycle status."
        },
        priority: { type: "number", description: "1 = highest." },
        assignee: { type: "string", description: "User id/name or chain id/name." },
        acceptance_criteria: { type: "string" },
        design: { type: "string" },
        notes: { type: "string" },
        labels: { type: "array", items: { type: "string" } },
        metadata: { type: "object", description: "Merged as-is into the metadata column (overwrites keys you set)." },
        estimated_minutes: { type: "number" },
        due_at: { type: "string", description: "ISO 8601." },
        workspace_id: { type: "string", description: "Absolute workspace path; must be authorized." }
      },
      required: ["id"]
    }
  },
  {
    name: "comment_task",
    description: "Add a comment to a task. The author is the authenticated MCP user.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Task id to comment on." },
        text: { type: "string", description: "Comment body." }
      },
      required: ["id", "text"]
    }
  },
  {
    name: "add_task_dependency",
    description: "Add a dependency edge: taskId depends on / is blocked by dependsOnId. taskId only unblocks once dependsOnId is closed. Use this to wire epic subtasks and prerequisites.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "The dependent (blocked) task." },
        dependsOnId: { type: "string", description: "The prerequisite (blocker) task it waits on." }
      },
      required: ["taskId", "dependsOnId"]
    }
  },
  {
    name: "remove_task_dependency",
    description: "Remove the dependency edge taskId -> dependsOnId.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "The dependent task." },
        dependsOnId: { type: "string", description: "The prerequisite it no longer waits on." }
      },
      required: ["taskId", "dependsOnId"]
    }
  },
  {
    name: "generate_tasks",
    description: "Start AI generation of a task tree from a natural-language work description. ASYNC: returns immediately with { runId, jobId } — does NOT wait. Poll get_job { id: jobId } until status \"complete\". The generation AGENT acts as a gate: it decides task-vs-decision while building. On completion the job result either carries the created task IDs (parentId/createdTaskIds) OR routedTo:'decision' with decisionId/taskId (the agent decided a human should step through a decision first). send_to_decision_if_warranted (default true) toggles whether the agent may route to a decision; pass false to force a task tree. mode:'decision' skips generation and creates a decision directly. Pass workspace_path or tasks won't appear in the /tasks workspace filter.",
    inputSchema: {
      type: "object",
      properties: {
        description: {
          type: "string",
          description: "Natural-language description of the work to break into a parent task, subtasks, and dependencies."
        },
        workspace_path: {
          type: "string",
          description: "Absolute path to the workspace. Generated tasks without this won't appear in the /tasks UI workspace filter."
        },
        auto_run: {
          type: "boolean",
          description: "When true, created parent and subtasks are marked for auto-run so Mentiko analyzes, creates or selects chains, and runs ready tasks."
        },
        send_to_decision_if_warranted: {
          type: "boolean",
          description: "Default true (ON). In task mode, a prompt that looks strategic/complex (architecture, migration, strategy, broad redesign...) is automatically routed to the decision flow instead of generating a task tree — returns routedTo:'decision'. Pass false to force task generation."
        },
        mode: {
          type: "string",
          enum: ["task", "decision"],
          "description": "task (default) = generate a task tree, subject to send_to_decision_if_warranted routing. decision = force the decision flow (human steps through it in /decisions)."
        }
      },
      required: ["description"]
    }
  },
  {
    name: "mark_task_done",
    description: "Mark a task as completed.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" }
      },
      required: ["id"]
    }
  },

  // ⑧b Schedule Ops
  {
    name: "list_schedules",
    description: "List schedules, including chain, generated-task, raw executable, registered-app, and task-run targets.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "create_schedule",
    description: "Create a schedule. Supports target types: chain_run, generate_tasks, run_task, registered_app, and raw_exec.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        description: { type: "string" },
        cron: { type: "string", description: "5-field cron expression, e.g. '0 * * * *'" },
        timezone: { type: "string", description: "IANA timezone, e.g. 'UTC' or 'America/Phoenix'" },
        target: {
          type: "object",
          description: "Schedule target. Examples: {type:'generate_tasks', prompt:'...', workspacePath:'/repo', autoRun:true} or {type:'raw_exec', executable:'python3', args:['script.py'], workingDirectory:'/repo'}",
          additionalProperties: true
        },
        trigger: {
          type: "object",
          description: "Optional trigger object. Cron trigger mirrors cron/timezone fields; file trigger is accepted for schema compatibility.",
          additionalProperties: true
        },
        jobGroupId: { type: "string" },
        enabled: { type: "boolean" }
      },
      required: ["name", "target"]
    }
  },
  {
    name: "update_schedule",
    description: "Update a schedule by id. Can update cron, timezone, target, trigger, jobGroupId, enabled, name, or description.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        cron: { type: "string" },
        timezone: { type: "string" },
        target: { type: "object", additionalProperties: true },
        trigger: { type: "object", additionalProperties: true },
        jobGroupId: { type: "string" },
        enabled: { type: "boolean" }
      },
      required: ["id"]
    }
  },
  {
    name: "delete_schedule",
    description: "Delete a schedule.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" }
      },
      required: ["id"]
    }
  },
  {
    name: "run_schedule_now",
    description: "Trigger a schedule immediately.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" }
      },
      required: ["id"]
    }
  },

  // ⑧c Scheduled Application Registry
  {
    name: "list_applications",
    description: "List registered applications that schedules can execute.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "register_application",
    description: "Register or replace a reusable application definition for schedules. Uses structured executable + args, not a shell string.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        executable: { type: "string" },
        args: { type: "array", items: { type: "string" } },
        workingDirectory: { type: "string" },
        env: { type: "object", additionalProperties: { type: "string" } },
        timeoutMs: { type: "number" },
        successExitCodes: { type: "array", items: { type: "number" } }
      },
      required: ["name", "executable"]
    }
  },
  {
    name: "update_application",
    description: "Update a registered scheduled application.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        executable: { type: "string" },
        args: { type: "array", items: { type: "string" } },
        workingDirectory: { type: "string" },
        env: { type: "object", additionalProperties: { type: "string" } },
        timeoutMs: { type: "number" },
        successExitCodes: { type: "array", items: { type: "number" } }
      },
      required: ["id"]
    }
  },
  {
    name: "delete_application",
    description: "Delete a registered scheduled application.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" }
      },
      required: ["id"]
    }
  },

  // ⑨ Code Editor
  {
    name: "open_file",
    description: "Navigate to the editor and open a file.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" }
      },
      required: ["path"]
    }
  },
  {
    name: "read_file",
    description: "Read a file from the workspace-sandboxed path.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" }
      },
      required: ["path"]
    }
  },
  {
    name: "write_file",
    description: "Write content to a file (destructive).",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
        mode: { type: "string" }
      },
      required: ["path", "content"]
    }
  },
  {
    name: "show_diff",
    description: "Preview a diff (no write).",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        before: { type: "string" },
        after: { type: "string" }
      },
      required: ["path", "before", "after"]
    }
  },

  // ⑩ Terminal
  {
    name: "show_terminal",
    description: "Attach to or spawn a PTY terminal.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" }
      }
    }
  },
  {
    name: "send_command",
    description: "Send a command to a PTY terminal.",
    inputSchema: {
      type: "object",
      properties: {
        ptySid: { type: "string" },
        cmd: { type: "string" },
        enter: { type: "boolean" }
      },
      required: ["ptySid", "cmd"]
    }
  },
  {
    name: "read_terminal",
    description: "Read last N lines from a PTY terminal.",
    inputSchema: {
      type: "object",
      properties: {
        ptySid: { type: "string" },
        lines: { type: "number" }
      },
      required: ["ptySid"]
    }
  },

  // ⑪ Templates + Marketplace
  {
    name: "list_templates",
    description: "List available chain templates. Useful for grandma: 'show me what other people made.'",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string", description: "Filter by category (e.g. 'code', 'research', 'writing')" }
      }
    }
  },
  {
    name: "install_template",
    description: "Install a local template as a new chain in the current org.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "The template slug or id to install" }
      },
      required: ["templateId"]
    }
  },

  // ⑫ Filesystem Awareness
  {
    name: "list_dir",
    description: "List files and directories at a path (workspace-sandboxed).",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute or workspace-relative path" }
      },
      required: ["path"]
    }
  },
  {
    name: "tree",
    description: "Show a directory tree up to a given depth.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        depth: { type: "number", description: "Max depth (default 2)" }
      },
      required: ["path"]
    }
  },
  {
    name: "find_files",
    description: "Find files matching a name pattern within a directory.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Root path to search from" },
        pattern: { type: "string", description: "Substring to match against filenames/paths" },
        maxResults: { type: "number", description: "Max files to return (default 20)" }
      },
      required: ["path", "pattern"]
    }
  },
  {
    name: "read_runtime_file",
    description: "Read a runtime diagnostic file from the current namespace/org only. Use this instead of read_file for events, runs, watchdog-hooks, or reports. Allowed roots: events/, runs/, watchdog-hooks/, reports/. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Runtime path such as events/file.event, runs/run-123/run.json, or an absolute path under the current namespace/org runtime roots." }
      },
      required: ["path"]
    }
  },
  {
    name: "list_runtime_dir",
    description: "List a runtime diagnostic directory from the current namespace/org only. Use for events/, runs/, watchdog-hooks/, or reports/. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Runtime directory such as events, runs/run-123, watchdog-hooks, or reports." }
      },
      required: ["path"]
    }
  },
  {
    name: "get_run_state",
    description: "Read run.json for a run id and return derived diagnostics including status, pending agent, last completed agent, failed agent, and error clues. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string", description: "Run id, for example run-1778724644028." }
      },
      required: ["runId"]
    }
  },
  {
    name: "get_run_events",
    description: "List and read event files in the current namespace/org events directory that reference a run id. Use to diagnose trigger/emits mismatches and stalled runs. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string", description: "Run id, for example run-1778724644028." }
      },
      required: ["runId"]
    }
  },
  {
    name: "get_system_logs",
    description: "Query the same structured system logs visible on /settings/logs for the current namespace/org. Supports level, source, text query, time range, and limit. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        level: { type: "string", enum: ["error", "warn", "info"] },
        source: { type: "string" },
        query: { type: "string", description: "Case-insensitive text search over source, message, and detail." },
        since: { type: "string", description: "ISO timestamp lower bound." },
        until: { type: "string", description: "ISO timestamp upper bound." },
        limit: { type: "number", description: "Max recent entries to scan, capped server-side." }
      }
    }
  },

  // ⑬ Notifications
  {
    name: "notify",
    description: "Push a notification to the user in the bar. Use when a background task completes.",
    inputSchema: {
      type: "object",
      properties: {
        level: { type: "string", enum: ["info", "success", "warning", "error"] },
        title: { type: "string" },
        message: { type: "string" },
        linkRoute: { type: "string", description: "Optional in-app route to link to" },
        durationMs: { type: "number", description: "Toast duration in ms (default 6000)" }
      },
      required: ["message"]
    }
  },

  // ⑭ User Questions (Synchronous - block tool return)
  {
    name: "ask_confirm",
    description: "Ask the user a yes/no or multi-choice question.",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string" },
        options: { type: "array", items: { type: "string" } }
      },
      required: ["question"]
    }
  },
  {
    name: "ask_input",
    description: "Ask the user for text input.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string" },
        placeholder: { type: "string" }
      },
      required: ["prompt"]
    }
  },
  {
    name: "ask_choice",
    description: "Ask the user to pick from a rich list of options.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string" },
        options: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              value: { type: "string" },
              description: { type: "string" }
            },
            required: ["label", "value"]
          }
        }
      },
      required: ["prompt", "options"]
    }
  },

  // ⑮ Meta / Introspection
  {
    name: "get_settings_pages",
    description: "List all settings pages with routes and descriptions. Use when user asks where to configure something.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "get_docs_index",
    description: "List all documentation articles. Use to find and navigate to the right doc.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "get_nav_structure",
    description: "Get the full pill nav structure: sections, icons, child routes.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "get_system_info",
    description: "Get platform version, build info, and system health status.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "get_system_status",
    description: "Mentiko Monitor digest: overall pulse, automation loops, runs, tasks, sessions, webhook deliveries, self-heals, recent errors, and what needs the human — plus the monitor directives for reporting it. Call this for any 'how is the system / am I okay / did anything break' question.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "navigate_to_doc",
    description: "Navigate to a specific documentation article by topic keyword.",
    inputSchema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "Topic or keyword to search docs for" }
      },
      required: ["topic"]
    }
  },
  {
    name: "get_notification_prefs",
    description: "Read current notification preferences (email, slack, webhook channels per category).",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "set_notification_prefs",
    description: "Update notification preferences. Use when user says 'email me when X'. Body: partial NotificationPreferences.",
    inputSchema: {
      type: "object",
      properties: {
        updates: { type: "object", description: "Partial NotificationPreferences object with fields to update" }
      },
      required: ["updates"]
    }
  },

  // ⑰ UI Guidance + Onboarding
  {
    name: "highlight",
    description: "Highlight a UI element with a pulsing ring. Use to point users at specific buttons or inputs.",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector for the element" },
        dataMentikoId: { type: "string", description: "Alternatively, find by data-mentiko-id attribute" },
        message: { type: "string", description: "Optional label text shown near the element" },
        durationMs: { type: "number", description: "How long to show the highlight (default 4000ms)" }
      }
    }
  },
  {
    name: "clear_highlight",
    description: "Remove any active element highlight.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "detect_cli_status",
    description: "Check which AI CLI tools are installed and authenticated (claude, codex, antigravity, aider, kollab).",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "start_cli_auth",
    description: "Start an interactive CLI authentication session. Returns a sessionId. Then poll with poll_cli_auth.",
    inputSchema: {
      type: "object",
      properties: {
        tool: { type: "string", enum: ["claude", "codex", "antigravity"], description: "Which CLI tool to authenticate" }
      },
      required: ["tool"]
    }
  },
  {
    name: "poll_cli_auth",
    description: "Poll a CLI auth session for the auth URL or completion. Call every 3s after start_cli_auth.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "The session ID from start_cli_auth" }
      },
      required: ["sessionId"]
    }
  },
  {
    name: "reconnect",
    description: "Re-authenticate this Mentiko MCP connection. Call this when a mentiko tool fails with 'session auth required' or a 401. Returns a one-time sign-in link; the user approves it in the Mentiko app, then this connection refreshes automatically (no restart). After approving, call reconnect once more (or just retry the failed command) to finish.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "request_ui_control",
    description: "Request permission to control the user's Mentiko UI in ONE specific browser window — navigate pages, highlight elements, open chains/runs/agents, show toasts. Returns a one-time code + link; the user opens it IN THE WINDOW THEY WANT CONTROLLED and approves, which binds that window. After approving, call request_ui_control again to finish. Effects then route to that window only, never other windows or users. Use when the user asks you to drive, control, or show them something in their UI.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "list_secrets",
    description: "List stored secrets (names and env var names only, never values).",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "create_secret",
    description: "Store a new encrypted secret. High risk — user must approve every time. Value is never shown again.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Human-readable name for the secret (e.g. 'OpenAI API Key')" },
        envVar: { type: "string", description: "Environment variable name (uppercase, e.g. OPENAI_API_KEY)" },
        value: { type: "string", description: "The secret value (will be encrypted and never readable again)" },
        description: { type: "string", description: "Optional notes about this secret" }
      },
      required: ["name", "envVar", "value"]
    }
  }
];

export const TOOLS: Tool[] =
  process.env.MENTIKO_MCP_TOOL_SCOPE === "bar"
    ? ALL_TOOLS.filter((tool) => BAR_TOOL_NAMES.has(tool.name))
    : ALL_TOOLS;
