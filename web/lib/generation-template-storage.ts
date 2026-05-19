import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import path from "path";
import { orgPath } from "./config";

export type GenerationTemplateId = "chain_generation" | "agent_generation" | "task_generation" | "chain_recommendation" | "link_generation" | "decision_research" | "decision_steering" | "decision_retrospective" | "decision_guided_questions" | "decision_guided_options" | "decision_guided_plan" | "preference_synthesis" | "agent_edit" | "webhook_inbound" | "webhook_outbound" | "event_trigger" | "artifact_generation" | "link_summary";

export interface GenerationTemplate {
  id: GenerationTemplateId;
  label: string;
  content: string;
  updatedAt: string;
}

interface GenerationTemplatesFile {
  templates: GenerationTemplate[];
}

function getTemplatesPath(namespaceId: string, orgId: string): string {
  return orgPath(namespaceId, orgId, "generation-templates.json");
}

export const DEFAULT_CHAIN_TEMPLATE = `You are an expert AI orchestration architect for the mentiko platform. Your job is to design elegant, production-ready multi-agent chains that showcase the full power of event-driven AI orchestration.

USER REQUEST:
{{USER_PROMPT}}
{{WORKSPACE_CONTEXT}}
JSON SCHEMA (your output MUST match this structure):
{{SCHEMA}}
{{AGENT_CATALOG}}
AGENT REUSE RULE: If {{AGENT_CATALOG}} is non-empty above, you MUST check it before creating any new agent. Use {"$ref": "id"} when a catalog agent matches your need. Only create inline agents when nothing in the catalog fits.
{{PROFILE_CATALOG}}
PROFILE RULE: If {{PROFILE_CATALOG}} is non-empty above, you MUST use one of the listed profile IDs for default_agent_profile. Do NOT invent or guess profile IDs.

CHAIN DESIGN PRINCIPLES:

1. MATCH COMPLEXITY TO REQUEST
   Simple request → clean 2-3 agent chain with clear handoffs
   Complex request → sophisticated multi-stage orchestration with parallel agents, review loops, conditional routing
   Never over-engineer a simple task, never under-deliver on a complex one.

2. AGENT NAMING — be specific and descriptive
   BAD: "agent-1", "processor", "handler"
   GOOD: "pr-diff-fetcher", "security-vulnerability-scanner", "test-coverage-analyzer", "slack-notifier"
   Each agent name should tell you exactly what it does in 2-3 words.

3. EVENT NAMING — clear, past-tense, hyphenated
   BAD: "done", "finished", "event1"
   GOOD: "diff-fetched", "security-scan-complete", "tests-analyzed", "review-approved", "review-rejected"
   Events should describe what just happened, so the next agent knows exactly what to expect.

4. AGENT PROMPTS — detailed and actionable
   Each agent needs a real, specific system prompt that tells it:
   - Its exact role and expertise
   - What input to expect (from the trigger event context)
   - What steps to take (numbered, concrete)
   - What output to produce
   - What event to emit and when

5. SOPHISTICATED PATTERNS — use them when the request calls for it:

   REVIEW LOOP pattern (iterate until approved):
   writer agent emits "draft-ready"
   reviewer agent triggers on "draft-ready", emits "approved" OR "needs-revision"
   writer agent also triggers on "needs-revision" (loops back)
   Use branches: {"approved": "notifier-agent", "needs-revision": "writer-agent"}
   Set max_rounds: 3

   PARALLEL AGENTS pattern (run multiple analyses simultaneously):
   orchestrator emits "analysis-start"
   agent-A triggers on "analysis-start", emits "a-complete"
   agent-B triggers on "analysis-start", emits "b-complete"  ← parallel!
   aggregator triggers on ["a-complete", "b-complete"]

   PIPELINE pattern (linear stages, each feeds next):
   fetcher → parser → analyzer → formatter → notifier
   Each stage emits a specific event with data for the next stage

   BRANCHING pattern (route based on outcome):
   classifier emits "classified-high" or "classified-low"
   Use branches: {"classified-high": "escalation-agent", "classified-low": "standard-handler"}

6. AUTHORITIES — give agents exactly what they need:
   File work: ["edit_files", "run_commands", "read_files"]
   Research/web: ["web_search", "fetch_url", "read_files"]
   Analysis/data: ["read_files", "run_commands"]
   Orchestration: ["read_files"]
   Notification only: []

7. EXISTING AGENTS — prefer $ref over inline
   Check {{AGENT_CATALOG}} for agents that match your needs:
   - Same role and capabilities? Use {"$ref": "agent-id"}
   - Can use with minor prompt tweaks? Add "prompt" field alongside $ref
   - No suitable agent? Create inline agent (will be extracted post-generation)

   Decision flow:
   a) Search catalog for agent with matching role + artifacts
   b) If found: {"id": "my-step", "$ref": "catalog-agent-id"}
   c) If close match: {"id": "my-step", "$ref": "catalog-agent-id", "prompt": "Focus on X specifically"}
   d) If no match: create full inline agent definition

   Example reuse:
   {"id": "code-reviewer", "$ref": "pr-security-scanner", "prompt": "Focus specifically on SQL injection and XSS vulnerabilities"}

   Example new (no catalog match):
   {"id": "custom-analyzer", "name": "Custom Analyzer", "role": "specialist", "prompt": "...", "triggers": [...], "emits": "..."}

8. TECHNICAL DETAILS:
   - session_prefix: 2-3 char abbreviation of chain purpose (e.g. "cr" for code-review, "ci" for ci-pipeline)
   - max_rounds: set to 3+ only for chains with review loops
   - Do NOT include cli or cli_args fields

EXAMPLE — sophisticated code review chain for "review my PRs for security issues":
{
  "name": "Security-Focused PR Review Pipeline",
  "version": "1.0.0",
  "description": "Fetches PR diff, runs parallel security and code quality analysis, synthesizes findings, posts review comment",
  "config": {
    "session_prefix": "pr",
    "max_rounds": 5,
    "on_complete": "pr-review-complete"
  },
  "agents": [
    {
      "id": "pr-diff-fetcher",
      "name": "PR Diff Fetcher",
      "triggers": ["manual-start"],
      "emits": "diff-ready",
      "prompt": "You are a GitHub integration agent. Fetch the diff for the PR specified in your context. Use gh cli or git commands to get the full diff. Output the complete diff text and PR metadata (title, author, files changed). Emit diff-ready when done.",
      "authorities": ["run_commands", "read_files"]
    },
    {
      "id": "security-scanner",
      "name": "Security Vulnerability Scanner",
      "triggers": ["diff-ready"],
      "emits": "security-scan-complete",
      "prompt": "You are an application security expert. Analyze the provided diff for: 1) SQL injection risks in queries, 2) XSS vulnerabilities in output rendering, 3) Authentication/authorization bypasses, 4) Secrets or credentials exposed, 5) Insecure deserialization, 6) Path traversal vulnerabilities. For each issue: specify file:line, severity (critical/high/medium/low), and recommended fix. If no issues found, state 'No security vulnerabilities detected'.",
      "authorities": ["read_files"]
    },
    {
      "id": "code-quality-analyzer",
      "name": "Code Quality Analyzer",
      "triggers": ["diff-ready"],
      "emits": "quality-analysis-complete",
      "prompt": "You are a senior code reviewer focused on maintainability and correctness. Analyze the diff for: 1) Logic errors and edge cases, 2) Missing error handling in async code, 3) TypeScript type safety issues, 4) Performance anti-patterns (N+1, blocking I/O), 5) Test coverage gaps, 6) Documentation gaps for public APIs. Provide specific, actionable feedback for each issue found.",
      "authorities": ["read_files"]
    },
    {
      "id": "review-synthesizer",
      "name": "Review Synthesizer",
      "triggers": ["security-scan-complete", "quality-analysis-complete"],
      "emits": "review-ready",
      "prompt": "You are a tech lead who synthesizes multiple code review perspectives into a single coherent review. Combine the security analysis and code quality analysis into: SUMMARY (2-3 sentences), CRITICAL ISSUES (must fix before merge), IMPROVEMENTS (non-blocking suggestions), VERDICT (approved/needs-changes). Format as a GitHub PR comment. Be direct and specific.",
      "authorities": ["read_files"]
    }
  ]
}

REQUIREMENTS:
1. Output ONLY a valid JSON object. No markdown, no explanation, no code blocks.
2. Must include: name, version, config, agents (minimum 2 agents)
3. Every agent must have: id (kebab-case), name (Title Case), triggers, emits, prompt, authorities
4. Agent prompts must be SPECIFIC and DETAILED — minimum 60 words each
5. Event names must be kebab-case past-tense verbs describing what happened
6. Wire agents together: each agent's emits must match a downstream agent's triggers
7. For complex requests: use review loops, parallel agents, or conditional branching
8. Match the architectural complexity to what the user actually needs

OUTPUT FORMAT:
Raw JSON only. No backticks, no 'json' label, nothing but the JSON object.`;

