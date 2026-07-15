import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import config from "@/lib/config";
import {
  acquireChainWatcherLock,
  buildChainWatcherLaunchEnv,
  cleanHandledEventState,
  evaluateChainWatcherCondition,
  loadChainWatcherTriggers,
  processChainWatcherEvent,
  resolveChainWatcherPaths,
  runChainWatcher,
  runChainWatcherTick,
  startChainWatcherService,
  getChainWatcherServiceStatus,
  waitForChainWatcherEvents,
  type ChainWatcherLaunchInput,
  type ChainWatcherTrigger,
} from "@/lib/runner-v2/chain-watcher-service";
import { parseRunnerEvent } from "@/lib/runner-v2/events";

function makeRoot(): string {
  return mkdtempSync(join(tmpdir(), "mentiko-chain-watcher-"));
}

function writeChain(
  chainsDir: string,
  name: string,
  eventTriggers: unknown[],
): string {
  const chainDir = join(chainsDir, name);
  mkdirSync(chainDir, { recursive: true });
  const chainPath = join(chainDir, "chain.json");
  writeFileSync(chainPath, JSON.stringify({
    name,
    config: { event_triggers: eventTriggers },
    agents: [{ id: "worker", name: "Worker", triggers: ["manual-start"], emits: "done" }],
  }));
  return chainPath;
}

function eventContent(overrides: Partial<Record<"event" | "source" | "run_id" | "timestamp" | "processed" | "data", string>> = {}): string {
  const fields = {
    event: "review-approved",
    source: "review-chain",
    run_id: "run-source-1",
    timestamp: "2026-07-15T00:00:00.000Z",
    processed: "false",
    data: "success",
    ...overrides,
  };
  return [
    `event: ${fields.event}`,
    `source: ${fields.source}`,
    `run_id: ${fields.run_id}`,
    `timestamp: ${fields.timestamp}`,
    `processed: ${fields.processed}`,
    `data: ${fields.data}`,
    "",
  ].join("\n");
}

function trigger(
  key: string,
  chainPath: string,
  overrides: Partial<ChainWatcherTrigger> = {},
): ChainWatcherTrigger {
  return {
    event: "review-approved",
    chainName: key,
    chainPath,
    key,
    ...overrides,
  };
}

