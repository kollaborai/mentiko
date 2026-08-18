import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  calculateBackoff,
  circuitStatePath,
  getCircuitState,
  isCircuitOpen,
  recordCircuitFailure,
  resetCircuit,
  shouldRetry,
  validateCircuitState,
  validateRawCircuitState,
} from "@/lib/runner-v2/retry-circuit";

const root = join("/tmp", `mentiko-retry-circuit-${process.pid}`);

beforeEach(() => mkdirSync(root, { recursive: true }));
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("retry circuit state", () => {
  it("keeps the legacy filename while validating and atomically persisting the normalized shape", () => {
    const path = circuitStatePath(root, "chain_1", "agent with spaces!");
    expect(path).toBe(join(realpathSync(root), "retry", "circuit_chain_1_agent_with_spaces_.json"));
    const state = recordCircuitFailure({ stateDir: root, chainId: "chain_1", agentName: "agent with spaces!", threshold: 2, timeout: 30, now: 100 });
    expect(state).toEqual({ state: "closed", failure_count: 1, last_failure: 100, open_until: 0, threshold: 2, timeout: 30 });
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(state);
    expect(recordCircuitFailure({ stateDir: root, chainId: "chain_1", agentName: "agent with spaces!", threshold: 2, timeout: 30, now: 101 }).state).toBe("open");
    expect(isCircuitOpen(root, "chain_1", "agent with spaces!", 120)).toBe(true);
    expect(isCircuitOpen(root, "chain_1", "agent with spaces!", 132)).toBe(false);
    expect(getCircuitState(root, "chain_1", "agent with spaces!")).toMatchObject({ state: "half_open", failure_count: 0, open_until: 0 });
  });

  it("fails closed on raw or normalized corruption rather than treating it as a free circuit", () => {
    const path = circuitStatePath(root, "chain", "agent");
    mkdirSync(join(root, "retry"), { recursive: true });
    writeFileSync(path, "not json");
    expect(() => isCircuitOpen(root, "chain", "agent", 1)).toThrow("Invalid raw circuit state JSON");
    writeFileSync(path, JSON.stringify({ state: "open", failure_count: 1 }));
    expect(() => isCircuitOpen(root, "chain", "agent", 1)).toThrow("Invalid normalized circuit state");
  });

  it("separates physical JSON validation from normalized record validation and rejects symlinked state", () => {
    expect(validateRawCircuitState("{")).toMatchObject({ valid: false, issues: [{ code: "invalid-json" }] });
    expect(validateRawCircuitState("[]")).toMatchObject({ valid: false, issues: [{ code: "invalid-root" }] });
    expect(validateCircuitState({ state: "closed", failure_count: 0 })).toMatchObject({ valid: false });
    const path = circuitStatePath(root, "chain", "agent");
    mkdirSync(join(root, "retry"), { recursive: true });
    const target = join(root, "outside.json");
    writeFileSync(target, JSON.stringify({ state: "closed", failure_count: 0, last_failure: 0, open_until: 0, threshold: 1, timeout: 1 }));
    symlinkSync(target, path);
    expect(() => getCircuitState(root, "chain", "agent")).toThrow("must not be a symbolic link");
  });

  it("resets only the canonical circuit path and retains retry policy semantics", () => {
    recordCircuitFailure({ stateDir: root, chainId: "chain", agentName: "agent", now: 1 });
    const path = circuitStatePath(root, "chain", "agent");
    resetCircuit(root, "chain", "agent");
    expect(existsSync(path)).toBe(false);
    expect(getCircuitState(root, "chain", "agent")).toEqual({ state: "closed", failure_count: 0 });
    expect(calculateBackoff(3, "exponential", 100)).toBe(400);
    expect(calculateBackoff(5, "exponential", 1000, 5000)).toBe(5000);
    expect(shouldRetry(2, 3)).toBe(true);
    expect(shouldRetry(3, 3)).toBe(false);
  });
});
