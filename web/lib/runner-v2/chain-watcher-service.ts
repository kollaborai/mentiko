import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  watch,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import config from "@/lib/config";
import {
  acquireExclusiveFileClaim,
  claimProcessIdentity,
  claimProcessIsAlive,
  claimProcessMatchesIdentity,
  ExclusiveFileClaimBusyError,
} from "@/lib/runner-v2/file-claim";
import {
  eventMatchesTrigger,
  isUnprocessedRunnerEvent,
  parseRunnerEvent,
  type RunnerEventRecord,
  type RunnerEventTrigger,
} from "@/lib/runner-v2/events";

const DEFAULT_POLL_INTERVAL_MS = 10_000;
const DEFAULT_TRIGGER_RELOAD_ITERATIONS = 6;
const DEFAULT_CLEANUP_ITERATIONS = 60;
const DEFAULT_HANDLED_TTL_MS = 24 * 60 * 60 * 1000;

export interface ChainWatcherPaths {
  eventsDir: string;
  chainsDir: string;
  stateDir: string;
}

export interface ChainWatcherTrigger extends RunnerEventTrigger {
  event: string;
  chainName: string;
  chainPath: string;
  key: string;
}

export interface ChainWatcherLaunchInput {
  namespaceId: string;
  orgId: string;
  event: RunnerEventRecord;
  trigger: ChainWatcherTrigger;
  stateDir: string;
}

export interface ChainWatcherLaunchResult {
  pid?: number;
  logPath?: string;
}

export interface ChainWatcherTickResult {
  filesScanned: number;
  invalidEvents: number;
  alreadyHandled: number;
  triggersMatched: number;
  launchesStarted: number;
  launchesFailed: number;
}

export interface ChainWatcherRunResult extends ChainWatcherTickResult {
  duplicate: boolean;
  iterations: number;
}

export interface ChainWatcherOptions {
  namespaceId?: string;
  orgId?: string;
  paths?: ChainWatcherPaths;
  pollIntervalMs?: number;
  triggerReloadIterations?: number;
  cleanupIterations?: number;
  handledTtlMs?: number;
  oneshot?: boolean;
  signal?: AbortSignal;
  launch?: (input: ChainWatcherLaunchInput) => Promise<ChainWatcherLaunchResult>;
  log?: (level: "info" | "warn" | "error", message: string) => void;
  now?: () => Date;
  isProcessAlive?: (pid: number) => boolean;
  processIdentity?: (pid: number) => string | undefined;
  waitForEvents?: (eventsDir: string, timeoutMs: number, signal?: AbortSignal) => Promise<void>;
  onTick?: (result: ChainWatcherTickResult) => void;
  onFatalError?: (error: Error) => void;
}

interface HandledEventState {
  schemaVersion: 1;
  eventFingerprint: string;
  launchedTriggerKeys: string[];
  complete: boolean;
  updatedAt: string;
}

interface ChainWatcherLock {
  acquired: boolean;
  release: () => void;
}

interface ChainWatcherServiceState {
  controller: AbortController | null;
  promise: Promise<ChainWatcherRunResult> | null;
  startedAt: string | null;
  lastError: string | null;
  lastResult: ChainWatcherRunResult | null;
  lastCheck: string | null;
  checkCount: number;
  lastTick: ChainWatcherTickResult | null;
}

const globalState = globalThis as typeof globalThis & {
  __mentikoChainWatcherService?: ChainWatcherServiceState;
};

if (!globalState.__mentikoChainWatcherService) {
  globalState.__mentikoChainWatcherService = {
    controller: null,
    promise: null,
    startedAt: null,
    lastError: null,
    lastResult: null,
    lastCheck: null,
    checkCount: 0,
    lastTick: null,
  };
}

const serviceState = globalState.__mentikoChainWatcherService;

export function resolveChainWatcherPaths(
  namespaceId = config.namespaceId,
  orgId = config.orgId,
): ChainWatcherPaths {
  if (namespaceId !== config.namespaceId || orgId !== config.orgId) {
    throw new Error(
      `chain watcher scope ${namespaceId}/${orgId} does not match configured project ${config.namespaceId}/${config.orgId}; explicit paths are required`,
    );
  }
  return {
    chainsDir: config.chainsDir,
    eventsDir: config.eventsDir,
    stateDir: join(config.projectRoot, "runtime", "chain-watcher"),
  };
}

