import { DashboardStats } from "@/components/dashboard-stats";
import { DashboardMode } from "@/components/dashboard-mode";
import { DashboardBanner } from "@/components/dashboard-banner";
import { ActiveChains } from "@/components/active-chains";
import { ActivityFeed } from "@/components/activity-feed";
import { QuickActions } from "@/components/quick-actions";
import { GettingStarted } from "@/components/getting-started";
import { RecentRuns } from "@/components/recent-runs";
import { PendingDecisions } from "@/components/pending-decisions";
import { RunsChart, TopAgents } from "@/components/dashboard-metrics";
import { UpdatesWidget } from "@/components/updates-widget";

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
