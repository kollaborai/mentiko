import {
  assertCanonicalMcpTaskToolReferences,
  formatMcpTaskToolReferenceIssue,
  normalizeMcpTaskToolDeclarations,
  validateMcpTaskToolReferences,
} from "./mcp-task-tool-contract";

describe("MCP task tool references", () => {
  it("accepts canonical task tools in declared tools and authorities", () => {
    expect(validateMcpTaskToolReferences({
      prompt: "Use get_task to inspect work and update_task to persist the result.",
      tools: ["get_task", "update_task"],
      authorities: {
        can: ["get_task"],
        needs_approval: ["update_task"],
      },
    })).toEqual([]);
  });

  it("reports retired task-tool names at every persisted declaration path", () => {
    const issues = validateMcpTaskToolReferences({
      prompt: "First call mentiko_get_task, then mentiko_update_task after verification.",
      tools: ["mentiko_get_task"],
      authorities: {
        can: ["mentiko_update_task"],
        needs_approval: ["mentiko_get_task"],
      },
    });

    expect(issues.map(formatMcpTaskToolReferenceIssue)).toEqual([
      "prompt: obsolete MCP task tool 'mentiko_get_task'; use 'get_task'",
      "prompt: obsolete MCP task tool 'mentiko_update_task'; use 'update_task'",
      "tools[0]: obsolete MCP task tool 'mentiko_get_task'; use 'get_task'",
      "authorities.can[0]: obsolete MCP task tool 'mentiko_update_task'; use 'update_task'",
      "authorities.needs_approval[0]: obsolete MCP task tool 'mentiko_get_task'; use 'get_task'",
    ]);
    expect(() => assertCanonicalMcpTaskToolReferences({ prompt: "mentiko_get_task TASK-059" }))
      .toThrow("use 'get_task'");
  });

  it("declares exactly the task tools requested by generated task-metadata prompts", () => {
    const reader = normalizeMcpTaskToolDeclarations({
      prompt: "Read the task with get_task before proposing a change.",
      tools: [],
    });
    const updater = normalizeMcpTaskToolDeclarations({
      prompt: "Persist the approved field change with update_task.",
      tools: ["get_task", "read_files"],
    });
    const verifier = normalizeMcpTaskToolDeclarations({
      prompt: "Re-read the task with get_task and report the result.",
    });

    expect(reader.tools).toEqual(["get_task"]);
    expect(updater.tools).toEqual(["read_files", "update_task"]);
    expect(verifier.tools).toEqual(["get_task"]);
  });

  it("does not grant task MCP tools when a prompt does not request one", () => {
    expect(normalizeMcpTaskToolDeclarations({
      prompt: "Summarize the supplied artifact.",
      tools: ["read_files", "get_task"],
    }).tools).toEqual(["read_files"]);
  });
});