export function loadChainWatcherTriggers(
  chainsDir: string,
  log: ChainWatcherOptions["log"] = defaultLog,
): ChainWatcherTrigger[] {
  if (!existsSync(chainsDir)) return [];

  const triggers: ChainWatcherTrigger[] = [];
  for (const entry of readdirSync(chainsDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const chainPath = join(chainsDir, entry.name, "chain.json");
    if (!existsSync(chainPath)) continue;

    let chain: unknown;
    try {
      chain = JSON.parse(readFileSync(chainPath, "utf8"));
    } catch (error) {
      log?.("warn", `skipping invalid chain JSON ${chainPath}: ${errorMessage(error)}`);
      continue;
    }

    const rawTriggers = readEventTriggers(chain);
    for (let index = 0; index < rawTriggers.length; index += 1) {
      const trigger = normalizeTrigger(rawTriggers[index], entry.name, chainPath);
      if (!trigger) {
        log?.("warn", `skipping invalid event trigger ${entry.name}[${index}]`);
        continue;
      }
      if (trigger.enabled !== false) triggers.push(trigger);
    }
  }
  return triggers;
}

export function evaluateChainWatcherCondition(condition: string | undefined, data: string): boolean {
  if (!condition || condition.trim() === "") return true;
  const expression = condition.trim();
  if (expression.length > 4096 || hasUnsafeConditionSyntax(expression)) return false;

  const unary = expression.match(/^-(n|z)\s+(.+)$/);
  if (unary) {
    const operand = parseConditionOperand(unary[2], data);
    if (!operand) return false;
    return unary[1] === "n" ? operand.value.length > 0 : operand.value.length === 0;
  }

  const binary = expression.match(/^(.+?)\s+(==|=|!=|=~|-eq|-ne|-lt|-le|-gt|-ge|<|>)\s+(.+)$/);
  if (!binary) return false;
  const left = parseConditionOperand(binary[1], data);
  const right = parseConditionOperand(binary[3], data);
  if (!left || !right) return false;

  switch (binary[2]) {
    case "=":
    case "==":
      return right.pattern ? globMatches(left.value, right.value) : left.value === right.value;
    case "!=":
      return right.pattern ? !globMatches(left.value, right.value) : left.value !== right.value;
    case "=~":
      try {
        if (!isSafeConditionRegex(right.value)) return false;
        return new RegExp(right.value).test(left.value);
      } catch {
        return false;
      }
    case "<":
      return left.value < right.value;
    case ">":
      return left.value > right.value;
    case "-eq":
    case "-ne":
    case "-lt":
    case "-le":
    case "-gt":
    case "-ge":
      return numericConditionMatches(binary[2], left.value, right.value);
    default:
      return false;
  }
}

export async function processChainWatcherEvent(
  eventPath: string,
  triggers: ChainWatcherTrigger[],
  input: Required<Pick<ChainWatcherOptions, "namespaceId" | "orgId">>
    & Pick<ChainWatcherOptions, "launch" | "log" | "now">
    & { stateDir: string },
): Promise<Omit<ChainWatcherTickResult, "filesScanned">> {
  const result = emptyTickResult();
  let content: string;
  let event: RunnerEventRecord;
  try {
    content = readFileSync(eventPath, "utf8");
    event = { ...parseRunnerEvent(content), path: eventPath };
  } catch (error) {
    input.log?.("warn", `skipping invalid event ${eventPath}: ${errorMessage(error)}`);
    result.invalidEvents += 1;
    return withoutFilesScanned(result);
  }

  if (!isUnprocessedRunnerEvent(event)) return withoutFilesScanned(result);
  const matching = triggers.filter((trigger) =>
    eventMatchesTrigger(event, trigger)
    && evaluateChainWatcherCondition(trigger.condition, event.data));
  result.triggersMatched = matching.length;
  if (matching.length === 0) return withoutFilesScanned(result);

  const markerPath = join(input.stateDir, "handled", basename(eventPath));
  const fingerprint = sha256(content);
  const handled = readHandledEventState(markerPath, fingerprint);
  if (handled?.complete) {
    result.alreadyHandled += 1;
    return withoutFilesScanned(result);
  }

  const launch = input.launch || launchTriggeredChain;
  const now = input.now || (() => new Date());
  const launched = new Set(handled?.launchedTriggerKeys || []);
  for (const trigger of matching) {
    if (launched.has(trigger.key)) continue;
    try {
      const started = await launch({
        namespaceId: input.namespaceId,
        orgId: input.orgId,
        event,
        trigger,
        stateDir: input.stateDir,
      });
      launched.add(trigger.key);
      result.launchesStarted += 1;
      writeHandledEventState(markerPath, {
        schemaVersion: 1,
        eventFingerprint: fingerprint,
        launchedTriggerKeys: [...launched].sort(),
        complete: false,
        updatedAt: now().toISOString(),
      });
      input.log?.("info", `event ${event.event} launched ${trigger.chainName}${started.pid ? ` (pid ${started.pid})` : ""}`);
    } catch (error) {
      result.launchesFailed += 1;
      input.log?.("error", `event ${event.event} failed to launch ${trigger.chainName}: ${errorMessage(error)}`);
    }
  }

  const complete = matching.every((trigger) => launched.has(trigger.key));
  if (complete) {
    writeHandledEventState(markerPath, {
      schemaVersion: 1,
      eventFingerprint: fingerprint,
      launchedTriggerKeys: [...launched].sort(),
      complete: true,
      updatedAt: now().toISOString(),
    });
  }
  return withoutFilesScanned(result);
}

export async function runChainWatcherTick(input: {
  namespaceId: string;
  orgId: string;
  paths: ChainWatcherPaths;
  triggers: ChainWatcherTrigger[];
  launch?: ChainWatcherOptions["launch"];
  log?: ChainWatcherOptions["log"];
  now?: ChainWatcherOptions["now"];
}): Promise<ChainWatcherTickResult> {
  const result = emptyTickResult();
  if (!existsSync(input.paths.eventsDir)) return result;

  const eventFiles = readdirSync(input.paths.eventsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".event"))
    .map((entry) => join(input.paths.eventsDir, entry.name))
    .sort();

  for (const eventPath of eventFiles) {
    const processed = await processChainWatcherEvent(eventPath, input.triggers, {
      namespaceId: input.namespaceId,
      orgId: input.orgId,
      stateDir: input.paths.stateDir,
      launch: input.launch,
      log: input.log,
      now: input.now,
    });
    result.filesScanned += 1;
    addTickResult(result, processed);
  }
  return result;
}

