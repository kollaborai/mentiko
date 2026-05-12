"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useNamespace } from "@/lib/namespace-context";
import { useNamespaceFetch } from "@/lib/use-namespace-fetch";
import { PageBanner } from "@/components/ui/page-banner";
import { ShieldTickFilled, RefreshFilled, DocumentDownloadFilled, ArrowDown2Filled, ArrowUp2Filled, DocumentTextFilled } from "@aliimam/icons";

interface AuditEntry {
  id?: string;
  timestamp?: string;
  event_type?: string;
  description?: string;
  user?: string;
  source?: string;
  ip?: string;
  [key: string]: unknown;
}

interface AuditApiData {
  logs: AuditEntry[];
  count: number;
}

interface ApiSuccess<T> {
  success: true;
  data: T;
  requestId: string;
}

interface ApiError {
  success: false;
  error?: {
    message?: string;
    code?: string;
  } | string;
  requestId?: string;
}

const LIMIT_OPTIONS = ["50", "100", "200", "400", "800"];

function parseMetadata(entry: AuditEntry): Record<string, unknown> {
  const metadata = { ...entry };
  delete metadata.id;
  delete metadata.timestamp;
  delete metadata.event_type;
  delete metadata.description;
  delete metadata.user;
  delete metadata.source;
  delete metadata.ip;
  delete metadata.hostname;
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (value !== undefined) {
      clean[key] = value;
    }
  }
  return clean;
}

function formatTimestamp(value: string | undefined): string {
  if (!value) return "—";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleString();
}

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message || "Request failed";
  if (typeof err === "string") return err;
  return "Request failed";
}

async function readResponseJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function getApiErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const data = payload as ApiError | { error?: string };
  if (typeof data.error === "string") return data.error;
  if (data.error && typeof data.error === "object" && data.error.message) {
    return data.error.message;
  }
  return fallback;
}

function unwrapAuditData(payload: unknown): AuditApiData {
  if (payload && typeof payload === "object" && "data" in payload) {
    const wrapped = payload as ApiSuccess<AuditApiData>;
    return wrapped.data;
  }
  return payload as AuditApiData;
}

function toCsvDownloadFilename(): string {
  const now = new Date().toISOString().replace(/[:.]/g, "-").split(".")[0];
  return `mentiko-audit-${now}.csv`;
}

