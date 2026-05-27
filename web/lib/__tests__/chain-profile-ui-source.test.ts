import { readFileSync } from "node:fs";

describe("chain profile UI source contract", () => {
  it("the chain list resolves and displays the workspace default", () => {
    const source = readFileSync("app/(workflows)/chains/page.tsx", "utf8");

    expect(source).toContain("const workspaceDefaultProfileId =");
    expect(source).toContain("deepLinkChainRef");
    expect(source).toContain('params.delete("chain")');
    expect(source).toContain('params.delete("edit")');
    expect(source).toContain("workspaceDefaultProfileId,");
    expect(source).toContain("workspaceDefaultProfileId={workspaceDefaultProfileId}");
    expect(source).toContain("getChainProfileLabel(chain)");
    expect(source).toContain("default_agent_profile: chain.default_agent_profile");
  });

  it("the direct run page resolves the selected workspace default", () => {
    const source = readFileSync("app/(workflows)/chains/[id]/run/page.tsx", "utf8");

    expect(source).toContain("selectedWorkspaceDefaultProfileId");
    expect(source).toContain("workspaceDefaultProfileId: selectedWorkspaceDefaultProfileId");
  });

  it("the edit-page debug runner carries workspace context into the run", () => {
    const source = readFileSync("app/(workflows)/chains/[id]/edit/edit-chain-component.tsx", "utf8");

    expect(source).toContain("workspaceId,");
    expect(source).toContain("workspacePath,");
    expect(source).toContain("getMissingChainDefaultProfileId(chain.default_agent_profile, agentProfiles)");
    expect(source).toContain("withChainDefaultAgentProfile(chain");
    expect(source).toContain("Profile not found - {missingDefaultProfileId}");
    expect(source).toContain("id: data.chain?.id || chainId");
    expect(source).toContain("encodeURIComponent(chainId)");
    expect(source).toContain("id: chain.id || chainId");
  });

  it("decision settings edits open inside the chains workflow shell", () => {
    const source = readFileSync("app/settings/decisions/page.tsx", "utf8");

    expect(source).toContain('href={`/chains?chain=${encodeURIComponent(chain.id)}&edit=1`}');
    expect(source).not.toContain('href={`/chains/${encodeURIComponent(chain.id)}/edit`}');
    expect(source).toContain("getMissingChainDefaultProfileId(chain.default_agent_profile, profiles)");
    expect(source).toContain("Profile not found - {missingProfileId}");
  });

  it("workspace settings make stale default profile ids selectable", () => {
    const source = readFileSync("components/workspace/workspace-settings.tsx", "utf8");

    expect(source).toContain("getMissingAgentProfileId(agentProfile, agentProfiles)");
    expect(source).toContain("Profile not found - {missingAgentProfileId}");
  });

  it("the chain detail API returns and saves the directory id", () => {
    const source = readFileSync("app/api/chains/[id]/route.ts", "utf8");

    expect(source).toContain("chain.id = decodedId");
    expect(source).toContain("const chainToSave = { ...chain, id: decodedId }");
    expect(source).toContain("JSON.stringify(chainToSave, null, 2)");
  });
});
