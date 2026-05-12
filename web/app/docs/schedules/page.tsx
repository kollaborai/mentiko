"use client";

import { PageBanner } from "@/components/ui/page-banner";
import { ClockFilled, LinkFilled, RouteSquareFilled } from "@aliimam/icons";

const CodeBlock = ({ children }: { children: string }) => (
  <pre className="bg-muted rounded-md p-3 font-mono text-[11px] text-foreground/70 whitespace-pre overflow-x-auto mb-4">
    {children}
  </pre>
);

export default function SchedulesDocPage() {
  return (
    <div>
      <PageBanner
        title="Schedules"
        subtitle="Cron-based triggers for chains. Chains run automatically on the schedule, in the specified workspace, with snooze/unsnooze control."
        icon={ClockFilled}
        sectionColor="#f59e0b"
        actions={[
          { label: "Schedules", href: "/schedules", icon: ClockFilled, iconColor: "#5b9ef5" },
          { label: "Chains", href: "/chains", icon: LinkFilled, iconColor: "#b07ee8" },
          { label: "Runs", href: "/runs", icon: RouteSquareFilled, iconColor: "#5b9ef5" },
        ]}
      />
      <div className="px-6 pb-6 max-w-3xl">

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Schedule Format</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Schedules use standard 5-field cron syntax:
        </p>
        <CodeBlock>{`{
  "id": "daily-backup",
  "name": "Daily Backup",
  "chainId": "backup-chain",
  "chainName": "Backup Chain",
  "cron": "0 2 * * *",
  "timezone": "America/Los_Angeles",
  "enabled": true,
  "status": "active",
  "retryCount": 0,
  "runCount": 0,
  "snoozedUntil": null,
  "lastRun": null,
  "nextRun": "2026-03-17T02:00:00Z"
}

// cron fields: minute hour day-of-month month day-of-week
// examples:
"*/5 * * * *"      // every 5 minutes
"0 */2 * * *"      // every 2 hours
"0 9 * * 1-5"      // 9 AM weekdays
"0 0 1 * *"        // midnight on first of month`}</CodeBlock>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Schedule CRUD</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Manage schedules via UI or API:
        </p>
        <div className="bg-card rounded-md p-3 text-xs text-foreground/60 space-y-1 mb-3">
          <div><span className="text-foreground/70">Create</span> - set name, cron, timezone, chain, workspace</div>
          <div><span className="text-foreground/70">Update</span> - modify any field except id (id in request body)</div>
          <div><span className="text-foreground/70">Delete</span> - remove schedule permanently</div>
          <div><span className="text-foreground/70">Toggle</span> - enable/disable without deleting</div>
        </div>
        <CodeBlock>{`// API endpoints
GET    /api/schedules                              # list schedules
POST   /api/schedules                              # create schedule (body includes cron)
PATCH  /api/schedules                              # update schedule (id in body)
PUT    /api/schedules                              # toggle enabled (id in body)
DELETE /api/schedules?id={id}&action=delete        # delete schedule
DELETE /api/schedules?id={id}&action=snooze&duration={ms}  # snooze
DELETE /api/schedules?id={id}&action=unsnooze      # clear snooze

// trigger now (immediate one-off run)
POST   /api/schedules   { "chainId": "..." }       # no cron = trigger now`}</CodeBlock>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Snooze and Unsnooze</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Temporarily disable a schedule without deleting it. Snoozed schedules
          don&apos;t fire until the snooze expires or is cleared.
        </p>
        <div className="bg-card rounded-md p-3 text-xs text-foreground/60 space-y-1">
          <div>Snooze: sets snoozedUntil, stored as <code className="text-foreground/70">SCHEDULES_DIR/{"{scheduleId}"}/.snooze</code></div>
          <div>Unsnooze: removes .snooze file, re-enables firing</div>
          <div>Snooze auto-expires when snoozedUntil is in the past</div>
          <div>UI shows snooze status with visual indicator</div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Background Worker</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          The scheduler now runs inside the standalone background worker.
          The worker owns the scheduler and reconciler loops and checks schedules every minute.
        </p>
        <div className="bg-card rounded-md p-3 text-xs text-foreground/60 space-y-1 mb-3">
          <div>Standalone process: started and stopped via the daemon API</div>
          <div>Owns both the scheduler and the run reconciler</div>
          <div>Fires on boot: runs all due schedules on startup</div>
          <div>Interval: checks every 60 seconds</div>
        </div>
        <CodeBlock>{`// scheduler behavior
1. On boot: load all enabled schedules
2. Each minute: check if any schedule is due
3. Due schedule: spawn chain-runner job
4. Update lastRunAt timestamp
5. Continue to next interval`}</CodeBlock>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Timezone Handling</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Schedules respect the specified timezone. Cron expressions are evaluated
          in the schedule&apos;s timezone, not the server timezone.
        </p>
        <div className="bg-card rounded-md p-3 text-xs text-foreground/60 space-y-1">
          <div>Default: user&apos;s profile timezone</div>
          <div>IANA format: America/Los_Angeles, Europe/London, etc.</div>
          <div>DST transitions handled automatically</div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Workspace and Task Binding</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Schedules can target a specific workspace path and optionally bind to a task:
        </p>
        <div className="bg-card rounded-md p-3 text-xs text-foreground/60 space-y-1 mb-3">
          <div><code className="text-foreground/70">workspacePath</code> - the workspace the chain runs in when triggered</div>
          <div><code className="text-foreground/70">taskBinding</code> - optional task ID to associate runs with a tracked task</div>
        </div>
        <p className="text-xs text-foreground/60 leading-relaxed">
          All schedules for an org are stored in a single file per org. The
          workspacePath field controls which workspace context the chain receives.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Schedule Storage</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          All schedules for an org are stored in a single JSON file:
        </p>
        <CodeBlock>{`// default org (org ID = "default")
namespaces/{id}/schedules.json

// explicit org
namespaces/{id}/orgs/{orgId}/schedules.json

// snooze state (per-schedule, under SCHEDULES_DIR)
{SCHEDULES_DIR}/{scheduleId}/.snooze`}</CodeBlock>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Optional Fields</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Additional schedule configuration options:
        </p>
        <div className="bg-card rounded-md p-3 text-xs text-foreground/60 space-y-1">
          <div><code className="text-foreground/70">goal</code> - optional prompt text injected as the chain goal at runtime</div>
          <div><code className="text-foreground/70">description</code> - human-readable description of what the schedule does</div>
          <div><code className="text-foreground/70">retryCount</code> - number of retries on failure (0–3, default 0)</div>
          <div><code className="text-foreground/70">taskBinding</code> - task ID to associate triggered runs with a tracked task</div>
          <div><code className="text-foreground/70">workspacePath</code> - workspace path the chain runs in</div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Run Tracking</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Each scheduled execution creates a run linked to the schedule. View
          schedule history via the linked runs.
        </p>
        <div className="bg-card rounded-md p-3 text-xs text-foreground/60 space-y-1">
          <div>Run metadata includes scheduleId reference</div>
          <div>Filter runs by schedule in the activity view</div>
        </div>
      </section>
      </div>
    </div>
  );
}
