import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { withExclusiveFileClaim } from "../file-claim.ts";

const mode = process.env.FILE_CLAIM_CHILD_MODE;
const claimDir = process.env.FILE_CLAIM_CHILD_CLAIM || "";
const artifactPath = process.env.FILE_CLAIM_CHILD_ARTIFACT || "";
const gatePath = process.env.FILE_CLAIM_CHILD_GATE || "";
const readyPath = process.env.FILE_CLAIM_CHILD_READY || "";

async function waitForGate(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(gatePath)) {
    if (process.ppid === 1) throw new Error("fixture parent exited before opening the gate");
    if (Date.now() >= deadline) throw new Error(`fixture gate was not opened within ${timeoutMs}ms`);
    await delay(5);
  }
}

async function main() {
  if (mode === "crash-reaper") {
    withExclusiveFileClaim(claimDir, () => undefined, {
      beforeStaleRetirement: () => {
        writeFileSync(artifactPath, "reaper-acquired\n");
        // The parent deliberately SIGKILLs this fixture. Bound the crash window
        // so an interrupted parent cannot leave an immortal child on the host.
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10_000);
      },
    });
    return;
  }

  if (mode === "contend") {
    writeFileSync(readyPath, "ready\n");
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
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
