#!/usr/bin/env tsx
/**
 * mentiko seed script
 *
 * Seeds a fresh namespace with example data:
 *   - demo workspace (local, points at project root)
 *   - example agent configs (code-reviewer, coder, researcher, writer)
 *   - example chains (hello-world, code-review, research-write)
 *   - default config profiles
 *
 * Usage:
 *   npm run seed                  # seeds default namespace
 *   NAMESPACE_ID=myns npm run seed
 *   npx tsx web/scripts/seed.ts
 */

import { existsSync, mkdirSync, writeFileSync } from "fs";
import path from "path";

// -- config ---------------------------------------------------------

const ROOT = process.env.MENTIKO_ROOT
  ? process.env.MENTIKO_ROOT
  : path.join(process.cwd(), "..");

const NAMESPACE_ID = process.env.NAMESPACE_ID || "default";
const ORG_ID = process.env.ORG_ID || "default";
const NS_ROOT = path.join(ROOT, "namespaces", NAMESPACE_ID);

// orgPath: resolve org-level path (collapses for default org)
function orgPath(nsId: string, oId: string, ...segments: string[]): string {
  if (oId === "default") {
    return path.join(ROOT, "namespaces", nsId, ...segments);
  }
  return path.join(ROOT, "namespaces", nsId, "orgs", oId, ...segments);
}

function nsPath(...segments: string[]): string {
  return path.join(NS_ROOT, ...segments);
}

function ensureDir(p: string) {
  mkdirSync(p, { recursive: true });
}

function writeJson(p: string, data: unknown, overwrite = false) {
  if (!overwrite && existsSync(p)) {
    console.log(`  skip (exists): ${path.relative(ROOT, p)}`);
    return;
  }
  ensureDir(path.dirname(p));
  writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
  console.log(`  wrote: ${path.relative(ROOT, p)}`);
}

// -- seed data ------------------------------------------------------

const DEMO_WORKSPACE = {
  id: "local",
  name: "Local",
  path: ROOT,
  addedAt: new Date().toISOString(),
  execution: { type: "local" },
};

const AGENTS = [
  {
    id: "code-reviewer",
    name: "Code Reviewer",
    description:
      "Reviews code for correctness, style, security, performance, and best practices.",
    role: "review",
    version: "1.0.0",
    prompt:
      "You are a Code Reviewer. Review the code thoroughly and write a structured report to workspace/review.md.\n\nCheck for: correctness, style, security, performance, and test coverage.\n\nEnd with VERDICT: approved or VERDICT: needs-changes.\n\nOutput AGENT_COMPLETE when done.",
    tools: ["read", "write", "bash"],
  },
  {
    id: "coder",
    name: "Coder",
    description: "Implements features and fixes bugs based on specifications.",
    role: "implement",
    version: "1.0.0",
    prompt:
      "You are a Coder. Read any review or spec at workspace/ and implement the requested changes.\n\nWrite a summary of changes to workspace/changes.md.\n\nOutput AGENT_COMPLETE when done.",
    tools: ["read", "write", "bash"],
  },
  {
    id: "researcher",
    name: "Researcher",
    description: "Researches topics and writes structured summaries.",
    role: "research",
    version: "1.0.0",
    prompt:
      "You are a Researcher. Research the given topic thoroughly.\n\nWrite findings to workspace/research.md with sections: Summary, Key Points, Sources.\n\nOutput AGENT_COMPLETE when done.",
    tools: ["read", "write", "bash"],
  },
  {
    id: "writer",
    name: "Writer",
    description: "Transforms research notes into polished written content.",
    role: "write",
    version: "1.0.0",
    prompt:
      "You are a Writer. Read the research at workspace/research.md and write polished content.\n\nSave output to workspace/output.md.\n\nOutput AGENT_COMPLETE when done.",
    tools: ["read", "write"],
  },
];

const AGENT_PROFILES = [
  {
    id: "mentiko-ai-gateway-smoke",
    name: "AI Gateway Smoke",
    description: "Runs a built-in OpenAI-compatible smoke check through the tenant AI gateway.",
    isDefault: false,
    cli: "bash",
    extra_args: ["-lc", 'node "$MENTIKO_CODE_ROOT/bin/ai-gateway-smoke-agent.mjs"'],
    env: {
      MENTIKO_AI_GATEWAY_SMOKE_MODEL: "glm-5.1",
    },
    log_path: "",
    log_format: "jsonl",
  },
];