export async function runChainWatcher(options: ChainWatcherOptions = {}): Promise<ChainWatcherRunResult> {
  const namespaceId = options.namespaceId || config.namespaceId;
  const orgId = options.orgId || config.orgId || "default";
  const paths = options.paths || resolveChainWatcherPaths(namespaceId, orgId);
  const log = options.log || defaultLog;
  const pollIntervalMs = positiveInteger(options.pollIntervalMs, DEFAULT_POLL_INTERVAL_MS);
  const triggerReloadIterations = positiveInteger(
    options.triggerReloadIterations,
    DEFAULT_TRIGGER_RELOAD_ITERATIONS,
  );
  const cleanupIterations = positiveInteger(options.cleanupIterations, DEFAULT_CLEANUP_ITERATIONS);
  const handledTtlMs = positiveInteger(options.handledTtlMs, DEFAULT_HANDLED_TTL_MS);
  const now = options.now || (() => new Date());
  const waitForEvents = options.waitForEvents || waitForChainWatcherEvents;
  mkdirSync(paths.eventsDir, { recursive: true });
  mkdirSync(join(paths.stateDir, "handled"), { recursive: true });
  mkdirSync(join(paths.stateDir, "runs"), { recursive: true });

  const lock = acquireChainWatcherLock({
    stateDir: paths.stateDir,
    namespaceId,
    orgId,
    isProcessAlive: options.isProcessAlive || claimProcessIsAlive,
    processIdentity: options.processIdentity,
  });
  if (!lock.acquired) return { ...emptyTickResult(), duplicate: true, iterations: 0 };

  const total: ChainWatcherRunResult = {
    ...emptyTickResult(),
    duplicate: false,
    iterations: 0,
  };
  let triggers: ChainWatcherTrigger[] = [];

  try {
    while (!options.signal?.aborted) {
      total.iterations += 1;
      if (total.iterations % triggerReloadIterations === 1 || total.iterations === 1) {
        triggers = loadChainWatcherTriggers(paths.chainsDir, log);
        log("info", `loaded ${triggers.length} chain event trigger(s) for ${namespaceId}/${orgId}`);
      }

      const tick = await runChainWatcherTick({
        namespaceId,
        orgId,
        paths,
        triggers,
        launch: options.launch,
        log,
        now,
      });
      addTickResult(total, tick);
      options.onTick?.(tick);

      if (total.iterations % cleanupIterations === 0) {
        cleanHandledEventState(paths.stateDir, now().getTime() - handledTtlMs, log, paths.eventsDir);
      }
      if (options.oneshot) break;
      await waitForEvents(paths.eventsDir, pollIntervalMs, options.signal);
    }
  } finally {
    lock.release();
  }
  return total;
}