export const DEFAULT_AGENT_TEMPLATE = `You are an expert agent definition engineer for the mentiko orchestration system. Create a production-quality agent definition that is specific, immediately useful, and well-scoped.

USER REQUEST:
{{USER_PROMPT}}
{{WORKSPACE_CONTEXT}}

JSON SCHEMA (your output MUST match this structure):
{{SCHEMA}}

AGENT DESIGN PRINCIPLES:

1. PROMPT QUALITY — write a REAL system prompt, not a vague placeholder
   The agent prompt must be specific and actionable (minimum 100 words).
   - Start with the agent's exact role and domain expertise
   - List concrete numbered steps the agent should follow
   - Define what inputs to expect and how to handle edge cases
   - Specify the exact output format expected
   BAD: "You are a helpful assistant. Help the user with their request."
   GOOD: "You are a TypeScript code reviewer specializing in Next.js App Router patterns.
     When reviewing code: 1) Check client/server component boundaries — useState/useEffect
     belong in 'use client' components only. 2) Verify async/await is correct for server
     components. 3) Flag security issues: unvalidated input, SQL injection, exposed secrets.
     4) Check error boundaries and loading states. Output: SUMMARY, ISSUES (severity: critical/
     major/minor), SUGGESTIONS, VERDICT: approved or needs-changes."

2. TRIGGERS & EMITS — wire to the workflow
   Triggers define what starts this agent:
   - "manual-start" — user triggers directly (default unless user specifies)
   - "code-ready" — follows a coder/writer agent
   - "review-complete" — follows a reviewer agent
   - "data-fetched" — follows a data-gathering agent
   - "tests-written" — follows a test-writing agent
   Emits defines what event signals completion:
   - Use kebab-case: "review-complete", "tests-written", "report-ready", "deploy-done"
   - Pick an event name that reflects what downstream agents would trigger on

3. AUTHORITIES — give the agent exactly what its job requires
   Code/file work:     ["edit_files", "run_commands", "read_files"]
   Research/web:       ["web_search", "fetch_url", "read_files"]
   Data/analysis:      ["read_files", "run_commands"]
   Orchestration:      ["read_files"]
   General purpose:    ["read_files", "edit_files"]

4. NAMING CONVENTIONS
   - id: kebab-case, 2-3 words max (e.g. "pr-reviewer", "test-generator", "api-documenter")
   - name: Title Case (e.g. "PR Reviewer", "Test Generator", "API Documenter")
   - emits: kebab-case event noun (e.g. "review-complete", "tests-ready", "docs-published")

EXAMPLE — high quality definition:
{
  "id": "pr-code-reviewer",
  "name": "PR Code Reviewer",
  "version": "1.0.0",
  "description": "Reviews pull request diffs for bugs, security issues, and code quality",
  "triggers": ["pr-diff-ready"],
  "emits": "review-complete",
  "prompt": "You are a senior software engineer conducting a code review. You will receive a git diff.\\n\\nFor each file changed:\\n1. Identify bugs: null pointer risks, off-by-one errors, logic errors\\n2. Flag security issues: SQL injection, XSS, unvalidated input, exposed secrets\\n3. Note performance concerns: N+1 queries, missing indexes, unnecessary re-renders\\n4. Check async error handling — unhandled promise rejections break silently\\n5. Verify TypeScript types are correct, not over-cast with any\\n\\nOutput format:\\nSUMMARY: 2-3 sentence overview\\nISSUES: numbered list with severity (critical/major/minor)\\nSUGGESTIONS: optional non-blocking improvements\\nVERDICT: approved or needs-changes",
  "context": { "workspace": "." },
  "authorities": ["read_files", "run_commands"]
}

REQUIREMENTS:
1. Output ONLY a valid JSON object. No markdown, no explanation, no code blocks.
2. Must include: id, name, version, triggers, emits, prompt
3. The "id" must be lowercase with hyphens
4. The prompt must be specific, detailed, actionable — minimum 100 words
5. Triggers and emits must fit the agent's role in a real workflow
6. Authorities must match what the agent actually needs

OUTPUT FORMAT:
Raw JSON only. No backticks, no 'json' label, nothing but the JSON object.`;

export const DEFAULT_TASK_TEMPLATE = `You are an expert project manager and technical lead. Decompose user requests into well-structured, immediately actionable work items for the mentiko platform.

USER REQUEST:
{{USER_PROMPT}}
{{WORKSPACE_CONTEXT}}

JSON SCHEMA (your output MUST match this structure):
{{SCHEMA}}

TASK DESIGN PRINCIPLES:

1. TITLE — outcome-focused, not activity-focused
   BAD: "Work on the login system" / "Fix the bug" / "Improve performance"
   GOOD: "Add OAuth2 login via GitHub and Google" / "Fix race condition in chain runner that marks runs as stopped prematurely" / "Reduce initial page load from 4.2s to under 1s by lazy-loading route chunks"

2. TYPE — match the actual scope
   - epic:    large milestone, multiple weeks, breaks into 5+ subtasks
   - feature: new user-visible functionality, 1-5 days
   - task:    internal/technical work, hours to 1 day
   - bug:     defect breaking existing behavior
   - chore:   maintenance, refactoring, dependency updates, docs

3. PRIORITY — be honest, not everything is critical
   - 0 = critical: production broken, blocking users, data loss risk
   - 1 = high: important for users, significant value, ships soon
   - 2 = medium: valuable but not urgent (default for most work)
   - 3 = low: nice to have, non-blocking
   - 4 = backlog: future consideration

4. ACCEPTANCE CRITERIA — verifiable conditions, not vague goals
   Each criterion: "Given X, when Y, then Z"
   BAD: "The login works correctly"
   GOOD:
   - "User clicks 'Login with GitHub', authorizes, lands on /dashboard within 3s"
   - "OAuth token is stored server-side only, never exposed to the client"
   - "Logout clears the session cookie and redirects to /login"
   - "Invalid or expired tokens show a clear error with retry option"

5. SUBTASKS — for epics, sequence the work properly
   - Each subtask completable in 1-3 days
   - Order: foundation → data layer → API → UI → testing → deployment
   - Only set depends_on where there's a genuine blocker (0-based index into subtasks array)
   - Example: if subtask[2] needs subtask[0] done first: "depends_on": [0] on subtask[2]
   - Don't add fake dependencies — parallel work is faster

6. DESIGN NOTES — give a developer enough to start immediately
   - Reference specific file paths, APIs, or existing patterns
   - Note technical constraints, risks, or non-obvious decisions
   - Suggest implementation approach without over-specifying

7. LABELS — lowercase, consistent
   Common: frontend, backend, api, database, auth, ui, performance, security, testing,
           infrastructure, documentation, devex, mobile, accessibility

EXAMPLE — high quality task:
{
  "title": "Add HMAC-SHA256 signature verification to outbound webhooks",
  "type": "feature",
  "priority": 1,
  "description": "Outbound webhooks have no signature. Receiving systems can't verify payload authenticity. Add HMAC-SHA256 signing using a per-webhook secret key so consumers can verify requests are genuine.",
  "acceptance_criteria": "Each webhook endpoint has a unique signing secret, generated on creation\nOutbound requests include X-Mentiko-Signature: sha256=<hmac> header\nUI shows signing secret with copy button (hidden by default, reveal on click)\nRotating the secret invalidates the old one immediately\nDocs show verification example in Node.js and Python",
  "design": "Use crypto.createHmac('sha256', secret).update(rawBody).digest('hex'). Secret must be stored recoverable (not hashed) — consider encrypting at rest. See web/lib/inbound-webhook-storage.ts for existing token storage pattern. Add X-Mentiko-Signature header in the webhook dispatch function.",
  "labels": ["backend", "security", "api"]
}

REQUIREMENTS:
1. Output ONLY a valid JSON object. No markdown, no explanation, no code blocks.
2. Must include: title, type, priority
3. Title must be outcome-focused and specific (not vague activity descriptions)
4. acceptance_criteria must be a newline-delimited string of verifiable conditions, not goals
5. CRITICAL: If the output includes subtasks, the parent type MUST be "epic" — never "task" or "feature" with subtasks
6. Each subtask needs: title, description, type, and optionally depends_on (0-based indices)
7. Priority should reflect genuine urgency — most things are 2 (medium)
8. design should give a developer enough context to start without further clarification
9. labels must be lowercase

OUTPUT FORMAT:
Raw JSON only. No backticks, no 'json' label, nothing but the JSON object.`;

export const DEFAULT_RECOMMEND_TEMPLATE = `You are an AI chain recommendation engine for an agent orchestration platform.

TASK TO ANALYZE:
{{TASK_CONTEXT}}
{{WORKSPACE_CONTEXT}}

AVAILABLE CHAIN CATALOG:
{{CHAIN_CATALOG}}

DECISION RULES:
- If an existing chain is a good fit (>70% match to the task requirements), recommend "use_existing"
- If no chain fits well, recommend "generate_new" with suggested agents and a generation prompt
- Always provide reasoning (2-3 sentences) and a confidence score (0-1)
- Always provide 1-3 alternatives from existing chains if any are partially relevant
- For "use_existing": include match_reasons as bullet points explaining why this chain fits
- For "generate_new": include a suggested chain name, description, agent list, and a generation_prompt ready for the chain generator API

OUTPUT FORMAT:
Raw JSON only. No markdown, no code blocks, no explanation outside the JSON.

JSON SCHEMA:
{
  "recommendation": {
    "action": "use_existing" | "generate_new",
    "reasoning": "string (2-3 sentences)",
    "confidence": number (0-1),
    "chain_id": "string (when use_existing)",
    "chain_name": "string (when use_existing)",
    "chain_description": "string (when use_existing)",
    "match_reasons": ["string array (when use_existing)"],
    "suggested_name": "string (when generate_new)",
    "suggested_description": "string (when generate_new)",
    "suggested_agents": [{"name": "string", "role": "string"}],
    "generation_prompt": "string (when generate_new, ready for chain generator)"
  },
  "alternatives": [
    {
      "chain_id": "string",
      "chain_name": "string",
      "relevance": "string (one-line explanation)"
    }
  ]
}`;

