import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  utimesSync,
  writeFileSync,
} from "fs";
import { spawn, type ChildProcess } from "child_process";
import { tmpdir } from "os";
import { join } from "path";
import {
  ExclusiveFileClaimBusyError,
  claimProcessIsAlive,
  withExclusiveFileClaim,
} from "@/lib/runner-v2/file-claim";

const childFixture = join(__dirname, "..", "test-support", "file-claim-child.fixture.ts");
const jestBin = join(process.cwd(), "node_modules", "jest", "bin", "jest.js");
const fixtureChildren = new Set<ChildProcess>();

function seedStaleClaim(claimDir: string): void {
  mkdirSync(claimDir);
  writeFileSync(join(claimDir, "owner.json"), `${JSON.stringify({ pid: 999_999, token: "stale" })}\n`);
  const stale = new Date(Date.now() - 60_000);
  utimesSync(claimDir, stale, stale);
}

function spawnFixture(args: string[]): ChildProcess {
  const [mode, claimDir, artifactPath, gatePath, readyPath] = args;
  const child = spawn(process.execPath, [
    jestBin,
    "--runInBand",
    "--forceExit",
    "--testMatch",
    "**/file-claim-child.fixture.ts",
    "--runTestsByPath",
    childFixture,
  ], {
    cwd: process.cwd(),
    stdio: "ignore",
    env: {
      ...process.env,
      FILE_CLAIM_CHILD_MODE: mode,
      FILE_CLAIM_CHILD_CLAIM: claimDir,
      FILE_CLAIM_CHILD_ARTIFACT: artifactPath,
      FILE_CLAIM_CHILD_GATE: gatePath,
      FILE_CLAIM_CHILD_READY: readyPath || "",
    },
  });
  fixtureChildren.add(child);
  child.once("exit", () => fixtureChildren.delete(child));
  child.once("error", () => fixtureChildren.delete(child));
  return child;
}

async function waitForFile(path: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(path)) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${path}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function waitForExit(child: ChildProcess): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

async function terminateFixture(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = waitForExit(child);
  child.kill("SIGTERM");
  const settled = await Promise.race([
    exited.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1_000)),
  ]);
  if (!settled && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await exited;
  }
}

