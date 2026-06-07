"use client";

import { PageBanner } from "@/components/ui/page-banner";
import { NotificationFilled, ClockFilled, RouteSquareFilled } from "@aliimam/icons";

const CodeBlock = ({ children }: { children: string }) => (
  <pre className="bg-muted rounded-md p-3 font-mono text-[11px] text-foreground/70 whitespace-pre overflow-x-auto mb-4">
    {children}
  </pre>
);

export default function NotificationsDocPage() {
  return (
    <div>
      <PageBanner
        title="Notifications"
        subtitle="System notifications keep you informed about chain events, errors, and schedule failures. Notifications persist until marked read or cleared."
        icon={NotificationFilled}
        sectionColor="#f59e0b"
        actions={[
          { label: "Notifications", href: "/notifications", icon: NotificationFilled, iconColor: "#f59e0b" },
          { label: "Runs", href: "/runs", icon: RouteSquareFilled, iconColor: "#5b9ef5" },
          { label: "Schedules", href: "/schedules", icon: ClockFilled, iconColor: "#5b9ef5" },
        ]}
      />
      <div className="px-6 pb-6 max-w-3xl">

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Notification Types</h2>
        <div className="bg-card rounded-md p-3 space-y-2 text-xs text-foreground/60 mb-3">
          <div><code className="text-foreground/70">chain_started</code> - chain run started</div>
          <div><code className="text-foreground/70">chain_complete</code> - chain finished successfully</div>
          <div><code className="text-foreground/70">chain_failed</code> - chain errored or stopped</div>
          <div><code className="text-foreground/70">agent_complete</code> - agent finished successfully</div>
          <div><code className="text-foreground/70">agent_error</code> - agent returned error status</div>
          <div><code className="text-foreground/70">job_started</code>, <code className="text-foreground/70">job_complete</code>, <code className="text-foreground/70">job_failed</code> - background job updates</div>
          <div><code className="text-foreground/70">webhook_delivered</code>, <code className="text-foreground/70">webhook_failed</code> - webhook delivery updates</div>
          <div><code className="text-foreground/70">info</code>, <code className="text-foreground/70">warning</code>, <code className="text-foreground/70">error</code> - general system notices</div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Notification Metadata</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Each notification includes context about the triggering event:
        </p>
        <CodeBlock>{`{
  "id": "notif_123",
  "type": "chain_complete",
  "title": "Chain completed",
  "message": "Deploy pipeline finished successfully",
  "read": false,
  "timestamp": "2026-03-16T10:30:00Z",
  "metadata": {
    "agentId": "writer",
    "chainId": "deploy-pipeline",
    "runId": "run_456",
    "jobId": "job_123",
    "jobType": "task_run_summary",
    "webhookUrl": "https://example.com/hook",
    "httpCode": 200,
    "decisionId": "decision_abc",
    "actionUrl": "/runs/run_456",
    "actionLabel": "Open run",
    "error": "optional error details"
  }
}`}</CodeBlock>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Managing Notifications</h2>
        <div className="bg-card rounded-md p-3 text-xs text-foreground/60 space-y-1">
          <div>Mark read - single notification (click or swipe)</div>
          <div>Mark all read - bulk action in notification center</div>
          <div>Clear all - removes every notification, read or unread</div>
          <div>Retention - newest 200 notifications are kept when new ones are created</div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Push Notifications</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Subscribe to browser push notifications for real-time alerts when
          you&apos;re not actively viewing the app.
        </p>
        <div className="bg-card rounded-md p-3 text-xs text-foreground/60 space-y-1">
          <div>Requires HTTPS or localhost</div>
          <div>Browser permission required on first subscribe</div>
          <div>Filtered by notification type preferences</div>
          <div>Unsubscribe anytime from notification settings</div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Notification Preferences</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Control which events trigger notifications:
        </p>
        <div className="bg-card rounded-md p-3 space-y-1 text-xs text-foreground/60">
          <div>Email notifications for critical failures</div>
          <div>Push notifications for chain completions</div>
          <div>In-app notifications for all events</div>
          <div>Quiet hours - disable non-critical alerts</div>
        </div>
      </section>
      </div>
    </div>
  );
}