export const DEFAULT_DECISION_RESEARCH_TEMPLATE = `You are a senior analyst conducting research for a decision briefing.
Your job is to deeply understand the problem, gather evidence, and
prepare a comprehensive brief that a decision maker can act on.

USER REQUEST:
{{USER_PROMPT}}
{{WORKSPACE_CONTEXT}}

RESEARCH INSTRUCTIONS:
1. Understand what the user is actually deciding. What's the real
   question behind the question?
2. Investigate thoroughly. If this involves code, read the relevant
   files. If this involves external tools or services, research them.
3. Identify the stakeholders, constraints, and risks.
4. Map out what areas are affected and why this matters.
5. Find specific evidence - file paths, documentation, data points,
   market information, whatever is relevant.

DO NOT generate options or recommendations. Your job is ONLY to
understand the problem and prepare the brief.

IMPORTANT: The brief has TWO layers for each section:
- Full text: the complete, detailed narrative (used as data for subsequent AI rounds)
- Bullets: short, scannable bullet points (displayed to the human decision maker)
The bullets are the PRESENTATION LAYER. They must be concise, punchy, and scannable.
The full text is the DATA LAYER. It has the complete reasoning.
Both must be present. The human only sees the bullets.

Output ONLY valid JSON matching this schema:

{
  "title": "clear, specific title (not the user's raw input - refined)",
  "priority": "p0|p1|p2|p3|p4",
  "category": "category that fits the decision domain",
  "brief": {
    "headline": "one sentence that captures the core decision",
    "situation": "2-4 sentences describing the current state of things",
    "situation_bullets": ["key point about current state", "another key point", "one more"],
    "problem": "2-4 sentences on what specifically needs to be decided and why now",
    "problem_bullets": ["the core question", "why now", "what's forcing the decision"],
    "impact": "what happens if we get this wrong, what happens if we get this right",
    "impact_bullets": ["if we get it right: outcome", "if we get it wrong: consequence", "cost of doing nothing"],
    "scope": "who and what is affected",
    "scope_bullets": ["affected area 1", "affected area 2", "affected area 3"]
  },
  "context": {
    "problem": "detailed problem statement",
    "currentState": "how things work or stand right now",
    "whyProblem": "why this matters - business impact, risk, opportunity cost",
    "affectedAreas": ["area 1", "area 2"],
    "constraints": ["constraint 1", "constraint 2"],
    "references": ["specific sources, file paths, URLs, data points"]
  }
}

EXAMPLE 1 (software architecture decision):

User input: "should we keep using sqlite or move to postgres for the auth system"

{
  "title": "Auth database migration: SQLite to PostgreSQL evaluation",
  "priority": "p2",
  "category": "infrastructure",
  "brief": {
    "headline": "The auth system runs on SQLite which works for single-server deployment but won't survive horizontal scaling or concurrent write loads beyond ~50 req/s.",
    "situation": "The platform currently uses better-sqlite3 for authentication, storing sessions, users, and org membership in a single auth.db file. This was chosen for simplicity during early development and works well for the current single-server setup. A managed PostgreSQL option is available for production deployments.",
    "situation_bullets": [
      "Auth uses SQLite (better-sqlite3) in a single auth.db file",
      "12 tables: users, sessions, accounts, orgs, members",
      "Works fine for current single-server setup",
      "Managed deployments can use PostgreSQL 16"
    ],
    "problem": "As the platform moves toward multi-tenant SaaS with multiple server instances, SQLite becomes a bottleneck. It doesn't support concurrent writers, can't be shared across instances, and backup/restore requires file-level operations. The question isn't whether to migrate eventually - it's whether to migrate now or defer until scaling pressure forces it.",
    "problem_bullets": [
      "SQLite can't handle concurrent writers or multi-instance deployments",
      "Backup requires file-level copy with downtime",
      "The question: migrate now while it's small, or wait until forced?"
    ],
    "impact": "Getting this wrong means either: (a) migrating under pressure during a scaling crisis with data at risk, or (b) investing engineering time now that could go toward features, on a migration that might not be needed for 6+ months. The auth database is the most sensitive data store - a botched migration means users can't log in.",
    "impact_bullets": [
      "If we migrate now: engineering time spent, but low-risk window",
      "If we wait: forced migration under pressure with data at risk",
      "Auth is the most sensitive store - botched migration = users locked out"
    ],
    "scope": "Auth system, session management, org membership, all API routes that touch user identity. Every authenticated request hits this database.",
    "scope_bullets": [
      "Auth system + session management",
      "~40 API routes via checkAuth()",
      "Every authenticated request hits this database"
    ]
  },
  "context": {
    "problem": "SQLite auth.db handles ~50 concurrent writes/sec max. Multi-instance deployment requires shared database. Current backup strategy is file copy which requires downtime.",
    "currentState": "Single auth.db file at ~/.mentiko/data/auth.db, accessed via better-sqlite3 synchronous API. ~12 tables covering users, sessions, accounts, organizations, members. Production can run as a single instance, while managed deployments may already use PostgreSQL.",
    "whyProblem": "Platform roadmap includes multi-tenant isolation with per-tenant compute. This requires either shared auth database (PostgreSQL) or distributed auth (JWT-only). Current architecture assumes single-file database locality. Migration cost increases with data volume - easier now with <1000 users than later with 50k.",
    "affectedAreas": [
      "~/.mentiko/data/auth.db - the database file itself",
      "web/lib/auth.ts - better-auth configuration and schema",
      "web/middleware.ts - session validation on every request",
      "All API routes using checkAuth() - ~40 endpoints",
      "Docker deployment - needs PostgreSQL container",
      "Backup/restore procedures"
    ],
    "constraints": [
      "Zero-downtime migration required - users cannot be locked out",
      "better-auth must support the target database (it supports both)",
      "Local development must remain simple (no mandatory PostgreSQL install)",
      "Session tokens must survive the migration (no mass logout)",
      "Managed PostgreSQL is available - could use a shared service or run a separate instance"
    ],
    "references": [
      "web/lib/auth.ts - current better-auth SQLite configuration",
      "~/.mentiko/data/auth.db - production database (12 tables, ~800KB)",
      "docker-compose.production.yml - current production stack",
      "managed PostgreSQL deployment docs",
      "better-auth docs: https://www.better-auth.com/docs/adapters"
    ]
  }
}

EXAMPLE 2 (business/hiring decision):

User input: "should we hire a dedicated devops engineer or keep using the founding team for infrastructure"

{
  "title": "DevOps hire vs founding team infrastructure ownership",
  "priority": "p2",
  "category": "hiring",
  "brief": {
    "headline": "Infrastructure work is consuming ~30% of the founding engineers' time, but a full-time DevOps hire at current burn rate means 4 fewer months of runway.",
    "situation": "The three founding engineers currently split infrastructure duties - deployments, monitoring, incident response, and scaling. This worked when the platform had 20 users and deployed weekly. Now with 200+ users, daily deploys, and two production environments, infra work is eating into feature development time. Last month, 47 of 160 engineering hours went to infrastructure tasks.",
    "situation_bullets": [
      "3 founders split infra duties: deploys, monitoring, incidents",
      "47 of 160 engineering hours last month went to infrastructure",
      "200+ users, daily deploys, two production environments",
      "Manual SSH + docker compose deployments"
    ],
    "problem": "The founding team is context-switching between feature work and infrastructure firefighting. Neither gets full attention. Deploys are manual and error-prone (3 incidents last quarter from deployment mistakes). But hiring means $150-180k/year fully loaded, which at current burn rate shortens runway from 14 months to 10 months. The question is whether the productivity gain from freeing up founding engineers justifies the runway cost.",
    "problem_bullets": [
      "Founders context-switching between features and infra firefighting",
      "3 deploy incidents last quarter from manual errors",
      "Hiring costs $150-180k/yr, shortens runway from 14 to 10 months",
      "Core question: does freeing up founders justify the runway cost?"
    ],
    "impact": "If we hire: founding engineers recover ~50 hours/month for feature work, deploys become reliable, monitoring improves. If we don't: feature velocity continues declining as infra complexity grows, risk of major outage increases, founding team burns out. If we hire wrong: we spend 3 months onboarding, the person doesn't work out, we've burned $45k and still have the same problem.",
    "impact_bullets": [
      "If we hire: founders recover ~50 hrs/month for product work",
      "If we don't: feature velocity keeps declining, burnout risk",
      "If we hire wrong: $45k burned, 3 months lost, same problem"
    ],
    "scope": "All engineering output, deployment reliability, production uptime, team morale, company runway, hiring pipeline.",
    "scope_bullets": [
      "Engineering velocity and feature output",
      "Production reliability and uptime",
      "Company runway and burn rate",
      "Team morale"
    ]
  },
  "context": {
    "problem": "Infrastructure is no longer a side task - it's a full workload being handled part-time by people whose core value is product development. The opportunity cost is features not shipped and technical debt accumulating.",
    "currentState": "3 founding engineers each spend ~10 hrs/week on infra. Manual deploys via SSH + docker compose. Monitoring is basic (uptime checks + manual log review). No IaC, no CI/CD pipeline, no automated rollbacks. Production infrastructure is split across management and platform services.",
    "whyProblem": "Every hour a $200/hr founding engineer spends on routine deploys is an hour not spent on the product that generates revenue. Infrastructure complexity grows with user count - this problem gets worse, not better. The team is already showing signs of burnout from context-switching.",
    "affectedAreas": [
      "Engineering velocity - feature output per sprint",
      "Production reliability - deploy success rate, MTTR",
      "Company runway - cash burn rate vs remaining funding",
      "Team morale - founding engineers doing work below their skill level",
      "Hiring pipeline - recruiting, interviewing, onboarding costs"
    ],
    "constraints": [
      "Current runway: 14 months at $85k/month burn",
      "Next funding round planned in 8 months",
      "DevOps market rate: $150-180k/year fully loaded in US",
      "Alternative: contractor at $100-150/hr for specific projects",
      "Founding engineers unwilling to fully hand off infra without trust built"
    ],
    "references": [
      "Last quarter incident reports: 3 deploy-related outages",
      "Time tracking data: 47/160 engineering hours on infra (March 2026)",
      "Current infra: single VPS, Docker Compose, manual SSH deploys",
      "Comparable startup benchmarks: first DevOps hire typically at $2-5M ARR"
    ]
  }
}

EXAMPLE 3 (vendor/platform selection):

User input: "evaluate switching from stripe to lemonsqueezy for payment processing"

{
  "title": "Payment processor evaluation: Stripe vs LemonSqueezy",
  "priority": "p3",
  "category": "vendor",
  "brief": {
    "headline": "Stripe handles everything but costs us ~15 hours/month in tax compliance overhead that LemonSqueezy would eliminate as a Merchant of Record, but migrating means rebuilding the billing integration and losing Stripe's ecosystem.",
    "situation": "The platform uses Stripe for subscription billing, processing ~$12k MRR across 180 paying customers. Stripe works well for payment processing but requires us to handle sales tax, VAT, and invoicing compliance ourselves. We currently use a cobbled-together setup of Stripe + TaxJar + manual quarterly filings. LemonSqueezy is a Merchant of Record (MoR) that handles all tax compliance, but has a smaller ecosystem and higher per-transaction fees.",
    "situation_bullets": [
      "Stripe processes $12k MRR across 180 customers in 14 countries",
      "Tax compliance: Stripe + TaxJar + manual quarterly filings",
      "LemonSqueezy is a Merchant of Record - handles all tax automatically",
      "LemonSqueezy fees higher: 5% + 50c vs Stripe's 2.9% + 30c"
    ],
    "problem": "Tax compliance is becoming a real burden as we expand internationally. We have customers in 14 countries now. Each country has different VAT rules, thresholds, and filing requirements. Last quarter we spent $4,200 on TaxJar + accounting fees, plus ~15 hours of engineering time maintaining the tax integration. LemonSqueezy would eliminate this entirely but takes a larger cut (5% + 50c vs Stripe's 2.9% + 30c) and has fewer features.",
    "problem_bullets": [
      "14 countries, each with different VAT rules and thresholds",
      "$4,200/quarter on TaxJar + accounting fees",
      "15 engineering hours/month maintaining tax integration",
      "LemonSqueezy eliminates all of this but costs more per transaction"
    ],
    "impact": "Staying with Stripe: tax compliance costs grow linearly with international expansion, risk of tax audit in unfamiliar jurisdictions. Switching to LemonSqueezy: ~$200/month more in processing fees at current volume, but saves $1,400/month in tax overhead + 15 engineering hours. Net positive now, but the fee difference grows as revenue scales.",
    "impact_bullets": [
      "Stay with Stripe: tax costs grow with every new country",
      "Switch to LemonSqueezy: saves $1,400/mo in tax overhead",
      "LemonSqueezy costs ~$200/mo more in processing fees at current volume",
      "Net positive now, but fee gap widens as revenue scales"
    ],
    "scope": "Billing system, subscription management, invoicing, tax compliance, international expansion strategy, customer payment experience.",
    "scope_bullets": [
      "Billing integration (complete rewrite if switching)",
      "180 existing subscriptions to migrate",
      "Tax compliance across 14 countries",
      "Customer payment experience"
    ]
  },
  "context": {
    "problem": "Tax compliance overhead is consuming engineering time and external costs that exceed the fee difference between processors. But Stripe's ecosystem (Connect, Billing Portal, Revenue Recognition) provides value that LemonSqueezy can't match.",
    "currentState": "Stripe integration via @stripe/stripe-node SDK. Webhook handlers for subscription lifecycle. Customer portal for self-service billing. TaxJar integration for tax calculation. Manual quarterly tax filings in 6 jurisdictions. 180 customers, 14 countries, $12k MRR.",
    "whyProblem": "International expansion is a growth priority. Each new country adds tax complexity. Current approach doesn't scale - we can't hire a tax specialist for our size, and engineering time on tax compliance is time not spent on product. LemonSqueezy eliminates this category of work entirely.",
    "affectedAreas": [
      "Billing integration code - complete rewrite required",
      "Customer payment experience - new checkout flow",
      "Subscription management - different API, different webhooks",
      "Financial reporting - new data source for revenue metrics",
      "International expansion - removes tax barrier entirely",
      "Existing customer migration - must move 180 subscriptions"
    ],
    "constraints": [
      "Cannot disrupt existing subscriber billing during migration",
      "Must maintain subscription history for accounting/audit",
      "LemonSqueezy doesn't support Stripe Connect (used for marketplace)",
      "Migration window: ideally between billing cycles",
      "Must evaluate LemonSqueezy API stability and support quality"
    ],
    "references": [
      "Current Stripe integration: web/lib/infra/stripe-client.ts",
      "Webhook handlers: web/app/api/webhooks/stripe/route.ts",
      "TaxJar monthly cost: $89/month + $0.03/transaction",
      "Accounting firm quarterly filing: ~$1,000/quarter",
      "LemonSqueezy pricing: https://lemonsqueezy.com/pricing",
      "Stripe pricing: https://stripe.com/pricing"
    ]
  }
}`;

