import { readFileSync } from "fs";
import { join } from "path";

const mutatingOpsRoutes = [
  "agents/route.ts",
  "applications/route.ts",
  "chains/route.ts",
  "context/runs/route.ts",
  "context/runs/cancel/route.ts",
  "decisions/answer/route.ts",
  "decisions/approve/route.ts",
  "decisions/select/route.ts",
  "files/route.ts",
  "notifications/prefs/route.ts",
  "notify/route.ts",
  "schedules/route.ts",
  "schedules/run/route.ts",
  "secrets/route.ts",
  "system/cli-auth/route.ts",
  "tasks/route.ts",
  "tasks/generate/route.ts",
  "templates/route.ts",
  "terminal/route.ts",
];

describe("MCP ops mutation permission gates", () => {
  test.each(mutatingOpsRoutes)("%s requires an ops permission check", (routePath) => {
    const source = readFileSync(
      join(process.cwd(), "app/api/mentiko-mcp/ops", routePath),
      "utf-8",
    );

    expect(source).toContain("requireOpsPermission");
  });
});
