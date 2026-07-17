import { existsSync, writeFileSync } from "fs";
import { setTimeout as delay } from "timers/promises";
import {
  enqueueExternalEffectsOnce,
  withExternalEffectsLock,
} from "../external-effects";

const mode = process.env.EXTERNAL_EFFECTS_CHILD_MODE;
const outboxPath = process.env.EXTERNAL_EFFECTS_CHILD_OUTBOX || "";
const artifactPath = process.env.EXTERNAL_EFFECTS_CHILD_ARTIFACT || "";
const gatePath = process.env.EXTERNAL_EFFECTS_CHILD_GATE || "";
const effectId = process.env.EXTERNAL_EFFECTS_CHILD_ID || "effect-child";

async function waitForGate(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(gatePath)) {
    if (process.ppid === 1) throw new Error("fixture parent exited before opening the gate");
    if (Date.now() >= deadline) throw new Error(`fixture gate was not opened within ${timeoutMs}ms`);
    await delay(5);
  }
}

describe("external effects child fixture", () => {
  it("executes the requested child protocol", async () => {
    if (mode === "hold") {
      await withExternalEffectsLock(outboxPath, async () => {
        writeFileSync(artifactPath, "holding\n");
        await delay(120);
      });
      return;
    }
    if (mode === "enqueue") {
      writeFileSync(artifactPath, "ready\n");
      await waitForGate(10_000);
      enqueueExternalEffectsOnce(outboxPath, [{
        idempotencyKey: effectId,
        operation: {
          type: "notification",
          event: "chain-completed",
          chainName: "Build Chain",
          runId: `run-${effectId}`,
        },
      }]);
      return;
    }
    throw new Error(`unknown external-effects child mode: ${mode}`);
  }, 30_000);
});