export const DEFAULT_DECISION_STEERING_TEMPLATE = `You are a senior analyst re-evaluating a decision briefing based on
feedback from the decision maker. Your previous research needs to be
revised to incorporate their input.

PREVIOUS BRIEF:
{{PREVIOUS_ANALYSIS}}

DECISION MAKER FEEDBACK:
{{STEERING_INPUT}}
{{WORKSPACE_CONTEXT}}

Based on this feedback, redo your research brief. Adjust the title,
brief, and context as needed. Incorporate the feedback and produce a
revised briefing that addresses their concerns.

DO NOT generate options or recommendations. Your job is ONLY to
revise the research brief based on the feedback.

IMPORTANT: The brief has TWO layers for each section:
- Full text: the complete narrative (data layer for subsequent AI rounds)
- Bullets: short, scannable bullet points (presentation layer for the human)
Both must be present.

Output ONLY valid JSON matching this schema:

{
  "title": "clear, specific title (revised based on feedback)",
  "priority": "p0|p1|p2|p3|p4",
  "category": "category that fits the decision domain",
  "brief": {
    "headline": "one sentence that captures the core decision",
    "situation": "2-4 sentences describing the current state of things",
    "situation_bullets": ["key point 1", "key point 2", "key point 3"],
    "problem": "2-4 sentences on what needs to be decided and why now",
    "problem_bullets": ["the core question", "why now", "what's forcing it"],
    "impact": "what happens if we get this wrong or right",
    "impact_bullets": ["if we get it right: ...", "if we get it wrong: ..."],
    "scope": "who and what is affected",
    "scope_bullets": ["affected area 1", "affected area 2"]
  },
  "context": {
    "problem": "detailed problem statement",
    "currentState": "how things work or stand right now",
    "whyProblem": "why this matters - business impact, risk, opportunity cost",
    "affectedAreas": ["area 1", "area 2"],
    "constraints": ["constraint 1", "constraint 2"],
    "references": ["specific sources, file paths, URLs, data points"]
  }
}`;

export const DEFAULT_DECISION_RETROSPECTIVE_TEMPLATE = `You are reviewing a completed decision for a software project retrospective.

{{DECISION_CONTEXT}}

Provide a brief retrospective. Be concise and direct.

Output ONLY valid JSON:
{
  "summary": "1-2 sentence summary of what was decided and why",
  "outcome": "what the expected outcome is based on the chosen approach",
  "lessonsLearned": ["insight 1", "insight 2"]
}`;

export const DEFAULT_GUIDED_QUESTIONS_TEMPLATE = `You are a senior consultant preparing preference questions for a
decision maker. You've completed your research and now need to help
them understand the real tradeoffs before presenting solutions.

RESEARCH BRIEF:
{{DECISION_CONTEXT}}

Generate 5-8 binary preference questions. Each question presents two
legitimate approaches - neither is wrong. They represent different
priorities, values, or risk appetites.

Every option must explain what the decision maker gets, what improves,
and what they give up if they choose it. The UI will display these
details inside the two option boxes, so keep the language crisp and
decision-specific.

Output ONLY valid JSON:

{
  "questions": [
    {
      "id": "q1",
      "text": "The tradeoff being presented - phrased as a clear either/or",
      "optionA": {
        "label": "Short action-oriented label (max 44 chars)",
        "value": "snake_case_value",
        "summary": "One clear sentence answering: what do I get if I choose this?",
        "pros": ["specific upside tied to the brief", "another concrete upside"],
        "cons": ["specific tradeoff or cost", "another honest downside"]
      },
      "optionB": {
        "label": "Short action-oriented label (max 44 chars)",
        "value": "snake_case_value",
        "summary": "One clear sentence answering: what do I get if I choose this?",
        "pros": ["specific upside tied to the brief", "another concrete upside"],
        "cons": ["specific tradeoff or cost", "another honest downside"]
      },
      "category": "what dimension this question measures",
      "weight": 0.8,
      "recommendation": {
        "choice": "a",
        "rationale": "1-2 sentence consultant nudge based on the research brief. Use either when the evidence does not favor one side."
      }
    }
  ]
}

RULES:
1. Each question must isolate ONE tradeoff dimension
2. Labels must be concise and action-oriented - not academic
3. summary must be one sentence, ideally under 140 characters
4. pros and cons must each contain 2-3 specific, evidence-based bullets
5. Cons must be honest and concrete, not softened or generic
6. recommendation is a light AI nudge, not a forced answer
7. If both choices are equally valid from the available context, set
   recommendation.choice to "either" and explain what would decide it
8. Weight reflects how much this tradeoff matters (0.1-1.0)
9. Categories should be distinct (don't repeat dimensions)
10. Questions should feel like a real consultant asking a real executive
11. The first 2-3 questions should address the biggest tradeoffs in this
    specific decision (highest weight)
12. Avoid generic questions that apply to every decision

EXAMPLE:

{
  "questions": [
    {
      "id": "q1",
      "text": "For a system writing 100k+ audit events daily, is it more important that security queries return instantly or that storage costs stay predictable and linear?",
      "optionA": {
        "label": "Optimize real-time query speed",
        "value": "optimize_query_speed",
        "summary": "You get fast investigation and monitoring at the cost of more indexing, caching, and retention complexity.",
        "pros": [
          "Security reviewers can answer access questions while incidents are active",
          "Dashboards and alerts stay responsive as event volume grows",
          "Better fit for enterprise read-only access and audit SLAs"
        ],
        "cons": [
          "More indexes and hot storage increase operational cost",
          "Query-optimized schemas can complicate ingestion and retention",
          "Requires more careful performance testing before rollout"
        ]
      },
      "optionB": {
        "label": "Optimize predictable storage cost",
        "value": "optimize_storage_cost",
        "summary": "You get simpler cost control and retention planning, but live audit queries may be slower under load.",
        "pros": [
          "Linear storage growth is easier to forecast and explain",
          "Simpler retention tiers reduce infrastructure complexity",
          "Lower risk of surprise bills from high-cardinality indexes"
        ],
        "cons": [
          "Security teams may wait longer for investigative queries",
          "Real-time dashboards may need sampling or delayed aggregates",
          "Enterprise customers may perceive slower audit access as weaker control"
        ]
      },
      "category": "performance_profile",
      "weight": 0.95,
      "recommendation": {
        "choice": "a",
        "rationale": "Because the brief emphasizes enterprise read-only access and security auditability, fast query response is likely the more valuable default unless cost ceilings are non-negotiable."
      }
    },
    {
      "id": "q2",
      "text": "Would you rather ship a smaller architecture that can be hardened this week, or spend longer designing the full enterprise-grade model up front?",
      "optionA": {
        "label": "Ship the hardenable slice",
        "value": "ship_hardenable_slice",
        "summary": "You get momentum and earlier feedback while accepting that the architecture will need follow-up passes.",
        "pros": [
          "Reduces time before users can validate the workflow",
          "Limits blast radius by proving one narrow path first",
          "Creates concrete telemetry for the next iteration"
        ],
        "cons": [
          "Some enterprise requirements will remain unresolved initially",
          "Follow-up work must be tracked carefully to avoid drift",
          "Short-term implementation may need refactoring later"
        ]
      },
      "optionB": {
        "label": "Design the full model first",
        "value": "design_full_model_first",
        "summary": "You get stronger architectural confidence before launch, but delay user feedback and implementation learning.",
        "pros": [
          "Better chance of catching tenant, audit, and permission gaps early",
          "Clearer long-term model for docs and onboarding",
          "Less risk of needing to unwind early assumptions"
        ],
        "cons": [
          "Longer path before any workflow is usable",
          "More design work may be speculative without production feedback",
          "Can delay fixes that users already need"
        ]
      },
      "category": "delivery_strategy",
      "weight": 0.85,
      "recommendation": {
        "choice": "either",
        "rationale": "Choose the slice if speed and learning are the priority; choose the full model if a wrong data boundary would be expensive to reverse."
      }
    }
  ]
}`;

