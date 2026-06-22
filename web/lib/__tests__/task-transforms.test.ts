import {
  mapPriority,
  priorityOrder,
  toTask,
  epicToGoalProps,
  graphToNodes,
  priorityColor,
  priorityBgColor,
  typeLabel,
  typeBgColor,
  groupByEpic,
  timeAgo,
} from "../tasks/task-transforms";
import type { TaskRecord, EpicStatus, GraphOutput } from "../tasks/task-types";

describe("mapPriority", () => {
  it("maps 0 to high", () => expect(mapPriority(0)).toBe("high"));
  it("maps 1 to high", () => expect(mapPriority(1)).toBe("high"));
  it("maps 2 to medium", () => expect(mapPriority(2)).toBe("medium"));
  it("maps 3 to low", () => expect(mapPriority(3)).toBe("low"));
  it("maps 4 to none", () => expect(mapPriority(4)).toBe("none"));
  it("maps 5+ to none", () => expect(mapPriority(99)).toBe("none"));
});

describe("priorityOrder", () => {
  it("high = 0", () => expect(priorityOrder("high")).toBe(0));
  it("medium = 1", () => expect(priorityOrder("medium")).toBe(1));
  it("low = 2", () => expect(priorityOrder("low")).toBe(2));
  it("none = 3", () => expect(priorityOrder("none")).toBe(3));
});

describe("toTask", () => {
  const baseTaskRecord: TaskRecord = {
    id: "test-123",
    title: "Test task",
    description: "A test",
    status: "open",
    priority: 2,
    issue_type: "task",
    owner: "marco",
    created_at: "2025-02-20T10:00:00Z",
    created_by: "marco",
    updated_at: "2025-02-20T12:00:00Z",
  };

  it("maps basic fields", () => {
    const task = toTask(baseTaskRecord);
    expect(task.id).toBe("test-123");
    expect(task.title).toBe("Test task");
    expect(task.completed).toBe(false);
    expect(task.status).toBe("open");
    expect(task.priority).toBe("medium");
    expect(task.rawPriority).toBe(2);
    expect(task.type).toBe("task");
    expect(task.owner).toBe("marco");
  });

  it("maps closed status to completed", () => {
    const task = toTask({ ...baseTaskRecord, status: "closed" });
    expect(task.completed).toBe(true);
    expect(task.status).toBe("closed");
  });

  it("extracts chain binding from metadata string", () => {
    const issue: TaskRecord = {
      ...baseTaskRecord,
      metadata: JSON.stringify({
        chain_id: "code-review",
        chain_name: "Code Review",
        auto_run: true,
        last_run_id: "run-1",
        last_run_status: "complete",
        last_run_outcome: "partial_pass",
        last_run_decision_required: true,
      }),
    };
    const task = toTask(issue);
    expect(task.chainBinding).toBeDefined();
    expect(task.chainBinding!.chain_id).toBe("code-review");
    expect(task.chainBinding!.chain_name).toBe("Code Review");
    expect(task.chainBinding!.auto_run).toBe(true);
    expect(task.chainBinding!.last_run_id).toBe("run-1");
    expect(task.chainBinding!.last_run_status).toBe("complete");
    expect(task.chainBinding!.last_run_outcome).toBe("partial_pass");
    expect(task.chainBinding!.last_run_decision_required).toBe(true);
  });

  it("exposes recommendation and generated-chain audit run ids separately", () => {
    const issue: TaskRecord = {
      ...baseTaskRecord,
      metadata: JSON.stringify({
        chain_id: "code-review",
        auto_run: false,
        last_run_id: "run-execution",
        recommendation_run_id: "run-recommend",
        recommendation_chain_id: "chain-recommendation",
        generated_chain_run_id: "run-generate",
        generated_chain_source_chain_id: "chain-generation",
      }),
    };
    const task = toTask(issue);
    expect(task.chainBinding).toBeDefined();
    expect(task.chainBinding!.last_run_id).toBe("run-execution");
    expect(task.chainBinding!.recommendation_run_id).toBe("run-recommend");
    expect(task.chainBinding!.recommendation_chain_id).toBe("chain-recommendation");
    expect(task.chainBinding!.generated_chain_run_id).toBe("run-generate");
    expect(task.chainBinding!.generated_chain_source_chain_id).toBe("chain-generation");
  });

  it("normalizes legacy recommendation audit run pollution away from execution run fields", () => {
    const issue: TaskRecord = {
      ...baseTaskRecord,
      metadata: {
        chain_id: "validate-task-generation-pipeline",
        chain_name: "Validate Task Generation Pipeline",
        last_run_id: "run-recommend",
        last_run_status: "completed",
        last_run_chain: "Chain Recommendation",
      },
    };
    const task = toTask(issue);
    expect(task.chainBinding).toBeDefined();
    expect(task.chainBinding!.last_run_id).toBeUndefined();
    expect(task.chainBinding!.last_run_status).toBeUndefined();
    expect(task.chainBinding!.recommendation_run_id).toBe("run-recommend");
    expect(task.chainBinding!.recommendation_chain_id).toBe("chain-recommendation");
  });

  it("normalizes legacy generation audit run pollution away from execution run fields", () => {
    const issue: TaskRecord = {
      ...baseTaskRecord,
      metadata: {
        chain_id: "generated-chain",
        last_run_id: "run-generate",
        last_run_status: "completed",
        last_run_summary: {
          chain: "Chain Generation",
        },
      },
    };
    const task = toTask(issue);
    expect(task.chainBinding).toBeDefined();
    expect(task.chainBinding!.last_run_id).toBeUndefined();
    expect(task.chainBinding!.last_run_status).toBeUndefined();
    expect(task.chainBinding!.generated_chain_run_id).toBe("run-generate");
    expect(task.chainBinding!.generated_chain_source_chain_id).toBe("chain-generation");
  });

  it("extracts chain binding from metadata object", () => {
    const issue: TaskRecord = {
      ...baseTaskRecord,
      metadata: {
        chain_id: "deploy",
        auto_run: false,
      },
    };
    const task = toTask(issue);
    expect(task.chainBinding).toBeDefined();
    expect(task.chainBinding!.chain_id).toBe("deploy");
    expect(task.chainBinding!.auto_run).toBe(false);
  });

  it("returns no chain binding when metadata has no chain_id", () => {
    const issue: TaskRecord = {
      ...baseTaskRecord,
      metadata: JSON.stringify({ some_key: "value" }),
    };
    const task = toTask(issue);
    expect(task.chainBinding).toBeUndefined();
  });

  it("does not treat task generation provenance as chain binding metadata", () => {
    const issue: TaskRecord = {
      ...baseTaskRecord,
      metadata: {
        task_generation_job_id: "job-task",
        task_generation_run_id: "run-task",
        task_generation_chain_id: "task-generation",
      },
    };
    const task = toTask(issue);
    expect(task.chainBinding).toBeUndefined();
  });

  it("handles missing optional fields", () => {
    const task = toTask(baseTaskRecord);
    expect(task.assignee).toBe("");
    expect(task.labels).toEqual([]);
    expect(task.dueDate).toBeUndefined();
    expect(task.estimate).toBeUndefined();
    expect(task.dependencyCount).toBe(0);
    expect(task.dependentCount).toBe(0);
    expect(task.commentCount).toBe(0);
    expect(task.parentId).toBeUndefined();
  });

  it("handles invalid metadata JSON", () => {
    const issue: TaskRecord = {
      ...baseTaskRecord,
      metadata: "not json",
    };
    const task = toTask(issue);
    expect(task.chainBinding).toBeUndefined();
  });
});

