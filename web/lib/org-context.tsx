"use client";

import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import type { Org } from "./org-types";
import { unwrapApiData } from "@/lib/api-client";

interface OrgContextValue {
  currentOrg: Org | null;
  orgs: Org[];
  setCurrentOrg: (org: Org | null) => void;
  refreshOrgs: () => Promise<void>;
  loading: boolean;
}

const OrgContext = createContext<OrgContextValue | undefined>(undefined);

const ORG_STORAGE_KEY = "mentiko-current-org";

export function OrgProvider({ children }: { children: ReactNode }) {
  const [currentOrg, setCurrentOrgState] = useState<Org | null>(null);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [loading, setLoading] = useState(true);

  // load saved org on mount
  useEffect(() => {
    const loadSavedOrg = async () => {
      try {
        const stored = localStorage.getItem(ORG_STORAGE_KEY);
        let savedOrg: Org | null = null;
        if (stored) {
          savedOrg = JSON.parse(stored) as Org;
          setCurrentOrgState(savedOrg);
        }

        // fetch all orgs
        const res = await fetch("/api/orgs");
        if (res.ok) {
          const data = unwrapApiData<{ orgs?: Org[]; org?: Org }>(await res.json());
          const orgList = Array.isArray(data.orgs) ? data.orgs : (data.org ? [data.org] : []);
          setOrgs(orgList);

          // if no current org but orgs exist, set first one
          if (!savedOrg && orgList.length > 0) {
            setCurrentOrgState(orgList[0]);
            localStorage.setItem(ORG_STORAGE_KEY, JSON.stringify(orgList[0]));
          }
        }
      } catch (e) {
        console.error("failed to load orgs:", e);
      } finally {
        setLoading(false);
      }
    };

    loadSavedOrg();
  }, []);

  const setCurrentOrg = useCallback((org: Org | null) => {
    setCurrentOrgState(org);
    if (org) {
      localStorage.setItem(ORG_STORAGE_KEY, JSON.stringify(org));
    } else {
      localStorage.removeItem(ORG_STORAGE_KEY);
    }
  }, []);

  const refreshOrgs = useCallback(async () => {
    try {
      const res = await fetch("/api/orgs");
      if (res.ok) {
        const data = unwrapApiData<{ orgs?: Org[]; org?: Org }>(await res.json());
        const orgList = Array.isArray(data.orgs) ? data.orgs : (data.org ? [data.org] : []);
        setOrgs(orgList);
      }
    } catch (e) {
      console.error("failed to refresh orgs:", e);
    }
  }, []);

  return (
    <OrgContext.Provider value={{ currentOrg, orgs, setCurrentOrg, refreshOrgs, loading }}>
      {children}
    </OrgContext.Provider>
  );
}

export function useOrg() {
  const context = useContext(OrgContext);
  if (!context) {
    throw new Error("useOrg must be used within OrgProvider");
  }
  return context;
}