export function startChainWatcherService(options: Omit<ChainWatcherOptions, "signal" | "oneshot"> = {}): void {
  if (serviceState.controller) return;
  const controller = new AbortController();
  serviceState.controller = controller;
  serviceState.startedAt = new Date().toISOString();
  serviceState.lastError = null;
  const callerOnTick = options.onTick;
  serviceState.promise = runChainWatcher({
    ...options,
    signal: controller.signal,
    onTick: (tick) => {
      serviceState.lastCheck = new Date().toISOString();
      serviceState.checkCount += 1;
      serviceState.lastTick = tick;
      callerOnTick?.(tick);
    },
  })
    .then((result) => {
      serviceState.lastResult = result;
      return result;
    })
    .catch((error) => {
      const fatalError = error instanceof Error ? error : new Error(errorMessage(error));
      serviceState.lastError = fatalError.message;
      (options.log || defaultLog)("error", `chain watcher stopped unexpectedly: ${serviceState.lastError}`);
      options.onFatalError?.(fatalError);
      return { ...emptyTickResult(), duplicate: false, iterations: 0 };
    })
    .finally(() => {
      if (serviceState.controller === controller) {
        serviceState.controller = null;
        serviceState.promise = null;
        serviceState.startedAt = null;
      }
    });
}

export async function stopChainWatcherService(): Promise<void> {
  const controller = serviceState.controller;
  const promise = serviceState.promise;
  if (!controller) return;
  controller.abort();
  await promise?.catch(() => undefined);
}

export function getChainWatcherServiceStatus() {
  return {
    status: serviceState.controller ? "running" as const : "stopped" as const,
    startedAt: serviceState.startedAt,
    lastError: serviceState.lastError,
    lastResult: serviceState.lastResult,
    lastCheck: serviceState.lastCheck,
    checkCount: serviceState.checkCount,
    lastTick: serviceState.lastTick,
  };
}

export function acquireChainWatcherLock(input: {
  stateDir: string;
  namespaceId: string;
  orgId: string;
  pid?: number;
  isProcessAlive?: (pid: number) => boolean;
  processIdentity?: (pid: number) => string | undefined;
}): ChainWatcherLock {
  const pid = input.pid || process.pid;
  const lockDir = join(
    input.stateDir,
    `running-${safeFilePart(input.namespaceId)}-${safeFilePart(input.orgId)}`,
  );
  const pidPath = join(lockDir, "pid");
  const alive = input.isProcessAlive || claimProcessIsAlive;
  const identity = input.processIdentity || claimProcessIdentity;
  mkdirSync(input.stateDir, { recursive: true });

  // Pre-cutover locks wrote only `<lock>/pid`. Without a recorded start
  // identity PID reuse is unprovable, so preserve any live/EPERM legacy owner
  // and retire only a provably dead one.
  const legacyPid = readPid(pidPath);
  if (legacyPid && claimProcessMatchesIdentity(legacyPid, undefined, alive, identity)) {
    return { acquired: false, release: () => undefined };
  }
  if (legacyPid) retireLegacyWatcherLock(lockDir, pidPath, legacyPid);

  try {
    const release = acquireExclusiveFileClaim(lockDir, {
      pid,
      isProcessAlive: alive,
      processIdentity: identity,
      freshMs: 30_000,
      waitTimeoutMs: 0,
    });
    return { acquired: true, release };
  } catch (error) {
    if (error instanceof ExclusiveFileClaimBusyError) {
      return { acquired: false, release: () => undefined };
    }
    throw error;
  }
}