export const DEFAULT_GUIDED_OPTIONS_TEMPLATE = `You are a senior consultant presenting tailored solutions to a
decision maker. You've done the research, you understand what they
value, and now you're presenting 4 genuinely different approaches.

RESEARCH BRIEF:
{{DECISION_CONTEXT}}

DECISION MAKER'S PREFERENCE PROFILE:
{{PREFERENCE_PROFILE}}

CONSTRAINTS:
{{CONSTRAINTS}}

Generate exactly 4 options. Each option must be a genuinely
different approach - not just variations on a scale from "do less"
to "do more." Think about different philosophies, different
strategies, different ways to solve the same problem.

DO NOT use this formula:
  A = minimum viable
  B = comprehensive
  C = alternative approach
  D = hybrid

Instead, think about what 4 experienced consultants with different
backgrounds would each recommend. A finance person thinks about it
differently than an engineer. An operator thinks about it
differently than a strategist.

For each option, the description must explain:
- WHAT: exactly what this approach entails
- HOW: the key implementation steps or actions
- WHY THIS FITS: how it connects to the decision maker's stated preferences
- WHAT YOU GIVE UP: the honest tradeoff

Output ONLY valid JSON:

{
  "options": [
    {
      "id": "opt-a",
      "letter": "A",
      "name": "option name (max 50 chars)",
      "description": "detailed description (see requirements below)",
      "effort": "low|medium|high",
      "risk": "low|medium|high",
      "matchScore": 85,
      "matchLabel": "strong match",
      "pros": ["specific advantage with evidence", "another advantage"],
      "cons": ["specific disadvantage with honest assessment", "another con"]
    }
  ],
  "recommendation": {
    "choiceId": "opt-a",
    "confidence": "high|medium|low",
    "rationale": "3-4 sentences explaining why this option best fits the decision maker's stated preferences, with specific references to their priority answers"
  }
}

RULES:
1. Each option must represent a genuinely different strategy
2. matchScore: 0-100 based on alignment with preference profile
   - 90+: directly addresses top priorities, acceptable tradeoffs
   - 70-89: addresses most priorities, minor conflicts
   - 50-69: addresses some priorities, notable tradeoffs
   - <50: conflicts with stated preferences (include anyway if it's
     the objectively right answer - sometimes the boss needs to hear it)
3. matchLabel: "strong match" (80+), "good match" (60-79),
   "partial match" (40-59), "worth considering" (<40)
4. Description must be substantive - minimum 4 sentences covering
   WHAT, HOW, WHY THIS FITS, and WHAT YOU GIVE UP
5. Pros must be specific and evidence-based, not generic
6. Cons must be honest, not softened
7. The recommendation rationale must reference specific preferences

EXAMPLE (for auth database migration, decision maker prefers:
pragmatic, act now, keep dev simple, short-term focus):

{
  "options": [
    {
      "id": "opt-a",
      "letter": "A",
      "name": "SQLite with connection pooling and WAL mode",
      "description": "Keep SQLite but optimize it for higher concurrency. Enable WAL (Write-Ahead Logging) mode which allows concurrent reads during writes, add a connection pool wrapper around better-sqlite3, and implement read replicas for query-heavy endpoints. This directly matches your preference for simplicity - no new database server, no migration risk, no changes to local dev. What you give up is true horizontal scaling - this buys you 6-12 months before you hit SQLite's ceiling again, and when you do, the migration will be harder because you've built more on top of it.",
      "effort": "low",
      "risk": "low",
      "matchScore": 92,
      "matchLabel": "strong match",
      "pros": [
        "Zero migration risk - optimizing what already works",
        "Local dev stays exactly the same (no database server needed)",
        "WAL mode alone typically gives 5-10x write throughput improvement",
        "Can be done incrementally - enable WAL first, add pooling later",
        "Fully reversible if it doesn't help"
      ],
      "cons": [
        "Ceiling: WAL mode helps but SQLite still can't do multi-instance",
        "Delays the eventual PostgreSQL migration (more code built on SQLite)",
        "No concurrent write scaling beyond ~500 req/s",
        "Team might view this as avoiding the real problem"
      ]
    },
    {
      "id": "opt-b",
      "letter": "B",
      "name": "PostgreSQL for auth, SQLite stays for local dev",
      "description": "Migrate production auth to PostgreSQL 16 while keeping SQLite as the local development database. better-auth supports both via adapter configuration. Production uses PostgreSQL connection string, local dev defaults to SQLite file. This means you act now (matching your timing preference) but local dev stays simple (matching your DX preference). What you give up is true dev-prod parity - bugs that only appear in PostgreSQL won't be caught locally, and you'll maintain two code paths for database-specific queries.",
      "effort": "medium",
      "risk": "medium",
      "matchScore": 78,
      "matchLabel": "good match",
      "pros": [
        "Production gets PostgreSQL's concurrency, ACID, and tooling",
        "Can use existing managed PostgreSQL - no new infrastructure",
        "Local dev stays simple: npm run dev just works, no docker required",
        "better-auth handles adapter switching - not a full rewrite"
      ],
      "cons": [
        "Two database adapters means two code paths to maintain",
        "PostgreSQL-specific bugs won't surface in local testing",
        "Migration script needs thorough testing - auth is the riskiest data",
        "1-2 week timeline competes with feature development priorities"
      ]
    },
    {
      "id": "opt-c",
      "letter": "C",
      "name": "Externalize auth entirely to a managed service",
      "description": "Replace the self-hosted auth system with a managed service like Clerk, Auth0, or Supabase Auth. Eliminates the database question entirely - auth becomes an API call, not a database query. This is the 'make it someone else's problem' approach. It matches your simplicity preference (less code to maintain) but conflicts with your preference to act quickly - the migration to an external provider is larger scope than a database swap. What you give up is control and cost predictability - managed auth services charge per-MAU and you're subject to their API changes, outages, and pricing changes.",
      "effort": "high",
      "risk": "medium",
      "matchScore": 45,
      "matchLabel": "worth considering",
      "pros": [
        "Eliminates the database scaling question permanently",
        "Gets enterprise auth features for free (MFA, SSO, social login)",
        "Reduces security liability - auth is their problem, not yours",
        "Frees engineering time from auth maintenance forever"
      ],
      "cons": [
        "Largest migration scope - touching every auth touchpoint in the app",
        "Ongoing cost: $0.02-0.05/MAU adds up fast at scale",
        "Vendor lock-in: switching auth providers later is extremely painful",
        "Loss of control over auth behavior and data locality",
        "Conflicts with your preference for quick, pragmatic action"
      ]
    },
    {
      "id": "opt-d",
      "letter": "D",
      "name": "Stateless JWT auth with SQLite as backup store",
      "description": "Shift the auth model from session-based (database lookup on every request) to JWT-based (cryptographic verification, no database hit). SQLite stays but becomes a write-only audit log rather than the critical path for every authenticated request. This eliminates the read-scaling problem entirely while keeping your simple infrastructure. What you give up is immediate session revocation - JWTs are valid until they expire, so 'log out everywhere' has a delay window. You also need to handle token refresh carefully to avoid security gaps.",
      "effort": "medium",
      "risk": "medium",
      "matchScore": 68,
      "matchLabel": "good match",
      "pros": [
        "Eliminates database as bottleneck for reads (90%+ of auth traffic)",
        "Works across multiple instances without shared database",
        "SQLite stays but is no longer on the critical path",
        "Better-auth supports JWT mode with minimal configuration change"
      ],
      "cons": [
        "Cannot instantly revoke sessions (JWT valid until expiry)",
        "Token refresh logic adds complexity to frontend",
        "Security model change requires thorough audit",
        "Doesn't solve the write-scaling problem (just the read problem)"
      ]
    }
  ],
  "recommendation": {
    "choiceId": "opt-a",
    "confidence": "high",
    "rationale": "You told us you want to act now, keep things simple, and build for today's needs rather than theoretical future scale. Option A does exactly that - it's the lowest risk, fastest to implement, and doesn't change anything about your development workflow. WAL mode alone is a one-line configuration change that typically gives 5-10x write throughput improvement. The honest tradeoff is that you'll probably need to revisit this in 6-12 months, but by then you'll have more data on actual scaling needs rather than guessing now. Given your stated preference for pragmatic solutions over theoretical perfection, optimizing what works beats replacing it."
  }
}

EXAMPLE (for hiring decision, decision maker prefers:
immediate impact, preserve runway, full ownership, part-time senior):

{
  "options": [
    {
      "id": "opt-a",
      "letter": "A",
      "name": "Senior DevOps contractor, 20 hrs/week",
      "description": "Engage a senior DevOps contractor at $120-150/hr for 20 hours/week. They own infrastructure end-to-end: set up CI/CD, monitoring, IaC, and train the founding team. 6-month engagement with option to convert to full-time. This matches your preference for immediate impact (senior people deliver from day 1) and preserves runway ($10-12k/month vs $15k/month for a full-time hire). What you give up is continuity - contractors can leave, and 20 hrs/week means prioritization is critical. Not everything gets fixed.",
      "effort": "low",
      "risk": "low",
      "matchScore": 91,
      "matchLabel": "strong match",
      "pros": [
        "Senior expertise from day 1 - no 3-month ramp",
        "$10-12k/month vs $12-15k/month for full-time (runway preserved)",
        "Flexible: scale hours up/down as needs change",
        "Try-before-you-buy: convert to full-time if it works",
        "Can start in 2 weeks vs 6-8 week hiring process"
      ],
      "cons": [
        "20 hrs/week means tough prioritization choices",
        "Less invested than a full-time employee (no equity, no mission)",
        "Contractor market is competitive - good ones are booked",
        "Knowledge leaves when contractor leaves",
        "No after-hours incident response unless negotiated separately"
      ]
    },
    {
      "id": "opt-b",
      "letter": "B",
      "name": "Platform engineering bootcamp for founding team",
      "description": "Instead of hiring, invest 2 weeks in a structured infrastructure bootcamp for the founding team. Bring in a consultant for 40 hours to set up CI/CD, IaC, and monitoring templates, then train the team to maintain them. The founding engineers keep ownership but with proper tooling that reduces the 30% overhead to ~10%. This matches your autonomy preference (execute on our architecture) but challenges your timing preference - the 2-week investment has to come from somewhere. What you give up is the long-term solution - the team gets better tooling but still owns infra.",
      "effort": "medium",
      "risk": "low",
      "matchScore": 62,
      "matchLabel": "good match",
      "pros": [
        "No ongoing headcount cost - one-time $6-8k investment",
        "Founding team retains full control and context",
        "Proper tooling (CI/CD, IaC) reduces overhead from 30% to ~10%",
        "Knowledge stays in-house permanently",
        "Team levels up their infrastructure skills"
      ],
      "cons": [
        "2 weeks of zero feature output during bootcamp",
        "Founding engineers still own infra (just with better tools)",
        "Doesn't solve the scaling problem if team grows",
        "Requires founding team buy-in to invest the time",
        "~10% overhead is still 16+ hours/month of infra work"
      ]
    },
    {
      "id": "opt-c",
      "letter": "C",
      "name": "Managed infrastructure platform (Render/Railway)",
      "description": "Eliminate the DevOps role entirely by migrating to a managed platform like Render or Railway. They handle deployments, scaling, SSL, monitoring, and rollbacks. Your infra becomes a YAML file. This is the most aggressive simplification - it matches your preference for immediate impact and freeing up founders, but conflicts with full ownership (you're dependent on the platform's abstractions). What you give up is customization and cost control at scale - managed platforms charge a premium over raw VPS, and you can't do anything they don't support.",
      "effort": "high",
      "risk": "medium",
      "matchScore": 55,
      "matchLabel": "partial match",
      "pros": [
        "Eliminates DevOps as a role entirely",
        "Founding engineers recover 100% of infra time",
        "Deployments become git push (zero manual work)",
        "Built-in monitoring, logging, auto-scaling",
        "No hiring process, no contractor management"
      ],
      "cons": [
        "Platform lock-in: migrating away is painful",
        "Higher cost at scale ($50-200/month premium per service)",
        "Can't do anything the platform doesn't support",
        "Loss of infrastructure customization (specific provider configs)",
        "Existing Docker Compose setup needs full rewrite"
      ]
    },
    {
      "id": "opt-d",
      "letter": "D",
      "name": "Junior DevOps hire + founding engineer mentor",
      "description": "Hire a junior/mid DevOps engineer ($90-110k) paired with a founding engineer as mentor for the first 3 months. The junior handles day-to-day operations immediately (deploys, monitoring, tickets) while the mentor guides architecture decisions. After 3 months, the junior owns operations fully and the founding engineer steps back to pure product work. This preserves more runway than a senior hire while still adding dedicated headcount. What you give up is speed - a junior needs more guidance, makes more mistakes, and takes 3 months to reach full autonomy.",
      "effort": "medium",
      "risk": "medium",
      "matchScore": 58,
      "matchLabel": "partial match",
      "pros": [
        "Lower salary preserves more runway ($7.5-9k/month vs $12-15k)",
        "Full-time dedication - no prioritization conflicts",
        "Grows into the role: builds loyalty, learns your specific stack",
        "Founding engineer mentorship transfers knowledge intentionally",
        "Equity compensation possible: junior more likely to accept"
      ],
      "cons": [
        "3-month ramp before full impact (conflicts with immediate impact preference)",
        "Founding engineer spends MORE time on infra during mentorship period",
        "Higher risk of bad hire - junior track record harder to evaluate",
        "Junior may outgrow the role and leave in 12-18 months",
        "Hiring process takes 4-6 weeks minimum"
      ]
    }
  ],
  "recommendation": {
    "choiceId": "opt-a",
    "confidence": "high",
    "rationale": "You told us three things clearly: you want immediate impact, you want to preserve runway, and you want someone senior enough to own infrastructure with full autonomy. The 20hr/week senior contractor hits all three. They start contributing in week 1 (no ramp), cost $10-12k/month (vs $12-15k for full-time, saving ~$3k/month), and senior contractors are used to owning systems end-to-end. The convert-to-hire option also keeps the door open - if they're great and you have runway after the next funding round, you bring them on full-time with zero ramp time. The biggest risk is contractor availability, so we'd recommend starting the search immediately."
  }
}`;

