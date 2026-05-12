"use client";

import { ComponentFilled, ShopFilled } from "@aliimam/icons";
import { PageBanner } from "@/components/ui/page-banner";

export default function PluginsMarketplacePage() {
  return (
    <div className="h-full overflow-y-auto">
      <PageBanner
        title="Plugins"
        subtitle="Extend mentiko with integrations, tools, and custom capabilities. Browse community-built plugins to add new powers to your agent workflows."
        icon={ComponentFilled}
        sectionColor="#5cb88a"
        actions={[
          { label: "Marketplace", href: "/marketplace", icon: ShopFilled, iconColor: "#5cb88a" },
        ]}
      />

      <div className="px-4 py-3">
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="p-3 bg-muted rounded-md mb-3">
            <ComponentFilled className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-xs font-medium text-foreground/60 mb-1">Coming soon</p>
          <p className="text-[11px] text-foreground/30 max-w-xs">
            The plugin registry is in development.
          </p>
        </div>
      </div>
    </div>
  );
}
