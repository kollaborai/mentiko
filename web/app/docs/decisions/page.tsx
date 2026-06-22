"use client";

import { PageBanner } from "@/components/ui/page-banner";
import { JudgeFilled, TaskSquareFilled } from "@aliimam/icons";

const CodeBlock = ({ children }: { children: string }) => (
  <pre className="bg-muted rounded-md p-3 font-mono text-[11px] text-foreground/70 whitespace-pre overflow-x-auto mb-4">
    {children}
  </pre>
);

export default function DecisionsDocPage() {
  return (
    <div>
      <PageBanner
        title="Decisions"
        subtitle="AI-assisted decision flow for complex choices. Research options, get AI recommendations, and convert decisions into actionable tasks with execution plans."
        icon={JudgeFilled}
        sectionColor="#f59e0b"
        actions={[
          { label: "Decision Tasks", href: "/tasks?type=decision", icon: JudgeFilled, iconColor: "#5b9ef5" },
          { label: "Tasks", href: "/tasks", icon: TaskSquareFilled, iconColor: "#5b9ef5" },
        ]}
      />
      <div className="px-6 pb-6 max-w-3xl">

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Decision Modes</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Two modes for different decision styles:
        </p>
        <div className="bg-card rounded-md p-3 text-xs text-foreground/60 space-y-1 mb-3">
          <div><span className="text-foreground/70">Classic</span> - freeform prompt, AI generates options + recommendation</div>
          <div><span className="text-foreground/70">Guided</span> - 3-round structured flow (preferences → options → plan)</div>
        </div>
        <p className="text-xs text-foreground/60 leading-relaxed">
          Guided mode is the default for new decisions. Classic mode is available for
          quick, unstructured decisions.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Decision Lifecycle</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Decisions progress through these states:
        </p>
        <div className="bg-card rounded-md p-3 space-y-1 text-xs text-foreground/60 mb-3">
          <div><span className="text-foreground/70">intake</span> - initial creation, gathering context</div>
          <div><span className="text-foreground/70">researching</span> - AI analyzing the problem</div>
          <div><span className="text-foreground/70">briefed</span> - research brief is ready for review</div>
          <div><span className="text-foreground/70">pending</span> - awaiting your approval</div>
          <div><span className="text-foreground/70">approved</span> - decision resolved and task(s) created</div>
          <div><span className="text-foreground/70">in_progress</span> - legacy status; task execution state lives on the created tasks</div>
          <div><span className="text-foreground/70">done</span> - completed, retrospective written</div>
          <div><span className="text-foreground/70">skipped</span> - cancelled or no longer relevant</div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Guided Flow: Round 1 (Preferences)</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          AI asks binary tradeoff questions to understand your priorities. Each question
          presents two opposing values (e.g. &quot;Speed vs Quality&quot;).
        </p>
        <div className="bg-card rounded-md p-3 text-xs text-foreground/60 space-y-1 mb-3">
          <div>Answer A or B for each tradeoff question</div>
          <div>Builds a preference profile based on your choices</div>
          <div>Used to score and rank options in round 2</div>
        </div>
        <CodeBlock>{`// tradeoff question format
{
  id: "tq-1",
  question: "Which matters more?",
  optionA: "Speed - ship quickly, iterate later",
  optionB: "Quality - get it right the first time"
}`}</CodeBlock>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Guided Flow: Round 2 (Options)</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          AI generates tailored options based on your preferences. Each option is scored
          0-100 based on how well it matches your preference profile.
        </p>
        <div className="bg-card rounded-md p-3 text-xs text-foreground/60 space-y-1 mb-3">
          <div>Options include: name, description, pros, cons, effort, risk</div>
          <div>Match score shows alignment with your preferences</div>
          <div>Select one option to proceed to round 3</div>
        </div>
        <CodeBlock>{`// option format
{
  id: "opt-1",
  name: "Refactor in phases",
  description: "Break into smaller refactorings...",
  matchScore: 85,  // 0-100 based on preferences
  pros: ["Lower risk", "Can ship between phases"],
  cons: ["Takes longer", "More coordination"],
  effort: "medium",
  risk: "low"
}`}</CodeBlock>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Guided Flow: Round 3 (Plan)</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          AI creates an execution plan for the selected option. The plan includes a
          summary, tasks, subtasks, phases, priorities, and dependencies.
        </p>
        <div className="bg-card rounded-md p-3 text-xs text-foreground/60 space-y-1 mb-3">
          <div>Tasks array with id, title, description, subtasks, assignee, priority, phase</div>
          <div>Dependencies between tasks (DAG)</div>
          <div>Approve to create epic + subtasks in the native task store</div>
        </div>
        <CodeBlock>{`// plan format
{
  tasks: [
    {
      id: "extract-user-service",
      title: "Extract user service",
      description: "Move user logic to separate module",
      subtasks: ["Move user queries", "Add tests"],
      assignee: "marco",
      priority: 2,
      phase: 1
    },
    {
      id: "migrate-database-calls",
      title: "Migrate database calls",
      description: "Update all DB calls to use service",
      subtasks: ["Replace direct imports", "Run integration tests"],
      assignee: "marco",
      priority: 2,
      phase: 2
    }
  ],
  dependencies: [
    { from: "migrate-database-calls", to: "extract-user-service" }
  ]
}`}</CodeBlock>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Research Phase</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Before generating options, AI can research the problem. Research runs as a
          background job and gathers context, constraints, and references.
        </p>
        <div className="bg-card rounded-md p-3 text-xs text-foreground/60 space-y-1">
          <div>Trigger: click &quot;Research&quot; button</div>
          <div>Output: context object with problem analysis</div>
          <div>Used to generate better options and plans</div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Resolution and Task Creation</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          When you approve a decision (with or without a plan), tasks are created:
        </p>
        <div className="bg-card rounded-md p-3 text-xs text-foreground/60 space-y-1">
          <div>With plan: creates epic + subtasks with dependencies</div>
          <div>Without plan: creates single task from description</div>
          <div>Tasks link back to decision via metadata</div>
          <div>Decision status changes to &quot;approved&quot;</div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Retrospective</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          After completing tasks, run a retrospective to capture lessons learned.
          The AI summarizes what happened and what to improve next time.
        </p>
        <div className="bg-card rounded-md p-3 text-xs text-foreground/60 space-y-1">
          <div>Trigger: click &quot;Retrospective&quot; on completed decision</div>
          <div>Output: summary, outcome, lessons learned</div>
          <div>Decision status changes to &quot;done&quot;</div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Decision Fields</h2>
        <div className="bg-card rounded-md p-3">
          <div className="space-y-2 text-xs text-foreground/60">
            <div><code className="text-foreground/70">id</code> - unique UUID</div>
            <div><code className="text-foreground/70">status</code> - lifecycle state</div>
            <div><code className="text-foreground/70">prompt</code> - the decision prompt</div>
            <div><code className="text-foreground/70">title</code> - short summary</div>
            <div><code className="text-foreground/70">priority</code> - urgency level</div>
            <div><code className="text-foreground/70">category</code> - tech, product, hiring, etc.</div>
            <div><code className="text-foreground/70">context</code> - problem, constraints, references</div>
            <div><code className="text-foreground/70">options</code> - generated options with pros/cons</div>
            <div><code className="text-foreground/70">recommendation</code> - AI&apos;s choice with rationale</div>
            <div><code className="text-foreground/70">resolution</code> - your choice and notes</div>
            <div><code className="text-foreground/70">guidedFlow</code> - 3-round state (currentRound, answers, plan)</div>
            <div><code className="text-foreground/70">mode</code> - &quot;classic&quot; or &quot;guided&quot;</div>
            <div><code className="text-foreground/70">activeJobId</code> - research/generation job</div>
          </div>
        </div>
      </section>
      </div>
    </div>
  );
}
