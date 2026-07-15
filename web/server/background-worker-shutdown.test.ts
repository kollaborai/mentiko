import { createBackgroundWorkerShutdown } from "./background-worker-shutdown";

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("background worker shutdown", () => {
  it("latches a fatal request that arrives during graceful shutdown", async () => {
    const stop = deferred();
    const exits: number[] = [];
    const controller = createBackgroundWorkerShutdown({
      stop: () => stop.promise,
      finalize: () => undefined,
      exit: (code) => { exits.push(code); },
    });

    const graceful = controller.request("SIGTERM");
    const fatal = controller.request("uncaughtException", 1);
    expect(fatal).toBe(graceful);
    stop.resolve();
    await graceful;

    expect(exits).toEqual([1]);
  });

  it("exits fatally and still finalizes when service shutdown rejects", async () => {
    const calls: string[] = [];
    const errors: unknown[] = [];
    const exits: number[] = [];
    const controller = createBackgroundWorkerShutdown({
      stop: async () => {
        calls.push("stop");
        throw new Error("watcher stop failed");
      },
      finalize: () => { calls.push("finalize"); },
      exit: (code) => { exits.push(code); },
      onError: (error) => { errors.push(error); },
    });

    await controller.request("SIGTERM");

    expect(calls).toEqual(["stop", "finalize"]);
    expect(errors).toEqual([expect.objectContaining({ message: "watcher stop failed" })]);
    expect(exits).toEqual([1]);
  });

  it("shares one shutdown promise and stops services once", async () => {
    let stopCalls = 0;
    let finalizeCalls = 0;
    const controller = createBackgroundWorkerShutdown({
      stop: () => { stopCalls += 1; },
      finalize: () => { finalizeCalls += 1; },
      exit: () => undefined,
    });

    const first = controller.request("SIGTERM");
    const duplicate = controller.request("SIGINT");
    expect(duplicate).toBe(first);
    await Promise.all([first, duplicate]);

    expect(stopCalls).toBe(1);
    expect(finalizeCalls).toBe(1);
  });
});
