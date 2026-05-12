/**
 * Linear task provider — GraphQL API.
 * Creates/updates Linear issues for task operations.
 */

import type { TaskProvider, CreateTaskInput, UpdateTaskInput, TaskRecord } from "./types";

const LINEAR_API = "https://api.linear.app/graphql";

async function gql(
  apiKey: string,
  query: string,
  variables: Record<string, unknown>
): Promise<unknown> {
  const res = await fetch(LINEAR_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: apiKey,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Linear API error ${res.status}`);
  const json = (await res.json()) as { data?: unknown; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(json.errors[0].message);
  return json.data;
}

const PRIORITY_MAP: Record<number, number> = {
  0: 1, // critical → urgent
  1: 2, // high → high
  2: 3, // medium → medium
  3: 4, // low → low
  4: 0, // backlog → no priority
};

export class LinearTaskProvider implements TaskProvider {
  readonly type = "linear" as const;
  readonly name = "Linear";

  private apiKey: string;
  private teamId: string | undefined;
  private resolvedTeamId: string | null = null;

  constructor(credentials: Record<string, string>, options?: Record<string, string>) {
    this.apiKey = credentials.api_key;
    this.teamId = options?.team_id || credentials.team_id;
  }

  private async getTeamId(): Promise<string> {
    if (this.resolvedTeamId) return this.resolvedTeamId;

    if (this.teamId) {
      // Resolve team key to ID if needed (keys look like "ENG", IDs look like UUIDs)
      if (!this.teamId.includes("-")) {
        const data = await gql(this.apiKey, `query { teams { nodes { id key } } }`, {}) as {
          teams: { nodes: { id: string; key: string }[] };
        };
        const team = data.teams.nodes.find((t) => t.key === this.teamId);
        this.resolvedTeamId = team?.id ?? this.teamId;
      } else {
        this.resolvedTeamId = this.teamId;
      }
      return this.resolvedTeamId!;
    }

    // Auto-detect first team
    const data = await gql(this.apiKey, `query { teams { nodes { id key } } }`, {}) as {
      teams: { nodes: { id: string; key: string }[] };
    };
    const teams = data.teams.nodes;
    if (!teams.length) throw new Error("No Linear teams found");
    this.resolvedTeamId = teams[0].id;
    return this.resolvedTeamId;
  }

  async create(input: CreateTaskInput): Promise<TaskRecord> {
    const teamId = await this.getTeamId();
    const priority = input.priority !== undefined ? (PRIORITY_MAP[input.priority] ?? 3) : 3;

    const data = await gql(
      this.apiKey,
      `mutation CreateIssue($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          issue { id title url state { name } }
        }
      }`,
      {
        input: {
          teamId,
          title: input.title,
          description: input.description,
          priority,
          ...(input.assignee && { assigneeId: input.assignee }),
        },
      }
    ) as { issueCreate: { issue: { id: string; title: string; url: string; state: { name: string } } } };

    const issue = data.issueCreate.issue;
    return {
      id: issue.id,
      title: issue.title,
      status: issue.state.name,
      url: issue.url,
    };
  }

  async get(id: string): Promise<TaskRecord | null> {
    try {
      const data = await gql(
        this.apiKey,
        `query GetIssue($id: String!) {
          issue(id: $id) { id title url state { name } priority }
        }`,
        { id }
      ) as { issue: { id: string; title: string; url: string; state: { name: string }; priority: number } | null };

      if (!data.issue) return null;
      return {
        id: data.issue.id,
        title: data.issue.title,
        status: data.issue.state.name,
        url: data.issue.url,
        priority: data.issue.priority,
      };
    } catch {
      return null;
    }
  }

  async update(id: string, input: UpdateTaskInput): Promise<void> {
    const updateFields: Record<string, unknown> = {};
    if (input.title) updateFields.title = input.title;
    if (input.description) updateFields.description = input.description;
    if (input.priority !== undefined) updateFields.priority = PRIORITY_MAP[input.priority] ?? 3;

    if (Object.keys(updateFields).length === 0) return;

    await gql(
      this.apiKey,
      `mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) { success }
      }`,
      { id, input: updateFields }
    );
  }

  async comment(id: string, body: string): Promise<void> {
    await gql(
      this.apiKey,
      `mutation AddComment($input: CommentCreateInput!) {
        commentCreate(input: $input) { success }
      }`,
      { input: { issueId: id, body } }
    );
  }

  async complete(id: string): Promise<void> {
    // Look up the "Done" workflow state for the team
    const teamId = await this.getTeamId();
    const data = await gql(
      this.apiKey,
      `query WorkflowStates($teamId: String!) {
        workflowStates(filter: { team: { id: { eq: $teamId } } }) {
          nodes { id name type }
        }
      }`,
      { teamId }
    ) as { workflowStates: { nodes: { id: string; name: string; type: string }[] } };

    const doneState = data.workflowStates.nodes.find(
      (s) => s.type === "completed" || s.name.toLowerCase() === "done"
    );
    if (!doneState) throw new Error("No 'Done' workflow state found in Linear team");

    await gql(
      this.apiKey,
      `mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) { success }
      }`,
      { id, input: { stateId: doneState.id } }
    );
  }

  async ping(): Promise<string | null> {
    try {
      await gql(this.apiKey, `query { viewer { id name } }`, {});
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : "Linear API unreachable";
    }
  }
}
