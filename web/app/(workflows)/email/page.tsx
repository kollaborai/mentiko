"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useNamespaceFetch } from "@/lib/use-namespace-fetch";
import { RefreshFilled, TickCircleFilled, DirectSendFilled, Webhook, LinkFilled, SendFilled } from "@aliimam/icons";
import { AddFilled, EditFilled } from "@aliimam/icons";
import { Button } from "@/components/ui/button";
import { DetailHeader } from "@/components/ui/detail-header";
import { PageBanner } from "@/components/ui/page-banner";
import { WaveSpinner } from "@/components/ui/wave-spinner";
import { ComposeDialog } from "@/components/email/compose-dialog";
import { CreateInboxDialog } from "@/components/email/create-inbox-dialog";
import {
  WorkflowSidebarFilters,
  WorkflowSidebarItem,
  WorkflowSidebarPane,
  WorkflowSidebarResizeHandle,
  WorkflowSidebarSegmentedControl,
} from "@/components/ui/workflow-sidebar";
import type { EmailInbox, NormalizedEmail } from "@/lib/email-types";
import { useEmailPoller } from "@/hooks/use-email-poller";

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return "just now";
  if (diff < 3600000) return Math.floor(diff / 60000) + "m ago";
  if (diff < 86400000) return Math.floor(diff / 3600000) + "h ago";
  return Math.floor(diff / 86400000) + "d ago";
}

type Folder = "unread" | "processed" | "failed";

const FOLDERS: { value: Folder; label: string }[] = [
  { value: "unread", label: "Unread" },
  { value: "processed", label: "Processed" },
  { value: "failed", label: "Failed" },
];

export default function EmailPage() {
  return (
    <Suspense
      fallback={
        <div className="h-full flex items-center justify-center">
          <WaveSpinner size="sm" color="primary" animation="ripple" />
        </div>
      }
    >
      <EmailPageContent />
    </Suspense>
  );
}