describe("typed chain watcher", () => {
  it("uses only the active configured event root unless explicit paths are supplied", () => {
    const paths = resolveChainWatcherPaths(config.namespaceId, config.orgId);
    expect(paths).toEqual({
      chainsDir: config.chainsDir,
      eventsDir: config.eventsDir,
      stateDir: join(config.projectRoot, "runtime", "chain-watcher"),
    });
    expect(() => resolveChainWatcherPaths("another-namespace", "another-org"))
      .toThrow("explicit paths are required");
  });

  it("loads enabled triggers from valid chain definitions and skips invalid entries", () => {
    const root = makeRoot();
    const chainsDir = join(root, "chains");
    const warnings: string[] = [];
    writeChain(chainsDir, "notify", [
      { event: "review-approved", source_chain: "review-chain", condition: '$data == "success"', pass_data: true },
      { event: "disabled", enabled: false },
      { event: "bad", pass_data: "yes" },
    ]);
    mkdirSync(join(chainsDir, "broken"), { recursive: true });
    writeFileSync(join(chainsDir, "broken", "chain.json"), "{");

    const loaded = loadChainWatcherTriggers(chainsDir, (_level, message) => warnings.push(message));

    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toMatchObject({
      event: "review-approved",
      source_chain: "review-chain",
      condition: '$data == "success"',
      pass_data: true,
      chainName: "notify",
    });
    expect(loaded[0].key).toMatch(/^[a-f0-9]{64}$/);
    expect(warnings).toEqual(expect.arrayContaining([
      expect.stringContaining("invalid chain JSON"),
      expect.stringContaining("invalid event trigger notify[2]"),
    ]));
  });

  it("evaluates a narrow condition grammar without executing authored code", () => {
    expect(evaluateChainWatcherCondition(undefined, "success")).toBe(true);
    expect(evaluateChainWatcherCondition('$data == "success"', "success")).toBe(true);
    expect(evaluateChainWatcherCondition('"$data" != "failed"', "success")).toBe(true);
    expect(evaluateChainWatcherCondition("$data == prod-*", "prod-west")).toBe(true);
    expect(evaluateChainWatcherCondition("$data =~ ^prod-[a-z]+$", "prod-west")).toBe(true);
    expect(evaluateChainWatcherCondition("$data -ge 10", "12")).toBe(true);
    expect(evaluateChainWatcherCondition("-n $data", "value")).toBe(true);
    expect(evaluateChainWatcherCondition("-z $data", "")).toBe(true);

    expect(evaluateChainWatcherCondition('$data == "success"; touch /tmp/nope', "success")).toBe(false);
    expect(evaluateChainWatcherCondition("$(touch /tmp/nope)", "success")).toBe(false);
    expect(evaluateChainWatcherCondition("$data | grep success", "success")).toBe(false);
    expect(evaluateChainWatcherCondition("[[ $data == success ]]", "success")).toBe(false);
    expect(evaluateChainWatcherCondition("$data =~ (a+)+$", "aaaaaaaaaaaaaaaaaaaaa!")).toBe(false);
    expect(evaluateChainWatcherCondition("not a supported expression", "success")).toBe(false);
  });

  it("strictly parses events, matches source and condition, and handles each event once", async () => {
    const root = makeRoot();
    const eventsDir = join(root, "events");
    const chainsDir = join(root, "chains");
    const stateDir = join(root, "runtime", "chain-watcher");
    mkdirSync(eventsDir, { recursive: true });
    const chainPath = writeChain(chainsDir, "notify", []);
    const eventPath = join(eventsDir, "review.event");
    writeFileSync(eventPath, eventContent());
    const launches: ChainWatcherLaunchInput[] = [];
    const watcherTrigger = trigger("notify", chainPath, {
      source_chain: "review-chain",
      condition: '$data == "success"',
      pass_data: true,
    });
    const paths = { eventsDir, chainsDir, stateDir };
    const launch = async (input: ChainWatcherLaunchInput) => {
      launches.push(input);
      return { pid: 42 };
    };

    const first = await runChainWatcherTick({
      namespaceId: "default",
      orgId: "default",
      paths,
      triggers: [watcherTrigger],
      launch,
    });
    const second = await runChainWatcherTick({
      namespaceId: "default",
      orgId: "default",
      paths,
      triggers: [watcherTrigger],
      launch,
    });

    expect(first).toMatchObject({ filesScanned: 1, triggersMatched: 1, launchesStarted: 1, launchesFailed: 0 });
    expect(second).toMatchObject({ filesScanned: 1, alreadyHandled: 1, launchesStarted: 0 });
    expect(launches).toHaveLength(1);
    expect(launches[0].event).toMatchObject({ event: "review-approved", source: "review-chain", runId: "run-source-1" });
    expect(JSON.parse(readFileSync(join(stateDir, "handled", "review.event"), "utf8"))).toMatchObject({
      schemaVersion: 1,
      complete: true,
      launchedTriggerKeys: ["notify"],
    });
  });

  it("persists successful trigger launches and retries only a failed sibling", async () => {
    const root = makeRoot();
    const stateDir = join(root, "state");
    const eventPath = join(root, "handoff.event");
    const firstChain = join(root, "first.json");
    const secondChain = join(root, "second.json");
    writeFileSync(firstChain, "{}");
    writeFileSync(secondChain, "{}");
    writeFileSync(eventPath, eventContent());
    const triggers = [trigger("first", firstChain), trigger("second", secondChain)];
    const launched: string[] = [];
    let failSecond = true;
    const launch = async ({ trigger: matched }: ChainWatcherLaunchInput) => {
      launched.push(matched.key);
      if (matched.key === "second" && failSecond) throw new Error("spawn unavailable");
      return { pid: 7 };
    };

    const first = await processChainWatcherEvent(eventPath, triggers, {
      namespaceId: "default",
      orgId: "default",
      stateDir,
      launch,
    });
    failSecond = false;
    const second = await processChainWatcherEvent(eventPath, triggers, {
      namespaceId: "default",
      orgId: "default",
      stateDir,
      launch,
    });
    const third = await processChainWatcherEvent(eventPath, triggers, {
      namespaceId: "default",
      orgId: "default",
      stateDir,
      launch,
    });

    expect(first).toMatchObject({ launchesStarted: 1, launchesFailed: 1 });
    expect(second).toMatchObject({ launchesStarted: 1, launchesFailed: 0 });
    expect(third).toMatchObject({ alreadyHandled: 1, launchesStarted: 0 });
    expect(launched).toEqual(["first", "second", "second"]);
  });

  it("does not poison malformed or already-processed events", async () => {
    const root = makeRoot();
    const stateDir = join(root, "state");
    const malformedPath = join(root, "malformed.event");
    const processedPath = join(root, "processed.event");
    writeFileSync(malformedPath, eventContent().replace("run_id: run-source-1\n", ""));
    writeFileSync(processedPath, eventContent({ processed: "true" }));
    const launch = jest.fn(async () => ({ pid: 1 }));
    const matched = trigger("notify", join(root, "notify.json"));

    const malformed = await processChainWatcherEvent(malformedPath, [matched], {
      namespaceId: "default",
      orgId: "default",
      stateDir,
      launch,
    });
    const processed = await processChainWatcherEvent(processedPath, [matched], {
      namespaceId: "default",
      orgId: "default",
      stateDir,
      launch,
    });

    expect(malformed.invalidEvents).toBe(1);
    expect(processed).toMatchObject({ triggersMatched: 0, launchesStarted: 0 });
    expect(launch).not.toHaveBeenCalled();
    expect(existsSync(join(stateDir, "handled", "malformed.event"))).toBe(false);
  });

  it("sanitizes launch environment and passes event data only when requested", () => {
    const event = parseRunnerEvent(eventContent({ data: "payload" }));
    const baseEnv = {
      PATH: "/bin",
      CHAIN_INPUT: "stale",
      BASH_FUNC_injected: "() { dangerous; }",
    };
    const withoutData = buildChainWatcherLaunchEnv({
      namespaceId: "acme",
      orgId: "eng",
      event,
      trigger: trigger("plain", "/chains/plain.json", { pass_data: false }),
    }, baseEnv);
    const withData = buildChainWatcherLaunchEnv({
      namespaceId: "acme",
      orgId: "eng",
      event,
      trigger: trigger("data", "/chains/data.json", { pass_data: true }),
    }, baseEnv);

    expect(withoutData).toMatchObject({
      NAMESPACE_ID: "acme",
      ORG_ID: "eng",
      CHAIN_TRIGGER_EVENT: "review-approved",
      CHAIN_TRIGGER_SOURCE: "review-chain",
      MENTIKO_RUNNER_V2: "1",
      MENTIKO_RUNNER_V2_COMPLETION: "1",
    });
    expect(withoutData.CHAIN_INPUT).toBeUndefined();
    expect(withoutData.BASH_FUNC_injected).toBeUndefined();
    expect(withData.CHAIN_INPUT).toBe("payload");
  });

  it("enforces one watcher lock per namespace and org and reclaims a dead holder", () => {
    const root = makeRoot();
    const first = acquireChainWatcherLock({
      stateDir: root,
      namespaceId: "default",
      orgId: "default",
      pid: 101,
    });
    const duplicate = acquireChainWatcherLock({
      stateDir: root,
      namespaceId: "default",
      orgId: "default",
      pid: 202,
      isProcessAlive: (pid) => pid === 101,
    });
    const reclaimed = acquireChainWatcherLock({
      stateDir: root,
      namespaceId: "default",
      orgId: "default",
      pid: 303,
      isProcessAlive: () => false,
    });

    expect(first.acquired).toBe(true);
    expect(duplicate.acquired).toBe(false);
    expect(reclaimed.acquired).toBe(true);
    first.release();
    expect(existsSync(join(root, "running-default-default"))).toBe(true);
    reclaimed.release();
    expect(existsSync(join(root, "running-default-default"))).toBe(false);
  });

  it("treats EPERM as a live watcher owner, including a legacy pid lock", () => {
    const root = makeRoot();
    const lockDir = join(root, "running-default-default");
    mkdirSync(lockDir);
    writeFileSync(join(lockDir, "pid"), "424242\n");
    const kill = jest.spyOn(process, "kill").mockImplementation(() => {
      throw Object.assign(new Error("not permitted"), { code: "EPERM" });
    });

    try {
      const duplicate = acquireChainWatcherLock({
        stateDir: root,
        namespaceId: "default",
        orgId: "default",
        pid: 303,
        processIdentity: () => undefined,
      });
      expect(duplicate.acquired).toBe(false);
      expect(readFileSync(join(lockDir, "pid"), "utf8").trim()).toBe("424242");
    } finally {
      kill.mockRestore();
    }
  });

  it("reclaims a same-PID watcher lock when the process start identity changed", () => {
    const root = makeRoot();
    const first = acquireChainWatcherLock({
      stateDir: root,
      namespaceId: "default",
      orgId: "default",
      pid: 101,
      isProcessAlive: () => true,
      processIdentity: () => "start-a",
    });
    const reusedPid = acquireChainWatcherLock({
      stateDir: root,
      namespaceId: "default",
      orgId: "default",
      pid: 101,
      isProcessAlive: () => true,
      processIdentity: () => "start-b",
    });

    expect(first.acquired).toBe(true);
    expect(reusedPid.acquired).toBe(true);
    first.release();
    expect(existsSync(join(root, "running-default-default"))).toBe(true);
    reusedPid.release();
    expect(existsSync(join(root, "running-default-default"))).toBe(false);
  });

  it("runs one background-worker tick with blocking supplied by the service boundary", async () => {
    const root = makeRoot();
    const paths = {
      eventsDir: join(root, "events"),
      chainsDir: join(root, "chains"),
      stateDir: join(root, "runtime", "chain-watcher"),
    };
    mkdirSync(paths.eventsDir, { recursive: true });
    writeChain(paths.chainsDir, "notify", [{ event: "review-approved" }]);
    writeFileSync(join(paths.eventsDir, "event.event"), eventContent());
    const launch = jest.fn(async () => ({ pid: 91 }));
    const onTick = jest.fn();

    const result = await runChainWatcher({
      namespaceId: "default",
      orgId: "default",
      paths,
      oneshot: true,
      launch,
      onTick,
    });

    expect(result).toMatchObject({ duplicate: false, iterations: 1, filesScanned: 1, launchesStarted: 1 });
    expect(launch).toHaveBeenCalledTimes(1);
    expect(onTick).toHaveBeenCalledWith(expect.objectContaining({ launchesStarted: 1 }));
    expect(existsSync(join(paths.stateDir, "running-default-default"))).toBe(false);
  });

  it("unblocks the filesystem wait immediately when the worker stops", async () => {
    const root = makeRoot();
    const controller = new AbortController();
    const waiting = waitForChainWatcherEvents(root, 10_000, controller.signal);

    controller.abort();

    await expect(waiting).resolves.toBeUndefined();
  });

  it("reports a fatal service error to the worker supervisor instead of silently stopping", async () => {
    const root = makeRoot();
    const invalidEventsDir = join(root, "events-file");
    writeFileSync(invalidEventsDir, "not a directory");
    const onFatalError = jest.fn();

    startChainWatcherService({
      namespaceId: "default",
      orgId: "default",
      paths: {
        eventsDir: invalidEventsDir,
        chainsDir: join(root, "chains"),
        stateDir: join(root, "state"),
      },
      onFatalError,
      log: () => undefined,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onFatalError).toHaveBeenCalledWith(expect.any(Error));
    expect(getChainWatcherServiceStatus()).toMatchObject({
      status: "stopped",
      lastError: expect.stringContaining("EEXIST"),
    });
  });

  it("retains old markers while their unprocessed event still exists", () => {
    const root = makeRoot();
    const handledDir = join(root, "handled");
    const eventsDir = join(root, "events");
    mkdirSync(handledDir, { recursive: true });
    mkdirSync(eventsDir, { recursive: true });
    writeFileSync(join(handledDir, "active.event"), "active");
    writeFileSync(join(handledDir, "processed.event"), "processed");
    writeFileSync(join(handledDir, "missing.event"), "missing");
    writeFileSync(join(eventsDir, "active.event"), eventContent());
    writeFileSync(join(eventsDir, "processed.event"), eventContent({ processed: "true" }));
    const now = Date.now();

    expect(cleanHandledEventState(root, now + 1, undefined, eventsDir)).toBe(2);
    expect(existsSync(join(handledDir, "active.event"))).toBe(true);
    expect(existsSync(join(handledDir, "processed.event"))).toBe(false);
    expect(existsSync(join(handledDir, "missing.event"))).toBe(false);
  });
});