function retireLegacyWatcherLock(lockDir: string, pidPath: string, expectedPid: number): void {
  const quarantine = `${lockDir}.legacy-stale-${process.pid}-${Date.now()}`;
  try {
    if (readPid(pidPath) !== expectedPid) return;
    renameSync(lockDir, quarantine);
    if (readPid(join(quarantine, "pid")) !== expectedPid) {
      try { renameSync(quarantine, lockDir); } catch {}
      return;
    }
    rmSync(quarantine, { recursive: true, force: true });
  } catch {
    // The legacy owner or another contender changed the lock; fail closed and
    // let the owner.json claim acquisition observe the remaining state.
  }
}

export async function waitForChainWatcherEvents(
  eventsDir: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) return;
  await new Promise<void>((resolve) => {
    let settled = false;
    let watcher: ReturnType<typeof watch> | undefined;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      watcher?.close();
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    try {
      watcher = watch(eventsDir, { persistent: false }, finish);
      watcher.on("error", finish);
    } catch {
      // The timeout remains the poll path when the filesystem cannot watch.
    }
    signal?.addEventListener("abort", finish, { once: true });
  });
}

export function cleanHandledEventState(
  stateDir: string,
  olderThanMs: number,
  log: ChainWatcherOptions["log"] = defaultLog,
  eventsDir?: string,
): number {
  const handledDir = join(stateDir, "handled");
  if (!existsSync(handledDir)) return 0;
  let removed = 0;
  for (const entry of readdirSync(handledDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(handledDir, entry.name);
    try {
      if (statSync(path).mtimeMs < olderThanMs) {
        if (eventsDir && eventStillNeedsHandledMarker(join(eventsDir, entry.name))) continue;
        unlinkSync(path);
        removed += 1;
      }
    } catch (error) {
      log?.("warn", `failed to clean handled marker ${path}: ${errorMessage(error)}`);
    }
  }
  return removed;
}

async function launchTriggeredChain(input: ChainWatcherLaunchInput): Promise<ChainWatcherLaunchResult> {
  if (!existsSync(input.trigger.chainPath)) {
    throw new Error(`chain not found: ${input.trigger.chainPath}`);
  }
  const runsDir = join(input.stateDir, "runs");
  mkdirSync(runsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
  const logPath = join(runsDir, `${safeFilePart(input.trigger.chainName)}-${stamp}-${input.trigger.key.slice(0, 8)}.log`);
  const logFd = openSync(logPath, "a");
  const env = buildChainWatcherLaunchEnv(input, process.env);
  let child: ChildProcess;
  try {
    child = spawn(join(config.binDir, "mentiko"), ["run", input.trigger.chainPath], {
      cwd: config.codeRoot,
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: {
        ...env,
        NODE_ENV: nodeEnvironment(env.NODE_ENV || process.env.NODE_ENV),
      },
    });
    await waitForSpawn(child);
  } finally {
    closeSync(logFd);
  }
  child.unref();
  return { pid: child.pid, logPath };
}

export function buildChainWatcherLaunchEnv(
  input: Pick<ChainWatcherLaunchInput, "namespaceId" | "orgId" | "event" | "trigger">,
  baseEnv: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const env = Object.fromEntries(
    Object.entries(baseEnv).filter(([key, value]) => value !== undefined && !key.startsWith("BASH_FUNC_")),
  );
  delete env.CHAIN_INPUT;
  env.NAMESPACE_ID = input.namespaceId;
  env.ORG_ID = input.orgId;
  env.CHAIN_TRIGGER_EVENT = input.event.event;
  env.CHAIN_TRIGGER_SOURCE = input.event.source;
  env.MENTIKO_RUNNER_V2 = "1";
  env.MENTIKO_RUNNER_V2_COMPLETION = "1";
  if (input.trigger.pass_data === true) env.CHAIN_INPUT = input.event.data;
  return env;
}

function readEventTriggers(chain: unknown): unknown[] {
  if (!chain || typeof chain !== "object" || Array.isArray(chain)) return [];
  const chainObject = chain as Record<string, unknown>;
  const chainConfig = chainObject.config;
  if (!chainConfig || typeof chainConfig !== "object" || Array.isArray(chainConfig)) return [];
  const triggers = (chainConfig as Record<string, unknown>).event_triggers;
  return Array.isArray(triggers) ? triggers : [];
}

function normalizeTrigger(
  value: unknown,
  chainName: string,
  chainPath: string,
): ChainWatcherTrigger | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const trigger = value as Record<string, unknown>;
  if (typeof trigger.event !== "string" || trigger.event.trim() === "") return null;
  if (trigger.source_chain !== undefined && typeof trigger.source_chain !== "string") return null;
  if (trigger.condition !== undefined && typeof trigger.condition !== "string") return null;
  if (trigger.pass_data !== undefined && typeof trigger.pass_data !== "boolean") return null;
  if (trigger.enabled !== undefined && typeof trigger.enabled !== "boolean") return null;
  const normalized: ChainWatcherTrigger = {
    event: trigger.event,
    chainName,
    chainPath,
    key: "",
    ...(typeof trigger.source_chain === "string" ? { source_chain: trigger.source_chain } : {}),
    ...(typeof trigger.condition === "string" ? { condition: trigger.condition } : {}),
    ...(typeof trigger.pass_data === "boolean" ? { pass_data: trigger.pass_data } : {}),
    ...(typeof trigger.enabled === "boolean" ? { enabled: trigger.enabled } : {}),
  };
  normalized.key = sha256(JSON.stringify({
    chainPath,
    event: normalized.event,
    source_chain: normalized.source_chain,
    condition: normalized.condition,
    pass_data: normalized.pass_data,
    enabled: normalized.enabled,
  }));
  return normalized;
}

function hasUnsafeConditionSyntax(expression: string): boolean {
  return /[\r\n;`|&]|\$\(|<\(|>\(|\[\[|\]\]/.test(expression);
}

function isSafeConditionRegex(expression: string): boolean {
  if (expression.length > 512) return false;
  if (/\\[1-9]|\(\?[=!<]/.test(expression)) return false;
  // Reject a quantified group that itself contains a repetition. This blocks
  // the common catastrophic-backtracking forms while retaining simple anchors,
  // classes, and one-level repetitions used by existing trigger conditions.
  if (/\([^)]*[*+{][^)]*\)[*+{]/.test(expression)) return false;
  return true;
}

function parseConditionOperand(
  rawValue: string,
  data: string,
): { value: string; pattern: boolean } | null {
  const raw = rawValue.trim();
  if (/^(?:\$data|\$\{data\}|"\$data"|"\$\{data\}")$/.test(raw)) {
    return { value: data, pattern: false };
  }
  if (raw.startsWith('"') && raw.endsWith('"')) {
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === "string" ? { value: parsed, pattern: false } : null;
    } catch {
      return null;
    }
  }
  if (raw.startsWith("'") && raw.endsWith("'") && !raw.slice(1, -1).includes("'")) {
    return { value: raw.slice(1, -1), pattern: false };
  }
  if (!/^[A-Za-z0-9_./:@%+*?{}\[\]^$-]+$/.test(raw)) return null;
  return { value: raw, pattern: raw.includes("*") || raw.includes("?") };
}

function globMatches(value: string, pattern: string): boolean {
  const regex = pattern
    .split("")
    .map((character) => character === "*" ? ".*" : character === "?" ? "." : escapeRegex(character))
    .join("");
  return new RegExp(`^${regex}$`).test(value);
}

function numericConditionMatches(operator: string, left: string, right: string): boolean {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (!Number.isFinite(leftNumber) || !Number.isFinite(rightNumber)) return false;
  if (operator === "-eq") return leftNumber === rightNumber;
  if (operator === "-ne") return leftNumber !== rightNumber;
  if (operator === "-lt") return leftNumber < rightNumber;
  if (operator === "-le") return leftNumber <= rightNumber;
  if (operator === "-gt") return leftNumber > rightNumber;
  return leftNumber >= rightNumber;
}

function readHandledEventState(path: string, fingerprint: string): HandledEventState | null {
  if (!existsSync(path)) return null;
  try {
    const state = JSON.parse(readFileSync(path, "utf8")) as Partial<HandledEventState>;
    if (state.schemaVersion !== 1 || state.eventFingerprint !== fingerprint) return null;
    return {
      schemaVersion: 1,
      eventFingerprint: fingerprint,
      launchedTriggerKeys: Array.isArray(state.launchedTriggerKeys)
        ? state.launchedTriggerKeys.filter((key): key is string => typeof key === "string")
        : [],
      complete: state.complete === true,
      updatedAt: typeof state.updatedAt === "string" ? state.updatedAt : "",
    };
  } catch {
    // A pre-migration marker means the event already launched. Honor it to
    // avoid duplicate side effects during the typed ownership cutover.
    return {
      schemaVersion: 1,
      eventFingerprint: fingerprint,
      launchedTriggerKeys: [],
      complete: true,
      updatedAt: "",
    };
  }
}

function eventStillNeedsHandledMarker(eventPath: string): boolean {
  if (!existsSync(eventPath)) return false;
  try {
    return isUnprocessedRunnerEvent(parseRunnerEvent(readFileSync(eventPath, "utf8")));
  } catch {
    // Fail closed: an invalid file must not cause deletion of the only durable
    // evidence that a prior version already launched its side effects.
    return true;
  }
}

function writeHandledEventState(path: string, state: HandledEventState): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmpPath, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  renameSync(tmpPath, path);
}

function waitForSpawn(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const onSpawn = () => {
      child.off("error", onError);
      resolve();
    };
    const onError = (error: Error) => {
      child.off("spawn", onSpawn);
      reject(error);
    };
    child.once("spawn", onSpawn);
    child.once("error", onError);
  });
}

function readPid(path: string): number | null {
  try {
    const pid = Number.parseInt(readFileSync(path, "utf8").trim(), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function addTickResult(target: ChainWatcherTickResult, value: Partial<ChainWatcherTickResult>): void {
  target.filesScanned += value.filesScanned || 0;
  target.invalidEvents += value.invalidEvents || 0;
  target.alreadyHandled += value.alreadyHandled || 0;
  target.triggersMatched += value.triggersMatched || 0;
  target.launchesStarted += value.launchesStarted || 0;
  target.launchesFailed += value.launchesFailed || 0;
}

function emptyTickResult(): ChainWatcherTickResult {
  return {
    filesScanned: 0,
    invalidEvents: 0,
    alreadyHandled: 0,
    triggersMatched: 0,
    launchesStarted: 0,
    launchesFailed: 0,
  };
}

function withoutFilesScanned(
  value: ChainWatcherTickResult,
): Omit<ChainWatcherTickResult, "filesScanned"> {
  const { filesScanned: _ignored, ...result } = value;
  return result;
}

function positiveInteger(value: number | undefined, defaultValue: number): number {
  return Number.isInteger(value) && value! > 0 ? value! : defaultValue;
}

function nodeEnvironment(value: string | undefined): "development" | "production" | "test" {
  return value === "development" || value === "test" ? value : "production";
}

function safeFilePart(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "-").replace(/-+/g, "-").slice(0, 80) || "default";
}

function escapeRegex(value: string): string {
  return /[\\^$.*+?()[\]{}|]/.test(value) ? `\\${value}` : value;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function defaultLog(level: "info" | "warn" | "error", message: string): void {
  const line = `[chain-watcher] ${message}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
