"use client";

import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";

export interface NamespaceInfo {
  id: string;
  name: string;
}

interface NamespaceContextValue {
  namespaceId: string;
  setNamespaceId: (id: string) => void;
  namespaces: NamespaceInfo[];
}

const NamespaceContext = createContext<NamespaceContextValue | undefined>(undefined);

const DEFAULT_NAMESPACES: NamespaceInfo[] = [
  { id: "default", name: "Default" },
];

const DEFAULT_VALUE: NamespaceContextValue = {
  namespaceId: "default",
  setNamespaceId: () => {},
  namespaces: DEFAULT_NAMESPACES,
};

/**
 * Inner provider that uses better-auth hooks.
 * Only rendered after client mount to avoid SSR/React instance issues.
 */
function AuthNamespaceProvider({ children }: { children: ReactNode }) {
  // dynamic import to avoid SSR issues with better-auth React hooks
  const [hooks, setHooks] = useState<{
    useSession: () => { data: { user?: { id: string } } | null };
    useActiveOrganization: () => { data: Record<string, unknown> | null };
    useListOrganizations: () => { data: Array<{ slug: string; name: string; id: string }> | null };
    authClient: { organization: { setActive: (opts: { organizationId: string }) => void } };
  } | null>(null);

  const [fallbackNamespace, setFallbackNamespace] = useState<string>("default");

  useEffect(() => {
    import("../auth/auth-client").then((mod) => {
      setHooks({
        useSession: mod.useSession,
        useActiveOrganization: mod.useActiveOrganization,
        useListOrganizations: mod.useListOrganizations,
        authClient: mod.authClient,
      });
    });
    const stored = localStorage.getItem("mentiko-namespace");
    if (stored) setFallbackNamespace(stored);
  }, []);

  // before hooks loaded, render with defaults
  if (!hooks) {
    return (
      <NamespaceContext.Provider value={{ ...DEFAULT_VALUE, namespaceId: fallbackNamespace }}>
        {children}
      </NamespaceContext.Provider>
    );
  }

  return (
    <HookedNamespaceProvider hooks={hooks} fallbackNamespace={fallbackNamespace} setFallbackNamespace={setFallbackNamespace}>
      {children}
    </HookedNamespaceProvider>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const noopOrgHook = () => ({ data: null });

function HookedNamespaceProvider({
  children,
  hooks,
  fallbackNamespace,
  setFallbackNamespace,
}: {
  children: ReactNode;
  hooks: {
    useSession: () => { data: { user?: { id: string } } | null };
    useActiveOrganization: () => { data: Record<string, unknown> | null };
    useListOrganizations: () => { data: Array<{ slug: string; name: string; id: string }> | null };
    authClient: { organization: { setActive: (opts: { organizationId: string }) => void } };
  };
  fallbackNamespace: string;
  setFallbackNamespace: (ns: string) => void;
}) {
  const { data: session } = hooks.useSession();
  // Always call both org hooks unconditionally — React requires the same hook
  // chain on every render. Discard the results when there is no session.
  // (better-auth's hooks tolerate being called without a session; they just
  // return null/null without making the request.)
  const { data: activeOrgRaw } = hooks.useActiveOrganization();
  const { data: orgListRaw } = hooks.useListOrganizations();
  const activeOrg = session?.user ? activeOrgRaw : null;
  const orgList = session?.user ? orgListRaw : null;

  const namespaceId = (activeOrg as Record<string, unknown>)?.slug as string || fallbackNamespace;

  const namespaces: NamespaceInfo[] = orgList && orgList.length > 0
    ? orgList.map((org) => ({ id: org.slug, name: org.name }))
    : DEFAULT_NAMESPACES;

  const setNamespaceId = useCallback((id: string) => {
    const org = orgList?.find((o) => o.slug === id);
    if (org) {
      hooks.authClient.organization.setActive({ organizationId: org.id });
    } else {
      setFallbackNamespace(id);
      localStorage.setItem("mentiko-namespace", id);
    }
  }, [orgList, hooks.authClient, setFallbackNamespace]);

  return (
    <NamespaceContext.Provider value={{ namespaceId, setNamespaceId, namespaces }}>
      {children}
    </NamespaceContext.Provider>
  );
}

export function NamespaceProvider({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <NamespaceContext.Provider value={DEFAULT_VALUE}>
        {children}
      </NamespaceContext.Provider>
    );
  }

  return <AuthNamespaceProvider>{children}</AuthNamespaceProvider>;
}

export function useNamespace() {
  const context = useContext(NamespaceContext);
  if (!context) {
    throw new Error("useNamespace must be used within NamespaceProvider");
  }
  return context;
}