describe("epicToGoalProps", () => {
  const baseEpic: EpicStatus = {
    id: "epic-1",
    title: "V1 MVP",
    description: "First release",
    status: "open",
    priority: 1,
    total_children: 10,
    closed_children: 3,
  };

  it("calculates progress percentage", () => {
    const props = epicToGoalProps(baseEpic);
    expect(props.progress).toBe(30);
    expect(props.meta).toBe("3/10 done");
  });

  it("returns 0 progress when no children", () => {
    const epic = { ...baseEpic, total_children: 0, closed_children: 0 };
    const props = epicToGoalProps(epic);
    expect(props.progress).toBe(0);
  });

  it("returns completed status when all done", () => {
    const epic = { ...baseEpic, total_children: 5, closed_children: 5 };
    const props = epicToGoalProps(epic);
    expect(props.status).toBe("completed");
  });

  it("returns in_progress when some done", () => {
    const props = epicToGoalProps(baseEpic);
    expect(props.status).toBe("in_progress");
  });

  it("returns pending when none done", () => {
    const epic = { ...baseEpic, closed_children: 0 };
    const props = epicToGoalProps(epic);
    expect(props.status).toBe("pending");
  });
});

describe("graphToNodes", () => {
  it("converts graph layout to nodes and links", () => {
    const graph: GraphOutput = {
      layout: {
        Nodes: {
          "task-1": {
            Issue: {
              id: "task-1",
              title: "Task One",
              issue_type: "task",
              status: "open",
              priority: 2,
              description: "",
              owner: "",
              created_at: "",
              created_by: "",
              updated_at: "",
            },
            Layer: 0,
            Position: 0,
            DependsOn: null,
          },
          "task-2": {
            Issue: {
              id: "task-2",
              title: "Task Two",
              issue_type: "task",
              status: "closed",
              priority: 1,
              description: "",
              owner: "",
              created_at: "",
              created_by: "",
              updated_at: "",
            },
            Layer: 1,
            Position: 0,
            DependsOn: ["task-1"],
          },
        },
        Layers: [["task-1"], ["task-2"]],
        MaxLayer: 1,
        RootID: "task-1",
      },
    };

    const result = graphToNodes(graph);
    expect(result.nodes).toHaveLength(2);
    expect(result.links).toHaveLength(1);
    expect(result.links[0]).toEqual({
      source: "task-1",
      target: "task-2",
      type: "blocks",
    });
  });
});

