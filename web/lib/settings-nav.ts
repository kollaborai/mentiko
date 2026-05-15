import type { ComponentType, SVGProps } from "react";
import {
  CategoryFilled, UserFilled, ColorSwatchFilled, Element3Filled, NotificationFilled,
  LockFilled, SecurityFilled, ShieldTickFilled, BotMessageSquare, SmsFilled,
  ExportFilled, PeopleFilled, Setting2Filled, DocumentTextFilled, CommandSquareFilled,
  ChartFilled, ActivityFilled, TrendUpFilled, KeyFilled,
  MagicStarFilled,
} from "@aliimam/icons";

type SettingsIcon = ComponentType<SVGProps<SVGSVGElement>>;

export interface SettingsNavItem {
  id: string;
  label: string;
  href: string;
  icon: SettingsIcon;
  inSidebar: boolean;
  inQuickMenu: boolean;
}

export interface SettingsNavGroup {
  label: string;
  items: SettingsNavItem[];
}

export const SETTINGS_NAV_GROUPS: SettingsNavGroup[] = [
  {
    label: "profile",
    items: [
      { id: "dashboard", label: "Overview", href: "/settings", icon: CategoryFilled, inSidebar: true, inQuickMenu: false },
      { id: "account", label: "Account", href: "/settings/account", icon: UserFilled, inSidebar: true, inQuickMenu: true },
      { id: "appearance", label: "Appearance", href: "/settings/appearance", icon: ColorSwatchFilled, inSidebar: true, inQuickMenu: true },
      { id: "pill-nav", label: "Navigation Bar", href: "/settings/pill-nav", icon: Element3Filled, inSidebar: true, inQuickMenu: true },
      { id: "notifications", label: "Notifications", href: "/settings/notifications", icon: NotificationFilled, inSidebar: true, inQuickMenu: true },
    ],
  },
  {
    label: "access",
    items: [
      { id: "security", label: "Security", href: "/settings/security", icon: LockFilled, inSidebar: true, inQuickMenu: true },
      { id: "sessions", label: "Sessions", href: "/settings/sessions", icon: SecurityFilled, inSidebar: true, inQuickMenu: true },
      { id: "ssh-keys", label: "SSH Keys", href: "/settings/ssh-keys", icon: KeyFilled, inSidebar: true, inQuickMenu: false },
      { id: "secrets", label: "Secrets", href: "/settings/secrets", icon: ShieldTickFilled, inSidebar: true, inQuickMenu: true },
    ],
  },
  {
    label: "workspace",
    items: [
      { id: "agent-configs", label: "Agent Configs", href: "/settings/agent-configs", icon: BotMessageSquare, inSidebar: true, inQuickMenu: true },
      { id: "mentiko-agent", label: "Mentiko Agent", href: "/settings/mentiko-agent", icon: MagicStarFilled, inSidebar: true, inQuickMenu: true },
      { id: "email", label: "Email", href: "/settings/email", icon: SmsFilled, inSidebar: true, inQuickMenu: true },
    ],
  },
  {
    label: "organization",
    items: [
      { id: "data", label: "Data", href: "/settings/data", icon: ExportFilled, inSidebar: true, inQuickMenu: true },
      { id: "organization", label: "Organization", href: "/settings/organization", icon: PeopleFilled, inSidebar: true, inQuickMenu: true },
    ],
  },
  {
    label: "system",
    items: [
      { id: "system", label: "System", href: "/settings/system", icon: Setting2Filled, inSidebar: true, inQuickMenu: true },
      { id: "logs", label: "Logs", href: "/settings/logs", icon: DocumentTextFilled, inSidebar: true, inQuickMenu: true },
      { id: "audit", label: "Audit Trail", href: "/settings/audit", icon: ShieldTickFilled, inSidebar: true, inQuickMenu: false },
      { id: "pty", label: "PTY Sessions", href: "/settings/pty", icon: CommandSquareFilled, inSidebar: true, inQuickMenu: true },
      { id: "metrics", label: "Metrics", href: "/settings/metrics", icon: ChartFilled, inSidebar: true, inQuickMenu: true },
      { id: "agent-health", label: "Agent Health", href: "/settings/agent-health", icon: ActivityFilled, inSidebar: true, inQuickMenu: true },
      { id: "performance", label: "Performance", href: "/settings/performance", icon: TrendUpFilled, inSidebar: true, inQuickMenu: true },
    ],
  },
];

export const SETTINGS_SIDEBAR_GROUPS = SETTINGS_NAV_GROUPS
  .map((group) => ({
    ...group,
    items: group.items.filter((item) => item.inSidebar),
  }))
  .filter((group) => group.items.length > 0);

export const SETTINGS_QUICK_MENU_GROUPS = SETTINGS_NAV_GROUPS
  .map((group) => ({
    ...group,
    items: group.items.filter((item) => item.inQuickMenu),
  }))
  .filter((group) => group.items.length > 0);
