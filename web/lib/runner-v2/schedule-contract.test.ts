import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeEmbeddedSchedule, getScheduleState, setScheduleState } from "@/lib/runner-v2/schedule-contract";
import { runScheduleContractCli } from "@/lib/runner-v2/schedule-contract-cli";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "mentiko-schedule-contract-"));
  const chainDir = join(root, "chains");
  const schedulesDir = join(root, "schedules");
  const chainPath = join(chainDir, "daily", "chain.json");
  mkdirSync(join(chainDir, "daily"), { recursive: true });
  mkdirSync(schedulesDir, { recursive: true });
  writeFileSync(chainPath, JSON.stringify({ name: "Daily Review", config: { schedule: { cron: "0 9 * * *", timezone: "UTC" } } }));
  return { root, chainDir, schedulesDir, chainPath };
}

describe("typed embedded schedule contract", () => {
  it("separates raw chain decoding from normalized schedule fields", () => {
    const { chainDir, chainPath } = fixture();
    expect(decodeEmbeddedSchedule(chainPath, chainDir)).toMatchObject({
      chainName: "Daily Review", scheduleId: "daily_chain.json", cron: "0 9 * * *", timezone: "UTC",
    });
    writeFileSync(chainPath, JSON.stringify({ name: "Broken", config: { schedule: { timezone: "UTC" } } }));
    expect(() => decodeEmbeddedSchedule(chainPath, chainDir)).toThrow("schedule.cron must be a non-empty string");
  });

  it("rejects chain and state symlink escapes before decoding or mutation", () => {
    const { root, chainDir, schedulesDir, chainPath } = fixture();
    const outside = join(root, "outside.json");
    writeFileSync(outside, readFileSync(chainPath));
    expect(() => decodeEmbeddedSchedule(outside, chainDir)).toThrow("escapes configured chains directory");
    const linkedChain = join(chainDir, "linked.json");
    symlinkSync(outside, linkedChain);
    expect(() => decodeEmbeddedSchedule(linkedChain, chainDir)).toThrow("non-symlink regular file");
    const linkedStateTarget = join(root, "state-target.json");
    writeFileSync(linkedStateTarget, "{}");
    symlinkSync(linkedStateTarget, join(schedulesDir, "state.json"));
    expect(() => getScheduleState(schedulesDir, "daily_chain.json")).toThrow("non-symlink regular file");
  });

  it("atomically retains normalized state entries across updates", () => {
    const { schedulesDir } = fixture();
    setScheduleState(schedulesDir, "daily_chain.json", 100);
    setScheduleState(schedulesDir, "other_chain.json", 200);
    expect(JSON.parse(readFileSync(join(schedulesDir, "state.json"), "utf8"))).toEqual({ "daily_chain.json": 100, "other_chain.json": 200 });
  });

  it("keeps CLI scalar fields and state mutation aligned with the typed contract", () => {
    const { chainDir, schedulesDir, chainPath } = fixture();
    const cron: string[] = [];
    const state: string[] = [];
    runScheduleContractCli(["field", "--chain-path", chainPath, "--chain-dir", chainDir, "--field", "cron"], (line) => cron.push(line));
    runScheduleContractCli(["state-set", "--schedules-dir", schedulesDir, "--schedule-id", "daily_chain.json", "--timestamp", "42"]);
    runScheduleContractCli(["state-get", "--schedules-dir", schedulesDir, "--schedule-id", "daily_chain.json"], (line) => state.push(line));
    expect(cron).toEqual(["0 9 * * *"]);
    expect(state).toEqual(["42"]);
  });
});
