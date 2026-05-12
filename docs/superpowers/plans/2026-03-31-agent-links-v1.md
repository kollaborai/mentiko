# Agent Links V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Absorb swarm's live session features into the links system, rename swarm->links, and build the right-panel run experience on the /links page.

**Architecture:** Port 5 swarm API routes to /api/links/ namespace, update PeerSplitView to use link run IDs instead of swarm session names, add run launcher panel to /links page, add link-aware rendering to run-detail-panel.

**Tech Stack:** Next.js 16 app router, TypeScript, peer-manager (bash), pty-manager, xterm.js

---

### Task 1: Update link-types.ts with run-related types

**Files:**
- Modify: `web/lib/link-types.ts`

- [ ] **Step 1: Add LinkRun and LinkEscalation interfaces**

```typescript
// append to existing file after LinkSummary interface

export interface LinkEscalation {
  id: string;
  round: number;
  trigger: "STATUS:ESCALATE" | "STALL" | "MAX_ROUNDS";
  haiku_summary?: string;
  human_reply?: string;
  replied_at?: string;
  created_at: string;
}

export interface LinkRunAgent {
  id: string;
  name: string;
  status: "pending" | "running" | "complete" | "failed";
  session: string;
}

export interface LinkRun {
  id: string;
  type: "link";
  linkId: string;
  linkName: string;
  goal: string;
  workspaceId?: string;
  started: string;
  completed?: string;
  status: "running" | "completed" | "failed" | "stopped" | "stalled";
  mode: LinkMode;
  managerSession: string;
  agents: [LinkRunAgent, LinkRunAgent];
  escalations: LinkEscalation[];
}
```

- [ ] **Step 2: Verify types compile**

