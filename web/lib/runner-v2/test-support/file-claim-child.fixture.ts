import { appendFileSync, existsSync, writeFileSync } from "fs";
import { setTimeout as delay } from "timers/promises";
import { withExclusiveFileClaim } from "../file-claim";

const mode = process.env.FILE_CLAIM_CHILD_MODE;
const claimDir = process.env.FILE_CLAIM_CHILD_CLAIM || "";
const artifactPath = process.env.FILE_CLAIM_CHILD_ARTIFACT || "";
const gatePath = process.env.FILE_CLAIM_CHILD_GATE || "";

describe("file claim child fixture", () => {
  it("executes the requested child protocol", async () => {
    if (mode === "crash-reaper") {
      withExclusiveFileClaim(claimDir, () => undefined, {
        beforeStaleRetirement: () => {
          writeFileSync(artifactPath, "reaper-acquired\n");
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
        },
      });
      return;
    }
    if (mode === "contend") {
      while (!existsSync(gatePath)) await delay(5);
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
