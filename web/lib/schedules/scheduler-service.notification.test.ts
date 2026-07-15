/** @jest-environment node */

import { createNotification } from "@/lib/notifications/notification-server";
import { createScheduleNotification } from "@/lib/schedules/scheduler-service";
import type { Schedule } from "@/lib/types";

jest.mock("@/lib/notifications/notification-server", () => ({
  createNotification: jest.fn(() => ({ title: "Schedule failed: Nightly" })),
}));

jest.mock("@/lib/auth/session-token", () => ({
  mintSessionToken: jest.fn(),
}));

const schedule: Schedule = {
  id: "schedule-1",
  name: "Nightly",
  chainId: "nightly-chain",
  chainName: "Nightly Chain",
  cron: "0 0 * * *",
  timezone: "UTC",
  enabled: true,
  status: "enabled",
  retryCount: 0,
  lastRun: null,
  nextRun: null,
  runCount: 0,
};

describe("scheduler notification persistence", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("routes schedule failures through the centralized notification writer", async () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => {});

    await createScheduleNotification("default", schedule, "runner stopped");

    expect(createNotification).toHaveBeenCalledWith("default", {
      type: "chain_failed",
      title: "Schedule failed: Nightly",
      message: "runner stopped",
      metadata: {
        chainId: "nightly-chain",
        error: "runner stopped",
        actionUrl: "/schedules",
        actionLabel: "View Schedules",
      },
    });
    log.mockRestore();
  });

  it("reports persistence failures instead of writing a second store path", async () => {
    const persistenceError = new Error("notification store write failed");
    (createNotification as jest.Mock).mockImplementationOnce(() => {
      throw persistenceError;
    });
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

    await createScheduleNotification("default", schedule, "runner stopped");

    expect(warn).toHaveBeenCalledWith(
      "[scheduler] failed to create notification:",
      persistenceError,
    );
    warn.mockRestore();
  });
});
