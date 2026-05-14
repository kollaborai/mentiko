"use client";

import { useState, useEffect } from "react";
import { useNamespaceFetch } from "@/lib/use-namespace-fetch";
import { useParams, useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { OrgMembersPanel } from "@/components/org/org-members-panel";
import { OrgSettingsPanel } from "@/components/org/org-settings-panel";
import { WaveSpinner } from "@/components/ui/wave-spinner";
import { PageBanner } from "@/components/ui/page-banner";
import {
  ArrowLeftFilled,
  BuildingFilled,
  LinkFilled,
  PeopleFilled,
  SettingsFilled,
  TaskSquareFilled,
  TrendUpFilled,
  RouteSquareFilled,
} from "@aliimam/icons";
import type { OrgMember } from "@/lib/org-types";

type OrgTab = "overview" | "members" | "settings";

interface Org {
  id: string;
  name: string;
  slug: string;
  settings?: {
    allowMemberInvite?: boolean;
    requireApproval?: boolean;
  };
  createdAt: string;
  updatedAt: string;
}

interface Stats {
  chainCount: number;
  memberCount: number;
  taskCount: number;
  runCount: number;
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md bg-muted px-3 py-2">
      <div className="flex items-center gap-2 text-xs text-foreground/50">
        <Icon className="h-3.5 w-3.5" />
        <span>{label}</span>
      </div>
      <p className="text-sm font-semibold">{value}</p>
    </div>
  );
}

export default function OrgDetailPage() {
  const params = useParams();
  const router = useRouter();
  const pathname = usePathname();
  const orgId = params.id as string;
  const listPath = pathname.startsWith("/settings/organization") ? "/settings/organization" : "/orgs";

  const { fetchWithNamespace } = useNamespaceFetch();
  const [org, setOrg] = useState<Org | null>(null);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [stats, setStats] = useState<Stats>({
    chainCount: 0,
    memberCount: 0,
    taskCount: 0,
    runCount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<OrgTab>("overview");
  const memberCount = members.length || stats.memberCount;

  const refreshMembers = () => {
    fetchWithNamespace(`/api/orgs/${orgId}/members`)
      .then((res) => res.json())
      .then((data) => setMembers(data.members || []))
      .catch(() => setMembers([]));
  };

  useEffect(() => {
    const fetchOrg = async () => {
      try {
        const res = await fetchWithNamespace(`/api/orgs/${orgId}`);
        if (res.ok) {
          const data = await res.json();
          setOrg(data.org);
        }
      } catch {
      } finally {
        setLoading(false);
      }
    };

    const fetchStats = async () => {
      try {
        const res = await fetchWithNamespace(`/api/orgs/${orgId}/stats`);
        if (res.ok) {
          const data = await res.json();
          setStats(data.stats || { chainCount: 0, memberCount: 0, taskCount: 0, runCount: 0 });
        }
      } catch {
      }
    };

    const fetchMembers = async () => {
      try {
        const res = await fetchWithNamespace(`/api/orgs/${orgId}/members`);
        if (res.ok) {
          const data = await res.json();
          setMembers(data.members || []);
        }
      } catch {
        setMembers([]);
      }
    };

    fetchOrg();
    fetchStats();
    fetchMembers();
  }, [orgId, fetchWithNamespace]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <WaveSpinner size="md" color="primary" animation="ripple" />
      </div>
    );
  }

  if (!org) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-24">
        <p className="text-foreground/50 text-sm">organization not found</p>
        <Link href="/dashboard">
          <Button size="sm" variant="outline">
            <ArrowLeftFilled className="h-4 w-4 mr-1" />
            back to dashboard
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div>
      <PageBanner
        title={org.name}
        subtitle={`Namespace ${org.slug}`}
        icon={BuildingFilled}
        sectionColor="#f59e0b"
        actions={[
          { label: "Organizations", href: listPath, icon: ArrowLeftFilled, iconColor: "#f59e0b" },
        ]}
      />

      {/* main content */}
      <main className="max-w-5xl mx-auto px-4 py-3">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as OrgTab)}>
          <TabsList className="mb-3 h-8 rounded-md bg-muted">
            <TabsTrigger value="overview" className="h-7 gap-1.5 text-xs">
              <TrendUpFilled className="h-3.5 w-3.5" />
              overview
            </TabsTrigger>
            <TabsTrigger value="members" className="h-7 gap-1.5 text-xs">
              <PeopleFilled className="h-3.5 w-3.5" />
              members
              <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                {memberCount}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="settings" className="h-7 gap-1.5 text-xs">
              <SettingsFilled className="h-3.5 w-3.5" />
              settings
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-0">
            <div className="grid gap-3 lg:grid-cols-[280px_1fr]">
              {/* stats grid */}
              <div className="space-y-2">
                <StatCard icon={LinkFilled} label="chains" value={stats.chainCount} />
                <StatCard icon={PeopleFilled} label="members" value={memberCount} />
                <StatCard icon={TaskSquareFilled} label="tasks" value={stats.taskCount} />
                <StatCard icon={RouteSquareFilled} label="runs" value={stats.runCount} />
              </div>

              {/* org info */}
              <section className="rounded-md bg-card p-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-medium">organization info</h3>
                  <span className="rounded-full bg-foreground/5 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-foreground/40">
                    active
                  </span>
                </div>
                <div className="divide-y divide-foreground/5 rounded-md bg-muted text-sm">
                  <div className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="text-foreground/50">org id</span>
                    <span className="truncate font-mono text-foreground/70">{org.id}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="text-foreground/50">slug</span>
                    <span className="truncate font-mono text-foreground/70">{org.slug}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="text-foreground/50">created</span>
                    <span>{new Date(org.createdAt).toLocaleDateString()}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="text-foreground/50">last updated</span>
                    <span>{new Date(org.updatedAt).toLocaleDateString()}</span>
                  </div>
                </div>
              </section>
            </div>
          </TabsContent>

          <TabsContent value="members" className="mt-0">
            <OrgMembersPanel
              orgId={orgId}
              members={members}
              onMembersChange={refreshMembers}
            />
          </TabsContent>

          <TabsContent value="settings" className="mt-0">
            <OrgSettingsPanel
              org={{
                id: org.id,
                name: org.name,
                slug: org.slug,
              }}
              onSave={async (data) => {
                const res = await fetchWithNamespace(`/api/orgs/${orgId}`, {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(data),
                });
                if (!res.ok) {
                  const err = await res.json();
                  throw new Error(err.error || "Failed to save");
                }
                const updated = await res.json();
                setOrg(updated.org);
              }}
              onDelete={async () => {
                const res = await fetchWithNamespace(`/api/orgs/${orgId}`, {
                  method: "DELETE",
                });
                if (!res.ok) {
                  const err = await res.json();
                  throw new Error(err.error || "Failed to delete");
                }
                router.push(listPath);
              }}
            />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
