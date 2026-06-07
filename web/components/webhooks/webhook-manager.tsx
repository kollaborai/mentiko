"use client";

import { useState, useEffect, useCallback } from "react";
import {
  AddFilled as Plus,
  Trash2,
  Play,
  RefreshFilled as RefreshCw,
  SearchNormalFilled as Search,
  ArrowDown2Filled as ChevronDown,
  ArrowUp2Filled as ChevronUp,
  LinkFilled as GitBranch,
  NotificationFilled as BellOff,
  CheckFilled as CheckCircle,
  CloseCircleFilled as XCircle,
  ClockFilled as Clock,
} from "@aliimam/icons";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Card,
  CardContent,
} from "@/components/ui/card";

import type {
  WebhookSubscription,
  WebhookEvent,
  WebhookSource,
  WebhookEventType,
  WebhookEventFilter,
} from "@/lib/webhooks/webhook-types";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { unwrapApiData, getApiErrorMessage } from "@/lib/api/api-client";
import { useSharedChains } from "@/lib/chains/chains-store";

const WEBHOOK_SOURCES: { value: WebhookSource; label: string }[] = [
  { value: "github", label: "GitHub" },
  { value: "gitlab", label: "GitLab" },
  { value: "bitbucket", label: "Bitbucket" },
  { value: "slack", label: "Slack" },
  { value: "discord", label: "Discord" },
  { value: "custom", label: "Custom" },
];

const WEBHOOK_EVENT_TYPES: { value: WebhookEventType; label: string }[] = [
  { value: "push", label: "Push" },
  { value: "pull_request", label: "Pull Request" },
  { value: "pull_request_review", label: "PR Review" },
  { value: "issues", label: "Issues" },
  { value: "issue_comment", label: "Issue Comment" },
  { value: "deployment", label: "Deployment" },
  { value: "deployment_status", label: "Deployment Status" },
  { value: "release", label: "Release" },
  { value: "star", label: "Star" },
  { value: "fork", label: "Fork" },
  { value: "ping", label: "Ping" },
  { value: "custom", label: "Custom" },
];

interface Chain {
  id: string;
  name: string;
  description: string;
}

interface WebhookManagerProps {
  onWebhookClick?: (webhookId: string) => void;
}

