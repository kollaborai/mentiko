import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  DEFAULT_EVENT_TEMPLATE_MAPPINGS,
  getEnabledMappingsForEvent,
  normalizeEventTemplateMapping,
  readEventTemplateMappings,
} from "@/lib/event-artifacts/event-template-map";

jest.mock("@/lib/config", () => ({
  __esModule: true,
  orgPath: (...parts: string[]) => join(globalThis.__EVENT_ARTIFACT_ROOT__, ...parts),
}));

declare global {
  var __EVENT_ARTIFACT_ROOT__: string;
}

describe("event artifact mapping registry", () => {
  beforeEach(() => {
    globalThis.__EVENT_ARTIFACT_ROOT__ = mkdtempSync(join(tmpdir(), "event-artifact-map-"));
  });

  it("returns the default quality gate mapping when no org file exists", () => {
    const mappings = readEventTemplateMappings("default", "default");

    expect(mappings).toEqual(DEFAULT_EVENT_TEMPLATE_MAPPINGS);
    expect(getEnabledMappingsForEvent(mappings, "quality_gate.failed")).toEqual([
      expect.objectContaining({
        id: "quality-gate-failed-draft-tasks",
        generationTemplateId: "failure_triage",
        artifactTemplateId: "generated_tasks",
        artifactSchema: "generated-tasks/v1",
        actions: ["draft_tasks"],
        requireHumanReview: true,
      }),
    ]);
  });

  it("normalizes unsafe mappings to the mvp contract", () => {
    expect(normalizeEventTemplateMapping({
      id: "Bad ID!",
      event: "quality_gate.failed",
      enabled: true,
      generationTemplateId: "failure_triage",
      artifactTemplateId: "generated_tasks",
      artifactSchema: "generated-tasks/v1",
      outputArtifact: "../triage-result.json",
      actions: ["draft_tasks", "start_chain"],
      maxChildren: 99,
      requireHumanReview: false,
      dedupeKey: "{{run.id}}",
    })).toEqual({
      id: "bad-id",
      event: "quality_gate.failed",
      enabled: true,
      generationTemplateId: "failure_triage",
      artifactTemplateId: "generated_tasks",
      artifactSchema: "generated-tasks/v1",
      outputArtifact: "triage-result.json",
      actions: ["draft_tasks"],
      maxChildren: 5,
      requireHumanReview: true,
      dedupeKey: "{{run.id}}",
    });
  });

  it("falls back to defaults when custom mapping json is malformed", () => {
    const dir = join(globalThis.__EVENT_ARTIFACT_ROOT__, "default", "default");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "event-artifact-mappings.json"), "{nope", "utf8");

    expect(readEventTemplateMappings("default", "default")).toEqual(DEFAULT_EVENT_TEMPLATE_MAPPINGS);
  });
});
