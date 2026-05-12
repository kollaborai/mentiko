"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useNamespaceFetch } from "@/lib/use-namespace-fetch";
import { SmsFilled as Mail, TrashFilled as Trash2, AddFilled as Plus, Star1Filled as Crown, ClockFilled as Clock, CloseCircleFilled as X, SearchNormalFilled as Search } from "@aliimam/icons";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AgentAvatar } from "@/components/agent/agent-avatar";
import { OrgInviteDialog } from "./org-invite-dialog";
import type { OrgMember } from "@/lib/org-types";

interface OrgMembersPanelProps {
  orgId: string;
  members: OrgMember[];
  onMembersChange?: () => void;
}

interface PendingInvite {
  id: string;
  email: string;
  role: string;
  status: string;
  createdAt: string;
  expiresAt: string;
}

type Role = "owner" | "admin" | "member" | "guest";

const roleColors: Record<Role, string> = {
  owner: "bg-amber-500/15 text-amber-400",
  admin: "bg-purple-500/15 text-purple-400",
  member: "bg-cyan-500/15 text-cyan-400",
  guest: "bg-muted text-muted-foreground",
};

function MemberListItem({
  member,
  selected,
  onClick,
}: {
  member: OrgMember;
  selected: boolean;
  onClick: () => void;
}) {
  const role = member.role as Role;
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 rounded-md px-2.5 py-2 text-left transition-colors ${
        selected ? "bg-accent" : "bg-muted hover:bg-accent"
      }`}
    >
      <AgentAvatar seed={member.email} size={28} className="rounded-sm" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-xs font-medium">{member.email}</span>
          {member.role === "owner" && (
            <Crown className="h-3 w-3 text-amber-400 shrink-0" />
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          <span className="text-[10px] text-foreground/40 font-mono">
            {member.userId.slice(0, 8)}
          </span>
          <span className="text-[10px] text-foreground/30">
            {new Date(member.joinedAt).toLocaleDateString()}
          </span>
        </div>
      </div>
      <Badge className={`h-5 shrink-0 px-2 text-[10px] ${roleColors[role]}`}>
        {role}
      </Badge>
    </button>
  );
}

function MemberDetail({
  member,
  onUpdateRole,
  onRemove,
  updating,
}: {
  member: OrgMember;
  onUpdateRole: (role: string) => void;
  onRemove: () => void;
  updating: boolean;
}) {
  const role = member.role as Role;
  const isOwner = role === "owner";

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3 rounded-md bg-background border border-border/40 p-3">
        <AgentAvatar seed={member.email} size={40} className="rounded-md" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold">{member.email}</h3>
          <p className="mt-1 font-mono text-[10px] text-foreground/35">
            {member.userId}
          </p>
        </div>
        {isOwner && (
          <div className="flex shrink-0 items-center gap-1 rounded-full bg-amber-500/10 px-2 py-1 text-[10px] text-amber-400">
            <Crown className="h-3 w-3" />
            <span>owner</span>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="divide-y divide-foreground/5 rounded-md bg-background border border-border/40 text-xs">
          <div className="flex justify-between gap-3 px-3 py-2">
            <span className="text-foreground/50">user id</span>
            <span className="truncate font-mono text-foreground/70">{member.userId}</span>
          </div>
          <div className="flex justify-between gap-3 px-3 py-2">
            <span className="text-foreground/50">joined</span>
            <span>{new Date(member.joinedAt).toLocaleDateString()}</span>
          </div>
        </div>

        {!isOwner && (
          <div className="space-y-2">
            <label className="text-xs text-foreground/50">role</label>
            <Select
              value={role}
              onValueChange={onUpdateRole}
              disabled={updating}
            >
              <SelectTrigger className="w-full bg-muted">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">admin</SelectItem>
                <SelectItem value="member">member</SelectItem>
                <SelectItem value="guest">guest</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {!isOwner && (
          <Button
            variant="outline"
            size="sm"
            onClick={onRemove}
            disabled={updating}
            className="h-8 w-full text-destructive hover:text-destructive"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            remove member
          </Button>
        )}
      </div>
    </div>
  );
}

function PendingInviteItem({
  invite,
  onCancel,
}: {
  invite: PendingInvite;
  onCancel: () => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-muted px-2.5 py-2">
      <Mail className="h-4 w-4 text-foreground/30 shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="block truncate text-xs text-foreground/60">
          {invite.email}
        </span>
        <span className="text-[10px] text-foreground/30">
          expires {new Date(invite.expiresAt).toLocaleDateString()}
        </span>
      </div>
      <Badge className="h-5 shrink-0 bg-amber-500/10 px-2 text-[10px] text-amber-400">
        {invite.role}
      </Badge>
      <button
        onClick={onCancel}
        className="text-foreground/30 hover:text-red-400 transition-colors shrink-0"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function OrgMembersPanel({ orgId, members, onMembersChange }: OrgMembersPanelProps) {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(
    members[0]?.userId ?? null
  );
  const [updating, setUpdating] = useState<string | null>(null);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  const filteredMembers = useMemo(() => {
    if (!searchQuery) return members;
    const q = searchQuery.toLowerCase();
    return members.filter((m) =>
      m.email.toLowerCase().includes(q) ||
      m.userId.toLowerCase().includes(q)
    );
  }, [members, searchQuery]);

  const selectedMember = members.find((m) => m.userId === selectedMemberId);

  const loadInvites = useCallback(async () => {
    try {
      const res = await fetchWithNamespace(`/api/orgs/${orgId}/invites`);
      if (res.ok) {
        const data = await res.json();
        setInvites(
          (data.invites || []).filter((i: PendingInvite) => i.status === "pending")
        );
      }
    } catch {
      setInvites([]);
    }
  }, [orgId, fetchWithNamespace]);

  useEffect(() => {
    loadInvites();
  }, [loadInvites]);

  useEffect(() => {
    if (members.length > 0 && !selectedMemberId) {
      setSelectedMemberId(members[0].userId);
    }
  }, [members, selectedMemberId]);

  const handleCancelInvite = async (inviteId: string) => {
    try {
      const res = await fetchWithNamespace(`/api/orgs/${orgId}/invites/${inviteId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        loadInvites();
      }
    } catch {
      // ignore
    }
  };

  const handleRoleChange = async (userId: string, newRole: string) => {
    setUpdating(userId);
    try {
      const res = await fetchWithNamespace(`/api/orgs/${orgId}/members/${userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      });
      if (res.ok) {
        onMembersChange?.();
      }
    } catch (e) {
      console.error("failed to update role:", e);
    } finally {
      setUpdating(null);
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!confirm("Remove this member from the organization?")) return;

    setUpdating(userId);
    try {
      const res = await fetchWithNamespace(`/api/orgs/${orgId}/members/${userId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        onMembersChange?.();
      }
    } catch (e) {
      console.error("failed to remove member:", e);
    } finally {
      setUpdating(null);
    }
  };

  return (
    <div className="grid gap-3 lg:grid-cols-[360px_1fr]">
      <div className="flex min-h-0 flex-col gap-2 rounded-md border border-border/40 bg-background p-3">
        <div className="flex items-center justify-between">
          <h3 className="px-1 text-xs font-medium text-foreground">
            members ({members.length})
          </h3>
          <OrgInviteDialog
            orgId={orgId}
            onInviteSent={() => { onMembersChange?.(); loadInvites(); }}
            trigger={
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs">
                <Plus className="h-3 w-3 mr-1" />
                Invite
              </Button>
            }
          />
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground/30" />
          <Input
            placeholder="search members..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-8 text-xs bg-muted"
          />
        </div>

        <div className="max-h-[360px] flex-1 overflow-y-auto space-y-1 pr-1">
          {filteredMembers.map((member) => (
            <MemberListItem
              key={member.userId}
              member={member}
              selected={selectedMemberId === member.userId}
              onClick={() => setSelectedMemberId(member.userId)}
            />
          ))}

          {filteredMembers.length === 0 && (
            <div className="text-center py-8 text-foreground/40 text-xs">
              {searchQuery ? "no members match" : "no members yet"}
            </div>
          )}
        </div>

        {invites.length > 0 && (
          <div className="border-t border-border/40 pt-2">
            <h3 className="text-xs font-medium text-foreground/50 mb-2 flex items-center gap-1.5">
              <Clock className="h-3 w-3" />
              pending ({invites.length})
            </h3>
            <div className="max-h-28 space-y-1 overflow-y-auto">
              {invites.map((invite) => (
                <PendingInviteItem
                  key={invite.id}
                  invite={invite}
                  onCancel={() => handleCancelInvite(invite.id)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="min-h-0 overflow-y-auto rounded-md border border-border/40 bg-muted p-3">
        {selectedMember ? (
          <MemberDetail
            member={selectedMember}
            onUpdateRole={(role) => handleRoleChange(selectedMember.userId, role)}
            onRemove={() => handleRemoveMember(selectedMember.userId)}
            updating={updating === selectedMember.userId}
          />
        ) : (
          <div className="h-full flex items-center justify-center text-foreground/40 text-sm">
            select a member to view details
          </div>
        )}
      </div>
    </div>
  );
}