function EmailPageContent() {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [inboxes, setInboxes] = useState<EmailInbox[]>([]);
  const [selectedInbox, setSelectedInbox] = useState<EmailInbox | null>(null);
  const [folder, setFolder] = useState<Folder>("unread");
  const [emails, setEmails] = useState<NormalizedEmail[]>([]);
  const [selectedEmail, setSelectedEmail] = useState<NormalizedEmail | null>(null);
  const [loading, setLoading] = useState(true);
  const [emailsLoading, setEmailsLoading] = useState(false);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [showCompose, setShowCompose] = useState(false);
  const [showCreateInbox, setShowCreateInbox] = useState(false);

  const pollerState = useEmailPoller({
    enabled: true,
    onProcessed: (count) => { if (count > 0) fetchEmails(); },
  });

  const SIDEBAR_KEY = "email-inbox-sidebar-width";
  const MIN_W = 240;
  const MAX_W = 400;
  const DEFAULT_W = 280;
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_W);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(DEFAULT_W);
  const messageListWidth = 300;

  useEffect(() => {
    const saved = localStorage.getItem(SIDEBAR_KEY);
    if (saved) {
      const width = parseInt(saved, 10);
      if (width >= MIN_W && width <= MAX_W) setSidebarWidth(width);
    }
  }, []);

  const onDragStart = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      dragging.current = true;
      startX.current = event.clientX;
      startW.current = sidebarWidth;

      const onMove = (moveEvent: MouseEvent) => {
        if (!dragging.current) return;
        const delta = moveEvent.clientX - startX.current;
        const next = Math.min(MAX_W, Math.max(MIN_W, startW.current + delta));
        setSidebarWidth(next);
      };

      const onUp = () => {
        dragging.current = false;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        setSidebarWidth((width) => {
          localStorage.setItem(SIDEBAR_KEY, String(width));
          return width;
        });
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [sidebarWidth]
  );

  const fetchInboxes = useCallback(async () => {
    try {
      const res = await fetchWithNamespace("/api/email/inboxes");
      const data = await res.json();
      const loadedInboxes = data.inboxes || [];
      setInboxes(loadedInboxes);
      if (loadedInboxes.length > 0 && !selectedInbox) {
        setSelectedInbox(loadedInboxes[0]);
      }
    } catch (err) {
      console.error("failed to load inboxes:", err);
      setInboxes([]);
    } finally {
      setLoading(false);
    }
  }, [fetchWithNamespace, selectedInbox]);

  const fetchEmails = useCallback(async () => {
    if (!selectedInbox) return;
    setEmailsLoading(true);
    try {
      const res = await fetchWithNamespace(
        `/api/email/inboxes/${encodeURIComponent(selectedInbox.id)}/messages?folder=${folder}&limit=50&offset=0`
      );
      const data = await res.json();
      setEmails(data.emails || []);
    } catch (err) {
      console.error("failed to load emails:", err);
      setEmails([]);
    } finally {
      setEmailsLoading(false);
    }
  }, [selectedInbox, folder, fetchWithNamespace]);

  useEffect(() => {
    fetchInboxes();
  }, [fetchInboxes]);

  useEffect(() => {
    fetchEmails();
  }, [fetchEmails]);

  const handleMoveToProcessed = useCallback(async () => {
    if (!selectedInbox || !selectedEmail) return;
    setMovingId(selectedEmail.internalId);
    try {
      await fetchWithNamespace(`/api/email/inboxes/${encodeURIComponent(selectedInbox.id)}/messages/${encodeURIComponent(selectedEmail.internalId)}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: folder, to: "processed" }),
      });
      setEmails((prev) => prev.filter((e) => e.internalId !== selectedEmail.internalId));
      setSelectedEmail(null);
    } catch (err) {
      console.error("failed to move email:", err);
    } finally {
      setMovingId(null);
    }
  }, [selectedInbox, selectedEmail, folder, fetchWithNamespace]);

  return (
    <div className="h-full flex flex-col">
      <PageBanner
        title="Email"
        subtitle="Inbound and outbound email routing for agents. Configure mailboxes that forward to chains, and compose messages from agent workflows."
        icon={DirectSendFilled}
        sectionColor="#b07ee8"
        actions={[
          { label: "Webhooks", href: "/webhooks", icon: Webhook, iconColor: "#b07ee8" },
          { label: "Chains", href: "/chains", icon: LinkFilled, iconColor: "#b07ee8" },
          { label: "Events", href: "/events", icon: SendFilled, iconColor: "#b07ee8" },
        ]}
        docs={[
          { label: "Email Guide", href: "/docs/email", icon: DirectSendFilled },
        ]}
      >
        <div className="flex items-center gap-2 mt-3">
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowCompose(true)}>
            <EditFilled className="h-3 w-3 mr-1" />
            Compose
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowCreateInbox(true)}>
            <AddFilled className="h-3 w-3 mr-1" />
            New Inbox
          </Button>
        </div>
      </PageBanner>

      <div className="flex-1 flex overflow-hidden pl-4">
        {/* left panel: inbox list */}
        <WorkflowSidebarPane style={{ width: sidebarWidth }}>
          <WorkflowSidebarFilters>
            <div className="flex items-center justify-between">
              <WorkflowSidebarSegmentedControl
                options={FOLDERS}
                value={folder}
                onChange={setFolder}
              />
              {(pollerState.polling || pollerState.error) && (
                <div className="shrink-0 ml-1">
                  {pollerState.polling ? (
                    <span className="w-1.5 h-1.5 rounded-full bg-foreground/40 animate-pulse inline-block" />
                  ) : (
                    <span className="text-[10px] text-red-400">err</span>
                  )}
                </div>
              )}
            </div>
          </WorkflowSidebarFilters>

          {/* inbox list */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <WaveSpinner size="sm" color="muted" animation="ripple" />
              </div>
            ) : inboxes.length === 0 ? (
              <div className="text-center py-12 px-4">
                <p className="text-xs text-foreground/30">No inboxes yet</p>
                <p className="text-[10px] text-foreground/20 mt-1">Create an inbox to receive email</p>
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {inboxes.map((inbox) => (
                  <WorkflowSidebarItem
                    key={inbox.id}
                    selected={selectedInbox?.id === inbox.id}
                    onClick={() => {
                      setSelectedInbox(inbox);
                      setSelectedEmail(null);
                    }}
                    accentClassName={inbox.enabled ? "bg-emerald-400" : undefined}
                  >
                    <div className="pl-4">
                      <div className="flex items-start justify-between gap-2">
                        <span className="line-clamp-1 text-sm font-semibold leading-5">{inbox.name}</span>
                        <span className="shrink-0 text-[10px] text-foreground/30">
                          {formatRelativeTime(inbox.createdAt)}
                        </span>
                      </div>

                      <p className="line-clamp-1 text-[11px] text-foreground/40 mt-0.5">
                        {inbox.address}
                      </p>

                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-foreground/40">
                        <span className={`rounded-full px-2 py-0.5 uppercase tracking-[0.14em] ${inbox.enabled ? "bg-emerald-500/15 text-emerald-400" : "bg-foreground/5"}`}>
                          {inbox.enabled ? "active" : "inactive"}
                        </span>
                        {inbox.chainId && (
                          <span className="rounded-full bg-foreground/5 px-2 py-0.5 uppercase tracking-[0.14em]">
                            chained
                          </span>
                        )}
                      </div>
                    </div>
                  </WorkflowSidebarItem>
                ))}
              </div>
            )}
          </div>

          <WorkflowSidebarResizeHandle onMouseDown={onDragStart} />
        </WorkflowSidebarPane>

        {/* right panel: message list + detail */}
        <div className="flex-1 flex overflow-hidden">
          {/* message list */}
          <div className="shrink-0 flex flex-col bg-card" style={{ width: messageListWidth }}>
            <div className="px-3 py-2 border-b border-foreground/5">
              <p className="text-xs font-medium">{selectedInbox?.name || "Select an inbox"}</p>
              <p className="text-[10px] text-foreground/40">{emails.length} messages</p>
            </div>

            <div className="flex-1 overflow-y-auto">
              {!selectedInbox ? (
                <div className="flex items-center justify-center h-full">
                  <p className="text-xs text-foreground/30">Select an inbox</p>
                </div>
              ) : emailsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <WaveSpinner size="sm" color="muted" animation="ripple" />
                </div>
              ) : emails.length === 0 ? (
                <div className="flex items-center justify-center h-full">
                  <p className="text-xs text-foreground/30">No messages</p>
                </div>
              ) : (
                <div>
                  {emails.map((email) => (
                    <button
                      key={email.internalId}
                      onClick={() => setSelectedEmail(email)}
                      className={`w-full text-left px-3 py-2 border-b border-foreground/5 transition-colors ${
                        selectedEmail?.internalId === email.internalId ? "bg-accent" : "hover:bg-accent"
                      }`}
                    >
                      <p className="text-xs font-medium truncate">{email.from}</p>
                      <p className="text-[10px] text-foreground/60 truncate">{email.subject}</p>
                      <p className="text-[10px] text-foreground/30 mt-0.5">{formatRelativeTime(email.receivedAt)}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* message detail */}
          <div className="flex-1 flex flex-col overflow-hidden bg-background">
            {!selectedEmail ? (
              <div className="flex items-center justify-center h-full">
                <p className="text-xs text-foreground/30">Select a message</p>
              </div>
            ) : (
              <>
                {/* message header */}
                <div className="px-3 pt-3 shrink-0">
                  <DetailHeader className="items-start gap-4">
                    <div className="relative flex-1 min-w-0">
                      <h2 className="text-lg font-bold tracking-tighter">{selectedEmail.subject}</h2>
                      <div className="mt-2 space-y-1">
                        <p className="text-xs">
                          <span className="text-foreground/50">from:</span>{" "}
                          <span className="text-foreground">{selectedEmail.from}</span>
                        </p>
                        <p className="text-xs">
                          <span className="text-foreground/50">to:</span>{" "}
                          <span className="text-foreground">{selectedEmail.to.join(", ")}</span>
                        </p>
                        <p className="text-[10px] text-foreground/30">
                          {new Date(selectedEmail.receivedAt).toLocaleString()}
                        </p>
                      </div>
                    </div>
                    {folder === "unread" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={handleMoveToProcessed}
                        disabled={movingId === selectedEmail.internalId}
                        className="h-7 text-xs shrink-0"
                      >
                        {movingId === selectedEmail.internalId ? (
                          <RefreshFilled className="h-3 w-3 animate-spin" />
                        ) : (
                          <>
                            <TickCircleFilled className="h-3 w-3 mr-1" />
                            Mark processed
                          </>
                        )}
                      </Button>
                    )}
                  </DetailHeader>
                </div>

                {/* message body */}
                <div className="flex-1 overflow-y-auto px-6 py-4">
                  {selectedEmail.textBody ? (
                    <pre className="text-xs whitespace-pre-wrap break-words font-mono text-foreground/80">
                      {selectedEmail.textBody}
                    </pre>
                  ) : selectedEmail.htmlBody ? (
                    <div
                      className="prose prose-invert prose-sm max-w-none"
                      dangerouslySetInnerHTML={{ __html: selectedEmail.htmlBody }}
                    />
                  ) : (
                    <p className="text-xs text-foreground/30">No body content</p>
                  )}

                  {/* attachments */}
                  {selectedEmail.attachments.length > 0 && (
                    <div className="mt-6 pt-4 border-t border-foreground/5">
                      <p className="text-xs font-medium mb-2">Attachments</p>
                      <div className="space-y-1">
                        {selectedEmail.attachments.map((att, i) => (
                          <div key={i} className="flex items-center justify-between px-3 py-2 bg-muted rounded-md">
                            <div className="flex-1 min-w-0">
                              <p className="text-xs truncate">{att.filename}</p>
                              <p className="text-[10px] text-foreground/40">
                                {att.contentType} • {(att.size / 1024).toFixed(1)} KB
                              </p>
                            </div>
                            {att.scanStatus === "blocked" && (
                              <span className="text-[10px] text-red-400 shrink-0 ml-2">blocked</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <ComposeDialog open={showCompose} onOpenChange={setShowCompose} />
      <CreateInboxDialog
        open={showCreateInbox}
        onOpenChange={setShowCreateInbox}
        onCreated={(inbox) => {
          setInboxes((prev) => [...prev, inbox]);
          setSelectedInbox(inbox);
        }}
      />
    </div>
  );
}
