import { render, screen, waitFor } from "@testing-library/react";
import type { AnchorHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { OnboardingRunMonitor, formatAnswerBlocks } from "./run-monitor";

const mockFetchWithNamespace = jest.fn();

jest.mock("@/lib/hooks/use-namespace-fetch", () => ({
  useNamespaceFetch: () => ({ fetchWithNamespace: mockFetchWithNamespace }),
}));

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href, ...props }: { children: ReactNode; href: string } & AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

jest.mock("motion/react", () => {
  const React = jest.requireActual("react");
  return {
    motion: new Proxy({}, {
      get: (_target, tag: string) =>
        ({ children, ...props }: HTMLAttributes<HTMLElement>) => React.createElement(tag, props, children),
    }),
  };
});

jest.mock("@aliimam/icons", () => {
  const Icon = () => <span />;
  return {
    RotateFilled: Icon,
    TickCircleFilled: Icon,
    CloseCircleFilled: Icon,
    Warning2Filled: Icon,
    ClockFilled: Icon,
    StopCircleFilled: Icon,
    ArrowRight2Filled: Icon,
  };
});

function jsonResponse(payload: unknown, options: { ok?: boolean; status?: number } = {}) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    json: async () => payload,
    text: async () => (typeof payload === "string" ? payload : ""),
  };
}

const RUNNING_RUN = {
  id: "run-1",
  status: "running",
  started: new Date(Date.now() - 5_000).toISOString(),
  agents: [{ id: "a1", name: "Agent One", status: "running", lastMessage: "thinking" }],
};

const COMPLETED_RUN = {
  id: "run-1",
  status: "completed",
  started: RUNNING_RUN.started,
  completed: new Date().toISOString(),
  agents: [{
    id: "a1", name: "Agent One", status: "complete",
    // the real bug: lastMessage freezes at the last LIVE line before the
    // agent finished and is never updated on completion — must not be
    // shown once the agent is complete.
    lastMessage: "queued: waiting for an active agent slot",
    durableOutput: "All done.",
  }],
};

