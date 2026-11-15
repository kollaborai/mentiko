/** @jest-environment node */

import { RESUME_PROVENANCE_ENV, resumeProvenanceFromEnv, resumeProvenanceRecordFields } from "./resume-provenance";

describe("resumeProvenanceFromEnv", () => {
  it("parses the whitelist from the env var", () => {
    const provenance = resumeProvenanceFromEnv({
      [RESUME_PROVENANCE_ENV]: JSON.stringify({
        resumedFromRunId: "run-orig",
        chainId: "release-review",
        metadata: { generationJobId: "job-1" },
        workspaceId: "ws-1",
        agentProfileId: "profile-1",
        agentProfileSource: "workspace",
        user_id: "user-1",
        session_id: "session-1",
        org_role: "admin",
      }),
    });

    expect(provenance).toEqual({
      resumedFromRunId: "run-orig",
      chainId: "release-review",
      metadata: { generationJobId: "job-1" },
      workspaceId: "ws-1",
      agentProfileId: "profile-1",
      agentProfileSource: "workspace",
      user_id: "user-1",
      session_id: "session-1",
      org_role: "admin",
    });
  });

  it("never copies non-whitelisted record keys such as id or status", () => {
    const provenance = resumeProvenanceFromEnv({
      [RESUME_PROVENANCE_ENV]: JSON.stringify({
        resumedFromRunId: "run-orig",
        id: "run-injected",
        status: "completed",
        agents: [{ id: "evil", status: "complete" }],
      }),
    });

    expect(provenance).toEqual({ resumedFromRunId: "run-orig" });
    expect(resumeProvenanceRecordFields(provenance!)).not.toHaveProperty("id");
    expect(resumeProvenanceRecordFields(provenance!)).not.toHaveProperty("status");
    expect(resumeProvenanceRecordFields(provenance!)).not.toHaveProperty("agents");
  });

  it("returns undefined without the env var", () => {
    expect(resumeProvenanceFromEnv({})).toBeUndefined();
    expect(resumeProvenanceFromEnv({ [RESUME_PROVENANCE_ENV]: "" })).toBeUndefined();
  });

  it("returns undefined on malformed payloads, failing closed to the old behavior", () => {
    expect(resumeProvenanceFromEnv({ [RESUME_PROVENANCE_ENV]: "not json" })).toBeUndefined();
    expect(resumeProvenanceFromEnv({ [RESUME_PROVENANCE_ENV]: "[1,2]" })).toBeUndefined();
    expect(resumeProvenanceFromEnv({ [RESUME_PROVENANCE_ENV]: JSON.stringify({ chainId: "x" }) })).toBeUndefined();
  });
});