Run: `cd web && npx tsc --noEmit 2>&1 | head -10`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add web/lib/link-types.ts
git commit -m "feat(links): add LinkRun and LinkEscalation types"
```

---

### Task 2: Port /api/links/{id}/run with workspace support

**Files:**
- Modify: `web/app/api/links/run/route.ts`

The existing file already launches peer-manager from a link definition. We need to add: workspace resolution, goal from request body, LINK_RUN_ID env var for escalation callbacks, and workspace path in the peer-manager command.

- [ ] **Step 1: Read the existing run route**

Read: `web/app/api/links/run/route.ts` (154 lines)
Understand the current spawn + command building flow.

- [ ] **Step 2: Update the POST handler to accept workspace and goal params**

Update the request body parsing to accept:
```typescript
const { linkId, goalOverride, workspaceId, specFile, taskId } = await request.json();
```

Add workspace resolution after loading the link:
```typescript
// resolve workspace path
let workspacePath = "";
if (workspaceId) {
  const wsRes = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/workspaces/${encodeURIComponent(workspaceId)}`, {
    headers: { cookie: request.headers.get("cookie") || "" },
  });
  if (wsRes.ok) {
    const wsData = await wsRes.json();
    const ws = wsData?.data || wsData;
    workspacePath = ws?.path || "";
  }
}
```

- [ ] **Step 3: Add LINK_RUN_ID env var export to manager session**

After the BETTER_AUTH_SECRET export, add:
```typescript
// export run ID so peer-manager can construct escalation callback URL
execFileSync(pBin, ["send", managerSession, `export LINK_RUN_ID='${runId}'`], { timeout: 5000 });
```

- [ ] **Step 4: Add workspace cd and specFile to peer-manager command**

Before sending the peer-manager command, if workspacePath is set:
```typescript
if (workspacePath) {
  execFileSync(pBin, ["send", managerSession, `cd ${shellEscape(workspacePath)}`], { timeout: 5000 });
}
```

Include specFile in the goal if provided:
```typescript
const effectiveGoal = specFile
  ? `${goalOverride || link.config.leading_prompt || link.name}\n\nSpec file: ${specFile}`
  : goalOverride || link.config.leading_prompt || link.name;
```

- [ ] **Step 5: Update run.json to include workspaceId**

Add `workspaceId` and `workspacePath` to the run object written to disk.

- [ ] **Step 6: Verify it compiles**

Run: `cd web && npx tsc --noEmit 2>&1 | head -10`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add web/app/api/links/run/route.ts
git commit -m "feat(links): add workspace, goal, specFile support to run endpoint"
```

---

### Task 3: Create /api/links/runs/[runId]/stop endpoint

**Files:**
- Create: `web/app/api/links/runs/[runId]/stop/route.ts`

- [ ] **Step 1: Create the stop route**

```typescript
import { NextRequest } from "next/server";
import { execFileSync } from "child_process";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import config from "@/lib/config";
import { checkAuth } from "@/lib/security-server";
import { BadRequest, NotFound } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const POST = withErrorHandling(async (
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) => {
  const authErr = await checkAuth(request);
  if (authErr) return authErr;

  const { runId } = await params;
  if (!runId || !/^run-\d+$/.test(runId)) {
    throw new BadRequest("Invalid run ID");
  }

  const runPath = join(config.runsDir, runId, "run.json");
  if (!existsSync(runPath)) {
    throw new NotFound("Run not found");
  }

  const run = JSON.parse(readFileSync(runPath, "utf-8"));
  if (run.type !== "link") {
    throw new BadRequest("Not a link run");
  }

  const pBin = join(config.binDir, "p");
  const stopped: string[] = [];

  // kill manager + agent sessions
  const sessions = [
    run.managerSession,
    ...run.agents.map((a: { session: string }) => a.session).filter(Boolean),
  ];

  for (const session of sessions) {
    if (!session || !/^[a-zA-Z0-9][a-zA-Z0-9\-_]{0,99}$/.test(session)) continue;
    try {
      execFileSync(pBin, ["remove", session], { timeout: 5000 });
      stopped.push(session);
    } catch {
      // session may already be dead
    }
  }

  // update run status
  run.status = "stopped";
  run.completed = new Date().toISOString();
  writeFileSync(runPath, JSON.stringify(run, null, 2));

  return apiSuccess({ stopped, runId });
});
```

- [ ] **Step 2: Verify it compiles**

Run: `cd web && npx tsc --noEmit 2>&1 | head -10`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add 'web/app/api/links/runs/[runId]/stop/route.ts'
git commit -m "feat(links): add stop endpoint for link runs"
```

---

### Task 4: Create /api/links/runs/[runId]/escalate endpoint

**Files:**
- Create: `web/app/api/links/runs/[runId]/escalate/route.ts`

- [ ] **Step 1: Create the escalate route**

Port from `web/app/api/swarm/[session]/escalate/route.ts`. Key changes:
- Parameter is `runId` not `session`
- Load run.json to get managerSession
- Use run's escalation dir instead of swarm's
- Store escalation in run.json escalations array

```typescript
import { NextRequest } from "next/server";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { execFileSync } from "child_process";
import config from "@/lib/config";
import { checkAuth } from "@/lib/security-server";
import { BadRequest, NotFound } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { sendMessage, telegramEnabled } from "@/lib/telegram";

function generateSummary(peer1Last: string, peer2Last: string): string {
  try {
    const prompt = `Summarize this disagreement in ONE sentence. Peer 1: "${peer1Last.slice(0, 500)}" Peer 2: "${peer2Last.slice(0, 500)}"`;
    const result = execFileSync("claude", ["-p", prompt, "--model", "haiku"], {
      timeout: 30000,
      encoding: "utf-8",
    });
    return result.trim().slice(0, 200);
  } catch {
    return "Agents are stuck and need human guidance.";
  }
}

const triggerLabels: Record<string, string> = {
  "STATUS:ESCALATE": "loop detected",
  STALL: "stalled (consecutive continues)",
  MAX_ROUNDS: "max rounds hit",
};

export const POST = withErrorHandling(async (
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) => {
  const authErr = await checkAuth(request);
  if (authErr) return authErr;

  const { runId } = await params;
  const runPath = join(config.runsDir, runId, "run.json");
  if (!existsSync(runPath)) {
    throw new NotFound("Run not found");
  }

  const run = JSON.parse(readFileSync(runPath, "utf-8"));
  if (run.type !== "link") {
    throw new BadRequest("Not a link run");
  }

  const body = await request.json();
  const { escalation_id, round, trigger, consecutive_continues, peer1_last, peer2_last } = body;

  const summary = generateSummary(peer1_last || "", peer2_last || "");

  const escalation = {
    id: escalation_id || `esc-${Date.now()}`,
    round: round || 0,
    trigger: trigger || "STALL",
    consecutive_continues: consecutive_continues || 0,
    haiku_summary: summary,
    created_at: new Date().toISOString(),
  };

  // append to run.json escalations
  if (!run.escalations) run.escalations = [];
  run.escalations.push(escalation);
  run.status = "stalled";
  writeFileSync(runPath, JSON.stringify(run, null, 2));

  // create escalation dir for reply file
  const escDir = join(config.runsDir, runId, "escalations");
  mkdirSync(escDir, { recursive: true });

  // send telegram if configured
  let telegramSent = false;
  let telegramMessageId: number | null = null;
  if (telegramEnabled()) {
    try {
      const label = triggerLabels[trigger] || trigger;
      const msg = `Agent Link escalation (${run.linkName})\nRound ${round}: ${label}\n${summary}`;
      const result = await sendMessage(msg);
      telegramSent = true;
      telegramMessageId = result?.message_id || null;
    } catch {
      // telegram failure is non-fatal
    }
  }

  return apiSuccess({
    ok: true,
    telegram_sent: telegramSent,
    telegram_message_id: telegramMessageId,
  });
});
```

- [ ] **Step 2: Verify it compiles**

Run: `cd web && npx tsc --noEmit 2>&1 | head -10`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add 'web/app/api/links/runs/[runId]/escalate/route.ts'
git commit -m "feat(links): add escalation endpoint for link runs"
```

---

### Task 5: Create /api/links/runs/[runId]/reply endpoint

**Files:**
- Create: `web/app/api/links/runs/[runId]/reply/route.ts`

- [ ] **Step 1: Create the reply route**

```typescript
import { NextRequest } from "next/server";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import config from "@/lib/config";
import { checkAuth } from "@/lib/security-server";
import { BadRequest, NotFound } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { sendMessage, telegramEnabled } from "@/lib/telegram";

export const POST = withErrorHandling(async (
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) => {
  const authErr = await checkAuth(request);
  if (authErr) return authErr;

  const { runId } = await params;
  const { reply } = await request.json();

  if (!reply || typeof reply !== "string") {
    throw new BadRequest("reply text is required");
  }

  const runPath = join(config.runsDir, runId, "run.json");
  if (!existsSync(runPath)) {
    throw new NotFound("Run not found");
  }

  const run = JSON.parse(readFileSync(runPath, "utf-8"));
  if (run.type !== "link") {
    throw new BadRequest("Not a link run");
  }

  // write reply file for peer-manager to consume
  const escDir = join(config.runsDir, runId, "escalations");
  mkdirSync(escDir, { recursive: true });
  writeFileSync(join(escDir, "reply.txt"), reply);

  // update last escalation with reply
  if (run.escalations?.length > 0) {
    const last = run.escalations[run.escalations.length - 1];
    last.human_reply = reply;
    last.replied_at = new Date().toISOString();
  }
  run.status = "running";
  writeFileSync(runPath, JSON.stringify(run, null, 2));

  // notify telegram
  if (telegramEnabled()) {
    try {
      await sendMessage("got it. injecting guidance into session...");
    } catch {
      // non-fatal
    }
  }

  return apiSuccess({ ok: true });
});
```

- [ ] **Step 2: Verify it compiles**

Run: `cd web && npx tsc --noEmit 2>&1 | head -10`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add 'web/app/api/links/runs/[runId]/reply/route.ts'
git commit -m "feat(links): add human reply/steering endpoint for link runs"
```

---

### Task 6: Create /api/links/runs/[runId]/escalations endpoint

**Files:**
- Create: `web/app/api/links/runs/[runId]/escalations/route.ts`

- [ ] **Step 1: Create the escalations GET route**

```typescript
import { NextRequest } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import config from "@/lib/config";
import { checkAuth } from "@/lib/security-server";
import { NotFound } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { telegramEnabled } from "@/lib/telegram";

export const GET = withErrorHandling(async (
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) => {
  const authErr = await checkAuth(request);
  if (authErr) return authErr;

  const { runId } = await params;
  const runPath = join(config.runsDir, runId, "run.json");
  if (!existsSync(runPath)) {
    throw new NotFound("Run not found");
  }

  const run = JSON.parse(readFileSync(runPath, "utf-8"));
  const escDir = join(config.runsDir, runId, "escalations");
  const pending = run.status === "stalled" && !existsSync(join(escDir, "reply.txt"));

  return apiSuccess({
    runId,
    escalations: run.escalations || [],
    pending,
    telegram_connected: telegramEnabled(),
  });
});
```

- [ ] **Step 2: Verify it compiles**

Run: `cd web && npx tsc --noEmit 2>&1 | head -10`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add 'web/app/api/links/runs/[runId]/escalations/route.ts'
git commit -m "feat(links): add escalations history endpoint for link runs"
```

---

### Task 7: Update PeerSplitView to use link run endpoints

**Files:**
- Modify: `web/components/terminal/peer-split-view.tsx`

- [ ] **Step 1: Read the existing component**

Read: `web/components/terminal/peer-split-view.tsx` (350 lines)
Note the polling URL at ~line 68 and reply URL at ~line 86.

- [ ] **Step 2: Add runId prop and update API endpoints**

Add `runId?: string` to PeerSplitViewProps.

Update the escalation polling (currently `/api/swarm/{managerSession}/escalations`):
```typescript
// if runId provided, use new links endpoints; otherwise fall back to swarm (backward compat)
const escUrl = runId
  ? `/api/links/runs/${encodeURIComponent(runId)}/escalations`
  : `/api/swarm/${encodeURIComponent(managerSession!)}/escalations`;
```

Update the reply endpoint (currently `/api/swarm/{managerSession}/reply`):
```typescript
const replyUrl = runId
  ? `/api/links/runs/${encodeURIComponent(runId)}/reply`
  : `/api/swarm/${encodeURIComponent(managerSession!)}/reply`;
```

- [ ] **Step 3: Verify it compiles**

Run: `cd web && npx tsc --noEmit 2>&1 | head -10`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add web/components/terminal/peer-split-view.tsx
git commit -m "feat(links): update PeerSplitView to support link run endpoints"
```

---

### Task 8: Add link run rendering to run-detail-panel

**Files:**
- Modify: `web/components/run/run-detail-panel.tsx`

- [ ] **Step 1: Read the component and find the rendering section**

Read: `web/components/run/run-detail-panel.tsx` around lines 845-1000 where the main JSX is returned. Identify where to add the link-specific rendering branch.

- [ ] **Step 2: Import PeerSplitView**

Add import at top of file:
```typescript
import { PeerSplitView } from "@/components/terminal/peer-split-view";
```

- [ ] **Step 3: Add link run detection and live view**

In the main render block, after the loading/not-found checks, add a branch for link runs:

```typescript
const isLinkRun = run?.type === "link";
```

When `isLinkRun && isActive`, render PeerSplitView instead of the normal agent/output tabs:

```typescript
{isLinkRun && isActive ? (
  <div className="flex flex-col h-full">
    {/* header: goal, link name, mode, round count */}
    <div className="flex items-center justify-between px-4 py-3">
      <div>
        <div className="text-sm font-medium">{run.goal}</div>
        <div className="text-xs text-muted-foreground">
          {run.linkName || run.chain} | {run.mode || "collaboration"} | {run.agents?.length || 2} agents
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          className="px-3 py-1.5 text-xs bg-red-500/10 text-red-400 rounded-md hover:bg-red-500/20"
          onClick={handleStop}
        >
          Stop
        </button>
      </div>
    </div>
    {/* split terminal view */}
    <div className="flex-1 min-h-0">
      <PeerSplitView
        sessionA={run.agents?.[0]?.session || ""}
        sessionB={run.agents?.[1]?.session || ""}
        managerSession={run.managerSession}
        labelA={run.agents?.[0]?.name || "Agent 1"}
        labelB={run.agents?.[1]?.name || "Agent 2"}
        runId={run.id}
      />
    </div>
  </div>
) : isLinkRun && !isActive ? (
  /* completed link run: show transcript */
  <div className="flex flex-col h-full px-4 py-3 overflow-auto">
    <div className="mb-4">
      <div className="text-sm font-medium">{run.goal}</div>
      <div className="text-xs text-muted-foreground">
        {run.linkName || run.chain} | {run.mode || "collaboration"} | completed
      </div>
    </div>
    {/* escalation history if any */}
    {run.escalations?.length > 0 && (
      <div className="mb-4 space-y-2">
        <div className="text-xs font-medium text-muted-foreground">Escalations</div>
        {run.escalations.map((esc: { id: string; round: number; trigger: string; haiku_summary?: string; human_reply?: string }, i: number) => (
          <div key={esc.id || i} className="text-xs p-2 bg-muted/30 rounded">
            <span className="text-amber-400">Round {esc.round}: {esc.trigger}</span>
            {esc.haiku_summary && <div className="mt-1 opacity-70">{esc.haiku_summary}</div>}
            {esc.human_reply && <div className="mt-1 text-blue-400">Steering: {esc.human_reply}</div>}
          </div>
        ))}
      </div>
    )}
    {/* fall through to normal output/conversation tabs for transcript */}
    <div className="text-xs text-muted-foreground">
      Conversation transcript available in Output tab
    </div>
  </div>
) : (
  /* existing chain run rendering - no changes */
```

Close the ternary properly to wrap the existing chain rendering.

- [ ] **Step 4: Add handleStop function for link runs**

```typescript
async function handleStop() {
  if (!run?.id) return;
  try {
    await fetchWithNamespace(`/api/links/runs/${encodeURIComponent(run.id)}/stop`, {
      method: "POST",
    });
    // refresh run data
    fetchRun();
  } catch {
    // stop failure is visible in UI via status not changing
  }
}
```

- [ ] **Step 5: Verify it compiles**

Run: `cd web && npx tsc --noEmit 2>&1 | head -10`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add web/components/run/run-detail-panel.tsx
git commit -m "feat(links): add PeerSplitView for live link runs in run detail"
```

---

### Task 9: Add right panel run launcher to /links page

**Files:**
- Modify: `web/app/(workflows)/links/page.tsx`

- [ ] **Step 1: Read the current page component**

Read: `web/app/(workflows)/links/page.tsx` (552 lines)
Note the state variables, handleRun function, and the detail pane JSX.

- [ ] **Step 2: Add workspace state and fetch**

Add state for workspaces and selected workspace:
```typescript
const [workspaces, setWorkspaces] = useState<{ id: string; name: string; path: string }[]>([]);
const [selectedWorkspace, setSelectedWorkspace] = useState("");
const [specFile, setSpecFile] = useState("");
```

Add useEffect to fetch workspaces on mount:
```typescript
useEffect(() => {
  fetchWithNamespace("/api/workspaces/list")
    .then((r) => r.json())
    .then((data) => {
      const ws = data?.data?.workspaces || data?.workspaces || [];
      setWorkspaces(ws);
    })
    .catch(() => {});
}, [fetchWithNamespace]);
```

- [ ] **Step 3: Update handleRun to pass workspace and goal**

Replace the existing handleRun with:
```typescript
async function handleRun() {
  if (!selected) return;
  setLaunching(true);
  try {
    const res = await fetchWithNamespace("/api/links/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        linkId: selected.id,
        goalOverride: runGoal || undefined,
        workspaceId: selectedWorkspace || undefined,
        specFile: specFile || undefined,
      }),
    });
    const data = await res.json();
    const runId = data?.data?.runId || data?.runId;
    if (runId) {
      router.push(`/runs?id=${runId}`);
    }
  } catch {
    // error handling
  } finally {
    setLaunching(false);
  }
}
```

- [ ] **Step 4: Replace the run modal with inline right panel launcher**

In the detail pane JSX (where the link config is shown), replace or extend the run section. Remove the modal approach and add inline controls:

```typescript
{/* Run Section */}
<div className="mt-6 space-y-3">
  <div className="text-xs font-medium text-muted-foreground">Run this link</div>
  <textarea
    className="w-full rounded-md bg-muted/30 px-3 py-2 text-sm resize-none"
    rows={3}
    placeholder="What should the agents discuss or work on?"
    value={runGoal}
    onChange={(e) => setRunGoal(e.target.value)}
  />
  <div className="flex gap-2">
    <select
      className="flex-1 rounded-md bg-muted/30 px-3 py-2 text-sm"
      value={selectedWorkspace}
      onChange={(e) => setSelectedWorkspace(e.target.value)}
    >
      <option value="">No workspace</option>
      {workspaces.map((ws) => (
        <option key={ws.id} value={ws.id}>{ws.name}</option>
      ))}
    </select>
  </div>
  <input
    className="w-full rounded-md bg-muted/30 px-3 py-2 text-sm"
    placeholder="Spec file path (optional)"
    value={specFile}
    onChange={(e) => setSpecFile(e.target.value)}
  />
  <button
    className="w-full py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-500 disabled:opacity-50"
    onClick={handleRun}
    disabled={launching}
  >
    {launching ? "Launching..." : "Run Link"}
  </button>
