import {
  assertCanonicalMcpTaskToolReferences,
  formatMcpTaskToolReferenceIssue,
  validateMcpTaskToolReferences,
} from "./mcp-task-tool-contract";

describe("MCP task tool references", () => {
  it("accepts canonical task tools in declared tools and authorities", () => {
    expect(validateMcpTaskToolReferences({
      tools: ["get_task", "update_task"],
      authorities: {
        can: ["get_task"],
        needs_approval: ["update_task"],
      },
    })).toEqual([]);
  });

  it("reports retired task-tool names at every persisted declaration path", () => {
    const issues = validateMcpTaskToolReferences({
      tools: ["mentiko_get_task"],
      authorities: {
        can: ["mentiko_update_task"],
        needs_approval: ["mentiko_get_task"],
      },
    });

    expect(issues.map(formatMcpTaskToolReferenceIssue)).toEqual([
      "tools[0]: obsolete MCP task tool 'mentiko_get_task'; use 'get_task'",
      "authorities.can[0]: obsolete MCP task tool 'mentiko_update_task'; use 'update_task'",
      "authorities.needs_approval[0]: obsolete MCP task tool 'mentiko_get_task'; use 'get_task'",
    ]);
    expect(() => assertCanonicalMcpTaskToolReferences({ tools: ["mentiko_get_task"] }))
      .toThrow("use 'get_task'");
  });
});