export const DEFAULT_GUIDED_PLAN_TEMPLATE = `You are building an execution plan for a decision that has been
approved. The decision maker has selected their preferred option
and you need to break it into actionable tasks with clear phases,
and dependencies.

RESEARCH BRIEF:
{{DECISION_CONTEXT}}

SELECTED OPTION:
{{SELECTED_OPTION}}

DECISION MAKER'S PREFERENCES:
{{USER_PREFERENCES}}

Create a detailed execution plan. Be specific about what needs to
happen and in what order.

Output ONLY valid JSON:

{
  "summary": "2-3 sentence execution brief - what we're doing and the expected outcome",
  "tasks": [
    {
      "id": "task-1",
      "title": "specific action item (imperative form)",
      "description": "what needs to be done and why this step matters",
      "subtasks": ["concrete subtask 1", "concrete subtask 2"],
      "priority": 2,
      "phase": 1
    }
  ],
  "dependencies": [
    { "from": "task-1", "to": "task-2" }
  ]
}

RULES:
1. Break into 2-4 phases (preparation, execution, validation, rollout)
2. 5-15 total tasks - enough detail to act on, not so much it's noise
3. Dependencies must not be circular
4. Priority: 0=critical, 1=high, 2=medium, 3=low, 4=backlog
5. Each task must be independently completable by one person
6. Include verification/testing/validation tasks
7. Task titles should be imperative: "Set up X" not "X setup"
8. Phase 1 should be the smallest possible step that proves the
   approach works (de-risk early)

EXAMPLE (for "SQLite with WAL mode" option):

{
  "summary": "Optimize SQLite auth database with WAL mode and connection pooling. Expected outcome: 5-10x write throughput improvement with zero migration risk and no changes to local development workflow.",
  "tasks": [
    {
      "id": "task-1",
      "title": "Benchmark current SQLite write throughput",
      "description": "Establish baseline metrics before changes. Run concurrent write tests against auth.db to measure current ceiling. This gives us a number to compare against after optimization.",
      "subtasks": [
        "Write a load test script that simulates concurrent auth requests",
        "Measure: writes/sec, p50/p95/p99 latency, lock contention rate",
        "Document baseline in a test report"
      ],
      "priority": 1,
      "phase": 1
    },
    {
      "id": "task-2",
      "title": "Enable WAL mode on auth.db",
      "description": "Switch SQLite from default journal mode to WAL (Write-Ahead Logging). This is a one-line PRAGMA change that allows concurrent reads during writes. Reversible by switching back to DELETE mode.",
      "subtasks": [
        "Add PRAGMA journal_mode=WAL to database initialization",
        "Add PRAGMA busy_timeout=5000 for write contention handling",
        "Verify WAL mode persists across restarts",
        "Test that better-auth operations work correctly in WAL mode"
      ],
      "priority": 0,
      "phase": 2
    },
    {
      "id": "task-3",
      "title": "Add connection pool wrapper",
      "description": "Wrap better-sqlite3 in a connection pool that manages multiple read connections and serializes writes. This prevents connection starvation under load.",
      "subtasks": [
        "Create pool wrapper with configurable max connections",
        "Separate read pool (multiple connections) from write pool (single connection)",
        "Add connection health checks and auto-reconnect",
        "Integrate with existing auth.ts database access"
      ],
      "priority": 1,
      "phase": 2
    },
    {
      "id": "task-4",
      "title": "Re-run benchmark and compare",
      "description": "Run the same load test from task-1 against the optimized database. Compare write throughput, latency, and lock contention. If improvement is <3x, investigate further optimizations.",
      "subtasks": [
        "Run identical load test script from task-1",
        "Compare metrics: writes/sec, latency percentiles, lock contention",
        "Document results and publish comparison"
      ],
      "priority": 1,
      "phase": 3
    },
    {
      "id": "task-5",
      "title": "Deploy to production and monitor",
      "description": "Apply WAL mode and connection pool changes to production auth.db. Monitor for 48 hours before declaring success.",
      "subtasks": [
        "Backup production auth.db before changes",
        "Apply PRAGMA changes and deploy pool wrapper",
        "Monitor error rates, response times, and database size",
        "Verify WAL checkpoint behavior (auto-checkpoint at 1000 pages)",
        "Document the change and rollback procedure"
      ],
      "priority": 0,
      "phase": 4
    }
  ],
  "dependencies": [
    { "from": "task-1", "to": "task-2" },
    { "from": "task-2", "to": "task-3" },
    { "from": "task-3", "to": "task-4" },
    { "from": "task-4", "to": "task-5" }
  ]
}`;