</div>
```

- [ ] **Step 5: Add recent runs section below the launcher**

Add state for recent runs and fetch them when a link is selected:
```typescript
const [recentRuns, setRecentRuns] = useState<{ id: string; status: string; started: string }[]>([]);

// in the link selection handler or useEffect on selected:
useEffect(() => {
  if (!selected) return;
  fetchWithNamespace(`/api/runs?type=link&linkId=${encodeURIComponent(selected.id)}&limit=5`)
    .then((r) => r.json())
    .then((data) => {
      const runs = data?.data?.runs || data?.runs || [];
      setRecentRuns(runs);
    })
    .catch(() => setRecentRuns([]));
}, [selected, fetchWithNamespace]);
```

Render below the run button:
```typescript
{recentRuns.length > 0 && (
  <div className="mt-4">
    <div className="text-xs font-medium text-muted-foreground mb-2">Recent Runs</div>
    {recentRuns.map((r) => (
      <div
        key={r.id}
        className="flex items-center justify-between py-1.5 text-xs cursor-pointer hover:bg-muted/20 rounded px-2"
        onClick={() => router.push(`/runs?id=${r.id}`)}
      >
        <span className="opacity-60">{r.id.slice(0, 16)}...</span>
        <span className={r.status === "running" ? "text-green-400" : "opacity-40"}>{r.status}</span>
      </div>
    ))}
  </div>
)}
```

- [ ] **Step 6: Remove the showRunModal state and RunModal dialog**

The inline panel replaces the modal. Remove `showRunModal` state and the modal component JSX.

- [ ] **Step 7: Verify it compiles**

Run: `cd web && npx tsc --noEmit 2>&1 | head -10`
Expected: no errors

- [ ] **Step 8: Commit**

```bash
git add 'web/app/(workflows)/links/page.tsx'
git commit -m "feat(links): add inline run launcher with workspace picker to links page"
```

---

### Task 10: Update /api/runs to support type=link filtering

**Files:**
- Modify: `web/app/api/runs/route.ts`

- [ ] **Step 1: Read the runs list endpoint**

Read: `web/app/api/runs/route.ts` - find where runs are listed and filtered.

- [ ] **Step 2: Add type and linkId query params**

In the GET handler, add filtering support:
```typescript
const type = searchParams.get("type"); // "link" or "chain"
const linkId = searchParams.get("linkId");

