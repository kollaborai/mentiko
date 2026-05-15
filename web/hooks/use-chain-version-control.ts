"use client";

import { useState, useCallback, useEffect } from "react";
import { useNamespaceFetch } from "@/lib/use-namespace-fetch";
import { unwrapApiData } from "@/lib/api-client";
import type {
  GitCommit,
  GitBranch,
  GitStatus,
  GitDiffResult,
  MergeResult,
  Chain,
} from "@/lib/types";

/** Result of comparing two branches (ahead/behind counts). */
export interface BranchComparison {
  target: string;
  ahead: number;
  behind: number;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface UseChainVersionControlReturn {
  // State
  isRepo: boolean;
  status: GitStatus | null;
  commits: GitCommit[];
  branches: GitBranch[];
  currentBranch: string;
  diff: GitDiffResult | null;
  mergeResult: MergeResult | null;
  loading: boolean;
  error: string | null;

  // Git operations
  initRepo: (branch?: string) => Promise<void>;
  commit: (message: string, files?: string | string[]) => Promise<GitCommit | null>;
  getHistory: (limit?: number) => Promise<void>;
  getDiff: (from: string, to?: string) => Promise<void>;
  getCommit: (commitHash: string, file?: string) => Promise<Chain | null>;
  revert: (commitHash: string, createBranch?: boolean) => Promise<void>;

  // Branch operations
  getBranches: () => Promise<void>;
  createBranch: (name: string, startPoint?: string) => Promise<void>;
  switchBranch: (name: string) => Promise<void>;
  deleteBranch: (name: string, force?: boolean) => Promise<void>;
  compareBranches: (branch1: string, branch2: string) => Promise<BranchComparison | null>;
  mergeBranch: (name: string, strategy?: string) => Promise<MergeResult | null>;
  abortMerge: () => Promise<void>;

  // Status
  refreshStatus: () => Promise<void>;
  refresh: () => Promise<void>;
}

export function useChainVersionControl(chainId: string): UseChainVersionControlReturn {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [isRepo, setIsRepo] = useState(false);
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [currentBranch, setCurrentBranch] = useState("");
  const [diff, setDiff] = useState<GitDiffResult | null>(null);
  const [mergeResult, setMergeResult] = useState<MergeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = () => setError(null);

  // Initialize git repository
  const initRepo = useCallback(async (branch = "main") => {
    setLoading(true);
    clearError();
    try {
      const res = await fetchWithNamespace(`/api/chains/${encodeURIComponent(chainId)}/git/init`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branch }),
      });
      if (!res.ok) throw new Error("Failed to initialize git repo");
      await res.json();
      setIsRepo(true);
      await refreshStatus();
      await getHistory();
      await getBranches();
    } catch (err: unknown) {
      setError(getErrorMessage(err));
      throw err;
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshStatus, getHistory, getBranches defined below (forward refs)
  }, [chainId, fetchWithNamespace]);

  // Commit changes
  const commit = useCallback(async (message: string, files?: string | string[]) => {
    setLoading(true);
    clearError();
    try {
      const res = await fetchWithNamespace(`/api/chains/${encodeURIComponent(chainId)}/git/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, files }),
      });
      if (!res.ok) throw new Error("Failed to commit");
      const raw = await res.json();
      const data = unwrapApiData<{ commit?: GitCommit }>(raw);
      await refreshStatus();
      await getHistory();
      return data.commit || null;
    } catch (err: unknown) {
      setError(getErrorMessage(err));
      throw err;
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshStatus, getHistory defined below (forward refs)
  }, [chainId, fetchWithNamespace]);

  // Get commit history
  const getHistory = useCallback(async (limit = 50) => {
    setLoading(true);
    clearError();
    try {
      const res = await fetchWithNamespace(
        `/api/chains/${encodeURIComponent(chainId)}/git/history?limit=${limit}`
      );
      if (!res.ok) throw new Error("Failed to fetch history");
      const raw = await res.json();
      const data = unwrapApiData<{ commits?: GitCommit[]; branch?: string }>(raw);
      setCommits(data.commits || []);
      setCurrentBranch(data.branch || "");
    } catch (err: unknown) {
      setError(getErrorMessage(err));
      throw err;
    } finally {
      setLoading(false);
    }
  }, [chainId, fetchWithNamespace]);

  // Get diff between commits
  const getDiff = useCallback(async (from: string, to?: string) => {
    setLoading(true);
    clearError();
    try {
      const params = new URLSearchParams({ from });
      if (to) params.set("to", to);
      const res = await fetchWithNamespace(
        `/api/chains/${encodeURIComponent(chainId)}/git/diff?${params}`
      );
      if (!res.ok) throw new Error("Failed to fetch diff");
      const raw = await res.json();
      const data = unwrapApiData<GitDiffResult>(raw);
      setDiff(data);
    } catch (err: unknown) {
      setError(getErrorMessage(err));
      throw err;
    } finally {
      setLoading(false);
    }
  }, [chainId, fetchWithNamespace]);

  // Get file content at commit
  const getCommit = useCallback(async (commitHash: string, file = "chain.json") => {
    setLoading(true);
    clearError();
    try {
      const res = await fetchWithNamespace(`/api/chains/${encodeURIComponent(chainId)}/git/diff`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commit: commitHash, file }),
      });
      if (!res.ok) throw new Error("Failed to fetch commit");
      const raw = await res.json();
      const data = unwrapApiData<{ content?: string }>(raw);
      return data.content ? JSON.parse(data.content) : null;
    } catch (err: unknown) {
      setError(getErrorMessage(err));
      throw err;
    } finally {
      setLoading(false);
    }
  }, [chainId, fetchWithNamespace]);

  // Revert to a commit
  const revert = useCallback(async (commitHash: string, createBranch = false) => {
    setLoading(true);
    clearError();
    try {
      const res = await fetchWithNamespace(`/api/chains/${encodeURIComponent(chainId)}/git/revert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commit: commitHash, createBranch }),
      });
      if (!res.ok) throw new Error("Failed to revert");
      await res.json();
      await refreshStatus();
      await getHistory();
      if (createBranch) {
        await getBranches();
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err));
      throw err;
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshStatus, getHistory, getBranches defined below (forward refs)
  }, [chainId, fetchWithNamespace]);

  // Get branches
  const getBranches = useCallback(async () => {
    setLoading(true);
    clearError();
    try {
      const res = await fetchWithNamespace(`/api/chains/${encodeURIComponent(chainId)}/git/branches`);
      if (!res.ok) throw new Error("Failed to fetch branches");
      const raw = await res.json();
      const data = unwrapApiData<{ branches?: GitBranch[]; current?: string }>(raw);
      setBranches(data.branches || []);
      setCurrentBranch(data.current || "");
    } catch (err: unknown) {
      setError(getErrorMessage(err));
      throw err;
    } finally {
      setLoading(false);
    }
  }, [chainId, fetchWithNamespace]);

  // Create branch
  const createBranch = useCallback(async (name: string, startPoint = "HEAD") => {
    setLoading(true);
    clearError();
    try {
      const res = await fetchWithNamespace(`/api/chains/${encodeURIComponent(chainId)}/git/branches`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", branch: name, startPoint }),
      });
      if (!res.ok) throw new Error("Failed to create branch");
      await getBranches();
    } catch (err: unknown) {
      setError(getErrorMessage(err));
      throw err;
    } finally {
      setLoading(false);
    }
  }, [chainId, fetchWithNamespace, getBranches]);

  // Switch branch
  const switchBranch = useCallback(async (name: string) => {
    setLoading(true);
    clearError();
    try {
      const res = await fetchWithNamespace(`/api/chains/${encodeURIComponent(chainId)}/git/branches`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "switch", branch: name }),
      });
      if (!res.ok) throw new Error("Failed to switch branch");
      await res.json();
      setCurrentBranch(name);
      await refreshStatus();
      await getHistory();
    } catch (err: unknown) {
      setError(getErrorMessage(err));
      throw err;
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshStatus defined below, circular dep
  }, [chainId, fetchWithNamespace, getHistory]);

  // Delete branch
  const deleteBranch = useCallback(async (name: string, force = false) => {
    setLoading(true);
    clearError();
    try {
      const res = await fetchWithNamespace(`/api/chains/${encodeURIComponent(chainId)}/git/branches`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", branch: name, force }),
      });
      if (!res.ok) throw new Error("Failed to delete branch");
      await getBranches();
    } catch (err: unknown) {
      setError(getErrorMessage(err));
      throw err;
    } finally {
      setLoading(false);
    }
  }, [chainId, fetchWithNamespace, getBranches]);

  // Compare branches — returns ahead/behind counts, not file diffs
  const compareBranches = useCallback(async (branch1: string, branch2: string): Promise<BranchComparison | null> => {
    setLoading(true);
    clearError();
    try {
      const res = await fetchWithNamespace(`/api/chains/${encodeURIComponent(chainId)}/git/branches`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "compare", branch: branch1, target: branch2 }),
      });
      if (!res.ok) throw new Error("Failed to compare branches");
      const raw = await res.json();
      const data = unwrapApiData<{ comparison?: BranchComparison }>(raw);
      return data.comparison ?? null;
    } catch (err: unknown) {
      setError(getErrorMessage(err));
      throw err;
    } finally {
      setLoading(false);
    }
  }, [chainId, fetchWithNamespace]);

  // Merge branch
  const mergeBranch = useCallback(async (name: string, strategy = "") => {
    setLoading(true);
    clearError();
    setMergeResult(null);
    try {
      const res = await fetchWithNamespace(`/api/chains/${encodeURIComponent(chainId)}/git/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branch: name, strategy }),
      });
      if (!res.ok) throw new Error("Failed to merge branch");
      const raw = await res.json();
      const data = unwrapApiData<MergeResult & { status?: string }>(raw);
      setMergeResult(data);
      await refreshStatus();
      await getBranches();
      if (data.status === "success") {
        await getHistory();
      }
      return data;
    } catch (err: unknown) {
      setError(getErrorMessage(err));
      throw err;
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshStatus defined below, circular dep
  }, [chainId, fetchWithNamespace, getBranches, getHistory]);

  // Abort merge
  const abortMerge = useCallback(async () => {
    setLoading(true);
    clearError();
    try {
      const res = await fetchWithNamespace(`/api/chains/${encodeURIComponent(chainId)}/git/merge`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to abort merge");
      setMergeResult(null);
      await refreshStatus();
    } catch (err: unknown) {
      setError(getErrorMessage(err));
      throw err;
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshStatus defined below, circular dep
  }, [chainId, fetchWithNamespace]);

  // Refresh git status
  const refreshStatus = useCallback(async () => {
    setLoading(true);
    clearError();
    try {
      const res = await fetchWithNamespace(`/api/chains/${encodeURIComponent(chainId)}/git/status`);
      if (!res.ok) {
        setIsRepo(false);
        return;
      }
      const raw = await res.json();
      const data = unwrapApiData<GitStatus & { isRepo?: boolean; branch?: string }>(raw);
      setIsRepo(data.isRepo);
      setStatus(data);
      setCurrentBranch(data.branch || "");
    } catch (err: unknown) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [chainId, fetchWithNamespace]);

  // Refresh all data
  const refresh = useCallback(async () => {
    await Promise.all([
      refreshStatus(),
      getHistory(),
      getBranches(),
    ]);
  }, [refreshStatus, getHistory, getBranches]);

  // Initial load
  useEffect(() => {
    if (chainId) {
      refreshStatus();
    }
  }, [chainId, refreshStatus]);

  return {
    // State
    isRepo,
    status,
    commits,
    branches,
    currentBranch,
    diff,
    mergeResult,
    loading,
    error,

    // Git operations
    initRepo,
    commit,
    getHistory,
    getDiff,
    getCommit,
    revert,

    // Branch operations
    getBranches,
    createBranch,
    switchBranch,
    deleteBranch,
    compareBranches,
    mergeBranch,
    abortMerge,

    // Status
    refreshStatus,
    refresh,
  };
}

// Hook for chain versions (non-git versioning)
interface ChainVersion {
  version: string;
  message: string;
  createdAt: string;
  chain?: Chain;
}

export interface UseChainVersionsReturn {
  versions: ChainVersion[];
  loading: boolean;
  error: string | null;
  getVersions: () => Promise<void>;
  createVersion: (version: string, message: string) => Promise<void>;
  restoreVersion: (version: string) => Promise<void>;
  diffVersions: (from: string, to: string) => Promise<ChainDiffResult | null>;
}

interface ChainDiffResult {
  from: string;
  to: string;
  diff: string;
  summary: {
    added: number;
    removed: number;
    modified: number;
  };
}

export function useChainVersions(chainId: string): UseChainVersionsReturn {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [versions, setVersions] = useState<ChainVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getVersions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithNamespace(`/api/chains/${encodeURIComponent(chainId)}/versions`);
      if (!res.ok) throw new Error("Failed to fetch versions");
      const raw = await res.json();
      const data = unwrapApiData<{ versions?: ChainVersion[] }>(raw);
      setVersions(data.versions || []);
    } catch (err: unknown) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [chainId, fetchWithNamespace]);

  const createVersion = useCallback(async (version: string, message: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithNamespace(`/api/chains/${encodeURIComponent(chainId)}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version, message }),
      });
      if (!res.ok) throw new Error("Failed to create version");
      await getVersions();
    } catch (err: unknown) {
      setError(getErrorMessage(err));
      throw err;
    } finally {
      setLoading(false);
    }
  }, [chainId, fetchWithNamespace, getVersions]);

  const restoreVersion = useCallback(async (version: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithNamespace(`/api/chains/${encodeURIComponent(chainId)}/versions/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version }),
      });
      if (!res.ok) throw new Error("Failed to restore version");
      return await res.json();
    } catch (err: unknown) {
      setError(getErrorMessage(err));
      throw err;
    } finally {
      setLoading(false);
    }
  }, [chainId, fetchWithNamespace]);

  const diffVersions = useCallback(async (from: string, to: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithNamespace(
        `/api/chains/${encodeURIComponent(chainId)}/versions/diff?from=${from}&to=${to}`
      );
      if (!res.ok) throw new Error("Failed to diff versions");
      return await res.json();
    } catch (err: unknown) {
      setError(getErrorMessage(err));
      throw err;
    } finally {
      setLoading(false);
    }
  }, [chainId, fetchWithNamespace]);

  useEffect(() => {
    if (chainId) {
      getVersions();
    }
  }, [chainId, getVersions]);

  return {
    versions,
    loading,
    error,
    getVersions,
    createVersion,
    restoreVersion,
    diffVersions,
  };
}
