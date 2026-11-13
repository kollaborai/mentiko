import { spawn, type ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "@jest/globals";
import { emitRunnerEvent, type EmitRunnerEventInput } from "@/lib/runner-v2/event-emitter";
import {
  captureRunnerEventAcceptedTrigger,
  consumeRunnerEvents,
  type ConsumeRunnerEventsInput,
} from "@/lib/runner-v2/event-lifecycle";
import { parseRunnerEvent } from "@/lib/runner-v2/events";

const CHILD_FIXTURE = join(__dirname, "../test-support/event-lifecycle-race-child.fixture.cjs");
const WEB_ROOT = join(__dirname, "../../..");

type WorkerMode = "consume" | "barrier" | "crash" | "emit";
type InterruptStage = "prepared" | "renamed" | "claimed" | "processed" | "archived" | "receipted" | "complete";

interface WorkerResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

interface LifecycleWorker {
  child: ChildProcess;
  startedPath: string;
  readyPath: string;
  releasePath: string;
  result: Promise<WorkerResult>;
}

interface EventFixture {
  root: string;
  eventsDir: string;
  eventPath: string;
  originalContent: string;
  originalOccurrenceId: string;
  consumeInput: ConsumeRunnerEventsInput;
}

const activeWorkers = new Set<LifecycleWorker>();
const fixtureRoots = new Set<string>();

function eventInput(eventsDir: string, data: string): EmitRunnerEventInput {
  return {
    event: "draft-ready",
    source: "writer",
    runId: "run-race",
    scope: "run",
    filenameMode: "canonical",
    filename: "trigger.event",
    eventsDir,
    data,
    timestamp: "2026-11-12T12:00:00.000Z",
  };
}

function createFixture(): EventFixture {
  const root = mkdtempSync(join(tmpdir(), "runner-event-lifecycle-race-"));
  fixtureRoots.add(root);
  const eventsDir = join(root, "events");
  mkdirSync(eventsDir);
  const emitted = emitRunnerEvent(eventInput(eventsDir, "accepted occurrence"));
  const acceptedTrigger = captureRunnerEventAcceptedTrigger({
    eventsDir,
    file: emitted.path,
  });
  return {
    root,
    eventsDir,
    eventPath: emitted.path,
    originalContent: readFileSync(emitted.path, "utf8"),
    originalOccurrenceId: emitted.occurrenceId,
    consumeInput: {
      eventsDir,
      runId: "run-race",
      source: "writer",
      expectedEvent: "draft-ready",
      allAgentIds: ["writer"],
      triggered: emitted.path,
      acceptedTrigger,
    },
  };
}

function spawnWorker(
  root: string,
  mode: WorkerMode,
  input: ConsumeRunnerEventsInput | EmitRunnerEventInput,
  stage = "",
): LifecycleWorker {
  const id = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const inputPath = join(root, `worker-${id}.json`);
  const startedPath = join(root, `worker-${id}.started`);
  const readyPath = join(root, `worker-${id}.ready`);
  const releasePath = join(root, `worker-${id}.release`);
  writeFileSync(inputPath, `${JSON.stringify(input)}\n`);
  const child = spawn(process.execPath, [
    "-r", "ts-node/register/transpile-only",
    "-r", "tsconfig-paths/register",
    CHILD_FIXTURE,
  ], {
    cwd: WEB_ROOT,
    env: {
      ...process.env,
      TS_NODE_BASEURL: ".",
      TS_NODE_COMPILER_OPTIONS: JSON.stringify({
        module: "commonjs",
        moduleResolution: "node",
        baseUrl: ".",
        paths: { "@/*": ["./*"] },
      }),
      EVENT_LIFECYCLE_CHILD_MODE: mode,
      EVENT_LIFECYCLE_CHILD_INPUT: inputPath,
      EVENT_LIFECYCLE_CHILD_STARTED: startedPath,
      EVENT_LIFECYCLE_CHILD_READY: readyPath,
      EVENT_LIFECYCLE_CHILD_RELEASE: releasePath,
      EVENT_LIFECYCLE_CHILD_STAGE: stage,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => { stdout += chunk; });
  child.stderr?.on("data", (chunk: string) => { stderr += chunk; });
  let resolveResult!: (result: WorkerResult) => void;
  let rejectResult!: (error: Error) => void;
  const result = new Promise<WorkerResult>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  child.once("error", rejectResult);
  child.once("close", (code) => resolveResult({ code, stdout, stderr }));

  const worker = { child, startedPath, readyPath, releasePath, result };
  activeWorkers.add(worker);
  child.once("close", () => activeWorkers.delete(worker));
  return worker;
}

async function waitForFile(path: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(path)) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${path}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function waitForWorker(worker: LifecycleWorker, timeoutMs = 20_000): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`worker did not exit within ${timeoutMs}ms`)), timeoutMs);
    worker.result.then((result) => {
      clearTimeout(timeout);
      resolve(result);
    }, (error: Error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

afterEach(async () => {
  await Promise.all([...activeWorkers].map(async ({ child, result }) => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    await result.catch(() => undefined);
  }));
  for (const root of fixtureRoots) rmSync(root, { recursive: true, force: true });
  fixtureRoots.clear();
});

describe("runner event lifecycle barriers and process interruption", () => {
  it("keeps a claim-respecting publisher behind the archive claim and publishes it after the rename transaction", async () => {
    const fixture = createFixture();
    const consumer = spawnWorker(fixture.root, "barrier", fixture.consumeInput, "renamed");
    await waitForFile(consumer.readyPath);
    expect(existsSync(fixture.eventPath)).toBe(false);

    const publisher = spawnWorker(fixture.root, "emit", eventInput(fixture.eventsDir, "later occurrence"));
    await waitForFile(publisher.startedPath);
    await delay(200);
    expect(publisher.child.exitCode).toBeNull();
    expect(existsSync(publisher.readyPath)).toBe(false);
    expect(existsSync(fixture.eventPath)).toBe(false);

    writeFileSync(consumer.releasePath, "continue\n");
    const [consumerResult, publisherResult] = await Promise.all([
      waitForWorker(consumer),
      waitForWorker(publisher),
    ]);
    expect(consumerResult.code).toBe(0);
    expect(publisherResult.code).toBe(0);
    const archived = JSON.parse(consumerResult.stdout) as { destination: string; status: string };
    const published = JSON.parse(publisherResult.stdout) as { occurrenceId: string; path: string };
    expect(archived.status).toBe("archived");
    expect(published.path).toBe(fixture.eventPath);
    expect(existsSync(fixture.eventPath)).toBe(true);
    expect(parseRunnerEvent(readFileSync(fixture.eventPath, "utf8")).fields.occurrence_id)
      .toBe(published.occurrenceId);
    expect(published.occurrenceId).not.toBe(fixture.originalOccurrenceId);
    expect(parseRunnerEvent(readFileSync(archived.destination, "utf8"))).toMatchObject({
      processed: true,
      fields: { occurrence_id: fixture.originalOccurrenceId },
    });
    const archiveDir = join(fixture.eventsDir, "archive");
    expect(readdirSync(archiveDir).filter((name) => name.endsWith(".event"))).toEqual(["trigger.event"]);
    expect(readdirSync(archiveDir).filter((name) => name.startsWith(".event-receipt-")).length).toBe(1);
    expect(readdirSync(join(fixture.eventsDir, ".event-transactions"))).toEqual([]);
  }, 30_000);

  it("leaves a bypass-writer replacement published after rename untouched", async () => {
    const fixture = createFixture();
    const replacementDir = join(fixture.root, "replacement-source");
    mkdirSync(replacementDir);
    const replacement = emitRunnerEvent(eventInput(replacementDir, "replacement after rename"));
    const replacementBytes = readFileSync(replacement.path, "utf8");
    const consumer = spawnWorker(fixture.root, "barrier", fixture.consumeInput, "renamed");
    await waitForFile(consumer.readyPath);
    expect(existsSync(fixture.eventPath)).toBe(false);

    // This simulates an old producer that ignores the shared source claim.
    writeFileSync(fixture.eventPath, replacementBytes, { flag: "wx" });
    writeFileSync(consumer.releasePath, "continue\n");
    const result = await waitForWorker(consumer);
    expect(result.code).toBe(0);
    const consumed = JSON.parse(result.stdout) as { destination: string };

    expect(readFileSync(fixture.eventPath, "utf8")).toBe(replacementBytes);
    expect(parseRunnerEvent(readFileSync(fixture.eventPath, "utf8")).fields.occurrence_id)
      .toBe(replacement.occurrenceId);
    expect(parseRunnerEvent(readFileSync(consumed.destination, "utf8"))).toMatchObject({
      processed: true,
      fields: { occurrence_id: fixture.originalOccurrenceId },
    });
    const archiveDir = join(fixture.eventsDir, "archive");
    expect(readdirSync(archiveDir).filter((name) => name.endsWith(".event"))).toEqual(["trigger.event"]);
    expect(readdirSync(archiveDir).filter((name) => name.startsWith(".event-receipt-")).length).toBe(1);
  }, 30_000);

  it("marks a fresh-inode identical bypass replacement as a conflict before rename and creates no receipt", async () => {
    const fixture = createFixture();
    const originalIdentity = statSync(fixture.eventPath).ino;
    const consumer = spawnWorker(fixture.root, "barrier", fixture.consumeInput, "prepared");
    await waitForFile(consumer.readyPath);

    const replacementPath = join(fixture.root, "identical-replacement.tmp");
    writeFileSync(replacementPath, fixture.originalContent);
    renameSync(replacementPath, fixture.eventPath);
    expect(statSync(fixture.eventPath).ino).not.toBe(originalIdentity);
    const replacementContent = readFileSync(fixture.eventPath, "utf8");
    writeFileSync(consumer.releasePath, "continue\n");
    const result = await waitForWorker(consumer);

    expect(result.code).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({ error: expect.stringMatching(/preserved without completion/) });
    expect(readFileSync(fixture.eventPath, "utf8")).toBe(replacementContent);
    expect(captureRunnerEventAcceptedTrigger({
      eventsDir: fixture.eventsDir,
      file: fixture.eventPath,
    }).occurrenceToken).not.toBe(fixture.consumeInput.acceptedTrigger.occurrenceToken);
    const transactionDir = join(
      fixture.eventsDir,
      ".event-transactions",
      fixture.consumeInput.acceptedTrigger.occurrenceToken,
    );
    expect(JSON.parse(readFileSync(join(transactionDir, "manifest.json"), "utf8"))).toMatchObject({
      state: "conflict",
      sourceFilename: "trigger.event",
    });
    expect(existsSync(join(transactionDir, "claimed.event"))).toBe(false);
    expect(existsSync(join(fixture.eventsDir, "archive"))).toBe(false);
    expect(() => consumeRunnerEvents(fixture.consumeInput)).toThrow(/no longer matches the accepted trigger occurrence/);
    expect(readFileSync(fixture.eventPath, "utf8")).toBe(replacementContent);
  }, 30_000);

  it("serializes concurrent consumers so one archives and the other proves the same receipt", async () => {
    const fixture = createFixture();
    const winner = spawnWorker(fixture.root, "barrier", fixture.consumeInput, "renamed");
    await waitForFile(winner.readyPath);
    const follower = spawnWorker(fixture.root, "consume", fixture.consumeInput);
    await waitForFile(follower.startedPath);
    await delay(200);
    expect(follower.child.exitCode).toBeNull();

    writeFileSync(winner.releasePath, "continue\n");
    const [winnerResult, followerResult] = await Promise.all([
      waitForWorker(winner),
      waitForWorker(follower),
    ]);
    expect(winnerResult.code).toBe(0);
    expect(followerResult.code).toBe(0);
    expect(JSON.parse(winnerResult.stdout).status).toBe("archived");
    expect(JSON.parse(followerResult.stdout).status).toBe("already-archived");
    const archiveDir = join(fixture.eventsDir, "archive");
    expect(readdirSync(archiveDir).filter((name) => name.endsWith(".event"))).toEqual(["trigger.event"]);
    expect(readdirSync(archiveDir).filter((name) => name.startsWith(".event-receipt-")).length).toBe(1);
  }, 30_000);

  it.each(["prepared", "renamed", "claimed", "processed", "archived", "receipted", "complete"] as const)(
    "recovers an actual archiver process exit after the %s manifest transaction stage",
    async (stage: InterruptStage) => {
      const fixture = createFixture();
      const crashed = spawnWorker(fixture.root, "crash", fixture.consumeInput, stage);
      await waitForFile(crashed.startedPath);
      expect((await waitForWorker(crashed)).code).toBe(86);

      const recovered = consumeRunnerEvents(fixture.consumeInput);
      expect(recovered.triggered.status).toBe("already-archived");
      expect(parseRunnerEvent(readFileSync(recovered.triggered.destination, "utf8"))).toMatchObject({
        processed: true,
        fields: { occurrence_id: fixture.originalOccurrenceId },
      });
      const archiveDir = join(fixture.eventsDir, "archive");
      expect(readdirSync(archiveDir).filter((name) => name.endsWith(".event"))).toEqual(["trigger.event"]);
      expect(readdirSync(archiveDir).filter((name) => name.startsWith(".event-receipt-")).length).toBe(1);
      expect(readdirSync(join(fixture.eventsDir, ".event-transactions"))).toEqual([]);
      expect(existsSync(fixture.eventPath)).toBe(false);
    },
    30_000,
  );
});