describe("priorityColor", () => {
  it("high = red", () => expect(priorityColor("high")).toContain("red"));
  it("medium = amber", () => expect(priorityColor("medium")).toContain("amber"));
  it("low = blue", () => expect(priorityColor("low")).toContain("blue"));
  it("none = foreground", () => expect(priorityColor("none")).toContain("foreground"));
});

describe("priorityBgColor", () => {
  it("returns bg class for each priority", () => {
    expect(priorityBgColor("high")).toContain("bg-red");
    expect(priorityBgColor("medium")).toContain("bg-amber");
    expect(priorityBgColor("low")).toContain("bg-blue");
    expect(priorityBgColor("none")).toContain("bg-foreground");
  });
});

describe("typeLabel", () => {
  it("maps known types", () => {
    expect(typeLabel("epic")).toBe("EPIC");
    expect(typeLabel("feature")).toBe("FEAT");
    expect(typeLabel("task")).toBe("TASK");
    expect(typeLabel("bug")).toBe("BUG");
    expect(typeLabel("chore")).toBe("CHORE");
  });

  it("uppercases unknown types", () => {
    expect(typeLabel("other")).toBe("OTHER");
  });
});

describe("typeBgColor", () => {
  it("returns correct color classes", () => {
    expect(typeBgColor("epic")).toContain("purple");
    expect(typeBgColor("feature")).toContain("green");
    expect(typeBgColor("bug")).toContain("red");
    expect(typeBgColor("chore")).toContain("foreground");
    expect(typeBgColor("task")).toContain("foreground");
  });
});

