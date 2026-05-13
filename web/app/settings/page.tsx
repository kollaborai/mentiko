"use client";

import Link from "next/link";
import {
  UserFilled,
  ColorSwatchFilled,
  NotificationFilled,
  ExportFilled,
  LockFilled,
  SecurityFilled,
  KeyFilled,
  BotMessageSquare,
  MagicStarFilled,
  BoxFilled,
  CommandSquareFilled,
  Setting2Filled,
  SmsFilled,
  ShieldTickFilled,
  PeopleFilled,
  CloudConnectionFilled,
} from "@aliimam/icons";
import { PageBanner } from "@/components/ui/page-banner";

const SETTINGS_GROUPS = [
  {
    label: "Profile",
    items: [
      { id: "account", label: "Account", description: "Profile, email, account deletion", href: "/settings/account", icon: UserFilled, watermarkColor: "#5b9ef5" },
      { id: "appearance", label: "Appearance", description: "Theme, accent color, font size, behavior", href: "/settings/appearance", icon: ColorSwatchFilled, watermarkColor: "#f59e0b" },
      { id: "notifications", label: "Notifications", description: "Email and in-app notification preferences", href: "/settings/notifications", icon: NotificationFilled, watermarkColor: "#f59e0b" },
    ],
  },
  {
    label: "Security & Access",
    items: [
      { id: "security", label: "Security", description: "Password, 2FA, and account protection", href: "/settings/security", icon: LockFilled, watermarkColor: "#a0927b" },
      { id: "sessions", label: "Sessions", description: "Active sessions and device management", href: "/settings/sessions", icon: SecurityFilled, watermarkColor: "#a0927b" },
      { id: "ssh-keys", label: "SSH Keys", description: "Public keys for direct terminal access", href: "/settings/ssh-keys", icon: KeyFilled, watermarkColor: "#a0927b" },
      { id: "secrets", label: "Secrets", description: "Encrypted env var secrets for agents", href: "/settings/secrets", icon: ShieldTickFilled, watermarkColor: "#a0927b" },
    ],
  },
  {
    label: "Developer",
    items: [
      { id: "agent-configs", label: "Agent Configs", description: "CLI execution profiles for agents", href: "/settings/agent-configs", icon: BotMessageSquare, watermarkColor: "#b07ee8" },
      { id: "mcp", label: "MCP", description: "Model Context Protocol setup and client integration", href: "/settings/mcp", icon: CloudConnectionFilled, watermarkColor: "#5cb88a" },
      { id: "generation", label: "Generation", description: "Prompt templates for AI chain generation", href: "/settings/generation", icon: MagicStarFilled, watermarkColor: "#f59e0b" },
      { id: "artifacts", label: "Artifacts", description: "Artifact output templates", href: "/settings/artifacts", icon: BoxFilled, watermarkColor: "#b07ee8" },
    ],
  },
  {
    label: "Workspace",
    items: [
      { id: "email", label: "Email", description: "Inbound email routing configuration", href: "/settings/email", icon: SmsFilled, watermarkColor: "#5b9ef5" },
      { id: "data", label: "Data & Privacy", description: "Export, retention, and account data", href: "/settings/data", icon: ExportFilled, watermarkColor: "#5cb88a" },
      { id: "organization", label: "Organization", description: "Team members, roles, and invites", href: "/settings/organization", icon: PeopleFilled, watermarkColor: "#b07ee8" },
    ],
  },
  {
    label: "System",
    items: [
      { id: "system", label: "System", description: "System configuration and diagnostics", href: "/settings/system", icon: Setting2Filled, watermarkColor: "#f59e0b" },
      { id: "pty", label: "PTY Sessions", description: "Active PTY session management", href: "/settings/pty", icon: CommandSquareFilled, watermarkColor: "#5b9ef5" },
    ],
  },
];

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
          {SETTINGS_GROUPS.map((group) => (
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
                        style={{ color: section.watermarkColor, opacity: 0.1 }}
                      >
                        <WatermarkIcon className="h-48 w-48" />
                      </div>

                      <div className="relative z-10">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <h3 className="text-sm font-bold tracking-tight">{section.label}</h3>
                        </div>

                        <p className="text-xs text-muted-foreground leading-relaxed">
                          {section.description}
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
