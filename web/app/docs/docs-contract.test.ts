import { readFileSync } from "node:fs";
import { join } from "node:path";

function readRepoFile(path: string): string {
  return readFileSync(join(process.cwd(), "..", path), "utf8");
}

function readWebFile(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("docs contract", () => {
  it("matches implemented webhook route methods", () => {
    const page = readWebFile("app/docs/webhooks/page.tsx");
    const apiReference = readRepoFile("docs/API_REFERENCE.md");

    expect(page).not.toContain("GET    /api/webhooks/{id}");
    expect(page).not.toContain("PATCH  /api/webhooks/{id}");
    expect(page).toContain("POST   /api/webhooks/{id}                # test subscription");
    expect(page).toContain("DELETE /api/webhooks/{id}                # delete subscription");
    expect(page).toContain("PATCH  /api/webhooks/inbound/config/{id} # update or regenerate token");
    expect(page).toContain("DELETE /api/webhooks/inbound/config/{id} # delete inbound endpoint");

    expect(apiReference).not.toContain("GET/POST/DELETE | `/api/webhooks/{id}`");
    expect(apiReference).toContain("| POST/DELETE | `/api/webhooks/{id}` | Test/delete webhook subscription |");
    expect(apiReference).toContain("| PATCH/DELETE | `/api/webhooks/inbound/config/{id}` | Update, regenerate token, or delete inbound webhook config |");
  });

  it("documents schedule snooze files under the org schedules directory", () => {
    const page = readWebFile("app/docs/schedules/page.tsx");

    expect(page).not.toContain("SCHEDULES_DIR/{scheduleId}/.snooze");
    expect(page).toContain("namespaces/{id}/schedules/{scheduleId}/.snooze");
    expect(page).toContain("namespaces/{id}/orgs/{orgId}/schedules/{scheduleId}/.snooze");
  });
});
