import type { Decision, PreferenceProfile, GuidedFlow } from "./decision-types";

/**
 * Build full decision context string for template injection.
 * Includes all available fields: prompt, title, brief, context.
 */
export function buildDecisionContext(decision: Decision | null): string {
  if (!decision) return "";
  return [
    `DECISION: ${decision.prompt}`,
    decision.title ? `Title: ${decision.title}` : "",
    decision.brief?.headline ? `Headline: ${decision.brief.headline}` : "",
    decision.brief?.situation ? `Situation: ${decision.brief.situation}` : "",
    decision.context?.problem ? `Problem: ${decision.context.problem}` : "",
    decision.context?.currentState ? `Current State: ${decision.context.currentState}` : "",
    decision.context?.whyProblem ? `Impact: ${decision.context.whyProblem}` : "",
    decision.context?.affectedAreas?.length ? `Affected Areas: ${decision.context.affectedAreas.join(", ")}` : "",
    decision.context?.constraints?.length ? `Constraints: ${decision.context.constraints.join("; ")}` : "",
    decision.context?.references?.length ? `References: ${decision.context.references.join("; ")}` : "",
  ].filter(Boolean).join("\n");
}

/**
 * Build preference profile text for template injection.
 * Uses synthesized profile if available, falls back to raw Q&A pairs.
 */
export function buildPreferenceText(guidedFlow: GuidedFlow): string {
  const profile = guidedFlow.round1.preferenceProfile;

  if (profile && profile.priorities?.length) {
    return buildSynthesizedProfileText(profile);
  }

  // fallback: raw Q&A pairs for backward compat
  return buildRawPreferenceText(guidedFlow);
}

function buildSynthesizedProfileText(profile: PreferenceProfile): string {
  const parts: string[] = [];

  if (profile.summary) {
    parts.push(profile.summary);
  }

  if (profile.priorities?.length) {
    parts.push(`\nTop priorities:\n${profile.priorities.join("\n")}`);
  }

  if (profile.non_negotiables?.length) {
    parts.push(`\nNon-negotiables:\n${profile.non_negotiables.join("\n")}`);
  }

  if (profile.willing_to_sacrifice?.length) {
    parts.push(`\nWilling to sacrifice:\n${profile.willing_to_sacrifice.join("\n")}`);
  }

  if (profile.risk_profile) {
    parts.push(`\nRisk profile: ${profile.risk_profile}`);
  }

  if (profile.time_horizon) {
    parts.push(`Time horizon: ${profile.time_horizon}`);
  }

  if (profile.decision_style) {
    parts.push(`Decision style: ${profile.decision_style}`);
  }

  return parts.join("\n");
}

function buildRawPreferenceText(guidedFlow: GuidedFlow): string {
  const summary = guidedFlow.round1.preferenceProfile?.summary || "";
  const details = guidedFlow.round1.answers.map((a) => {
    const q = guidedFlow.round1.questions.find((qq) => qq.id === a.questionId);
    if (!q) return "";
    const chosen = a.choice === "a" ? q.optionA.label : a.choice === "b" ? q.optionB.label : "skipped";
    return `${q.category}: ${chosen}`;
  }).filter(Boolean).join("\n");

  if (summary && details) {
    return `${summary}\n\nDetailed preferences:\n${details}`;
  }
  return summary || details || "No preference data available";
}
