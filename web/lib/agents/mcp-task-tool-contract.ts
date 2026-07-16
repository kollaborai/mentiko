const OBSOLETE_MCP_TASK_TOOL_REPLACEMENTS: Readonly<Record<string, string>> = Object.freeze({
  mentiko_get_task: "get_task",
  mentiko_update_task: "update_task",
});

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

/**
 * Reject retired MCP task-tool names before an agent or chain can persist them.
 * Canonical task tools are `get_task` and `update_task`; this is intentionally
 * a narrow deny-list, not a general tool allow-list for agent integrations.
 */
export function validateMcpTaskToolReferences(agent: unknown): McpTaskToolReferenceIssue[] {
  if (!agent || typeof agent !== "object" || Array.isArray(agent)) return [];

  const record = agent as Record<string, unknown>;
  const issues: McpTaskToolReferenceIssue[] = [];
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
