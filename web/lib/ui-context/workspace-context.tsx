"use client";

import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from "react";
import { useNamespaceFetch } from "../hooks/use-namespace-fetch";

export interface WorkspaceInfo {
  id: string;
  name: string;
  path: string;
  icon?: string;
  default_agent_profile?: string;
}

interface WorkspaceContextValue {
  workspaceId: string;
  workspacePath: string;
  workspaceReady: boolean;
  setWorkspaceId: (id: string) => void;
  workspaces: WorkspaceInfo[];
  refetch: () => Promise<WorkspaceInfo[]>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | undefined>(undefined);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspaceId, setWorkspaceIdState] = useState<string>("");
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [workspacesLoaded, setWorkspacesLoaded] = useState<boolean>(false);
  const { fetchWithNamespace } = useNamespaceFetch();

  const fetchWorkspaces = useCallback(async (): Promise<WorkspaceInfo[]> => {
    // retry with exponential backoff on 429 — workspace bootstrap must succeed
    const maxAttempts = 4;
    let delay = 500;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const res = await fetchWithNamespace("/api/workspaces");
        if (res.ok) {
          const json = await res.json();
          const ws = json?.data?.workspaces ?? json?.workspaces ?? [];
          const nextWorkspaces = Array.isArray(ws) ? ws : [];
          setWorkspaces(nextWorkspaces);
          setWorkspacesLoaded(true);
          return nextWorkspaces;
        }
        if (res.status === 429 && attempt < maxAttempts - 1) {
          await new Promise(r => setTimeout(r, delay));
          delay *= 2;
          continue;
        }
      } catch {
        // network error — retry
        if (attempt < maxAttempts - 1) {
          await new Promise(r => setTimeout(r, delay));
          delay *= 2;
        }
      }
    }
    setWorkspacesLoaded(true);
    return [];
  }, [fetchWithNamespace]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchWorkspaces();
  }, [fetchWorkspaces]);

  useEffect(() => {
    const stored = localStorage.getItem("mentiko-workspace");
    if (stored) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setWorkspaceIdState(stored);
    }
  }, []);

  // auto-select first workspace if none selected, or clear stale ID
  useEffect(() => {
    if (!workspacesLoaded) return;
    if (workspaceId && workspaces.length > 0 && !workspaces.some((w) => w.id === workspaceId)) {
      // stale ID in localStorage doesn't match any workspace - clear and auto-select
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setWorkspaceIdState(workspaces[0].id);
      localStorage.setItem("mentiko-workspace", workspaces[0].id);
    } else if (workspaceId && workspaces.length === 0) {
      // workspaces list is empty but we have a stale ID - clear it
      setWorkspaceIdState("");
      localStorage.removeItem("mentiko-workspace");
    } else if (!workspaceId && workspaces.length > 0) {
      const stored = localStorage.getItem("mentiko-workspace");
      if (stored && workspaces.some((w) => w.id === stored)) {
        setWorkspaceIdState(stored);
      } else {
        setWorkspaceIdState(workspaces[0].id);
        localStorage.setItem("mentiko-workspace", workspaces[0].id);
      }
    }
  }, [workspaces, workspaceId, workspacesLoaded]);

  const setWorkspaceId = (id: string) => {
    setWorkspaceIdState(id);
    localStorage.setItem("mentiko-workspace", id);
  };

  const workspacePath = workspaces.find((w) => w.id === workspaceId)?.path || "";
  // Ready when workspaces have loaded and path is resolved (or no workspace selected)
  const workspaceReady = workspacesLoaded && (!!workspacePath || !workspaceId);

  // refetch function for manual refresh
  const refetch = useCallback(async (): Promise<WorkspaceInfo[]> => {
    try {
      const res = await fetchWithNamespace("/api/workspaces");
      if (res.ok) {
        const json = await res.json();
        const ws = json?.data?.workspaces ?? json?.workspaces ?? [];
        const nextWorkspaces = Array.isArray(ws) ? ws : [];
        setWorkspaces(nextWorkspaces);
        setWorkspacesLoaded(true);
        return nextWorkspaces;
      }
    } catch {
      // silent fail
    }
    setWorkspacesLoaded(true);
    return [];
  }, [fetchWithNamespace]);

  return (
    <WorkspaceContext.Provider
      value={{
        workspaceId,
        workspacePath,
        workspaceReady,
        setWorkspaceId,
        workspaces,
        refetch,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error("useWorkspace must be used within WorkspaceProvider");
  }
  return context;
}
