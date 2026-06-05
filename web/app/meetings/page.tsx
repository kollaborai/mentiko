"use client";

/**
 * /meetings - live meeting rooms where AI agents collaborate
 *
 * shows active + completed peer review sessions
 * click any meeting to watch the conversation in split terminal view
 * launch new meetings from a prompt
 */

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PeopleFilled, LinkFilled, RouteSquareFilled, MessageFilled, PlayFilled as Play, Eye, RefreshFilled as RefreshCw } from "@aliimam/icons";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { unwrapApiData } from "@/lib/api/api-client";
import { PageBanner } from "@/components/ui/page-banner";

interface PeerInfo {
  session: string;
  role?: string;
  alive: boolean;
}

interface Meeting {
  id: string;
  status: "active" | "completed" | "stalled";
  peer1: PeerInfo;
  peer2: PeerInfo;
  manager?: string;
  initiative?: string;
  round?: number;
  startedAt: string;
  sessionConfig?: {
    peer1: { role: string; context: string };
    peer2: { role: string; context: string };
    objective: string;
  };
}

export default function MeetingsPage() {
  const { fetchWithNamespace } = useNamespaceFetch();
  const router = useRouter();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [initiative, setInitiative] = useState("");
  const [launching, setLaunching] = useState(false);

  const fetchMeetings = useCallback(async () => {
    try {
      const res = await fetchWithNamespace("/api/meetings");
      if (!res.ok) return;
      const raw = await res.json();
      const data = unwrapApiData<{ meetings?: Meeting[] }>(raw);
      setMeetings(data.meetings || []);
    } catch {}
    setLoading(false);
  }, [fetchWithNamespace]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchMeetings();
    const interval = setInterval(fetchMeetings, 5000);
    return () => clearInterval(interval);
  }, [fetchMeetings]);

  const handleLaunch = async () => {
    if (!initiative.trim()) return;
    setLaunching(true);
    try {
      // Use the first available link for quick-launch meetings
      const linksRes = await fetchWithNamespace("/api/links");
      if (!linksRes.ok) {
        setLaunching(false);
        return;
      }
      const linksData = await linksRes.json();
      const links = linksData?.data?.links || linksData?.links || [];
      const defaultLink = links.find((l: { id: string }) => l.id === "default") || links[0];

      if (!defaultLink) {
        setLaunching(false);
        return;
      }

      const res = await fetchWithNamespace("/api/links/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          linkId: defaultLink.id,
          goalOverride: initiative,
        }),
      });
      if (res.ok) {
        const runData = await res.json();
        const runId = runData?.data?.runId || runData?.runId || runData?.data?.id || runData?.id;
        setInitiative("");
        // navigate to run detail to watch
        if (runId) router.push(`/runs/${runId}`);
      }
    } catch {}
    setLaunching(false);
  };

  const activeMeetings = meetings.filter((m) => m.status === "active");
  const completedMeetings = meetings.filter((m) => m.status !== "active");

  const handleWatch = (meeting: Meeting) => {
    if (meeting.status === "active") {
      // active meetings: go to links page which shows live sessions
      router.push("/links");
    } else {
      // completed/stalled: go to transcript viewer
      router.push(`/meetings/${meeting.id}`);
    }
  };

  const formatTime = (iso: string) => {
    try {
      const d = new Date(iso);
      const now = new Date();
      const diffMs = now.getTime() - d.getTime();
      const diffMin = Math.floor(diffMs / 60000);
      if (diffMin < 1) return "just now";
      if (diffMin < 60) return `${diffMin}m ago`;
      const diffHr = Math.floor(diffMin / 60);
      if (diffHr < 24) return `${diffHr}h ago`;
      return `${Math.floor(diffHr / 24)}d ago`;
    } catch {
      return "";
    }
  };

  return (
    <div className="h-full flex flex-col">
      <PageBanner
        title="meetings"
        subtitle="Live collaboration rooms where AI agents debate, review, and build together on your initiatives in real time."
        icon={PeopleFilled}
        sectionColor="#b07ee8"
        actions={[
          { label: "Links", href: "/links", icon: LinkFilled, iconColor: "#b07ee8" },
          { label: "Runs", href: "/runs", icon: RouteSquareFilled, iconColor: "#5b9ef5" },
          { label: "Conversations", href: "/conversations", icon: MessageFilled, iconColor: "#5b9ef5" },
        ]}
      />

      <div className="flex-1 overflow-auto">
        <div className="max-w-3xl mx-auto px-3 sm:px-6 py-6 space-y-6">
          {/* launch new meeting */}
          <div className="bg-card rounded-sm p-4">
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={initiative}
                onChange={(e) => setInitiative(e.target.value)}
                onKeyDown={(e) =>
                  e.key === "Enter" &&
                  !launching &&
                  initiative.trim() &&
                  handleLaunch()
                }
                placeholder="describe an initiative to start a meeting..."
                disabled={launching}
                className="flex-1 px-3 py-2 bg-muted text-sm rounded-sm border-0 focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
              />
              <Button
                onClick={handleLaunch}
                disabled={launching || !initiative.trim()}
                size="sm"
                className="h-9"
              >
                <Play className="h-3.5 w-3.5 mr-1.5" />
                {launching ? "planning..." : "new meeting"}
              </Button>
            </div>
          </div>

          {/* active meetings */}
          {activeMeetings.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-medium text-foreground/70">
                  active ({activeMeetings.length})
                </h2>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={fetchMeetings}
                  className="h-6 text-[10px]"
                >
                  <RefreshCw className="h-3 w-3 mr-1" />
                  refresh
                </Button>
              </div>
              <div className="space-y-2">
                {activeMeetings.map((m) => (
                  <div
                    key={m.id}
                    onClick={() => handleWatch(m)}
                    className="bg-card rounded-sm p-4 hover:bg-accent/30 cursor-pointer transition-colors"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                          <span className="text-sm font-medium truncate">
                            {m.sessionConfig?.objective ||
                              m.initiative ||
                              m.id}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-[11px] text-foreground/40">
                          {m.sessionConfig ? (
                            <>
                              <span className="text-blue-400/70">
                                {m.sessionConfig.peer1.role}
                              </span>
                              <span className="text-foreground/20">x</span>
                              <span className="text-purple-400/70">
                                {m.sessionConfig.peer2.role}
                              </span>
                            </>
                          ) : (
                            <>
                              <span>{m.peer1.session}</span>
                              <span className="text-foreground/20">x</span>
                              <span>{m.peer2.session}</span>
                            </>
                          )}
                          {m.round && (
                            <span className="text-foreground/30">
                              round {m.round}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[10px] text-foreground/30">
                          {formatTime(m.startedAt)}
                        </span>
                        <Eye className="h-3.5 w-3.5 text-foreground/30" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* completed meetings */}
          {completedMeetings.length > 0 && (
            <div>
              <h2 className="text-sm font-medium text-foreground/40 mb-3">
                completed ({completedMeetings.length})
              </h2>
              <div className="space-y-1">
                {completedMeetings.map((m) => (
                  <div
                    key={m.id}
                    onClick={() => handleWatch(m)}
                    className="bg-card/50 rounded-sm px-4 py-3 hover:bg-accent/20 cursor-pointer transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-foreground/20" />
                        <span className="text-xs text-foreground/50 truncate">
                          {m.sessionConfig?.objective ||
                            m.initiative ||
                            m.id}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        {m.sessionConfig && (
                          <span className="text-[10px] text-foreground/30">
                            {m.sessionConfig.peer1.role} x{" "}
                            {m.sessionConfig.peer2.role}
                          </span>
                        )}
                        {m.round && (
                          <span className="text-[10px] text-foreground/20">
                            {m.round}r
                          </span>
                        )}
                        <span className="text-[10px] text-foreground/20">
                          {formatTime(m.startedAt)}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* empty state */}
          {!loading && meetings.length === 0 && (
            <div className="text-center py-20">
              <p className="text-foreground/30 text-sm mb-2">
                no meetings yet
              </p>
              <p className="text-foreground/20 text-xs">
                describe an initiative above to start your first AI meeting
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
