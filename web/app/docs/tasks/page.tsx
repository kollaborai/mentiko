"use client";

import { PageBanner } from "@/components/ui/page-banner";
import { TaskSquareFilled, LinkFilled, JudgeFilled, Setting2Filled, RouteSquareFilled } from "@aliimam/icons";

const CodeBlock = ({ children }: { children: string }) => (
  <pre className="bg-muted rounded-md p-3 font-mono text-[11px] text-foreground/70 whitespace-pre overflow-x-auto mb-4">
    {children}
  </pre>
);

export default function TasksDocPage() {
  return (
    <div>
      <PageBanner
        title="Tasks"
        subtitle="Track work items with native task management. Tasks support dependencies, priorities, chain binding, and issue types for organizing development work."
        icon={TaskSquareFilled}
        sectionColor="#f59e0b"
        actions={[
          { label: "Tasks", href: "/tasks", icon: TaskSquareFilled, iconColor: "#5b9ef5" },
          { label: "Chains", href: "/chains", icon: LinkFilled, iconColor: "#b07ee8" },
          { label: "Runs", href: "/runs", icon: RouteSquareFilled, iconColor: "#5b9ef5" },
          { label: "Decisions", href: "/decisions", icon: JudgeFilled, iconColor: "#5b9ef5" },
          { label: "System Settings", href: "/settings/system", icon: Setting2Filled, iconColor: "#a0927b" },
        ]}
      />
      <div className="px-6 pb-6 max-w-3xl">

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Task Lifecycle</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Tasks progress through these states:
        </p>
        <div className="bg-card rounded-md p-3 space-y-1 text-xs text-foreground/60 mb-3">
          <div><span className="text-foreground/70">open</span> - task created, not started</div>
          <div><span className="text-foreground/70">in_progress</span> - someone is working on it</div>
          <div><span className="text-foreground/70">closed</span> - task completed</div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Dependencies and Blocking</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Tasks can depend on other tasks. A task with unresolved dependencies is
          &quot;blocked&quot; and cannot be started until its dependencies complete.
        </p>
        <CodeBlock>{`// add dependency via API
POST /api/tasks/deps
{ "from": "task-A", "to": "task-B" }

// view dependencies on a task
GET /api/tasks/task-A   # includes dependencies[] and dependents[]

// chains view shows both directions
// - blocking: tasks that must complete first
// - blocked by: tasks waiting on this one`}</CodeBlock>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Priority Levels</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Tasks use 0-4 priority scale (lower = more urgent):
        </p>
        <div className="bg-card rounded-md p-3 space-y-1 text-xs text-foreground/60 mb-3">
          <div><span className="text-foreground/70">P0 (0)</span> - critical, drop everything</div>
          <div><span className="text-foreground/70">P1 (1)</span> - high priority</div>
          <div><span className="text-foreground/70">P2 (2)</span> - medium priority (default)</div>
          <div><span className="text-foreground/70">P3 (3)</span> - low priority</div>
          <div><span className="text-foreground/70">P4 (4)</span> - backlog</div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Issue Types</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Tasks are categorized by type:
        </p>
        <div className="bg-card rounded-md p-3 space-y-1 text-xs text-foreground/60 mb-3">
          <div><span className="text-foreground/70">epic</span> - large initiative, contains subtasks</div>
          <div><span className="text-foreground/70">feature</span> - new functionality</div>
          <div><span className="text-foreground/70">task</span> - general work item</div>
          <div><span className="text-foreground/70">bug</span> - defect to fix</div>
          <div><span className="text-foreground/70">chore</span> - maintenance, cleanup</div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Epics</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Epics group related tasks into a single initiative. Subtasks are linked
          to an epic via <code className="text-foreground/70">parentId</code>. In the list view, subtasks are
          grouped under their epic header. Click the epic header to view its details.
        </p>
        <div className="bg-card rounded-md p-3 text-xs text-foreground/60 space-y-1 mb-3">
          <div><span className="text-foreground/70">Grouping</span> - subtasks grouped under parent epic in list and overview views</div>
          <div><span className="text-foreground/70">Progress</span> - epic header shows completion (e.g. 3/5 done)</div>
          <div><span className="text-foreground/70">Auto-run propagation</span> - toggling auto-run on an epic enables it on all subtasks</div>
          <div><span className="text-foreground/70">Dependency order</span> - subtasks run in dependency order when auto-run is enabled</div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Chain Binding</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Tasks can be bound to chains for automated execution. When a task is bound,
          you can configure auto-analysis and auto-generation of chains from the task
          description.
        </p>
        <CodeBlock>{`// chain binding in task metadata
chainBinding: {
  chainId: "my-chain",           // chain to run
  auto_run: true,                // auto-execute on trigger
  run_config: {                  // override chain config
    max_rounds: 10,
    workspace: "my-workspace"
  },
  last_run_id: "run-abc123",     // latest execution
  analysis_job_id: "job-xyz",    // background analysis job
  generation_job_id: "job-def"   // chain generation job
}`}</CodeBlock>
        <div className="bg-card rounded-md p-3 text-xs text-foreground/60 space-y-1 mb-3">
          <div><span className="text-foreground/70">Auto-analyze</span> - runs background job to analyze task</div>
          <div><span className="text-foreground/70">Auto-generate</span> - creates chain from task spec</div>
          <div><span className="text-foreground/70">Auto-run</span> - executes chain when triggered</div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Auto-Run</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          When auto-run is enabled on a task, the background worker automatically
          executes the task&apos;s chain when all dependencies are resolved. A background
          service scans for ready tasks every 60 seconds.
        </p>
        <div className="bg-card rounded-md p-3 text-xs text-foreground/60 space-y-1 mb-3">
          <div><span className="text-foreground/70">Dependency-aware</span> - only runs when all blockers are closed</div>
          <div><span className="text-foreground/70">Concurrency limit</span> - respects <a href="/settings/system" className="text-foreground/70 underline">max concurrent runs</a> setting</div>
          <div><span className="text-foreground/70">Auto-close</span> - successful runs automatically close the task</div>
          <div><span className="text-foreground/70">Retry limit</span> - retries up to 3 times on failure, then stops</div>
          <div><span className="text-foreground/70">Chain analysis</span> - if no chain is assigned, auto-run analyzes the task and recommends one</div>
        </div>
        <p className="text-xs text-foreground/40 leading-relaxed">
          Configure auto-run and concurrent limits at{" "}
          <a href="/settings/system" className="text-foreground/50 underline">Settings &rarr; System</a>.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Task Fields</h2>
        <div className="bg-card rounded-md p-3">
          <div className="space-y-2 text-xs text-foreground/60">
            <div><code className="text-foreground/70">id</code> - unique identifier (mentiko-number)</div>
            <div><code className="text-foreground/70">title</code> - task name</div>
            <div><code className="text-foreground/70">description</code> - detailed requirements</div>
            <div><code className="text-foreground/70">status</code> - open | in_progress | closed</div>
            <div><code className="text-foreground/70">priority</code> - 0-4 (P0-P4)</div>
            <div><code className="text-foreground/70">issue_type</code> - epic | feature | task | bug | chore</div>
            <div><code className="text-foreground/70">dependencies</code> - tasks this depends on</div>
            <div><code className="text-foreground/70">dependents</code> - tasks that depend on this</div>
            <div><code className="text-foreground/70">owner</code> - who claimed the task</div>
            <div><code className="text-foreground/70">assignee</code> - who should work on it</div>
            <div><code className="text-foreground/70">createdBy</code> - who created it</div>
            <div><code className="text-foreground/70">labels</code> - freeform tags</div>
            <div><code className="text-foreground/70">estimated_minutes</code> - stored estimate in minutes; UI maps it to estimate</div>
            <div><code className="text-foreground/70">due_at</code> - stored deadline; UI maps it to dueDate</div>
            <div><code className="text-foreground/70">chainBinding</code> - chain association</div>
          </div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Task API</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Tasks are managed via the web UI and REST API:
        </p>
        <CodeBlock>{`GET  /api/tasks?status=open     # list open tasks
GET  /api/tasks/:id             # task details with deps
POST /api/tasks/create          # create new task
PATCH /api/tasks/:id            # update task fields
POST /api/tasks/:id/close       # mark complete
POST /api/tasks/deps            # add dependency`}</CodeBlock>
      </section>
      </div>
    </div>
  );
}