// after loading runs, filter:
let filtered = runs;
if (type) {
  filtered = filtered.filter((r: { type?: string }) => r.type === type);
}
if (linkId) {
  filtered = filtered.filter((r: { linkId?: string }) => r.linkId === linkId);
}
```

- [ ] **Step 3: Verify it compiles**

Run: `cd web && npx tsc --noEmit 2>&1 | head -10`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add web/app/api/runs/route.ts
git commit -m "feat(links): add type and linkId filtering to runs list endpoint"
```

---

### Task 11: Delete swarm routes and page

**Files:**
- Delete: `web/app/swarm/page.tsx`
- Delete: `web/app/api/swarm/launch/route.ts`
- Delete: `web/app/api/swarm/[session]/escalate/route.ts`
- Delete: `web/app/api/swarm/[session]/reply/route.ts`
- Delete: `web/app/api/swarm/[session]/escalations/route.ts`
- Delete: `web/app/api/swarm/stop/route.ts`

- [ ] **Step 1: Verify no imports reference swarm routes**

Run: `cd web && grep -r "api/swarm" --include="*.ts" --include="*.tsx" app/ components/ lib/ | grep -v node_modules | grep -v ".next"`

Only hits should be in the files we're deleting and PeerSplitView (which now has fallback).

- [ ] **Step 2: Delete swarm files**