describe("exclusive file claim", () => {
  afterEach(async () => {
    await Promise.all([...fixtureChildren].map(terminateFixture));
    expect(fixtureChildren.size).toBe(0);
  });

  it("lets only one stale-claim contender retire and acquire the claim", () => {
    const root = mkdtempSync(join(tmpdir(), "runner-v2-file-claim-"));
    const claimDir = join(root, "delivery.claim");
    seedStaleClaim(claimDir);

    let secondEntered = false;
    let firstEntered = false;
    withExclusiveFileClaim(claimDir, () => {
      firstEntered = true;
    }, {
      pid: 101,
      isProcessAlive: (pid) => pid === 101 || pid === 202,
      beforeStaleRetirement: () => {
        expect(() => withExclusiveFileClaim(claimDir, () => {
          secondEntered = true;
        }, {
          pid: 202,
          isProcessAlive: (pid) => pid === 101 || pid === 202,
          waitTimeoutMs: 0,
        })).toThrow(ExclusiveFileClaimBusyError);
      },
    });

    expect(firstEntered).toBe(true);
    expect(secondEntered).toBe(false);
    expect(readdirSync(root)).toEqual([]);
  });

  it("recovers an owner-bearing reaper left by a killed process", async () => {
    const root = mkdtempSync(join(tmpdir(), "runner-v2-file-claim-crash-"));
    const claimDir = join(root, "delivery.claim");
    const readyPath = join(root, "reaper-ready");
    seedStaleClaim(claimDir);
    const child = spawnFixture(["crash-reaper", claimDir, readyPath, "unused"]);
    await waitForFile(readyPath);
    expect(existsSync(`${claimDir}.reaper`)).toBe(true);

    child.kill("SIGKILL");
    await waitForExit(child);

    let entered = false;
    withExclusiveFileClaim(claimDir, () => { entered = true; });
    expect(entered).toBe(true);
    expect(existsSync(`${claimDir}.reaper`)).toBe(false);
  }, 30_000);

  it("allows exactly one of two concurrent stale-claim reclaimers to own the claim", async () => {
    const root = mkdtempSync(join(tmpdir(), "runner-v2-file-claim-contend-"));
    const claimDir = join(root, "delivery.claim");
    const ownersPath = join(root, "owners.txt");
    const gatePath = join(root, "go");
    const firstReadyPath = join(root, "first-ready");
    const secondReadyPath = join(root, "second-ready");
    seedStaleClaim(claimDir);
    const first = spawnFixture(["contend", claimDir, ownersPath, gatePath, firstReadyPath]);
    const second = spawnFixture(["contend", claimDir, ownersPath, gatePath, secondReadyPath]);
    await Promise.all([waitForFile(firstReadyPath), waitForFile(secondReadyPath)]);
    writeFileSync(gatePath, "go\n");

    const exits = await Promise.all([waitForExit(first), waitForExit(second)]);
    expect(exits.map(({ code }) => code)).toEqual([0, 0]);
    expect(readFileSync(ownersPath, "utf8").trim().split("\n")).toHaveLength(1);
  }, 30_000);

  it("treats EPERM from pid probing as alive", () => {
    const kill = jest.spyOn(process, "kill").mockImplementation(() => {
      throw Object.assign(new Error("not permitted"), { code: "EPERM" });
    });
    expect(claimProcessIsAlive(123)).toBe(true);
    kill.mockRestore();
  });

  it("cleans a verified ownerless stale reaper quarantine", () => {
    const root = mkdtempSync(join(tmpdir(), "runner-v2-file-claim-ownerless-reaper-"));
    const claimDir = join(root, "delivery.claim");
    const reaperDir = `${claimDir}.reaper`;
    mkdirSync(reaperDir);
    const stale = new Date(Date.now() - 60_000);
    utimesSync(reaperDir, stale, stale);

    withExclusiveFileClaim(claimDir, () => undefined, { freshMs: 1 });

    expect(readdirSync(root)).toEqual([]);
  });

  it("retries a transient fenced-release removal before marking released", () => {
    const root = mkdtempSync(join(tmpdir(), "runner-v2-file-claim-release-retry-"));
    const claimDir = join(root, "delivery.claim");
    const { rmSync } = jest.requireActual<typeof import("fs")>("fs");
    let releaseAttempts = 0;
    const removeDirectoryAttempt = (path: string) => {
      if (path.includes(".release-") && releaseAttempts++ === 0) {
        throw Object.assign(new Error("directory not empty"), { code: "ENOTEMPTY" });
      }
      rmSync(path, { recursive: true, force: true });
    };

    withExclusiveFileClaim(claimDir, () => undefined, { removeDirectoryAttempt });

    expect(releaseAttempts).toBe(2);
    expect(readdirSync(root)).toEqual([]);
  });

  it("does not wedge successors when release-quarantine cleanup exhausts retries", () => {
    const root = mkdtempSync(join(tmpdir(), "runner-v2-file-claim-release-orphan-"));
    const claimDir = join(root, "delivery.claim");
    let attempts = 0;
    withExclusiveFileClaim(claimDir, () => undefined, {
      removeDirectoryAttempt: () => {
        attempts += 1;
        throw Object.assign(new Error("busy"), { code: "EBUSY" });
      },
    });

    let successorEntered = false;
    withExclusiveFileClaim(claimDir, () => { successorEntered = true; });

    expect(attempts).toBe(4);
    expect(successorEntered).toBe(true);
    expect(existsSync(claimDir)).toBe(false);
    expect(readdirSync(root).some((entry) => entry.includes(".release-"))).toBe(true);
  });
});