export function WebhookManager({}: WebhookManagerProps) {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [subscriptions, setSubscriptions] = useState<WebhookSubscription[]>([]);
  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const { chains: sharedChains } = useSharedChains();
  const chains: Chain[] = sharedChains.map((c) => ({ id: c.id, name: c.name, description: c.description || "" }));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const [newChainId, setNewChainId] = useState("");
  const [newSources, setNewSources] = useState<WebhookSource[]>([]);
  const [newTypes, setNewTypes] = useState<WebhookEventType[]>([]);
  const [newBranches, setNewBranches] = useState("");
  const [newLabels, setNewLabels] = useState("");
  const [newStates, setNewStates] = useState<string[]>([]);
  const [newEndpointUrl, setNewEndpointUrl] = useState("");
  const [newSecret, setNewSecret] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [testWebhookId, setTestWebhookId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const fetchSubscriptions = useCallback(async () => {
    try {
      const res = await fetchWithNamespace("/api/webhooks");
      if (!res.ok) throw new Error("failed to fetch subscriptions");
      const raw = await res.json();
      const data = unwrapApiData<{ webhooks?: WebhookSubscription[] }>(raw);
      setSubscriptions(data.webhooks || []);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [fetchWithNamespace]);

  const fetchEvents = useCallback(async () => {
    try {
      const res = await fetchWithNamespace("/api/webhooks/logs?limit=50");
      if (!res.ok) throw new Error("failed to fetch events");
      const raw = await res.json();
      const data = unwrapApiData<{ events?: WebhookEvent[] }>(raw);
      setEvents(data.events || []);
    } catch (err) {
      console.error("failed to fetch events:", err);
    }
  }, [fetchWithNamespace]);

  useEffect(() => {
    Promise.all([fetchSubscriptions(), fetchEvents()]).finally(() => {
      setLoading(false);
    });
  }, [fetchSubscriptions, fetchEvents]);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleCreate = async () => {
    if (!newChainId) {
      setCreateError("chain is required");
      return;
    }

    setCreating(true);
    setCreateError(null);

    const eventFilter: WebhookEventFilter = {};
    if (newSources.length > 0) eventFilter.sources = newSources;
    if (newTypes.length > 0) eventFilter.types = newTypes;
    if (newBranches.trim()) eventFilter.branches = newBranches.split(",").map(s => s.trim());
    if (newLabels.trim()) eventFilter.labels = newLabels.split(",").map(s => s.trim());
    if (newStates.length > 0) eventFilter.states = newStates as ("open" | "closed" | "merged" | "draft")[];

    try {
      const res = await fetchWithNamespace("/api/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chainId: newChainId,
          eventFilter,
          endpointUrl: newEndpointUrl || undefined,
          secret: newSecret || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(getApiErrorMessage(data, "failed to create subscription"));
      }

      await fetchSubscriptions();
      setCreateOpen(false);
      resetCreateForm();
    } catch (err) {
      setCreateError((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("delete this webhook subscription?")) return;

    try {
      const res = await fetchWithNamespace(`/api/webhooks/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("failed to delete");
      await fetchSubscriptions();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleToggle = async (sub: WebhookSubscription) => {
    const updated = { ...sub, enabled: !sub.enabled, updatedAt: new Date().toISOString() };
    try {
      const res = await fetchWithNamespace("/api/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });
      if (!res.ok) throw new Error("failed to update");
      await fetchSubscriptions();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleTest = async (id: string) => {
    setTestWebhookId(id);
    setTestResult(null);

    try {
      const res = await fetchWithNamespace(`/api/webhooks/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "custom",
          type: "custom",
          payload: { test: true, triggeredBy: "webhook-manager" },
        }),
      });

      const data = await res.json();
      if (data.test && data.delivery) {
        if (data.delivery.ok) {
          setTestResult({ success: true, message: `delivered: ${data.delivery.status}` });
        } else if (data.delivery.error) {
          setTestResult({ success: false, message: data.delivery.error });
        } else {
          setTestResult({ success: false, message: `failed: ${data.delivery.status}` });
        }
      } else {
        setTestResult({ success: true, message: "test event logged" });
      }
    } catch (err) {
      setTestResult({ success: false, message: (err as Error).message });
    } finally {
      setTestWebhookId(null);
    }
  };

  const resetCreateForm = () => {
    setNewChainId("");
    setNewSources([]);
    setNewTypes([]);
    setNewBranches("");
    setNewLabels("");
    setNewStates([]);
    setNewEndpointUrl("");
    setNewSecret("");
    setCreateError(null);
  };

  const filteredSubscriptions = subscriptions.filter((s) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    const chain = chains.find((c) => c.id === s.chainId);
    return (
      s.id.toLowerCase().includes(q) ||
      (chain?.name.toLowerCase().includes(q) ?? false) ||
      s.chainId.toLowerCase().includes(q)
    );
  });

  const getChainName = (chainId: string) => {
    const chain = chains.find((c) => c.id === chainId);
    return chain?.name || chainId;
  };

  const formatFilterBadge = (filter: WebhookEventFilter) => {
    const parts: string[] = [];
    if (filter.sources?.length) parts.push(filter.sources.join(", "));
    if (filter.types?.length) parts.push(filter.types.join(", "));
    if (filter.branches?.length) parts.push(`branches: ${filter.branches.join(", ")}`);
    if (filter.labels?.length) parts.push(`labels: ${filter.labels.join(", ")}`);
    if (filter.states?.length) parts.push(`states: ${filter.states.join(", ")}`);
    return parts.length > 0 ? parts.join(" | ") : "all events";
  };

  const getRelativeTime = (timestamp: string) => {
    const diff = Date.now() - new Date(timestamp).getTime();
    if (diff < 60000) return "just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">webhooks</h2>
          <p className="text-sm text-muted-foreground">
            {subscriptions.length} subscription{subscriptions.length !== 1 ? "s" : ""}
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="size-4" />
              new subscription
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>new webhook subscription</DialogTitle>
              <DialogDescription>
                configure which events should trigger chain execution
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-4">
              {createError && (
                <Alert variant="destructive">
                  <AlertDescription>{createError}</AlertDescription>
                </Alert>
              )}

              <div className="grid gap-2">
                <Label htmlFor="chain">chain</Label>
                <Select value={newChainId} onValueChange={setNewChainId}>
                  <SelectTrigger id="chain">
                    <SelectValue placeholder="select chain" />
                  </SelectTrigger>
                  <SelectContent>
                    {chains.map((chain) => (
                      <SelectItem key={chain.id} value={chain.id}>
                        {chain.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label>sources</Label>
                <div className="flex flex-wrap gap-2">
                  {WEBHOOK_SOURCES.map((source) => (
                    <Badge
                      key={source.value}
                      variant={newSources.includes(source.value) ? "default" : "outline"}
                      className="cursor-pointer"
                      onClick={() => {
                        setNewSources((prev) =>
                          prev.includes(source.value)
                            ? prev.filter((s) => s !== source.value)
                            : [...prev, source.value]
                        );
                      }}
                    >
                      {source.label}
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="grid gap-2">
                <Label>event types</Label>
                <div className="flex flex-wrap gap-2">
                  {WEBHOOK_EVENT_TYPES.map((type) => (
                    <Badge
                      key={type.value}
                      variant={newTypes.includes(type.value) ? "default" : "outline"}
                      className="cursor-pointer"
                      onClick={() => {
                        setNewTypes((prev) =>
                          prev.includes(type.value)
                            ? prev.filter((t) => t !== type.value)
                            : [...prev, type.value]
                        );
                      }}
                    >
                      {type.label}
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="branches">branches (comma-separated)</Label>
                <Input
                  id="branches"
                  placeholder="main, develop, staging/*"
                  value={newBranches}
                  onChange={(e) => setNewBranches(e.target.value)}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="labels">labels (comma-separated)</Label>
                <Input
                  id="labels"
                  placeholder="bug, enhancement, priority/*"
                  value={newLabels}
                  onChange={(e) => setNewLabels(e.target.value)}
                />
              </div>

              <div className="grid gap-2">
                <Label>states</Label>
                <div className="flex flex-wrap gap-2">
                  {["open", "closed", "merged", "draft"].map((state) => (
                    <Badge
                      key={state}
                      variant={newStates.includes(state) ? "default" : "outline"}
                      className="cursor-pointer"
                      onClick={() => {
                        setNewStates((prev) =>
                          prev.includes(state)
                            ? prev.filter((s) => s !== state)
                            : [...prev, state]
                        );
                      }}
                    >
                      {state}
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="endpoint">endpoint url (optional)</Label>
                <Input
                  id="endpoint"
                  placeholder="https://your-endpoint.com/webhook"
                  value={newEndpointUrl}
                  onChange={(e) => setNewEndpointUrl(e.target.value)}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="secret">secret (optional)</Label>
                <Input
                  id="secret"
                  type="password"
                  placeholder="webhook secret for signature"
                  value={newSecret}
                  onChange={(e) => setNewSecret(e.target.value)}
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>
                cancel
              </Button>
              <Button onClick={handleCreate} disabled={creating || !newChainId}>
                {creating && <RefreshCw className="mr-2 size-4 animate-spin" />}
                create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="subscriptions">
        <TabsList>
          <TabsTrigger value="subscriptions">
            subscriptions ({subscriptions.length})
          </TabsTrigger>
          <TabsTrigger value="logs">
            event logs ({events.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="subscriptions" className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="search subscriptions..."
              className="pl-9"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredSubscriptions.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-8">
                <BellOff className="mb-4 size-12 text-muted-foreground" />
                <p className="text-muted-foreground">
                  {searchQuery ? "no matching subscriptions" : "no webhook subscriptions yet"}
                </p>
                {!searchQuery && (
                  <Button variant="outline" size="sm" className="mt-4" onClick={() => setCreateOpen(true)}>
                    <Plus className="mr-2 size-4" />
                    create first subscription
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {filteredSubscriptions.map((sub) => {
                const isExpanded = expandedIds.has(sub.id);
                return (
                  <Card key={sub.id}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-3">
                          <Switch
                            checked={sub.enabled}
                            onCheckedChange={() => handleToggle(sub)}
                          />
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{getChainName(sub.chainId)}</span>
                              <Badge variant="outline" className="text-xs">
                                {sub.chainId}
                              </Badge>
                            </div>
                            <p className="text-sm text-muted-foreground mt-1">
                              {formatFilterBadge(sub.eventFilter)}
                            </p>
                            <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Clock className="size-3" />
                                {getRelativeTime(sub.updatedAt)}
                              </span>
                              {sub.endpointUrl && (
                                <span className="truncate max-w-[200px]">
                                  {sub.endpointUrl}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1">
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            onClick={() => toggleExpand(sub.id)}
                          >
                            {isExpanded ? (
                              <ChevronUp className="size-4" />
                            ) : (
                              <ChevronDown className="size-4" />
                            )}
                          </Button>
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            onClick={() => handleTest(sub.id)}
                            disabled={testWebhookId === sub.id}
                          >
                            {testWebhookId === sub.id ? (
                              <RefreshCw className="size-4 animate-spin" />
                            ) : (
                              <Play className="size-4" />
                            )}
                          </Button>
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            onClick={() => handleDelete(sub.id)}
                          >
                            <Trash2 className="size-4 text-destructive" />
                          </Button>
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="mt-4 pt-4 border-t border-border/40">
                          <div className="grid gap-3 text-sm">
                            <div>
                              <span className="text-muted-foreground">id:</span>{" "}
                              <code className="text-xs">{sub.id}</code>
                            </div>
                            <div>
                              <span className="text-muted-foreground">chain:</span>{" "}
                              {getChainName(sub.chainId)} ({sub.chainId})
                            </div>
                            <div>
                              <span className="text-muted-foreground">status:</span>{" "}
                              {sub.enabled ? (
                                <Badge variant="default" className="ml-2">
                                  <CheckCircle className="mr-1 size-3" />
                                  enabled
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="ml-2">
                                  <XCircle className="mr-1 size-3" />
                                  disabled
                                </Badge>
                              )}
                            </div>
                            <div>
                              <span className="text-muted-foreground">sources:</span>{" "}
                              {sub.eventFilter.sources?.length
                                ? sub.eventFilter.sources.map((s) => (
                                    <Badge key={s} variant="secondary" className="ml-2">
                                      {s}
                                    </Badge>
                                  ))
                                : "all"}
                            </div>
                            <div>
                              <span className="text-muted-foreground">types:</span>{" "}
                              {sub.eventFilter.types?.length
                                ? sub.eventFilter.types.map((t) => (
                                    <Badge key={t} variant="secondary" className="ml-2">
                                      {t}
                                    </Badge>
                                  ))
                                : "all"}
                            </div>
                            {sub.eventFilter.branches && (
                              <div>
                                <span className="text-muted-foreground">branches:</span>{" "}
                                {sub.eventFilter.branches.join(", ")}
                              </div>
                            )}
                            {sub.eventFilter.labels && (
                              <div>
                                <span className="text-muted-foreground">labels:</span>{" "}
                                {sub.eventFilter.labels.join(", ")}
                              </div>
                            )}
                            {sub.eventFilter.states && (
                              <div>
                                <span className="text-muted-foreground">states:</span>{" "}
                                {sub.eventFilter.states.join(", ")}
                              </div>
                            )}
                            {sub.endpointUrl && (
                              <div>
                                <span className="text-muted-foreground">endpoint:</span>{" "}
                                <code className="text-xs">{sub.endpointUrl}</code>
                              </div>
                            )}
                            {sub.secret && (
                              <div>
                                <span className="text-muted-foreground">secret:</span>{" "}
                                <code className="text-xs">••••••••</code>
                              </div>
                            )}
                            <div>
                              <span className="text-muted-foreground">created:</span>{" "}
                              {new Date(sub.createdAt).toLocaleString()}
                            </div>
                            <div>
                              <span className="text-muted-foreground">updated:</span>{" "}
                              {new Date(sub.updatedAt).toLocaleString()}
                            </div>
                          </div>

                          {testResult && testWebhookId === null && (
                            <Alert
                              variant={testResult.success ? "default" : "destructive"}
                              className="mt-4"
                            >
                              <AlertDescription>
                                test: {testResult.message}
                              </AlertDescription>
                            </Alert>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="logs" className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              recent webhook events
            </p>
            <Button size="xs" variant="outline" onClick={fetchEvents}>
              <RefreshCw className="mr-2 size-3" />
              refresh
            </Button>
          </div>

          {events.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-8">
                <Clock className="mb-4 size-12 text-muted-foreground" />
                <p className="text-muted-foreground">no webhook events yet</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {events.map((event) => (
                <Card key={event.id}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3">
                        <div className={`mt-1 size-2 rounded-full ${event.processed ? "bg-green-500" : "bg-yellow-500"}`} />
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">{event.source}</Badge>
                            <Badge variant="secondary">{event.type}</Badge>
                            {event.chainId && (
                              <Badge variant="outline" className="text-xs">
                                <GitBranch className="mr-1 size-3" />
                                {event.chainId}
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            {getRelativeTime(event.timestamp)}
                          </p>
                          <details className="mt-2">
                            <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                              view payload
                            </summary>
                            <pre className="mt-2 text-xs bg-muted p-2 rounded overflow-auto max-h-40">
                              {JSON.stringify(event.payload, null, 2)}
                            </pre>
                          </details>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