export const DEFAULT_PREFERENCE_SYNTHESIS_TEMPLATE = `You are synthesizing a decision maker's preferences from their
answers to tradeoff questions.

RESEARCH BRIEF:
{{DECISION_CONTEXT}}

QUESTIONS AND ANSWERS:
{{QUESTIONS_AND_ANSWERS}}

Analyze the pattern of answers and produce a preference profile.
Don't just restate the answers - interpret what they reveal about
this person's priorities, risk appetite, and decision-making style.

Output ONLY valid JSON:

{
  "summary": "2-3 sentence narrative of what this decision maker values most and how they think about this specific decision",
  "priorities": [
    "most important thing to this person (from highest-weight answers)",
    "second most important",
    "third most important"
  ],
  "willing_to_sacrifice": [
    "thing they're okay giving up (inferred from their B choices on A/B tradeoffs)"
  ],
  "non_negotiables": [
    "thing they absolutely won't compromise on"
  ],
  "risk_profile": "conservative|moderate|aggressive",
  "time_horizon": "short_term|medium_term|long_term",
  "decision_style": "one sentence characterizing how they approach decisions"
}

EXAMPLE:

Questions answered:
- timing: "migrate now while it's safe" (A)
- developer_experience: "keep local dev simple" (A)
- risk_tolerance: "accept the risk of failed attempt" (A)
- planning_horizon: "build for today's needs" (A)
- complexity_budget: "simplest thing that works" (B)

{
  "summary": "This decision maker values action over analysis paralysis. They'd rather attempt something now while stakes are low than wait for a crisis. But they strongly prefer simplicity - they want the pragmatic solution, not the theoretically perfect one.",
  "priorities": [
    "Act now while risk is low rather than defer",
    "Keep things simple for the development team",
    "Minimize complexity even at the cost of future flexibility"
  ],
  "willing_to_sacrifice": [
    "Production parity in local development",
    "Future-proofing and abstraction layers",
    "Building for scale they don't have yet"
  ],
  "non_negotiables": [
    "Taking action rather than waiting",
    "Developer experience must stay simple"
  ],
  "risk_profile": "moderate",
  "time_horizon": "short_term",
  "decision_style": "Pragmatic executor - prefers shipping a good solution now over designing a perfect solution later."
}`;

export const DEFAULT_AGENT_EDIT_TEMPLATE = `You are an AI agent definition editor for the mentiko orchestration system. Modify the following agent JSON according to the user's instructions.

CURRENT AGENT JSON:
{{AGENT_JSON}}

USER INSTRUCTIONS:
{{USER_INSTRUCTIONS}}

REQUIREMENTS:
1. Output ONLY a valid JSON object. No markdown, no explanation, no code blocks.
2. Keep all existing fields unless the user specifically asks to remove or change them.
3. The "id" field must remain unchanged unless explicitly asked to change it.
4. Preserve "created_at" if present. Set "updated_at" to the current ISO timestamp.
5. Fields available: id, name, description, role, version, prompt, triggers (array), emits (string), context (workspace, read_first), authorities (can, needs_approval), timeout (number, seconds), model (string), tools (array), on_error, on_timeout.

OUTPUT FORMAT:
Raw JSON only. No backticks, no 'json' label, nothing but the JSON object.`;

export const DEFAULT_WEBHOOK_INBOUND_TEMPLATE = `You are an expert at configuring inbound webhooks for AI agent chains. Given a description, generate an inbound webhook configuration.

USER REQUEST:
{{USER_PROMPT}}

WHAT IS AN INBOUND WEBHOOK:
An inbound webhook gives you a unique URL that external services (GitHub, Stripe, Slack, etc.) can POST to in order to trigger an AI chain. You define what chain to run when the webhook fires.

OUTPUT SCHEMA:
{
  "name": "human-readable webhook name (e.g. 'GitHub Push Trigger', 'Stripe Payment Handler', 'Slack Command Handler')",
  "chainId": "descriptive chain name that should be triggered (e.g. 'ci-pipeline', 'payment-processor', 'slack-bot')",
  "explanation": "1-2 sentences explaining what external service sends this webhook and what chain it triggers"
}

RULES:
1. Output ONLY a valid JSON object. No markdown, no code blocks.
2. name: Title Case, describe the source service and purpose (2-4 words).
3. chainId: use kebab-case descriptive name if no real chain is known.
4. Keep it practical — what real-world service would send this?

OUTPUT FORMAT:
Raw JSON only. Nothing but the JSON object.`;

export const DEFAULT_EVENT_TRIGGER_TEMPLATE = `You are an expert at wiring together AI agent chains using event-driven architecture. Given a natural language description, generate a valid event trigger configuration.

USER REQUEST:
{{USER_PROMPT}}

{{CHAIN_CATALOG}}

WHAT IS AN EVENT TRIGGER:
An event trigger wires two chains together. When the source chain emits a specific event, the target chain is triggered with a specific start event.

Example flow: "code-writer" chain emits "code-ready" → "code-reviewer" chain triggers on "code-ready"

OUTPUT SCHEMA:
{
  "sourceChain": "name of the chain that produces the event (must be an available chain name if chains are listed)",
  "emitEvent": "event name emitted by source chain (kebab-case, e.g. 'code-ready', 'analysis-complete')",
  "targetChain": "name of the chain that consumes the event (must be an available chain name if chains are listed)",
  "triggerEvent": "event name the target chain listens for (usually same as emitEvent, can be different if you're mapping/renaming)",
  "explanation": "1-2 sentence explanation of why this trigger makes sense"
}

RULES:
1. Output ONLY a valid JSON object. No markdown, no explanation, no code blocks.
2. Use chain names from the available list when possible. If none fit, use descriptive placeholder names.
3. emitEvent and triggerEvent are usually the same string unless explicitly remapping.
4. Event names must be kebab-case (e.g. "pr-reviewed", "tests-passed", "report-ready").
5. If the user's request is ambiguous, make a sensible interpretation.

OUTPUT FORMAT:
Raw JSON only. No backticks, no 'json' label, nothing but the JSON object.`;

export const DEFAULT_WEBHOOK_OUTBOUND_TEMPLATE = `You are an expert at configuring outbound webhooks for AI agent chains. Given a description, generate an outbound webhook configuration.

USER REQUEST:
{{USER_PROMPT}}

WHAT IS AN OUTBOUND WEBHOOK:
An outbound webhook listens to mentiko platform events and POSTs a payload to an external URL when those events fire. Examples: notify Slack when a chain completes, trigger a CI/CD pipeline when a run succeeds.

AVAILABLE EVENT TYPES:
{{MENTIKO_EVENTS}}

OUTPUT SCHEMA:
{
  "name": "human-readable webhook name (e.g. 'Slack Chain Notifications', 'CI/CD Trigger', 'Team Alerts')",
  "url": "destination URL — use empty string '' if the user did not specify a URL",
  "events": ["array of event types from the available list above that match the user's intent"],
  "explanation": "1-2 sentences explaining what this webhook does and when it fires"
}

RULES:
1. Output ONLY a valid JSON object. No markdown, no code blocks.
2. events must ONLY contain values from the available event types list above.
3. If the user says "notify when chain finishes": use ["chain_complete", "chain_failed"].
4. If the user says "notify on any run event": use ["run_started", "run_complete", "run_failed"].
5. If the user says "all events": use all event types.
6. url: empty string if not specified by user.
7. name: descriptive, Title Case, 2-4 words.

OUTPUT FORMAT:
Raw JSON only. Nothing but the JSON object.`;

export const DEFAULT_ARTIFACT_TEMPLATE = `You are an expert at designing artifact templates for AI agent workflows. An artifact template is a reusable output format that agents use to produce consistent, structured content.

USER REQUEST:
{{USER_PROMPT}}

JSON SCHEMA (your output MUST match this structure):
{{SCHEMA}}

ARTIFACT DESIGN PRINCIPLES:

1. ID — kebab-case identifier
   - lowercase, hyphens only
   - descriptive but concise (2-3 words)
   - BAD: "artifact_1", "my_template", "REPORT"
   - GOOD: "weekly-sprint-report", "security-audit-summary", "api-docs-template"

2. NAME — human-readable title
   - Title Case, clear and descriptive
   - Should immediately convey what this artifact produces
   - GOOD: "Weekly Sprint Report", "Security Audit Summary", "API Documentation Template"

3. TYPE — match the content format
   - markdown: reports, documentation, structured text (most common)
   - json: structured data, configs, schemas
   - code: code snippets, scripts, functions
   - patch: git diffs, file patches
   - csv: tabular data, exports
   - text: plain text, logs
   - image: image references, visual outputs

4. DESCRIPTION — one-line summary
   - What this artifact produces and when it's used
   - Should help users understand if this fits their need

5. CONTENT TEMPLATE — the output structure
   - Use {{PLACEHOLDER}} syntax for variables
   - Include sections that guide the agent's output
   - Make it structured and reproducible
   - Include examples where helpful

EXAMPLE — high quality artifact:

{
  "id": "weekly-sprint-report",
  "name": "Weekly Sprint Report",
  "description": "Structured weekly sprint summary with progress, blockers, and next steps",
  "type": "markdown",
  "content": "# Sprint Report: {{SPRINT_NUMBER}}\\n\\n**Date**: {{DATE}}\\n**Team**: {{TEAM_NAME}}\\n**Sprint Goal**: {{GOAL}}\\n\\n---\\n\\n## Summary\\n\\n_2-3 sentence overview of the sprint._\\n\\n---\\n\\n## Completed Items\\n\\n| Ticket | Description | Link |\\n|--------|-------------|------|\\n| {{TICKET_ID}} | {{DESCRIPTION}} | {{LINK}} |\\n\\n---\\n\\n## Blockers\\n\\n| Issue | Impact | Owner | Status |\\n|-------|--------|-------|--------|\\n| {{BLOCKER}} | {{IMPACT}} | {{OWNER}} | {{STATUS}} |\\n\\n---\\n\\n## Next Steps\\n\\n1. {{NEXT_ITEM_1}}\\n2. {{NEXT_ITEM_2}}\\n3. {{NEXT_ITEM_3}}\\n\\n---\\n\\n_Generated by {{AGENT}} on {{DATE}}_"
}

REQUIREMENTS:
1. Output ONLY a valid JSON object. No markdown, no explanation, no code blocks.
2. Must include: id, name, type, description, content
3. ID must be kebab-case, lowercase, hyphens only
4. Type must be one of: markdown, json, code, patch, csv, text, image
5. Content must use {{PLACEHOLDER}} syntax for variables
6. Content should be structured with clear sections
7. For markdown artifacts: include headers, sections, examples
8. For json artifacts: include structure with comments in values
9. Description should be one clear line explaining what this produces

OUTPUT FORMAT:
Raw JSON only. No backticks, no 'json' label, nothing but the JSON object.`;

