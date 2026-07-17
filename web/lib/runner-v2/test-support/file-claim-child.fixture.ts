import { appendFileSync, existsSync, writeFileSync } from "fs";
import { setTimeout as delay } from "timers/promises";
import { withExclusiveFileClaim } from "../file-claim";

const mode = process.env.FILE_CLAIM_CHILD_MODE;
const claimDir = process.env.FILE_CLAIM_CHILD_CLAIM || "";
const artifactPath = process.env.FILE_CLAIM_CHILD_ARTIFACT || "";
const gatePath = process.env.FILE_CLAIM_CHILD_GATE || "";

async function waitForGate(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(gatePath)) {
    if (process.ppid === 1) throw new Error("fixture parent exited before opening the gate");
    if (Date.now() >= deadline) throw new Error(`fixture gate was not opened within ${timeoutMs}ms`);
    await delay(5);
  }
}

describe("file claim child fixture", () => {
  it("executes the requested child protocol", async () => {
    if (mode === "crash-reaper") {
      withExclusiveFileClaim(claimDir, () => undefined, {
        beforeStaleRetirement: () => {
          writeFileSync(artifactPath, "reaper-acquired\n");
          // The parent deliberately SIGKILLs this fixture. A bounded wait is
          // the crash window under test and prevents a killed parent from
          // leaving an immortal orphan on the developer host.
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10_000);
        },
      });
      return;
    }
    if (mode === "contend") {
      await waitForGate(10_000);
      try {
        await withExclusiveFileClaim(claimDir, async () => {
          appendFileSync(artifactPath, `${process.pid}\n`);
          await delay(600);
        }, { waitTimeoutMs: 150 });
      } catch {
        // Losing the bounded claim race is the expected second-child outcome.
      }
      return;
    }
    throw new Error(`unknown file-claim child mode: ${mode}`);
  }, 30_000);
});
