"use client";

import { HomeFilled, LinkFilled, RouteSquareFilled, MonitorFilled } from "@aliimam/icons";
import { PageBanner } from "@/components/ui/page-banner";
import { useTranslations } from "@/hooks/use-translation";

export function DashboardBanner() {
  const { t } = useTranslations();

  return (
    <PageBanner
      title={t("dashboard.title")}
      subtitle={t("dashboard.tagline")}
      icon={HomeFilled}
      sectionColor="#f59e0b"
      actions={[
        { label: "Chains", href: "/chains", icon: LinkFilled, iconColor: "#b07ee8" },
        { label: "Runs", href: "/runs", icon: RouteSquareFilled, iconColor: "#5b9ef5" },
        { label: "Workspaces", href: "/workspaces", icon: MonitorFilled, iconColor: "#f59e0b" },
      ]}
      docs={[
        { label: "Getting Started", href: "/docs", icon: HomeFilled },
      ]}
    />
  );
}
