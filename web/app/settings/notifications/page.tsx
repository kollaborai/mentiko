"use client";

import { NotificationPreferencesPanel } from "@/components/settings/notification-preferences-panel";
import { NotificationFilled, SmsFilled, ColorSwatchFilled } from "@aliimam/icons";
import { PageBanner } from "@/components/ui/page-banner";

export default function NotificationSettingsPage() {
  return (
    <div className="flex-1 overflow-auto">
      <PageBanner
        title="Notifications"
        subtitle="Configure email and in-app notification preferences. Control which events trigger alerts."
        icon={NotificationFilled}
        sectionColor="#a0927b"
        actions={[
          { label: "Email", href: "/settings/email", icon: SmsFilled, iconColor: "#a0927b" },
          { label: "Appearance", href: "/settings/appearance", icon: ColorSwatchFilled, iconColor: "#a0927b" },
        ]}
      />
      <div className="px-4 py-3 max-w-4xl mx-auto">
        <NotificationPreferencesPanel />
      </div>
    </div>
  );
}
