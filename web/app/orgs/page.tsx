"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { BuildingFilled, PeopleFilled, AddFilled, ArrowRight1Filled } from "@aliimam/icons";
import { Button } from "@/components/ui/button";
import { PageBanner } from "@/components/ui/page-banner";
import { OrgCreateDialog } from "@/components/org/org-create-dialog";
import {
  WorkflowSidebarItem,
  WorkflowSidebarSectionHeader,
} from "@/components/ui/workflow-sidebar";
import { unwrapApiData, getApiErrorMessage } from "@/lib/api-client";

interface Org {
  id: string;
  name: string;
  slug: string;
  memberCount?: number;
  createdAt: string;
  updatedAt: string;
}

interface OrgsResponse {
  orgs?: Org[];
  org?: Org;
}

async function fetchOrgs(): Promise<Org[]> {
  try {
    const res = await fetch("/api/orgs", { cache: "no-store" });
    if (!res.ok) return [];
    const data = unwrapApiData<OrgsResponse>(await res.json());
    // handle both single org and list response
    return data.orgs || (data.org ? [data.org] : []);
  } catch {
    return [];
  }
}

function formatDate(date: string) {
  return new Date(date).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function OrgListItem({ org, onClick }: { org: Org; onClick: () => void }) {
  return (
    <WorkflowSidebarItem onClick={onClick} accentClassName="bg-foreground/20">
      <div className="pl-4">
        <div className="flex items-start justify-between gap-2 pr-5">
          <span className="line-clamp-2 text-sm font-semibold leading-5">
            {org.name}
          </span>
          <span className="shrink-0 text-[10px] text-foreground/30">
            {formatDate(org.updatedAt || org.createdAt)}
          </span>
        </div>
        <p className="mt-0.5 line-clamp-1 text-[11px] text-foreground/40">
          {org.slug}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-foreground/40">
          <span className="rounded-full bg-foreground/5 px-2 py-0.5 uppercase tracking-[0.14em]">
            namespace
          </span>
          {org.memberCount !== undefined ? (
            <span className="rounded-full bg-foreground/5 px-2 py-0.5">
              {org.memberCount} member{org.memberCount !== 1 ? "s" : ""}
            </span>
          ) : null}
        </div>
      </div>
    </WorkflowSidebarItem>
  );
}

function OrgDetailPreview({ org, onOpen }: { org: Org; onOpen: () => void }) {
  return (
    <section className="min-w-0 flex-1 rounded-md bg-card p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-accent">
            <BuildingFilled className="h-3.5 w-3.5 text-foreground/60" />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">{org.name}</h2>
            <p className="truncate font-mono text-[11px] text-foreground/40">{org.slug}</p>
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={onOpen} className="h-7 px-2">
          <ArrowRight1Filled className="h-4 w-4" />
        </Button>
      </div>

      <div className="mt-3 divide-y divide-foreground/5 rounded-md bg-muted">
        <div className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
          <span className="text-foreground/45">members</span>
          <span className="font-medium">{org.memberCount ?? 1}</span>
        </div>
        <div className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
          <span className="text-foreground/45">namespace</span>
          <span className="truncate font-mono text-foreground/70">{org.id}</span>
        </div>
        <div className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
          <span className="text-foreground/45">created</span>
          <span>{formatDate(org.createdAt)}</span>
        </div>
      </div>
    </section>
  );
}

function EmptyState({ onCreateClick }: { onCreateClick: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4">
      <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-4">
        <BuildingFilled className="h-6 w-6 text-foreground/40" />
      </div>
      <h3 className="text-sm font-medium text-foreground/80 mb-1">
        No organizations yet
      </h3>
      <p className="text-xs text-foreground/40 mb-4 text-center max-w-xs">
        Create your first organization to start collaborating with your team
      </p>
      <Button size="sm" onClick={onCreateClick}>
        <AddFilled className="h-4 w-4 mr-1" />
        Create Organization
      </Button>
    </div>
  );
}

export default function OrgsPage() {
  const router = useRouter();
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  const loadOrgs = async () => {
    setLoading(true);
    const data = await fetchOrgs();
    setOrgs(data);
    setLoading(false);
  };

  useEffect(() => {
    queueMicrotask(() => {
      loadOrgs();
    });
  }, []);

  const handleCreate = async (data: { name: string; slug: string }) => {
    setCreating(true);
    try {
      const res = await fetch("/api/orgs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const raw = await res.json().catch(() => ({}));
        throw new Error(getApiErrorMessage(raw, "Failed to create org"));
      }

      await loadOrgs();
      setDialogOpen(false);
    } finally {
      setCreating(false);
    }
  };

  const handleOrgClick = (org: Org) => {
    router.push(`/orgs/${org.id}`);
  };

  return (
    <div>
      <PageBanner
        title="Organizations"
        subtitle="Create and manage organizations. Each org isolates chains, agents, secrets, and team members."
        icon={PeopleFilled}
        sectionColor="#f59e0b"
        actions={[
          { label: "New Organization", icon: AddFilled, iconColor: "#5b9ef5", onClick: () => setDialogOpen(true) },
        ]}
      />
      <div className="mx-auto max-w-5xl px-4 py-3">

      {loading ? (
        <div className="bg-muted rounded-md p-8 text-center">
          <p className="text-sm text-foreground/40">loading organizations...</p>
        </div>
      ) : orgs.length === 0 ? (
        <EmptyState onCreateClick={() => setDialogOpen(true)} />
      ) : (
        <div className="flex flex-col gap-3 lg:flex-row">
          <aside className="w-full rounded-md bg-muted lg:w-80">
            <div className="space-y-2 p-2">
              <WorkflowSidebarSectionHeader title="organizations" count={orgs.length} />
              {orgs.map((org) => (
                <OrgListItem
                  key={org.id}
                  org={org}
                  onClick={() => handleOrgClick(org)}
                />
              ))}
            </div>
          </aside>
          <OrgDetailPreview
            org={orgs[0]}
            onOpen={() => handleOrgClick(orgs[0])}
          />
        </div>
      )}

      <OrgCreateDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreate={handleCreate}
        creating={creating}
      />
      </div>
    </div>
  );
}
