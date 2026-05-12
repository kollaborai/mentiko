jest.mock("child_process", () => ({
  execFileSync: jest.fn(() => "2026-05-06T12:00:00\n"),
}));

import { execFileSync } from "child_process";
import { calculateCronNextRun } from "../cron-next-run";
import { isSafeCronExpression, normalizeTimezone } from "../cron-validation";

const mockedExecFileSync = execFileSync as jest.MockedFunction<typeof execFileSync>;

describe("cron next run", () => {
  beforeEach(() => {
    mockedExecFileSync.mockClear();
    mockedExecFileSync.mockReturnValue("2026-05-06T12:00:00\n");
  });

  it("passes cron as python argv, not shell text", () => {
    expect(calculateCronNextRun("*/5 * * * *")).toBe("2026-05-06T12:00:00");
    expect(mockedExecFileSync).toHaveBeenCalledWith(
      "python3",
      expect.arrayContaining(["*/5 * * * *"]),
      expect.objectContaining({ shell: false }),
    );
  });

  it("rejects shell metacharacters before execution", () => {
    expect(() => calculateCronNextRun("* * * * *'; id #")).toThrow("invalid characters");
    expect(mockedExecFileSync).not.toHaveBeenCalled();
  });

  it("validates cron field count", () => {
    expect(isSafeCronExpression("* * * * *")).toBe(true);
    expect(isSafeCronExpression("* * *")).toBe(false);
  });

  it("validates timezone names", () => {
    expect(normalizeTimezone("America/Phoenix")).toBe("America/Phoenix");
    expect(() => normalizeTimezone("UTC;id")).toThrow("invalid characters");
  });
});
