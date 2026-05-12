import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  addScheduledApplication,
  listScheduledApplicationsFromFile,
  resolveScheduledApplicationRun,
} from "../scheduled-application-storage";

describe("scheduled-application-storage", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mentiko-apps-"));
    file = join(dir, "applications.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("stores reusable application definitions", () => {
    addScheduledApplication(file, {
      id: "csv-processor",
      name: "CSV Processor",
      executable: "python3",
      args: ["scripts/process.py"],
      workingDirectory: "/Users/malmazan/dev/mentiko",
      timeoutMs: 120_000,
      successExitCodes: [0],
    });

    expect(listScheduledApplicationsFromFile(file)).toEqual([
      expect.objectContaining({
        id: "csv-processor",
        executable: "python3",
        args: ["scripts/process.py"],
      }),
    ]);
  });

  it("resolves registered app runs by combining stored and schedule args", () => {
    addScheduledApplication(file, {
      id: "csv-processor",
      name: "CSV Processor",
      executable: "python3",
      args: ["scripts/process.py"],
      workingDirectory: "/Users/malmazan/dev/mentiko",
    });

    expect(resolveScheduledApplicationRun(file, "csv-processor", ["--input", "/drop/orders.csv"])).toEqual({
      executable: "python3",
      args: ["scripts/process.py", "--input", "/drop/orders.csv"],
      workingDirectory: "/Users/malmazan/dev/mentiko",
      env: undefined,
      timeoutMs: undefined,
      successExitCodes: undefined,
    });
  });
});