describe("groupByEpic", () => {
  const epics: EpicStatus[] = [
    {
      id: "epic-1",
      title: "V1",
      status: "open",
      priority: 1,
      total_children: 2,
      closed_children: 0,
    },
  ];

  it("groups tasks under their parent epic", () => {
    const tasks = [
      { id: "t1", parentId: "epic-1", type: "task" as const },
      { id: "t2", parentId: "epic-1", type: "feature" as const },
      { id: "t3", type: "task" as const },
    ].map(
      (t) =>
        ({
          ...t,
          title: t.id,
          description: "",
          completed: false,
          status: "open" as const,
          priority: "medium" as const,
          rawPriority: 2,
          owner: "",
          assignee: "",
          createdBy: "",
          createdAt: "",
          updatedAt: "",
          labels: [],
          dependencyCount: 0,
          dependentCount: 0,
          commentCount: 0,
        })
    );

    const groups = groupByEpic(tasks, epics);
    expect(groups).toHaveLength(2); // 1 epic group + 1 ungrouped
    expect(groups[0].epic?.id).toBe("epic-1");
    expect(groups[0].tasks).toHaveLength(2);
    expect(groups[1].epic).toBeNull();
    expect(groups[1].tasks).toHaveLength(1);
  });

  it("filters out epics from task list", () => {
    const tasks = [
      { id: "epic-1", type: "epic" as const },
      { id: "t1", parentId: "epic-1", type: "task" as const },
    ].map(
      (t) =>
        ({
          ...t,
          title: t.id,
          description: "",
          completed: false,
          status: "open" as const,
          priority: "medium" as const,
          rawPriority: 2,
          owner: "",
          assignee: "",
          createdBy: "",
          createdAt: "",
          updatedAt: "",
          labels: [],
          dependencyCount: 0,
          dependentCount: 0,
          commentCount: 0,
        })
    );

    const groups = groupByEpic(tasks, epics);
    // epic itself should not appear in any group's tasks
    const allGroupedTasks = groups.flatMap((g) => g.tasks);
    expect(allGroupedTasks.find((t) => t.type === "epic")).toBeUndefined();
  });

  it("keeps matching epics as selectable headers when requested", () => {
    const tasks = [
      { id: "epic-1", type: "epic" as const },
    ].map(
      (t) =>
        ({
          ...t,
          title: t.id,
          description: "",
          completed: false,
          status: "open" as const,
          priority: "medium" as const,
          rawPriority: 2,
          owner: "",
          assignee: "",
          createdBy: "",
          createdAt: "",
          updatedAt: "",
          labels: [],
          dependencyCount: 0,
          dependentCount: 0,
          commentCount: 0,
        })
    );

    const groups = groupByEpic(tasks, epics, { includeEpics: true });
    expect(groups).toHaveLength(1);
    expect(groups[0].epic?.id).toBe("epic-1");
    expect(groups[0].tasks).toHaveLength(0);
  });

  it("keeps epic headers while also grouping their child tasks", () => {
    const tasks = [
      { id: "epic-1", type: "epic" as const },
      { id: "t1", parentId: "epic-1", type: "task" as const },
    ].map(
      (t) =>
        ({
          ...t,
          title: t.id,
          description: "",
          completed: false,
          status: "open" as const,
          priority: "medium" as const,
          rawPriority: 2,
          owner: "",
          assignee: "",
          createdBy: "",
          createdAt: "",
          updatedAt: "",
          labels: [],
          dependencyCount: 0,
          dependentCount: 0,
          commentCount: 0,
        })
    );

    const groups = groupByEpic(tasks, epics, { includeEpics: true });
    expect(groups).toHaveLength(1);
    expect(groups[0].epic?.id).toBe("epic-1");
    expect(groups[0].tasks.map((task) => task.id)).toEqual(["t1"]);
  });

  it("derives epic groups from task rows when the epic summary fetch is stale", () => {
    const tasks = [
      { id: "epic-1", type: "epic" as const, title: "Launch epic", rawPriority: 1 },
      { id: "t1", parentId: "epic-1", type: "task" as const, title: "First task", rawPriority: 0 },
      { id: "t2", parentId: "epic-1", type: "task" as const, title: "Second task", rawPriority: 2, status: "closed" as const, completed: true },
    ].map(
      (t) =>
        ({
          ...t,
          description: "",
          completed: t.completed ?? false,
          status: t.status ?? ("open" as const),
          priority: "medium" as const,
          rawPriority: t.rawPriority,
          owner: "",
          assignee: "",
          createdBy: "",
          createdAt: "",
          updatedAt: "",
          labels: [],
          dependencyCount: 0,
          dependentCount: 0,
          commentCount: 0,
        })
    );

    const groups = groupByEpic(tasks, [], { includeEpics: true });
    expect(groups).toHaveLength(1);
    expect(groups[0].epic).toMatchObject({
      id: "epic-1",
      title: "Launch epic",
      total_children: 2,
      closed_children: 1,
    });
    expect(groups[0].tasks.map((task) => task.id)).toEqual(["t1", "t2"]);
  });

  it("derives epic groups from child parent ids when the epic row is filtered out", () => {
    const tasks = [
      { id: "t1", parentId: "EPIC-009", type: "task" as const, title: "First task", rawPriority: 0 },
      { id: "t2", parentId: "EPIC-009", type: "task" as const, title: "Second task", rawPriority: 2, status: "closed" as const, completed: true },
    ].map(
      (t) =>
        ({
          ...t,
          description: "",
          completed: t.completed ?? false,
          status: t.status ?? ("open" as const),
          priority: "medium" as const,
          rawPriority: t.rawPriority,
          owner: "",
          assignee: "",
          createdBy: "",
          createdAt: "",
          updatedAt: "",
          labels: [],
          dependencyCount: 0,
          dependentCount: 0,
          commentCount: 0,
        })
    );

    const groups = groupByEpic(tasks, []);
    expect(groups).toHaveLength(1);
    expect(groups[0].epic).toMatchObject({
      id: "EPIC-009",
      title: "EPIC-009",
      total_children: 2,
      closed_children: 1,
    });
    expect(groups[0].tasks.map((task) => task.id)).toEqual(["t1", "t2"]);
  });
});

describe("timeAgo", () => {
  it("returns just now for recent timestamps", () => {
    const now = new Date().toISOString();
    expect(timeAgo(now)).toBe("just now");
  });

  it("returns minutes ago", () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(timeAgo(fiveMinAgo)).toBe("5m ago");
  });

  it("returns hours ago", () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    expect(timeAgo(twoHoursAgo)).toBe("2h ago");
  });

  it("returns days ago", () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    expect(timeAgo(threeDaysAgo)).toBe("3d ago");
  });
});
