import { mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { reconcileOrphanedRuns } from "../run-reconciler";
import { getLiveSessions } from "../pty-client";
import { taskGet, taskMergeMeta } from "../task-store";

let mockRunsDir = "";
let mockEventsDir = "";

jest.mock("../config", () => ({
  __esModule: true,
  default: {
    get runsDir() {
      return mockRunsDir;
    },
    get eventsDir() {
      return mockEventsDir;
    },
    namespaceId: "default",
    orgId: "default",
  },
}));

jest.mock("../pty-client", () => ({
  getLiveSessions: jest.fn(),
}));

jest.mock("../system-logger", () => ({
  writeLog: jest.fn(),
}));

jest.mock("../task-store", () => ({
  taskGet: jest.fn(() => ({ metadata: {} })),
  taskMergeMeta: jest.fn(),
}));

describe("run reconciler", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "mentiko-run-reconciler-"));
    mockRunsDir = join(root, "runs");
    mockEventsDir = join(root, "events");
    mkdirSync(mockRunsDir, { recursive: true });
    mkdirSync(mockEventsDir, { recursive: true });
    (getLiveSessions as jest.Mock).mockResolvedValue(new Set());
    (taskGet as jest.Mock).mockReturnValue({ metadata: {} });
    (taskMergeMeta as jest.Mock).mockClear();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    jest.clearAllMocks();
  });

  it("recovers a completed current agent from its emitted event without accepting downstream out-of-scope events", async () => {
    const runDir = join(mockRunsDir, "run-1777862548347");
    mkdirSync(runDir, { recursive: true });

    writeFileSync(
      join(runDir, "chain.json"),
      JSON.stringify({
        agents: [
          { id: "middleware-architect", emits: "architecture-designed" },
          { id: "rbac-guest-enforcer", emits: "guest-enforcement-implemented" },
        ],
      })
    );

    writeFileSync(
      join(runDir, "run.json"),
      JSON.stringify({
        id: "run-1777862548347",
        status: "stopped",
        taskId: "TASK-032",
        completed: "2026-05-04T02:53:33.838Z",
        agents: [
          {
            id: "middleware-architect",
            name: "Middleware Architect",
            status: "stopped",
            session: "mentiko-uam-middleware-architect-run-1777862548347",
            started: "2026-05-04T02:42:31.000Z",
          },
          {
            id: "rbac-guest-enforcer",
            name: "RBAC Guest Enforcer",
            status: "cancelled",
            session: "",
          },
        ],
      })
    );

    const middlewareEvent = join(mockEventsDir, "uam-middleware-architect-architecture-designed.event");
    writeFileSync(
      middlewareEvent,
      [
        "event: architecture-designed",
        "source: uam-middleware-architect",
        "timestamp: 2026-05-03T10:30:00.000Z",
        "processed: false",
      ].join("\n")
    );
    utimesSync(middlewareEvent, new Date("2026-05-04T02:45:44.687Z"), new Date("2026-05-04T02:45:44.687Z"));

    writeFileSync(
      join(mockEventsDir, "uam-rbac-guest-enforcer-guest-enforcement-implemented.event"),
      [
        "event: guest-enforcement-implemented",
        "source: uam-rbac-guest-enforcer",
        "timestamp: 2026-05-03T10:45:00.000Z",
        "processed: false",
      ].join("\n")
    );

    const result = await reconcileOrphanedRuns();
    const run = JSON.parse(readFileSync(join(runDir, "run.json"), "utf-8"));

    expect(result.cleaned).toContain("run-1777862548347");
    expect(run.agents[0].status).toBe("complete");
    expect(run.agents[0].completed).toBeTruthy();
    expect(run.agents[1].status).toBe("cancelled");
    expect(taskMergeMeta).toHaveBeenCalledWith(
      "default",
      "TASK-032",
      expect.objectContaining({
        last_run_agents: "middleware-architect|complete,rbac-guest-enforcer|cancelled",
      }),
      "default"
    );
  });

  it("does not recover an agent from an event written after that run already stopped", async () => {
    const runDir = join(mockRunsDir, "run-1777857759654");
    mkdirSync(runDir, { recursive: true });

    writeFileSync(
      join(runDir, "chain.json"),
      JSON.stringify({
        agents: [
          { id: "middleware-architect", emits: "architecture-designed" },
        ],
      })
    );

    writeFileSync(
      join(runDir, "run.json"),
      JSON.stringify({
        id: "run-1777857759654",
        status: "stopped",
        taskId: "TASK-032",
        completed: "2026-05-04T01:31:10.309Z",
        agents: [
          {
            id: "middleware-architect",
            name: "Middleware Architect",
            status: "stopped",
            session: "mentiko-uam-middleware-architect-run-1777857759654",
            started: "2026-05-04T01:22:42.000Z",
          },
        ],
      })
    );

    const eventPath = join(mockEventsDir, "uam-middleware-architect-architecture-designed.event");
    writeFileSync(
      eventPath,
      [
        "event: architecture-designed",
        "source: uam-middleware-architect",
        "timestamp: 2026-05-03T10:30:00.000Z",
        "processed: false",
      ].join("\n")
    );
    utimesSync(eventPath, new Date("2026-05-04T02:45:44.687Z"), new Date("2026-05-04T02:45:44.687Z"));

    const result = await reconcileOrphanedRuns();
    const run = JSON.parse(readFileSync(join(runDir, "run.json"), "utf-8"));

    expect(result.cleaned).not.toContain("run-1777857759654");
    expect(run.agents[0].status).toBe("stopped");
  });

  it("repairs an impossible recovered completion timestamp on a stopped run", async () => {
    const runDir = join(mockRunsDir, "run-1777857759654");
    mkdirSync(runDir, { recursive: true });

    writeFileSync(
      join(runDir, "chain.json"),
      JSON.stringify({
        agents: [
          { id: "middleware-architect", emits: "architecture-designed" },
        ],
      })
    );

    writeFileSync(
      join(runDir, "run.json"),
      JSON.stringify({
        id: "run-1777857759654",
        status: "stopped",
        taskId: "TASK-032",
        completed: "2026-05-04T01:31:10.309Z",
        agents: [
          {
            id: "middleware-architect",
            name: "Middleware Architect",
            status: "complete",
            session: "mentiko-uam-middleware-architect-run-1777857759654",
            started: "2026-05-04T01:22:42.000Z",
            completed: "2026-05-04T02:45:44.687Z",
          },
        ],
      })
    );

    const result = await reconcileOrphanedRuns();
    const run = JSON.parse(readFileSync(join(runDir, "run.json"), "utf-8"));

    expect(result.cleaned).toContain("run-1777857759654");
    expect(run.agents[0].status).toBe("stopped");
    expect(run.agents[0].completed).toBeUndefined();
  });
});
