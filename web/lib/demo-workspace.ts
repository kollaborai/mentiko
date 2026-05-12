import { mkdirSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import config from "./config";

const DEMO_DIR = config.demoWorkspaceDir;

const PACKAGE_JSON = JSON.stringify(
  {
    name: "mentiko-demo",
    version: "1.0.0",
    description: "Demo project for mentiko",
    main: "index.ts",
    scripts: {
      start: "npx tsx index.ts",
      test: "echo 'no tests yet'",
    },
  },
  null,
  2
);

const INDEX_TS = `// mentiko demo project
// this is a simple app that agents can review and improve

interface Task {
  id: string;
  title: string;
  done: boolean;
}

const tasks: Task[] = [];

function addTask(title: string): Task {
  const task: Task = {
    id: Math.random().toString(36).slice(2, 8),
    title,
    done: false,
  };
  tasks.push(task);
  return task;
}

function completeTask(id: string): boolean {
  const task = tasks.find((t) => t.id === id);
  if (!task) return false;
  task.done = true;
  return true;
}

function listTasks(): Task[] {
  return tasks;
}

// demo
addTask("Set up mentiko");
addTask("Run first chain");
addTask("Build something cool");

console.log("tasks:", listTasks());
completeTask(tasks[0].id);
console.log("after completing first:", listTasks());
`;

export function createDemoWorkspace(): string {
  if (existsSync(DEMO_DIR)) return DEMO_DIR;

  mkdirSync(DEMO_DIR, { recursive: true });
  writeFileSync(join(DEMO_DIR, "package.json"), PACKAGE_JSON);
  writeFileSync(join(DEMO_DIR, "index.ts"), INDEX_TS);

  try {
    execSync("git init", { cwd: DEMO_DIR, stdio: "ignore" });
    execSync("git add -A", { cwd: DEMO_DIR, stdio: "ignore" });
    execSync('git commit -m "initial commit"', { cwd: DEMO_DIR, stdio: "ignore" });
  } catch {
    // git not available, that's ok
  }

  return DEMO_DIR;
}
