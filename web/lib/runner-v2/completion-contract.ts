import { join } from "node:path";
import { shellEscape } from "@/lib/api/audit-exec";

export interface CompletionContractInput {
  agentId: string;
  artifactsDir: string;
  eventsDir: string;
  runId?: string;
  emits?: string;
  coreGenerationChain?: boolean;
}

/** Canonical agent-summary and terminal-handoff instruction contract. */
export function buildTypedCompletionContract(input: CompletionContractInput): string {
  const runId = input.runId || "unknown";
  const agentId = input.agentId || "unknown";
  const emits = input.emits || "";
  const summaryJson = join(input.artifactsDir, `${agentId}-summary.json`);
  const summaryMarkdown = join(input.artifactsDir, `${agentId}-summary.md`);
  const emitCommand = emits ? `mentiko emit ${emits}` : "";
  const eventHandoff = emits
    ? input.coreGenerationChain
      ? ["Core generation handoff:", `- Write the authoritative generation payload to ${join(input.artifactsDir, "generation-result.json")}.`, "- Mentiko imports that file automatically when this run completes.", `- You may run \"${emitCommand}\" after writing the payload; the generation file remains authoritative.`]
      : ["Canonical event handoff:", "When completely finished, signal completion by running this command exactly:", `    ${emitCommand}`]
    : ["This agent has no declared completion event.", "Do not create or hand-write any .event file; the final completion marker is the only terminal signal."];
  return [
    "COMPLETION CONTRACT:",
    `Run context: RUN_ID=${runId}, MENTIKO_AGENT_ID=${agentId}`,
    `Event root: EVENTS_DIR=${input.eventsDir}`,
    `Artifact root: ARTIFACTS_DIR=${input.artifactsDir}`,
    "",
    "Before you finish, create these user-facing handoff artifacts:",
    `- ${summaryJson}`,
    `- ${summaryMarkdown}`,
    "",
    "The JSON summary must use this shape:",
    "{",
    '  "status": "complete|partial|blocked",',
    '  "executiveSummary": "2-4 sentences suitable for the run UI",',
    '  "workCompleted": ["specific work performed"],',
    '  "artifactsProduced": ["artifact paths you created or updated"],',
    '  "codeChanges": ["files changed, or \'none\'"],',
    '  "findings": ["important discoveries"],',
    '  "risks": ["known risks or gaps"],',
    '  "nextAgentHints": ["what the next agent should read or do"]',
    "}",
    "Write a syntactically valid JSON object. Do not put literal line breaks inside JSON strings; use arrays or escaped \\n instead.",
    `Before emitting completion, validate the summary with: node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' ${shellEscape(summaryJson)}`,
    "",
    ...eventHandoff,
    "Do NOT hand-write any .event file. The typed emitter owns the canonical event bytes, filename, provenance, and validation.",
    "Do NOT create output files in the project working directory unless the task explicitly requires it; put reports and handoff artifacts under ARTIFACTS_DIR.",
    "",
    "Your final terminal response must be in this order:",
    "SUMMARY:",
    "- one to three concise bullets",
    "ARTIFACTS:",
    "- paths to the most important artifacts",
    "NEXT:",
    '- handoff notes or "none"',
    "<the completion marker line>",
    "",
    "The completion marker line must contain exactly the token AGENT_COMPLETE and nothing else.",
    "The final non-empty line must be exactly AGENT_COMPLETE. Do not write anything after it. Do not put AGENT_COMPLETE inside files or earlier in your response.",
  ].join("\n");
}
