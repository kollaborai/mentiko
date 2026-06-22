"use client";

/**
 * /meetings/{id} - transcript viewer for a completed peer review session
 *
 * shows the back-and-forth between red and blue peers, ordered
 * chronologically by epoch. each message shows role, round, and text.
 */

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { CalendarFilled, PeopleFilled, RouteSquareFilled, FlashFilled } from "@aliimam/icons";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { PageBanner } from "@/components/ui/page-banner";

interface TranscriptEntry {
  role: "red" | "blue";
  session: string;
  round: number;
  epoch: number;
  text: string;
}

export default function MeetingTranscriptPage() {
  const { id } = useParams<{ id: string }>();
  const { fetchWithNamespace } = useNamespaceFetch();
  const [transcriptState, setTranscriptState] = useState<{
    id: string;
    entries: TranscriptEntry[];
    loading: boolean;
    error: string | null;
  }>({
    id,
    entries: [],
    loading: true,
    error: null,
  });

  const entries = transcriptState.id === id ? transcriptState.entries : [];
  const loading = transcriptState.id !== id || transcriptState.loading;
  const error = transcriptState.id === id ? transcriptState.error : null;

  useEffect(() => {
    let cancelled = false;

    async function fetchTranscript() {
      try {
        const res = await fetchWithNamespace(
          `/api/meetings/${id}/transcript`
        );
        if (!res.ok) {
          if (!cancelled) {
            setTranscriptState({
              id,
              entries: [],
              loading: false,
              error: "failed to load transcript",
            });
          }
          return;
        }
        const data = (await res.json()) as {
          transcript: TranscriptEntry[];
        };
        if (!cancelled) {
          setTranscriptState({
            id,
            entries: data.transcript || [],
            loading: false,
            error: null,
          });
        }
      } catch {
        if (!cancelled) {
          setTranscriptState({
            id,
            entries: [],
            loading: false,
            error: "failed to load transcript",
          });
        }
      }
    }

    void fetchTranscript();

    return () => {
      cancelled = true;
    };
  }, [fetchWithNamespace, id]);

  // group entries by round for visual separation
  const rounds = entries.reduce<Map<number, TranscriptEntry[]>>(
    (acc, entry) => {
      const group = acc.get(entry.round) || [];
      group.push(entry);
      acc.set(entry.round, group);
      return acc;
    },
    new Map()
  );

  const sortedRounds = Array.from(rounds.keys()).sort((a, b) => a - b);

  return (
    <div className="h-full flex flex-col">
      <PageBanner
        title={`meeting ${id}`}
        subtitle="Full transcript of the peer review session. Each round shows the back-and-forth between red and blue agents."
        icon={CalendarFilled}
        sectionColor="#b07ee8"
        actions={[
          { label: "All Meetings", href: "/meetings", icon: PeopleFilled, iconColor: "#b07ee8" },
          { label: "Runs", href: "/runs", icon: RouteSquareFilled, iconColor: "#5b9ef5" },
          { label: "Links", href: "/links", icon: FlashFilled, iconColor: "#b07ee8" },
        ]}
      />

      <div className="flex-1 overflow-auto">
        <div className="max-w-3xl mx-auto px-3 sm:px-6 py-6 space-y-6">
          {loading && (
            <div className="text-center py-20">
              <p className="text-foreground/30 text-sm">
                loading transcript...
              </p>
            </div>
          )}

          {error && (
            <div className="text-center py-20">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}

          {!loading && !error && entries.length === 0 && (
            <div className="text-center py-20">
              <p className="text-foreground/30 text-sm">
                no transcript found
              </p>
            </div>
          )}

          {!loading &&
            !error &&
            sortedRounds.map((round) => (
              <div key={round} className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="h-px flex-1 bg-muted" />
                  <span className="text-[10px] text-foreground/30 uppercase tracking-wider">
                    round {round}
                  </span>
                  <div className="h-px flex-1 bg-muted" />
                </div>

                {rounds.get(round)!.map((entry) => (
                  <div
                    key={`${entry.role}-${entry.epoch}`}
                    className={`flex ${
                      entry.role === "blue"
                        ? "justify-end"
                        : "justify-start"
                    }`}
                  >
                    <div
                      className={`max-w-[85%] rounded-sm p-4 ${
                        entry.role === "red"
                          ? "bg-card"
                          : "bg-muted"
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <span
                          className={`text-[11px] font-medium ${
                            entry.role === "red"
                              ? "text-red-400"
                              : "text-blue-400"
                          }`}
                        >
                          {entry.role}
                        </span>
                        <span className="text-[10px] text-foreground/20">
                          r{entry.round}
                        </span>
                      </div>
                      <div className="text-sm text-foreground/80 whitespace-pre-wrap leading-relaxed">
                        {entry.text}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