```bash
rm -rf web/app/swarm/
rm -rf web/app/api/swarm/
```

- [ ] **Step 3: Verify build still works**

Run: `cd web && npx tsc --noEmit 2>&1 | head -10`
Expected: no errors (PeerSplitView has backward compat fallback)

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(links): remove deprecated swarm routes and page"
```

---

### Task 12: Update documentation and references

**Files:**
- Modify: `CLAUDE.md` - update /swarm references to /links
- Modify: `docs/API_REFERENCE.md` - replace swarm API docs
- Modify: Any nav files referencing /swarm

- [ ] **Step 1: Find all remaining swarm references**

Run: `grep -rn "swarm" --include="*.md" --include="*.ts" --include="*.tsx" --include="*.sh" . | grep -v node_modules | grep -v .next | grep -v .git`

- [ ] **Step 2: Update CLAUDE.md**

Replace `/swarm` route description with deprecated note. Update the /links description to include run features, escalation, steering.

- [ ] **Step 3: Update other docs**

Update any docs that reference `/api/swarm/*` endpoints to use `/api/links/runs/*`.

- [ ] **Step 4: Verify build**

Run: `cd web && npx tsc --noEmit 2>&1 | head -10`
Expected: no errors

- [ ] **Step 5: Commit and push**

```bash
git add -A
git commit -m "docs: update swarm references to links across codebase"
git push
```

---

### Task 13: End-to-end QA via puppeteer

**Files:** none (testing only)

- [ ] **Step 1: Navigate to /links and verify page loads**

Navigate to http://localhost:3000/links
Screenshot and verify: list panel, empty state or link list, no errors.

- [ ] **Step 2: Create a link**

Click "Create link", fill in two agents, set mode to debate, save.
Verify link appears in list.

- [ ] **Step 3: Select link and verify right panel**

Click the link in the list.
Verify: prompt input, workspace dropdown, spec file input, Run Link button, link config summary.

- [ ] **Step 4: Run the link**

Type a goal, select a workspace, click Run Link.
Verify: redirects to /runs/{runId}.

- [ ] **Step 5: Verify live split terminal**

On /runs/{runId}, verify PeerSplitView renders with two terminal panes.
Verify agents are active (terminal output visible).

- [ ] **Step 6: Verify /swarm is gone**

Navigate to http://localhost:3000/swarm
Verify: 404 page.

- [ ] **Step 7: Verify no [object Object] or console errors**

Check rendered text for [object Object].
Check console for React errors.
