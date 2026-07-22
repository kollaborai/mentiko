/**
 * @jest-environment node
 */

const getAllStandaloneAgents = jest.fn();

jest.mock("./agent-loader", () => ({
  getAllStandaloneAgents: (...args: unknown[]) => getAllStandaloneAgents(...args),
}));

import { buildAgentCatalog } from "./agent-catalog";

describe("buildAgentCatalog", () => {
  it("includes capabilities so generation can reuse an agent by authority, not name alone", () => {
    getAllStandaloneAgents.mockReturnValue([{
      id: "repository-editor",
      name: "Repository Editor",
      role: "Implements scoped code changes",
      triggers: ["plan-ready"],
      emits: "change-implemented",
      prompt: "Implement the requested repository change.",
      authorities: {
        can: ["read_files", "edit_files", "run_commands"],
        needs_approval: [],
      },
    }]);

    const catalog = buildAgentCatalog("default", "default");

    expect(catalog).toContain('id: "repository-editor"');
    expect(catalog).toContain('authorities.can: ["read_files","edit_files","run_commands"]');
  });

  it("bounds and ranks the catalog against the current generation request", () => {
    getAllStandaloneAgents.mockReturnValue([
      {
        id: "documentation-writer",
        name: "Documentation Writer",
        role: "Writes markdown",
        prompt: "Write documentation.",
      },
      {
        id: "dependency-remover",
        name: "Dependency Remover",
        role: "Removes managed task dependencies",
        prompt: "Apply the requested dependency mutation.",
        authorities: { can: ["run_commands"], needs_approval: [] },
      },
    ]);

    const catalog = buildAgentCatalog("default", "default", {
      query: "remove a task dependency",
      limit: 1,
    });

    expect(catalog).toContain('id: "dependency-remover"');
    expect(catalog).not.toContain('id: "documentation-writer"');
  });
});
