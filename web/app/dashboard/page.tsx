import { DashboardStats } from "@/components/dashboard/dashboard-stats";
import { DashboardMode } from "@/components/dashboard/dashboard-mode";
import { DashboardBanner } from "@/components/dashboard/dashboard-banner";
import { ActiveChains } from "@/components/dashboard/active-chains";
import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { QuickActions } from "@/components/dashboard/quick-actions";
import { GettingStarted } from "@/components/dashboard/getting-started";
import { RecentRuns } from "@/components/dashboard/recent-runs";
import { PendingDecisions } from "@/components/dashboard/pending-decisions";
import { RunsChart, TopAgents } from "@/components/dashboard/dashboard-metrics";
import { UpdatesWidget } from "@/components/dashboard/updates-widget";

export default async function DashboardPage() {

  return (
    <div className="max-w-[1800px] mx-auto">
      <DashboardBanner />

      <div className="px-3 md:px-4">
        <DashboardMode />

        <GettingStarted />

        <DashboardStats />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4 mt-3 md:mt-4">
          <UpdatesWidget />
          <TopAgents />
          <RunsChart />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 auto-rows-[minmax(300px,1fr)] gap-3 md:gap-4 mt-3 md:mt-4 pb-4">
          <QuickActions className="md:row-span-2" />
          <RecentRuns />
          <ActivityFeed />
          <PendingDecisions />
          <ActiveChains />
        </div>
      </div>
    </div>
  );
}
