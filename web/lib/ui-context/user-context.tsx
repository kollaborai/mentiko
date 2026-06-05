"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import type { OrgRole, OrgAction } from "../orgs/org-types";

export interface User {
  id: string;
  email?: string;
  name?: string;
  avatar?: string;
}

interface UserContextValue {
  user: User | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  hasPermission: (action: OrgAction, resource?: string) => boolean;
  canView: (resource: string) => boolean;
  canEdit: (resource: string) => boolean;
  getRole: () => OrgRole | null;
}

const UserContext = createContext<UserContextValue | undefined>(undefined);

// map resources to actions
const RESOURCE_ACTIONS: Record<string, OrgAction> = {
  chains: "view_chains",
  tasks: "view_tasks",
  conversations: "view_chains",
  templates: "view_chains",
  schedules: "manage_chains",
  settings: "manage_org",
  members: "manage_members",
  profiles: "manage_chains",
};

const EDIT_ACTIONS: Record<string, OrgAction> = {
  chains: "manage_chains",
  tasks: "manage_tasks",
  templates: "manage_chains",
  schedules: "manage_chains",
  profiles: "manage_chains",
};

// default role for single-user setups
const DEFAULT_ROLE: OrgRole = "owner";

// role hierarchy: higher number = more permissions
const ROLE_HIERARCHY: Record<OrgRole, number> = {
  owner: 4,
  admin: 3,
  member: 2,
  guest: 1,
};

// minimum role level required for each action
const ACTION_LEVELS: Record<OrgAction, number> = {
  manage_org: 4,
  manage_members: 3,
  manage_chains: 2,
  manage_tasks: 2,
  view_chains: 1,
  view_tasks: 1,
  view_audit: 3,
  invite_members: 3,
  remove_members: 4,
  transfer_ownership: 4,
  manage_billing: 3,
};

function canRolePerformAction(role: OrgRole, action: OrgAction): boolean {
  const roleLevel = ROLE_HIERARCHY[role] || 0;
  const actionLevel = ACTION_LEVELS[action] || 0;
  return roleLevel >= actionLevel;
}

const DEFAULT_VALUE: UserContextValue = {
  user: null,
  loading: true,
  error: null,
  refresh: async () => {},
  hasPermission: () => true,
  canView: () => true,
  canEdit: () => true,
  getRole: () => "owner",
};

/**
 * Inner provider that uses better-auth hooks.
 * Loaded dynamically after client mount to avoid SSR issues.
 */
function AuthUserProvider({ children }: { children: ReactNode }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [hooks, setHooks] = useState<{ useSession: any; useActiveOrganization: any } | null>(null);

  useEffect(() => {
    import("../auth/auth-client").then((mod) => {
      setHooks({
        useSession: mod.useSession,
        useActiveOrganization: mod.useActiveOrganization,
      });
    });
  }, []);

  if (!hooks) {
    return (
      <UserContext.Provider value={DEFAULT_VALUE}>
        {children}
      </UserContext.Provider>
    );
  }

  return (
    <HookedUserProvider hooks={hooks}>
      {children}
    </HookedUserProvider>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const noopHook = () => ({ data: null, isPending: false, error: null, refetch: async () => {} });

function HookedUserProvider({
  children,
  hooks,
}: {
  children: ReactNode;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  hooks: { useSession: any; useActiveOrganization: any };
}) {
  const { data: session, isPending, error: sessionError, refetch } = hooks.useSession();
  // Always call the org hook unconditionally — React requires the same hook
  // chain on every render. Discard the result when there is no session.
  const { data: activeOrgRaw } = hooks.useActiveOrganization();
  const activeOrg = session?.user ? activeOrgRaw : null;

  const user: User | null = session?.user
    ? {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
        avatar: session.user.image || undefined,
      }
    : null;

  const role: OrgRole = (activeOrg as Record<string, unknown>)?.role as OrgRole || DEFAULT_ROLE;

  const hasPermission = (action: OrgAction, resource?: string): boolean => {
    if (!user) return false;
    const effectiveAction = resource ? RESOURCE_ACTIONS[resource] || action : action;
    return canRolePerformAction(role, effectiveAction);
  };

  const canView = (resource: string): boolean => {
    return hasPermission("view_chains" as OrgAction, resource);
  };

  const canEdit = (resource: string): boolean => {
    const action = EDIT_ACTIONS[resource] || "manage_chains";
    return canRolePerformAction(role, action);
  };

  const getRole = (): OrgRole | null => {
    return user ? role : null;
  };

  return (
    <UserContext.Provider
      value={{
        user,
        loading: isPending,
        error: sessionError?.message || null,
        refresh: async () => { await refetch(); },
        hasPermission,
        canView,
        canEdit,
        getRole,
      }}
    >
      {children}
    </UserContext.Provider>
  );
}

export function UserProvider({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <UserContext.Provider value={DEFAULT_VALUE}>
        {children}
      </UserContext.Provider>
    );
  }

  return <AuthUserProvider>{children}</AuthUserProvider>;
}

export function useUser() {
  const context = useContext(UserContext);
  if (!context) {
    return DEFAULT_VALUE;
  }
  return context;
}