describe("OnboardingRunMonitor", () => {
  beforeEach(() => {
    mockFetchWithNamespace.mockReset();
  });

  it("polls a running run to completion and calls onTerminal exactly once", async () => {
    let runCalls = 0;
    mockFetchWithNamespace.mockImplementation(async (url: string) => {
      if (url.includes("/output")) return jsonResponse("");
      if (url === "/api/runs/run-1") {
        runCalls += 1;
        return jsonResponse({ run: runCalls === 1 ? RUNNING_RUN : COMPLETED_RUN });
      }
      return jsonResponse({});
    });

    const onTerminal = jest.fn();
    render(<OnboardingRunMonitor runId="run-1" onTerminal={onTerminal} />);

    expect(await screen.findByText("Running")).toBeInTheDocument();
    expect(screen.getByText("Agent One")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();

    await waitFor(
      () => expect(onTerminal).toHaveBeenCalledWith({ status: "completed", runId: "run-1" }),
      { timeout: 6000 },
    );
    expect(onTerminal).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Completed")).toBeInTheDocument();
    // the real bounded answer shows up (per-agent line and/or terminal summary)...
    await waitFor(() => expect(screen.getAllByText("All done.").length).toBeGreaterThan(0));
    // ...and the stale pre-start lastMessage never does, now that the agent is complete
    expect(screen.queryByText(/queued: waiting/)).not.toBeInTheDocument();
    // a terminal run has nothing left to cancel
    expect(screen.queryByRole("button", { name: /cancel/i })).not.toBeInTheDocument();
  }, 10000);

  it("falls back to the run's output.log tail when a completed agent has no durableOutput", async () => {
    const runNoDurable = {
      id: "run-1", status: "completed", started: RUNNING_RUN.started, completed: new Date().toISOString(),
      agents: [{ id: "a1", name: "Agent One", status: "complete", lastMessage: "queued: waiting for an active agent slot" }],
    };
    mockFetchWithNamespace.mockImplementation(async (url: string) => {
      if (url.includes("/artifacts")) return jsonResponse({}, { ok: false, status: 404 });
      if (url.includes("/output")) return jsonResponse("some raw log line\nAnswer from the log tail.");
      return jsonResponse({ run: runNoDurable });
    });

    render(<OnboardingRunMonitor runId="run-1" />);

    expect(await screen.findByText(/Answer from the log tail/)).toBeInTheDocument();
    expect(screen.queryByText(/queued: waiting/)).not.toBeInTheDocument();
  });

  it("falls back to the artifacts endpoint's summary.md when durableOutput and the output log are both empty", async () => {
    const runNoOutput = {
      id: "run-1", status: "completed", started: RUNNING_RUN.started, completed: new Date().toISOString(),
      agents: [{ id: "a1", name: "Agent One", status: "complete" }],
    };
    mockFetchWithNamespace.mockImplementation(async (url: string) => {
      if (url.includes("/artifacts")) return jsonResponse({ content: "# Summary\n\nStatus: complete\n\nAll done via artifact." });
      if (url.includes("/output")) return jsonResponse("");
      return jsonResponse({ run: runNoOutput });
    });

    render(<OnboardingRunMonitor runId="run-1" />);

    expect(await screen.findByText(/All done via artifact/)).toBeInTheDocument();
  });

  it("formats a real markdown summary as prose instead of literal '#'/backtick syntax", async () => {
    const markdown = [
      "# Project Summary",
      "",
      "dsk is a self-hostable issue tracker for small teams.",
      "",
      "## Evidence",
      "",
      "`package.json` name is `dsk`.",
    ].join("\n");
    const runMarkdown = {
      id: "run-1", status: "completed", started: RUNNING_RUN.started, completed: new Date().toISOString(),
      agents: [{
        id: "project-summarizer", name: "Project Summarizer", status: "complete",
        lastMessage: "queued: waiting for an active agent slot",
        durableOutput: markdown,
      }],
    };
    mockFetchWithNamespace.mockImplementation(async (url: string) => {
      if (url.includes("/output")) return jsonResponse("");
      return jsonResponse({ run: runMarkdown });
    });

    render(<OnboardingRunMonitor runId="run-1" />);

    // clean first paragraph, not the "# Project Summary" heading — shows in
    // both the per-agent one-liner and the terminal summary block
    await waitFor(() => expect(
      screen.getAllByText("dsk is a self-hostable issue tracker for small teams.").length,
    ).toBeGreaterThan(0));
    // the sub-heading becomes its own small label, not literal "## Evidence"
    expect(await screen.findByText("Evidence")).toBeInTheDocument();
    // never raw markdown syntax anywhere on the page
    expect(document.body.textContent).not.toMatch(/[#`]/);
  });

  it("shows an honest placeholder when no output is available anywhere", async () => {
    const runNoOutput = {
      id: "run-1", status: "completed", started: RUNNING_RUN.started, completed: new Date().toISOString(),
      agents: [{ id: "a1", name: "Agent One", status: "complete" }],
    };
    mockFetchWithNamespace.mockImplementation(async (url: string) => {
      if (url.includes("/artifacts")) return jsonResponse({}, { ok: false, status: 404 });
      if (url.includes("/output")) return jsonResponse("");
      return jsonResponse({ run: runNoOutput });
    });

    render(<OnboardingRunMonitor runId="run-1" />);

    expect(await screen.findByText("Completed. No text output was captured.")).toBeInTheDocument();
  });

  it("shows a not-found state for a run the API does not know about", async () => {
    mockFetchWithNamespace.mockImplementation(async () => jsonResponse({}, { ok: false, status: 404 }));

    render(<OnboardingRunMonitor runId="missing-run" />);

    expect(await screen.findByText("Run not found.")).toBeInTheDocument();
  });

  it("renders the compact variant with the run's status and active agent", async () => {
    mockFetchWithNamespace.mockImplementation(async (url: string) => {
      if (url.includes("/output")) return jsonResponse("");
      return jsonResponse({ run: RUNNING_RUN });
    });

    render(<OnboardingRunMonitor runId="run-1" title="Readiness" compact />);

    expect(await screen.findByText(/Readiness/)).toBeInTheDocument();
    expect(screen.getByText(/Agent One/)).toBeInTheDocument();
  });
});

describe("formatAnswerBlocks", () => {
  it("drops the leading title heading, keeps the first paragraph as a summary, turns sub-headings into their own block, and strips backticks", () => {
    const markdown = [
      "# Project Summary",
      "",
      "dsk is a self-hostable issue tracker.",
      "",
      "## Evidence",
      "",
      "`package.json` says so.",
    ].join("\n");

    expect(formatAnswerBlocks(markdown)).toEqual([
      { type: "paragraph", text: "dsk is a self-hostable issue tracker." },
      { type: "heading", text: "Evidence" },
      { type: "paragraph", text: "package.json says so." },
    ]);
  });

  it("returns a single paragraph block for plain text with no markdown", () => {
    expect(formatAnswerBlocks("Completed. No text output was captured.")).toEqual([
      { type: "paragraph", text: "Completed. No text output was captured." },
    ]);
  });
});
