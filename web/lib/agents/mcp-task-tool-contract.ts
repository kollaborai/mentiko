const OBSOLETE_MCP_TASK_TOOL_REPLACEMENTS: Readonly<Record<string, string>> = Object.freeze({
  mentiko_get_task: "get_task",
  mentiko_update_task: "update_task",
});

const CANONICAL_MCP_TASK_TOOLS = ["get_task", "update_task"] as const;
const CANONICAL_MCP_TASK_TOOL_SET = new Set<string>(CANONICAL_MCP_TASK_TOOLS);

export interface McpTaskToolReferenceIssue {
  path: string;
  tool: string;
  replacement: string;
}

function obsoleteToolIssue(path: string, value: unknown): McpTaskToolReferenceIssue | undefined {
  if (typeof value !== "string") return undefined;
  const replacement = OBSOLETE_MCP_TASK_TOOL_REPLACEMENTS[value];
  return replacement ? { path, tool: value, replacement } : undefined;
}

function collectToolIssues(value: unknown, path: string, issues: McpTaskToolReferenceIssue[]): void {
  if (!Array.isArray(value)) return;
  value.forEach((tool, index) => {
    const issue = obsoleteToolIssue(`${path}[${index}]`, tool);
    if (issue) issues.push(issue);
  });
}

function collectPromptIssues(value: unknown, issues: McpTaskToolReferenceIssue[]): void {
  if (typeof value !== "string") return;
  for (const [tool, replacement] of Object.entries(OBSOLETE_MCP_TASK_TOOL_REPLACEMENTS)) {
    if (value.includes(tool)) issues.push({ path: "prompt", tool, replacement });
  }
}

/**
 * Reject retired MCP task-tool names before an agent or chain can persist them.
 * Canonical task tools are `get_task` and `update_task`; this is intentionally
 * a narrow deny-list, not a general tool allow-list for agent integrations.
 */
export function validateMcpTaskToolReferences(agent: unknown): McpTaskToolReferenceIssue[] {
  if (!agent || typeof agent !== "object" || Array.isArray(agent)) return [];

  const record = agent as Record<string, unknown>;
  const issues: McpTaskToolReferenceIssue[] = [];
  collectPromptIssues(record.prompt, issues);
  collectToolIssues(record.tools, "tools", issues);

  const authorities = record.authorities;
  if (Array.isArray(authorities)) {
    collectToolIssues(authorities, "authorities", issues);
  } else if (authorities && typeof authorities === "object") {
    const authorityRecord = authorities as Record<string, unknown>;
    collectToolIssues(authorityRecord.can, "authorities.can", issues);
    collectToolIssues(authorityRecord.needs_approval, "authorities.needs_approval", issues);
  }

  return issues;
}

export function formatMcpTaskToolReferenceIssue(issue: McpTaskToolReferenceIssue): string {
  return `${issue.path}: obsolete MCP task tool '${issue.tool}'; use '${issue.replacement}'`;
}

export function assertCanonicalMcpTaskToolReferences(agent: unknown): void {
  const issue = validateMcpTaskToolReferences(agent)[0];
  if (issue) throw new Error(formatMcpTaskToolReferenceIssue(issue));
}

/**
 * `tools` is the runner's executable capability declaration; mentioning an MCP
 * tool in prompt text does not make it available. Synchronize only the two
 * task MCP declarations with their canonical prompt references, preserving
 * every non-task tool supplied by the agent author.
 */
export function normalizeMcpTaskToolDeclarations<T extends object>(agent: T): T & { tools?: string[] } {
  assertCanonicalMcpTaskToolReferences(agent);

  const record = agent as Record<string, unknown>;
  const prompt = typeof record.prompt === "string" ? record.prompt : "";
  const promptTools = CANONICAL_MCP_TASK_TOOLS.filter((tool) =>
    new RegExp(`\\b${tool}\\b`).test(prompt)
  );
  const declaredTools = record.tools;

  if (declaredTools === undefined) {
    return promptTools.length > 0 ? { ...record, tools: promptTools } as T & { tools?: string[] } : agent;
  }
  if (!Array.isArray(declaredTools) || !declaredTools.every((tool) => typeof tool === "string")) {
    throw new Error("agent tools must be an array of strings");
  }

  const normalizedTools = [
    ...declaredTools.filter((tool) => !CANONICAL_MCP_TASK_TOOL_SET.has(tool)),
    ...promptTools,
  ];
  return { ...record, tools: normalizedTools } as T & { tools?: string[] };
}
