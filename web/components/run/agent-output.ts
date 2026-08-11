export interface AgentOutputSummary {
  executiveSummary?: string;
  workCompleted?: string[];
  artifactsProduced?: string[];
  codeChanges?: string[];
  findings?: string[];
  risks?: string[];
  nextAgentHints?: string[];
}

export interface AgentOutputActivity {
  output?: string | null;
  summary?: AgentOutputSummary | null;
  summaryMarkdown?: string | null;
}

export interface ResolvedAgentDisplayOutput {
  content: string;
  source: "session-output" | "summary";
}

/**
 * Resolve the best durable text for the run Output tab.
 *
 * A completed agent may have no live PTY transcript. In that case the
 * activity endpoint's stored summary is still the authoritative user-facing
 * result and must not be rendered as an empty output state.
 */
export function resolveAgentDisplayOutput(
  activity: AgentOutputActivity,
): ResolvedAgentDisplayOutput | null {
  const sessionOutput = activity.output?.trim();
  if (sessionOutput) {
    return { content: sessionOutput, source: "session-output" };
  }

  const summaryMarkdown = activity.summaryMarkdown?.trim();
  if (summaryMarkdown) {
    return { content: summaryMarkdown, source: "summary" };
  }

  const summary = activity.summary;
  if (!summary) return null;

  const sections: string[] = [];
  if (summary.executiveSummary?.trim()) {
    sections.push(summary.executiveSummary.trim());
  }

  const listSections: Array<[string, string[] | undefined]> = [
    ["Work completed", summary.workCompleted],
    ["Artifacts produced", summary.artifactsProduced],
    ["Code changes", summary.codeChanges],
    ["Findings", summary.findings],
    ["Risks", summary.risks],
    ["Next steps", summary.nextAgentHints],
  ];

  for (const [label, items] of listSections) {
    const visibleItems = items?.map((item) => item.trim()).filter(Boolean);
    if (visibleItems && visibleItems.length > 0) {
      sections.push(`### ${label}\n${visibleItems.map((item) => `- ${item}`).join("\n")}`);
    }
  }

  return sections.length > 0
    ? { content: sections.join("\n\n"), source: "summary" }
    : null;
}
