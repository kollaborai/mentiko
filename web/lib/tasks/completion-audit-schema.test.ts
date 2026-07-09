/**
 * @jest-environment node
 */
import { extractCompletionAudit } from "./completion-audit-schema";

describe("extractCompletionAudit", () => {
  it("returns null when there is no audit block (run was not audited)", () => {
    expect(extractCompletionAudit({ headline: "done" })).toBeNull();
    expect(extractCompletionAudit(null)).toBeNull();
    expect(extractCompletionAudit("not an object")).toBeNull();
  });

  it("parses a clean close verdict", () => {
    const a = extractCompletionAudit({ audit: { verdict: "close", reason: "all AC met" } });
    expect(a).toEqual({ verdict: "close", reason: "all AC met" });
  });

  it("parses an audit embedded in a generated job output string", () => {
    const a = extractCompletionAudit({
      output: JSON.stringify({
        headline: "implemented and verified",
        audit: { verdict: "close", reason: "live runtime evidence satisfied the task" },
      }),
    });
    expect(a).toEqual({ verdict: "close", reason: "live runtime evidence satisfied the task" });
  });

  it("FAIL-SAFE: unknown verdict embedded directly in job output escalates to decision", () => {
    const a = extractCompletionAudit({
      output: JSON.stringify({ verdict: "ship_it", reason: "looks fine" }),
    });
    expect(a?.verdict).toBe("decision");
  });

  it("parses a decision verdict with prompt and options", () => {
    const a = extractCompletionAudit({
      audit: {
        verdict: "decision",
        reason: "issues found",
        decision: { prompt: "fix now or proceed?", options_hint: "A or B" },
      },
    });
    expect(a?.verdict).toBe("decision");
    expect(a?.decision).toEqual({ prompt: "fix now or proceed?", options_hint: "A or B" });
  });

  it("parses a retry verdict with guidance, comments and tweaks", () => {
    const a = extractCompletionAudit({
      audit: {
        verdict: "retry",
        reason: "missed the intent",
        retry: {
          guidance: "cover the error cases",
          comments: ["tests were shallow", ""],
          task_tweaks: { acceptance_criteria: "must include edge cases", bogus: 1 },
        },
      },
    });
    expect(a?.verdict).toBe("retry");
    expect(a?.retry?.guidance).toBe("cover the error cases");
    expect(a?.retry?.comments).toEqual(["tests were shallow"]); // empties dropped
    expect(a?.retry?.task_tweaks).toEqual({ acceptance_criteria: "must include edge cases" });
  });

  it("FAIL-SAFE: unknown verdict escalates to decision, never close", () => {
    const a = extractCompletionAudit({ audit: { verdict: "ship_it", reason: "looks fine" } });
    expect(a?.verdict).toBe("decision");
  });

  it("FAIL-SAFE: missing verdict escalates to decision", () => {
    const a = extractCompletionAudit({ audit: { reason: "no verdict given" } });
    expect(a?.verdict).toBe("decision");
  });

  it("FAIL-SAFE: non-object audit block escalates to decision", () => {
    const a = extractCompletionAudit({ audit: "close" });
    expect(a?.verdict).toBe("decision");
  });

  it("retry without a retry object still yields guidance from reason", () => {
    const a = extractCompletionAudit({ audit: { verdict: "retry", reason: "redo it" } });
    expect(a?.verdict).toBe("retry");
    expect(a?.retry?.guidance).toBe("redo it");
  });
});
