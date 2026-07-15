import { mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { nsPath } from "@/lib/config";
import { createNotification, type ServerNotification } from "@/lib/notifications/notification-server";

jest.mock("@/lib/config", () => ({
  nsPath: jest.fn(),
}));

describe("server notifications", () => {
  it("persists an idempotency-keyed notification only once", () => {
    const root = mkdtempSync(join(tmpdir(), "notification-server-"));
    (nsPath as jest.Mock).mockReturnValue(root);
    const input = {
      type: "chain_failed",
      title: "Chain stalled",
      message: "no live session",
      idempotencyKey: "watchdog:run-1:notification:v1",
    };

    createNotification("default", input);
    createNotification("default", input);

    const notifications = JSON.parse(
      readFileSync(join(root, "notifications.json"), "utf8"),
    ) as ServerNotification[];
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toEqual(expect.objectContaining({
      type: "chain_failed",
      title: "Chain stalled",
    }));
  });
});