export const DEFAULT_LINK_TEMPLATE = `You are an expert at designing two-agent collaborations for the mentiko platform. Given a natural language goal, you create a "link" -- a structured definition for two AI agents to work together via debate, collaboration, or review.

USER REQUEST:
{{USER_PROMPT}}
{{WORKSPACE_CONTEXT}}
{{AGENT_CATALOG}}
AGENT SELECTION RULES:
- If the agent catalog above contains agents that fit, reference them with: { "$ref": "agent-id" }
- If no existing agent fits, create NEW agents with inline definitions: { "name": "Agent Name", "role": "one-line role description" }
- Set "create_agents" in your response to an array of new agent objects that need to be registered (empty array if using existing agents)

MODE SELECTION:
- "debate": agents take opposing positions, argue pros/cons, reach a verdict. use when the goal involves choosing between options, evaluating tradeoffs, or making a decision.
- "collaboration": agents work together toward a shared goal, building on each other's work. use when the goal involves creating something, planning, or solving a problem jointly.
- "review": one agent produces work, the other reviews and critiques it. use when the goal involves quality assurance, code review, or editorial feedback.

PROMPT DESIGN:
- leading_prompt: the shared goal both agents work toward
- agent1_prompt: role-specific instructions for agent 1. tell them WHO they are, what perspective to bring, what their expertise is.
- agent2_prompt: role-specific instructions for agent 2. give them the opposing/complementary perspective.
- for debate mode: frame the agents as advocates for different positions. they should be knowledgeable about their position AND the opposing one.
- for collaboration mode: give them complementary skills (e.g., architect + implementer, researcher + writer)
- for review mode: agent1 is the creator, agent2 is the reviewer with specific review criteria

ROUND LIMITS:
- default max_rounds to 0 (unlimited). let agents decide when they're done via STATUS:DONE.
- default stall_threshold to 0 (disabled). do not set stall thresholds unless the user explicitly asks for one.

OUTPUT FORMAT:
Return a JSON object with this exact structure:
{
  "name": "Short Title (2-5 words)",
  "description": "One sentence describing what this link does",
  "mode": "debate" | "collaboration" | "review",
  "agent1": { "$ref": "existing-id" } OR { "name": "Name", "role": "Role description" },
  "agent2": { "$ref": "existing-id" } OR { "name": "Name", "role": "Role description" },
  "agent1_prompt": "Detailed role instructions for agent 1...",
  "agent2_prompt": "Detailed role instructions for agent 2...",
  "leading_prompt": "The shared goal/topic...",
  "max_rounds": 0,
  "stall_threshold": 0,
  "create_agents": [
    {
      "id": "kebab-case-id",
      "name": "Agent Name",
      "role": "Short role",
      "description": "What this agent does",
      "prompt": "Detailed system prompt for this agent when used standalone"
    }
  ]
}

Raw JSON only. No backticks, no explanation, nothing but the JSON object.`;

export const DEFAULT_LINK_SUMMARY_TEMPLATE = `You are summarizing a completed two-agent link run from the mentiko AI orchestration platform. Your job is to analyze what happened during the run and produce a structured summary that a human can quickly understand.

LINK RUN DATA:
{{LINK_RUN_DATA}}

PEER OUTPUT TRANSCRIPT (what each agent said each round):
{{LINK_TRANSCRIPT}}

MODERATOR RELAY EXTRACTIONS:
{{LINK_MODERATOR}}

ESCALATIONS (if any):
{{LINK_ESCALATIONS}}

Based on the data above, produce a comprehensive summary.

RULES:
1. Be specific and factual. Reference what was actually said and done, not generic descriptions.
2. The "headline" should be a single sentence that captures the most important takeaway.
3. For debate mode: identify the core disagreements and whether consensus was reached.
4. For collaboration mode: identify what was built/planned and each agent's contribution.
5. For review mode: identify the key findings and whether issues were found or resolved.
6. Round breakdowns should be concise but informative -- what changed between rounds.
7. Key points should capture the substantive topics, not procedural exchanges.
8. Agent strengths/weaknesses should be honest and specific to this run.
9. Recommendations should be actionable next steps based on the outcome.
10. If files were touched, list them. If no files were touched, use an empty array.

OUTPUT FORMAT:
Output ONLY valid JSON matching this schema:

{
  "headline": "one sentence capturing the most important outcome",
  "outcome": "consensus" | "disagreement" | "partial" | "inconclusive",
  "goal": "what the link run was trying to accomplish",
  "mode": "debate" | "collaboration" | "review",
  "rounds": {
    "total": 5,
    "breakdown": [
      {
        "round": 1,
        "summary": "what happened this round",
        "agent1_stance": "agent 1's position or contribution",
        "agent2_stance": "agent 2's position or contribution",
        "status": "progress" | "escalation" | "consensus" | "disagreement"
      }
    ]
  },
  "key_points": [
    {
      "topic": "the issue being discussed",
      "agent1_position": "what agent 1 thinks",
      "agent2_position": "what agent 2 thinks",
      "resolution": "agreed" | "disputed" | "deferred"
    }
  ],
  "decisions": [
    {
      "decision": "what was decided",
      "rationale": "why",
      "decided_by": "agents" | "escalation" | "human"
    }
  ],
  "escalations": [
    {
      "round": 3,
      "trigger": "what caused the escalation",
      "human_input": "what the human said (if available)",
      "resolution": "what happened after"
    }
  ],
  "files_touched": ["path/to/file1.ts"],
  "agent_summaries": {
    "agent1": {
      "name": "Agent Name",
      "contribution": "what this agent brought to the table",
      "strengths": ["specific strength"],
      "weaknesses": ["specific weakness"]
    },
    "agent2": {
      "name": "Agent Name",
      "contribution": "what this agent brought",
      "strengths": ["specific strength"],
      "weaknesses": ["specific weakness"]
    }
  },
  "recommendations": ["actionable next step based on the outcome"]
}

Raw JSON only. No backticks, no explanation, nothing but the JSON object.`;

function getDefaultTemplates(): GenerationTemplate[] {
  const now = new Date().toISOString();
  return [
    {
      id: "chain_generation",
      label: "Chain Generation",
      content: DEFAULT_CHAIN_TEMPLATE,
      updatedAt: now,
    },
    {
      id: "agent_generation",
      label: "Agent Generation",
      content: DEFAULT_AGENT_TEMPLATE,
      updatedAt: now,
    },
    {
      id: "task_generation",
      label: "Task Generation",
      content: DEFAULT_TASK_TEMPLATE,
      updatedAt: now,
    },
    {
      id: "chain_recommendation",
      label: "Chain Recommendation",
      content: DEFAULT_RECOMMEND_TEMPLATE,
      updatedAt: now,
    },
    {
      id: "decision_research",
      label: "Decision Research",
      content: DEFAULT_DECISION_RESEARCH_TEMPLATE,
      updatedAt: now,
    },
    {
      id: "decision_steering",
      label: "Decision Steering",
      content: DEFAULT_DECISION_STEERING_TEMPLATE,
      updatedAt: now,
    },
    {
      id: "decision_retrospective",
      label: "Decision Retrospective",
      content: DEFAULT_DECISION_RETROSPECTIVE_TEMPLATE,
      updatedAt: now,
    },
    {
      id: "decision_guided_questions",
      label: "Decision Guided Questions",
      content: DEFAULT_GUIDED_QUESTIONS_TEMPLATE,
      updatedAt: now,
    },
    {
      id: "decision_guided_options",
      label: "Decision Guided Options",
      content: DEFAULT_GUIDED_OPTIONS_TEMPLATE,
      updatedAt: now,
    },
    {
      id: "decision_guided_plan",
      label: "Decision Guided Plan",
      content: DEFAULT_GUIDED_PLAN_TEMPLATE,
      updatedAt: now,
    },
    {
      id: "preference_synthesis",
      label: "Preference Synthesis",
      content: DEFAULT_PREFERENCE_SYNTHESIS_TEMPLATE,
      updatedAt: now,
    },
    {
      id: "agent_edit",
      label: "Agent Edit",
      content: DEFAULT_AGENT_EDIT_TEMPLATE,
      updatedAt: now,
    },
    {
      id: "webhook_inbound",
      label: "Webhook Inbound",
      content: DEFAULT_WEBHOOK_INBOUND_TEMPLATE,
      updatedAt: now,
    },
    {
      id: "webhook_outbound",
      label: "Webhook Outbound",
      content: DEFAULT_WEBHOOK_OUTBOUND_TEMPLATE,
      updatedAt: now,
    },
    {
      id: "event_trigger",
      label: "Event Trigger",
      content: DEFAULT_EVENT_TRIGGER_TEMPLATE,
      updatedAt: now,
    },
    {
      id: "artifact_generation",
      label: "Artifact Generation",
      content: DEFAULT_ARTIFACT_TEMPLATE,
      updatedAt: now,
    },
    {
      id: "link_generation",
      label: "Link Generation",
      content: DEFAULT_LINK_TEMPLATE,
      updatedAt: now,
    },
    {
      id: "link_summary",
      label: "Link Summary",
      content: DEFAULT_LINK_SUMMARY_TEMPLATE,
      updatedAt: now,
    },
  ];
}

export function getTemplates(namespaceId: string, orgId: string): GenerationTemplate[] {
  const defaults = getDefaultTemplates();
  const filePath = getTemplatesPath(namespaceId, orgId);
  if (!existsSync(filePath)) {
    return defaults;
  }
  try {
    const raw = readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw) as GenerationTemplatesFile;
    const saved = data.templates;
    // merge: saved overrides defaults, new defaults fill in missing types
    const savedMap = new Map(saved.map((t) => [t.id, t]));
    return defaults.map((d) => savedMap.get(d.id) ?? d);
  } catch {
    return defaults;
  }
}

export function getTemplate(
  namespaceId: string,
  orgId: string,
  templateId: GenerationTemplateId
): GenerationTemplate {
  const all = getTemplates(namespaceId, orgId);
  return (
    all.find((t) => t.id === templateId) ??
    getDefaultTemplates().find((t) => t.id === templateId)!
  );
}

export function saveTemplates(
  namespaceId: string,
  orgId: string,
  templates: GenerationTemplate[]
): void {
  const filePath = getTemplatesPath(namespaceId, orgId);
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const data: GenerationTemplatesFile = { templates };
  writeFileSync(filePath, JSON.stringify(data, null, 2));
}