const CHAINS = [
  {
    name: "ai-gateway-smoke",
    data: {
      name: "AI Gateway Smoke",
      version: "1.0",
      description:
        "Verifies the tenant-local AI gateway proxy can reach the included AI data plane.",
      default_agent_profile: "mentiko-ai-gateway-smoke",
      config: {
        monitor: true,
        monitor_interval: 5,
        max_rounds: 1,
        project_root: "auto",
        session_prefix: "gw-smoke",
        on_complete: "stop",
      },
      agents: [
        {
          id: "gateway-smoke",
          name: "Gateway Smoke",
          role: "testing",
          triggers: ["manual-start"],
          emits: "gateway-smoke-complete",
          agent_profile: "mentiko-ai-gateway-smoke",
          prompt:
            "Run the built-in AI gateway smoke check and report the result. Output AGENT_COMPLETE when done.",
        },
      ],
    },
  },
  {
    name: "hello-world",
    data: {
      name: "Hello World",
      version: "1.0",
      description:
        "A simple 2-agent chain: one reviews code, the other improves it. Great for testing your setup.",
      config: {
        monitor: true,
        monitor_interval: 30,
        max_rounds: 1,
        project_root: "auto",
        session_prefix: "hw",
        on_complete: "stop",
      },
      agents: [
        {
          $ref: "code-reviewer",
          id: "reviewer",
          triggers: ["manual-start"],
          emits: "review-complete",
          prompt:
            "Review the codebase in this workspace.\n\n1. Look at the main source files\n2. Check for code quality, readability, and potential bugs\n3. Write a brief review to workspace/review.md\n4. Include 2-3 specific suggestions for improvement\n\nOutput AGENT_COMPLETE when done.",
        },
        {
          $ref: "coder",
          id: "improver",
          triggers: ["review-complete"],
          emits: "improvements-complete",
          prompt:
            "Read the review at workspace/review.md and implement the most impactful suggestion.\n\nWrite a brief summary of changes to workspace/changes.md.\n\nOutput AGENT_COMPLETE when done.",
        },
      ],
    },
  },
  {
    name: "code-review",
    data: {
      name: "Code Review",
      version: "1.0",
      description: "Multi-round code review with approval gate.",
      config: {
        monitor: true,
        max_rounds: 3,
        project_root: "auto",
        session_prefix: "cr",
        on_complete: "stop",
      },
      agents: [
        {
          $ref: "coder",
          id: "coder",
          triggers: ["manual-start"],
          emits: "code-ready",
          prompt:
            "Implement the feature described in workspace/task.md (create it if missing with a sample task).\n\nOutput AGENT_COMPLETE when done.",
        },
        {
          $ref: "code-reviewer",
          id: "reviewer",
          triggers: ["code-ready"],
          emits: "review-complete",
          prompt:
            "Review the changes made by the Coder. Write review to workspace/review.md.\n\nOutput AGENT_COMPLETE when done.",
        },
      ],
    },
  },
  {
    name: "research-write",
    data: {
      name: "Research & Write",
      version: "1.0",
      description: "Research a topic then produce polished written content.",
      config: {
        monitor: true,
        max_rounds: 1,
        project_root: "auto",
        session_prefix: "rw",
        on_complete: "stop",
      },
      agents: [
        {
          $ref: "researcher",
          id: "researcher",
          triggers: ["manual-start"],
          emits: "research-done",
          prompt:
            "Research {TASK}. Write findings to workspace/research.md.\n\nOutput AGENT_COMPLETE when done.",
        },
        {
          $ref: "writer",
          id: "writer",
          triggers: ["research-done"],
          emits: "writing-done",
          prompt:
            "Read workspace/research.md and write polished content to workspace/output.md.\n\nOutput AGENT_COMPLETE when done.",
        },
      ],
    },
  },
];


// -- run seed -------------------------------------------------------

function main() {
  console.log(`seeding namespace: ${NAMESPACE_ID}`);
  console.log(`namespace root:   ${NS_ROOT}`);
  console.log("");

  // ensure namespace dirs
  const dirs = [
    "agents", "chains", "state", "events", "runs", "workspace",
    "reports", "debug", "jobs", "watchdog-hooks", "agent-profiles", "profiles", "metrics",
    "emails", "org", "notifications",
  ];
  for (const d of dirs) {
    ensureDir(nsPath(d));
  }

  // workspaces.json
  const wsPath = nsPath("workspaces.json");
  if (!existsSync(wsPath)) {
    writeFileSync(wsPath, JSON.stringify([DEMO_WORKSPACE], null, 2), "utf-8");
    console.log(`  wrote: namespaces/${NAMESPACE_ID}/workspaces.json`);
  } else {
    console.log(`  skip (exists): namespaces/${NAMESPACE_ID}/workspaces.json`);
  }

  // agents (org-level)
  for (const agent of AGENTS) {
    writeJson(orgPath(NAMESPACE_ID, ORG_ID, "agents", agent.id, "agent.json"), agent);
  }

  // agent profiles (org-level)
  const now = new Date().toISOString();
  for (const profile of AGENT_PROFILES) {
    writeJson(orgPath(NAMESPACE_ID, ORG_ID, "agent-profiles", `${profile.id}.json`), {
      ...profile,
      createdAt: now,
      updatedAt: now,
    });
  }

  // chains (org-level)
  for (const chain of CHAINS) {
    writeJson(orgPath(NAMESPACE_ID, ORG_ID, "chains", chain.name, "chain.json"), chain.data);
  }

  // seed marker
  const markerPath = nsPath(".seeded");
  writeFileSync(
    markerPath,
    JSON.stringify({ seededAt: new Date().toISOString(), version: "1.0" }, null, 2),
    "utf-8"
  );
  console.log(`  wrote: namespaces/${NAMESPACE_ID}/.seeded`);

  console.log("");
  console.log("seed complete.");
  console.log("  start the dev server: cd web && npm run dev");
  console.log("  open: http://localhost:3000");
}

main();
