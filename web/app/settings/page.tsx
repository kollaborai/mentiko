"use client";

import Link from "next/link";
import {
  UserFilled,
  LockFilled,
  Setting2Filled,
} from "@aliimam/icons";
import { PageBanner } from "@/components/ui/page-banner";
import { SETTINGS_SIDEBAR_GROUPS, type SettingsNavItem } from "@/lib/ui/settings-nav";

const SETTINGS_DESCRIPTIONS: Record<string, string> = {
  dashboard: "Top-level settings overview",
  account: "Profile, email, account deletion",
  appearance: "Theme, accent color, font size, behavior",
  "pill-nav": "Floating navigation bar behavior and appearance",
  notifications: "Email and in-app notification preferences",
  security: "Password, 2FA, and account protection",
  sessions: "Active sessions and device management",
  "ssh-keys": "Public keys for direct terminal access",
  secrets: "Encrypted env var secrets for agents",
  "agent-configs": "CLI execution profiles for agents",
  email: "Inbound email routing configuration",
  "mentiko-agent": "AI provider profiles for the Mentiko floating bar",
  decisions: "Core decision chain profiles and restore controls",
  data: "Export, retention, and account data",
  organization: "Team members, roles, and invites",
  system: "System configuration and diagnostics",
  logs: "Runtime logs and diagnostic output",
  audit: "Workspace audit trail and access events",
  pty: "Active PTY session management",
  metrics: "System metrics and telemetry",
  "agent-health": "Agent status and health checks",
  performance: "Runtime performance diagnostics",
};

const SETTINGS_WATERMARK_COLORS: Record<string, string> = {
  profile: "#5b9ef5",
  access: "#a0927b",
  workspace: "#5cb88a",
  developer: "#b07ee8",
  organization: "#b07ee8",
  system: "#f59e0b",
};

function getDescription(section: SettingsNavItem) {
  return SETTINGS_DESCRIPTIONS[section.id] ?? `${section.label} settings`;
}

export default function SettingsDashboard() {
  return (
    <div className="flex-1 overflow-auto">
      <PageBanner
        title="Settings"
        subtitle="Account, preferences, and system configuration. Manage your profile, security, integrations, and platform behavior."
        icon={Setting2Filled}
        sectionColor="#a0927b"
        actions={[
          { label: "Account", href: "/settings/account", icon: UserFilled, iconColor: "#a0927b" },
          { label: "Security", href: "/settings/security", icon: LockFilled, iconColor: "#a0927b" },
        ]}
      />
      <div className="px-4 pb-6 max-w-4xl mx-auto">
        <div className="space-y-6">
          {SETTINGS_SIDEBAR_GROUPS.map((group) => (
            <div key={group.label}>
              <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 px-1">
                {group.label}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {group.items.map((section) => {
                  const WatermarkIcon = section.icon;
                  return (
                    <Link
                      key={section.id}
                      href={section.href}
                      className="relative block bg-background border border-border/40 rounded-xl p-4 group hover:bg-accent transition-colors overflow-hidden"
                    >
                      <div
                        className="absolute -right-6 -bottom-6 pointer-events-none"
                        style={{ color: SETTINGS_WATERMARK_COLORS[group.label] ?? "#a0927b", opacity: 0.1 }}
                      >
                        <WatermarkIcon className="h-48 w-48" />
                      </div>

                      <div className="relative z-10">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <h3 className="text-sm font-bold tracking-tight">{section.label}</h3>
                        </div>

                        <p className="text-xs text-muted-foreground leading-relaxed">
                          {getDescription(section)}
                        </p>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
