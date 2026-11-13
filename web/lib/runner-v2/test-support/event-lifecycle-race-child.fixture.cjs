const { existsSync, readFileSync, writeFileSync } = require("node:fs");

const mode = process.env.EVENT_LIFECYCLE_CHILD_MODE || "";
const inputPath = process.env.EVENT_LIFECYCLE_CHILD_INPUT || "";
const startedPath = process.env.EVENT_LIFECYCLE_CHILD_STARTED || "";
const readyPath = process.env.EVENT_LIFECYCLE_CHILD_READY || "";
const releasePath = process.env.EVENT_LIFECYCLE_CHILD_RELEASE || "";
const targetStage = process.env.EVENT_LIFECYCLE_CHILD_STAGE || "";

function waitAtBarrier() {
  writeFileSync(readyPath, "ready\n");
  const deadline = Date.now() + 15_000;
  const signal = new Int32Array(new SharedArrayBuffer(4));
  while (!existsSync(releasePath)) {
    if (process.ppid === 1) throw new Error("race-test parent exited before opening the barrier");
    if (Date.now() >= deadline) throw new Error("race-test barrier was not opened within 15s");
    Atomics.wait(signal, 0, 0, 10);
  }
}

function main() {
  const input = JSON.parse(readFileSync(inputPath, "utf8"));

  if (mode === "emit") {
    const { emitRunnerEvent } = require("../event-emitter");
    writeFileSync(startedPath, `${process.pid}\n`);
    const result = emitRunnerEvent(input);
    writeFileSync(readyPath, JSON.stringify(result));
    process.stdout.write(JSON.stringify(result));
    return;
  }

  if (mode !== "consume" && mode !== "barrier" && mode !== "crash") {
    throw new Error(`unknown event lifecycle child mode: ${mode}`);
  }

  const { consumeRunnerEvents } = require("../event-lifecycle");
  writeFileSync(startedPath, `${process.pid}\n`);
  const hooks = {
    afterStage(stage) {
      if (stage !== targetStage) return;
      if (mode === "crash") process.exit(86);
      if (mode === "barrier") waitAtBarrier();
    },
  };
  const result = consumeRunnerEvents(input, hooks);
  process.stdout.write(JSON.stringify({
    status: result.triggered.status,
    destination: result.triggered.destination,
    archived: result.archived.map((item) => ({ filename: item.filename, destination: item.destination })),
  }));
}

try {
  main();
} catch (error) {
  process.stdout.write(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 2;
}
