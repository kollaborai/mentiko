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
      while (!existsSync(gatePath)) await delay(5);
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
