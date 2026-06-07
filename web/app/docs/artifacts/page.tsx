"use client";

import { PageBanner } from "@/components/ui/page-banner";
import { BoxFilled, RouteSquareFilled, BotMessageSquare } from "@aliimam/icons";

const CodeBlock = ({ children }: { children: string }) => (
  <pre className="bg-muted rounded-md p-3 font-mono text-[11px] text-foreground/70 whitespace-pre overflow-x-auto mb-4">
    {children}
  </pre>
);

export default function ArtifactsDocPage() {
  return (
    <div>
      <PageBanner
        title="Artifacts"
        subtitle="Outputs created by agents during chain execution. Capture code changes, conversations, logs, and custom outputs."
        icon={BoxFilled}
        sectionColor="#f59e0b"
        actions={[
          { label: "Artifacts", href: "/artifacts", icon: BoxFilled, iconColor: "#b07ee8" },
          { label: "Runs", href: "/runs", icon: RouteSquareFilled, iconColor: "#5b9ef5" },
          { label: "Agents", href: "/agents", icon: BotMessageSquare, iconColor: "#b07ee8" },
        ]}
      />
      <div className="px-6 pb-6 max-w-3xl">

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Built-in Artifact Types</h2>
        <div className="bg-card rounded-md p-3 space-y-2 text-xs text-foreground/60 mb-3">
          <div><code className="text-foreground/70">diff.patch</code> - git diff of files changed by agent</div>
          <div><code className="text-foreground/70">files-changed.json</code> - list of modified, added, deleted files</div>
          <div><code className="text-foreground/70">conversations.json</code> - LLM conversation with tool calls</div>
          <div><code className="text-foreground/70">output.txt</code> - raw agent output (captured in full)</div>
          <div><code className="text-foreground/70">events.json</code> - events fired during agent execution</div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Artifact Storage</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Artifacts are stored per-run, per-agent in the artifacts directory:
        </p>
        <CodeBlock>{`namespaces/{id}/[projects/{projectId}/]runs/
  └── run_456/
      └── artifacts/
          ├── builder-diff.patch
          ├── builder-files-changed.json
          ├── builder-conversations.json
          ├── builder-output.txt
          └── builder-events.json`}</CodeBlock>
        <p className="text-xs text-foreground/60 leading-relaxed mt-2">
          Default org/project collapse into namespace root
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Files-Changed Format</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          JSON file listing all filesystem changes using git status codes:
        </p>
        <CodeBlock>{`[
  { "status": "M", "file": "src/app.tsx" },
  { "status": "M", "file": "src/utils.ts" },
  { "status": "A", "file": "src/components/NewFeature.tsx" },
  { "status": "D", "file": "src/legacy/OldCode.ts" }
]`}</CodeBlock>
        <p className="text-xs text-foreground/60 leading-relaxed mt-2">
          Uses git status codes (M=modified, A=added, D=deleted)
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Artifact Templates</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Define custom output formats that agents should generate. Templates
          specify structure and required fields for reproducible outputs.
        </p>
        <CodeBlock>{`{
  "name": "test-report",
  "description": "Standard test execution report",
  "template": {
    "testSuite": "{{SUBJECT}}",
    "passed": {{passed_count}},
    "failed": {{failed_count}},
    "coverage": "{{coverage_percent}}%",
    "failures": [
      {
        "test": "{{test_name}}",
        "error": "{{error_message}}"
      }
    ]
  }
}`}</CodeBlock>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Agent Artifact Declarations</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Agents declare what artifacts they produce and consume:
        </p>
        <CodeBlock>{`{
  "id": "test-runner",
  "name": "Test Runner",
  "artifacts": {
    "produces": [
      { "id": "test-report", "type": "markdown" },
      { "id": "coverage-report", "type": "json" }
    ],
    "consumes": [
      { "id": "source-code", "type": "typescript" }
    ]
  }
}`}</CodeBlock>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Template Editor</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Create and manage artifact templates in settings. Templates can be
          referenced by agents to ensure consistent output formats.
        </p>
        <div className="bg-card rounded-md p-3 text-xs text-foreground/60 space-y-1">
          <div>Define template structure with placeholders</div>
          <div>Validate agent outputs against templates</div>
          <div>Share templates across agents</div>
          <div>Version templates for backward compatibility</div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Retrieving Artifacts</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Access artifacts through the UI or API:
        </p>
        <CodeBlock>{`# UI: run detail panel > agents tab > agent row
# Expands to show all artifacts with download buttons

# API: get all agent artifacts (includes artifact data)
GET /api/runs/{id}/agents/{agentId}/activity`}</CodeBlock>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Output Capture</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          How output files are captured and stored:
        </p>
        <div className="bg-card rounded-md p-3 text-xs text-foreground/60 space-y-1">
          <div>output.txt captured in full</div>
          <div>Summary JSON shows tail-80 for brevity</div>
          <div>Full file available for download</div>
        </div>
      </section>
      </div>
    </div>
  );
}