export default function AuditTrailPage() {
  const { namespaceId } = useNamespace();
  const { fetchWithNamespace } = useNamespaceFetch();

  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [forbidden, setForbidden] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const [typeFilter, setTypeFilter] = useState("all");
  const [userFilter, setUserFilter] = useState("");
  const [sinceFilter, setSinceFilter] = useState("");
  const [limitFilter, setLimitFilter] = useState("200");

  const typeOptions = useMemo(() => {
    const values = Array.from(
      new Set(entries.map((entry) => entry.event_type).filter((type): type is string => Boolean(type))
    )).sort();
    return ["all", ...values];
  }, [entries]);

  const buildParams = useCallback(() => {
    const params = new URLSearchParams();
    params.set("limit", limitFilter);

    if (typeFilter !== "all") {
      params.set("type", typeFilter);
    }
    if (userFilter.trim()) {
      params.set("user", userFilter.trim());
    }
    if (sinceFilter.trim()) {
      const parsed = new Date(sinceFilter);
      if (!Number.isNaN(parsed.getTime())) {
        params.set("since", parsed.toISOString());
      }
    }
    return params;
  }, [limitFilter, typeFilter, userFilter, sinceFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setForbidden(false);

    try {
      const res = await fetchWithNamespace(`/api/audit?${buildParams()}`);

      if (res.status === 403) {
        setForbidden(true);
        setEntries([]);
        setCount(0);
        return;
      }

      if (!res.ok) {
        const raw = await readResponseJson(res);
        throw new Error(getApiErrorMessage(raw, `Failed to load audit logs (${res.status})`));
      }

      const data = unwrapAuditData(await readResponseJson(res));
      setEntries(Array.isArray(data.logs) ? data.logs : []);
      setCount(typeof data.count === "number" ? data.count : 0);
    } catch (err) {
      setError(formatError(err));
      setEntries([]);
      setCount(0);
    } finally {
      setLoading(false);
    }
  }, [buildParams, fetchWithNamespace]);

  const handleExport = useCallback(async () => {
    try {
      const params = buildParams();
      params.set("format", "csv");
      const res = await fetchWithNamespace(`/api/audit?${params}`);
      if (res.status === 403) {
        setForbidden(true);
        return;
      }
      if (!res.ok) {
        const raw = await readResponseJson(res);
        throw new Error(getApiErrorMessage(raw, `Failed to export audit logs (${res.status})`));
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = toCsvDownloadFilename();
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(formatError(err));
    }
  }, [buildParams, fetchWithNamespace]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const onTypeFilter = (event: ChangeEvent<HTMLSelectElement>) => {
    setTypeFilter(event.target.value);
  };
  const onUserFilter = (event: ChangeEvent<HTMLInputElement>) => {
    setUserFilter(event.target.value);
  };
  const onSinceFilter = (event: ChangeEvent<HTMLInputElement>) => {
    setSinceFilter(event.target.value);
  };
  const onLimitFilter = (event: ChangeEvent<HTMLSelectElement>) => {
    setLimitFilter(event.target.value);
  };

  if (forbidden) {
    return (
      <div className="flex-1 overflow-auto">
        <PageBanner
          title="Audit Trail"
          subtitle="Audit trail access is restricted to owners and admins."
          icon={ShieldTickFilled}
          sectionColor="#a0927b"
          actions={[
            {
              label: "Audit Docs",
              href: "/docs/audit",
              icon: DocumentTextFilled,
            },
          ]}
        />
        <div className="px-4 py-3 max-w-4xl mx-auto">
          <div className="bg-card rounded-md p-4 text-xs text-foreground/60">
            You need the <span className="font-medium text-foreground">view_audit</span> permission to open this page.
            Ask an organization owner or admin to grant access.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto">
      <PageBanner
        title="Audit Trail"
        subtitle={`${count} log entries loaded`}
        icon={ShieldTickFilled}
        sectionColor="#a0927b"
        actions={[
          { label: "Refresh", icon: RefreshFilled, onClick: load, iconColor: "#5b9ef5" },
          { label: "CSV Export", icon: DocumentDownloadFilled, onClick: handleExport, iconColor: "#a0927b" },
          { label: "Audit Docs", href: "/docs/audit", icon: DocumentTextFilled, iconColor: "#5b9ef5" },
        ]}
      />

      <div className="px-4 py-3 max-w-5xl mx-auto space-y-3">
        <div className="bg-card rounded-md p-3 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            <label className="space-y-1">
              <span className="text-[10px] text-foreground/40">event type</span>
              <select
                value={typeFilter}
                onChange={onTypeFilter}
                className="w-full rounded-md bg-muted px-2 py-1.5 text-xs outline-none border border-foreground/10"
              >
                {typeOptions.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </label>

            <label className="space-y-1">
              <span className="text-[10px] text-foreground/40">user</span>
              <input
                value={userFilter}
                onChange={onUserFilter}
                className="w-full rounded-md bg-muted px-2 py-1.5 text-xs outline-none border border-foreground/10"
                placeholder="alice@example.com"
              />
            </label>

            <label className="space-y-1">
              <span className="text-[10px] text-foreground/40">since</span>
              <input
                type="datetime-local"
                value={sinceFilter}
                onChange={onSinceFilter}
                className="w-full rounded-md bg-muted px-2 py-1.5 text-xs outline-none border border-foreground/10"
              />
            </label>

            <label className="space-y-1">
              <span className="text-[10px] text-foreground/40">limit</span>
              <select
                value={limitFilter}
                onChange={onLimitFilter}
                className="w-full rounded-md bg-muted px-2 py-1.5 text-xs outline-none border border-foreground/10"
              >
                {LIMIT_OPTIONS.map((limit) => (
                  <option key={limit} value={limit}>{limit}</option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {loading ? (
          <div className="px-4 py-6 text-xs text-foreground/35">
            loading...
          </div>
        ) : error ? (
          <div className="bg-card rounded-md p-4 text-xs text-destructive">
            {error}
          </div>
        ) : entries.length === 0 ? (
          <div className="bg-card rounded-md p-6 text-xs">
            <p className="font-medium text-foreground/70 mb-1">No audit entries found.</p>
            <p className="text-foreground/40">
              Local audit log lives at{" "}
              <span className="font-mono text-foreground/80">
                ~/.mentiko/namespaces/{namespaceId}/audit/audit.log
              </span>
            </p>
          </div>
        ) : (
          <div className="rounded-md border border-foreground/10 overflow-hidden">
            {entries.map((entry, index) => {
              const entryId = entry.id || `${entry.timestamp || "entry"}-${index}`;
              const metadata = parseMetadata(entry);
              const hasMetadata = Object.keys(metadata).length > 0;
              const isOpen = expanded.has(entryId);

              return (
                <div
                  key={entryId}
                  className="border-b border-foreground/10 last:border-b-0 bg-card"
                >
                  <button
                    type="button"
                    onClick={() => toggleExpanded(entryId)}
                    className="w-full text-left px-3 py-2"
                  >
                    <div className="grid grid-cols-1 sm:grid-cols-[150px_120px_minmax(0,1fr)_120px_92px_24px] gap-1 sm:gap-2 sm:items-center text-[10px]">
                      <span className="truncate text-foreground/80" title={formatTimestamp(entry.timestamp)}>
                        {formatTimestamp(entry.timestamp)}
                      </span>
                      <span className="truncate font-medium text-foreground">
                        {entry.event_type || "event"}
                      </span>
                      <span className="truncate text-foreground/60">
                        {entry.description || "—"}
                      </span>
                      <span className="truncate text-foreground/60">
                        {entry.user || "—"}
                      </span>
                      <span className="truncate text-foreground/50" title={entry.ip || entry.source}>
                        {entry.ip || entry.source || "—"}
                      </span>
                      <span className="hidden sm:block justify-self-end text-foreground/30">
                        {isOpen ? (
                          <ArrowUp2Filled className="h-3.5 w-3.5" />
                        ) : (
                          <ArrowDown2Filled className="h-3.5 w-3.5" />
                        )}
                      </span>
                    </div>
                  </button>

                  {isOpen && hasMetadata && (
                    <div className="px-3 pb-3 pt-1 text-[10px] text-foreground/60">
                      <p className="mb-1 text-foreground/40">metadata</p>
                      <pre className="bg-muted/70 rounded-md p-2 overflow-x-auto">
                        {JSON.stringify(metadata, null, 2)}
                      </pre>
                    </div>
                  )}
                  {isOpen && !hasMetadata && (
                    <p className="px-3 pb-3 text-[10px] text-foreground/40">
                      no metadata
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
