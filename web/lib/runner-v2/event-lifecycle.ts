import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, parse, resolve } from "node:path";
import { withExclusiveFileClaim } from "@/lib/runner-v2/file-claim";
import { runnerEventIdentityMatches } from "@/lib/runner-v2/event-identity";
import {
  parseRunnerEvent,
  validateRawRunnerEvent,
  type RunnerEventRawIssue,
  type RunnerEventRecord,
} from "@/lib/runner-v2/events";

export interface RunnerEventFile {
  filename: string;
  path: string;
  content: string;
  event: RunnerEventRecord;
}

export interface InvalidRunnerEventFile {
  filename: string;
  path: string;
  issues: RunnerEventRawIssue[];
}

export interface RunnerEventScanResult {
  valid: RunnerEventFile[];
  invalid: InvalidRunnerEventFile[];
}

export interface FindRunnerEventInput {
  eventsDir: string;
  runId: string;
  expectedEvent?: string;
  agentId: string;
  sessionName?: string;
  allAgentIds?: string[];
}

export interface FindRunnerEventResult {
  match?: RunnerEventFile;
  invalid: InvalidRunnerEventFile[];
}

export type MarkRunnerEventStatus = "marked" | "already-processed";

export interface MarkRunnerEventResult {
  filename: string;
  path: string;
  status: MarkRunnerEventStatus;
  event: RunnerEventRecord;
}

export type ArchiveRunnerEventStatus =
  | "archived"
  | "collision-archived"
  | "already-archived";

interface PreparedRunnerEvent {
  original: string;
  processed: string;
  event: RunnerEventRecord;
  changed: boolean;
  mode: number;
}

/**
 * Immutable identity of the exact active event occurrence accepted by the
 * completion planner. The record hash covers every normalized field, while
 * the raw hash preserves byte-level provenance. occurrenceToken binds those
 * bytes to one physical file generation so a byte-identical recreation is a
 * new occurrence rather than a replay of the prior one.
 */
export interface RunnerEventAcceptedTrigger {
  version: 1;
  sourceFilename: string;
  occurrenceToken: string;
  rawContentSha256: string;
  normalizedRecordSha256: string;
}

interface RunnerEventArchiveReceipt {
  version: 2;
  role: "trigger" | "owned-sibling";
  occurrence: number;
  sourceFilename: string;
  runId: string;
  destinationFilename: string;
  occurrenceToken: string;
  acceptedContentSha256: string;
  acceptedRecordSha256: string;
  archivedContentSha256: string;
}

interface RunnerEventArchiveProof {
  receipt: RunnerEventArchiveReceipt;
  destination: string;
  content: string;
  event: RunnerEventRecord;
}

export interface ArchiveRunnerEventResult {
  filename: string;
  path: string;
  destination: string;
  status: ArchiveRunnerEventStatus;
  event: RunnerEventRecord;
}

export interface ConsumeRunnerEventsInput {
  eventsDir: string;
  runId: string;
  source: string;
  triggered: string;
  expectedEvent?: string;
  sessionName?: string;
  allAgentIds?: string[];
  acceptedTrigger: RunnerEventAcceptedTrigger;
}

export interface ConsumeRunnerEventsResult {
  triggered: ArchiveRunnerEventResult;
  archived: ArchiveRunnerEventResult[];
  invalid: InvalidRunnerEventFile[];
}

// The retired source label remains read-only compatibility for pre-cutover diagnostics.
const DIAGNOSTIC_SOURCES = new Set(["monitor", "watchdog", "chain-runner-complete"]);
const CLAIM_NAME = ".event-lifecycle.claim";
const CLAIM_WAIT_TIMEOUT_MS = 5_000;
const PORTABLE_NAME_MAX_BYTES = 255;
const ARCHIVE_RECEIPT_KEYS = [
  "version",
  "role",
  "occurrence",
  "sourceFilename",
  "runId",
  "destinationFilename",
  "occurrenceToken",
  "acceptedContentSha256",
  "acceptedRecordSha256",
  "archivedContentSha256",
] as const;
const ARCHIVE_RECEIPT_NAME = /^\.event-receipt-[a-f0-9]{64}-[a-f0-9]{64}-[a-f0-9]{64}\.json$/;

/**
 * Strictly scan the configured event root. Only direct regular `*.event` files
 * participate. Invalid physical files are returned as drift evidence and are
 * never normalized into operational records.
 */
export function scanRunnerEventFiles(
  eventsDir: string,
  options: { readFile?: (path: string) => string } = {},
): RunnerEventScanResult {
  const root = requireConfiguredEventsDir(eventsDir);
  const entries = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".event"))
    .sort((left, right) => compareFileNames(left.name, right.name));
  const valid: RunnerEventFile[] = [];
  const invalid: InvalidRunnerEventFile[] = [];

  for (const entry of entries) {
    const path = join(root, entry.name);
    let content: string;
    try {
      content = options.readFile?.(path) ?? readFileSync(path, "utf8");
    } catch (error) {
      // A concurrent lifecycle consume may unlink a file after the directory
      // snapshot. That one race is a normal omission from this scan; all other
      // read failures remain operational errors.
      if (isMissingPath(error)) continue;
      throw error;
    }
    const raw = validateRawRunnerEvent(content);
    if (!raw.valid) {
      invalid.push({ filename: entry.name, path, issues: raw.issues });
      continue;
    }
    const event = { ...parseRunnerEvent(content), path };
    valid.push({ filename: entry.name, path, content, event });
  }

  return { valid, invalid };
}

/**
 * Find one strict, unprocessed completion event. A populated run id is always
 * required and must match exactly; runless ingress can never complete a run.
 * Completion discovery never inspects archived events; receipts prove only an
 * idempotent consume after a caller already holds the exact logical path.
 */
export function findRunnerCompletionEvent(input: FindRunnerEventInput): FindRunnerEventResult {
  requireNonEmpty("runId", input.runId);
  if (input.expectedEvent !== undefined) requireNonEmpty("expectedEvent", input.expectedEvent);
  requireNonEmpty("agentId", input.agentId);
  const scan = scanRunnerEventFiles(input.eventsDir);
  const allAgentIds = normalizeAgentIds(input.allAgentIds);

  const match = scan.valid.find(({ event }) => (
    !event.processed
    && completionEventMatches(event, input, allAgentIds)
  ));
  return { match, invalid: scan.invalid };
}

/** Strict, idempotent processed mutation using a same-directory temp+rename. */
export function markRunnerEventProcessed(input: {
  eventsDir: string;
  file: string;
}): MarkRunnerEventResult {
  const root = requireConfiguredEventsDir(input.eventsDir);
  return withExclusiveFileClaim(join(root, CLAIM_NAME), () => {
    const path = resolveDirectEventPath(root, input.file, true);
    return markRunnerEventProcessedUnlocked(path);
  }, { waitTimeoutMs: CLAIM_WAIT_TIMEOUT_MS });
}

/** Capture one exact active trigger before downstream launches or effects. */
export function captureRunnerEventAcceptedTrigger(input: {
  eventsDir: string;
  file: string;
  expected?: RunnerEventRecord;
}): RunnerEventAcceptedTrigger {
  const root = requireConfiguredEventsDir(input.eventsDir);
  const path = resolveDirectEventPath(root, input.file, true);
  const before = eventFileIdentity(path);
  const content = readFileSync(path, "utf8");
  const event = strictEventAtPath(path, content);
  const after = eventFileIdentity(path);
  if (stableSerialize(before) !== stableSerialize(after)) {
    throw new Error(`Event file changed while capturing accepted trigger: ${path}`);
  }
  if (input.expected && normalizedEventDigest(input.expected) !== normalizedEventDigest(event)) {
    throw new Error(`Event file no longer matches the accepted normalized trigger: ${path}`);
  }
  if (event.processed) {
    throw new Error(`Accepted trigger must still be active and unprocessed: ${path}`);
  }
  return acceptedTriggerForSnapshot(path, content, event, after);
}

/**
 * Validate the explicit trigger first, archive same-run owned siblings, and
 * consume the accepted trigger last. The active trigger remains the durable
 * retry token if any earlier cleanup fails. Every moved file is strict,
 * claimed in the archive with its processed bytes before the active source is
 * removed, and never overwrites an existing basename.
 */
export function consumeRunnerEvents(input: ConsumeRunnerEventsInput): ConsumeRunnerEventsResult {
  requireNonEmpty("runId", input.runId);
  requireNonEmpty("source", input.source);
  requireNonEmpty("triggered", input.triggered);
  if (input.expectedEvent !== undefined) requireNonEmpty("expectedEvent", input.expectedEvent);
  const root = requireConfiguredEventsDir(input.eventsDir);
  const allAgentIds = normalizeAgentIds(input.allAgentIds);

  return withExclusiveFileClaim(join(root, CLAIM_NAME), () => {
    const triggeredPath = resolveDirectEventPath(root, input.triggered, false);
    assertAcceptedTriggerShape(input.acceptedTrigger, basename(triggeredPath));
    if (existsSync(triggeredPath)) {
      const observed = captureRunnerEventAcceptedTrigger({
        eventsDir: root,
        file: triggeredPath,
      });
      if (stableSerialize(observed) !== stableSerialize(input.acceptedTrigger)) {
        throw new Error(`Active event no longer matches the accepted trigger occurrence: ${triggeredPath}`);
      }
      assertExplicitTriggerMatches(
        strictEventAtPath(triggeredPath, readFileSync(triggeredPath, "utf8")),
        input,
        allAgentIds,
        triggeredPath,
      );
    } else {
      const triggered = proveAlreadyArchived(root, triggeredPath, input, allAgentIds);
      // A replay of an already-consumed occurrence has no authority over files
      // that appeared later under the same run/owner identity.
      return {
        triggered,
        archived: [],
        invalid: scanRunnerEventFiles(root).invalid,
      };
    }

    const scan = scanRunnerEventFiles(root);
    const archived: ArchiveRunnerEventResult[] = [];
    for (const candidate of scan.valid) {
      if (candidate.path === triggeredPath) continue;
      if (!eventIsStrictlyOwned(candidate.event, {
        runId: input.runId,
        source: input.source,
        sessionName: input.sessionName,
        allAgentIds,
      })) {
        continue;
      }
      const acceptedSibling = captureRunnerEventAcceptedTrigger({
        eventsDir: root,
        file: candidate.path,
        expected: candidate.event,
      });
      archived.push(processAndArchiveUnlocked(
        root,
        candidate.path,
        "owned-sibling",
        undefined,
        acceptedSibling,
      ));
    }

    const triggered = processAndArchiveUnlocked(root, triggeredPath, "trigger", (event) => {
        assertExplicitTriggerMatches(event, input, allAgentIds, triggeredPath);
      }, input.acceptedTrigger);

    return { triggered, archived, invalid: scan.invalid };
  }, { waitTimeoutMs: CLAIM_WAIT_TIMEOUT_MS });
}

export function eventIsStrictlyOwned(
  event: RunnerEventRecord,
  owner: {
    runId: string;
    source: string;
    sessionName?: string;
    allAgentIds?: string[];
  },
): boolean {
  if (!owner.runId || event.runId !== owner.runId) return false;
  const allAgentIds = normalizeAgentIds(owner.allAgentIds);
  const candidates = DIAGNOSTIC_SOURCES.has(normalizeIdentity(event.source))
    ? [event.source, event.fields.agent]
    : [event.source];
  return candidates
    .filter((candidate): candidate is string => Boolean(candidate))
    .some((candidate) => runnerEventIdentityMatches(
      candidate,
      owner.source,
      owner.sessionName,
      allAgentIds,
    ));
}

function markRunnerEventProcessedUnlocked(path: string): MarkRunnerEventResult {
  const prepared = prepareRunnerEventForProcessing(path);
  if (!prepared.changed) {
    return {
      filename: basename(path),
      path,
      status: "already-processed",
      event: prepared.event,
    };
  }
  const temporaryPath = join(
    dirname(path),
    `.event-mark-${process.pid}-${randomUUID()}.tmp`,
  );
  try {
    writeFileSync(temporaryPath, prepared.processed, {
      encoding: "utf8",
      flag: "wx",
      mode: prepared.mode,
    });
    renameSync(temporaryPath, path);
  } finally {
    try {
      unlinkSync(temporaryPath);
    } catch {
      // rename consumed the temporary path, or the initial write failed.
    }
  }

  return {
    filename: basename(path),
    path,
    status: "marked",
    event: { ...prepared.event, path },
  };
}

function processAndArchiveUnlocked(
  root: string,
  path: string,
  receiptRole: RunnerEventArchiveReceipt["role"],
  validate?: (event: RunnerEventRecord) => void,
  acceptedTrigger?: RunnerEventAcceptedTrigger,
): ArchiveRunnerEventResult {
  const observedTrigger = captureRunnerEventAcceptedTrigger({
    eventsDir: root,
    file: path,
  });
  if (acceptedTrigger && stableSerialize(observedTrigger) !== stableSerialize(acceptedTrigger)) {
    throw new Error(`Active event no longer matches the accepted trigger occurrence: ${path}`);
  }
  const prepared = prepareRunnerEventForProcessing(path);
  validate?.(prepared.event);
  const archiveDir = ensureArchiveDir(root);
  const requestedDestination = join(archiveDir, basename(path));
  const destination = claimArchiveDestination(
    requestedDestination,
    prepared.processed,
    prepared.mode,
  );
  claimArchiveReceipt(
    archiveDir,
    receiptRole,
    basename(path),
    prepared.event.runId,
    basename(destination.path),
    acceptedTrigger || observedTrigger,
    prepared.processed,
  );
  unlinkArchivedSource(path, prepared.original);

  return {
    filename: basename(path),
    path,
    destination: destination.path,
    status: destination.status,
    event: { ...prepared.event, path: destination.path },
  };
}

function prepareRunnerEventForProcessing(path: string): PreparedRunnerEvent {
  const original = readFileSync(path, "utf8");
  const parsed = strictEventAtPath(path, original);
  const mode = statSync(path).mode & 0o777;
  if (parsed.processed) {
    return {
      original,
      processed: original,
      event: parsed,
      changed: false,
      mode,
    };
  }

  const processed = original.replace(
    /^(processed:[\t ]*)false([\t ]*)$/m,
    "$1true$2",
  );
  if (processed === original) {
    throw new Error(`Strict event processed field could not be updated: ${path}`);
  }
  const event = strictEventAtPath(path, processed);
  if (!event.processed) {
    throw new Error(`Processed mutation did not validate as true: ${path}`);
  }
  return { original, processed, event, changed: true, mode };
}

function claimArchiveDestination(
  requestedDestination: string,
  content: string,
  mode: number,
): { path: string; status: ArchiveRunnerEventStatus } {
  const stagedPath = join(
    dirname(requestedDestination),
    `.event-archive-stage-${process.pid}-${randomUUID()}.tmp`,
  );
  try {
    writeFileSync(stagedPath, content, { encoding: "utf8", flag: "wx", mode });

    const requested = tryArchiveDestination(requestedDestination, stagedPath, content);
    if (requested) return requested;

    const parsed = parse(requestedDestination);
    const digest = createHash("sha256").update(content).digest("hex");
    const collisionDestination = join(
      parsed.dir,
      collisionArchiveFilename(parsed.base, digest),
    );
    const collision = tryArchiveDestination(collisionDestination, stagedPath, content);
    if (collision) {
      return {
        path: collision.path,
        status: collision.status === "already-archived" ? collision.status : "collision-archived",
      };
    }

    for (;;) {
      const unique = join(
        parsed.dir,
        collisionArchiveFilename(parsed.base, digest, randomUUID()),
      );
      const result = tryArchiveDestination(unique, stagedPath, content);
      if (result) return { path: result.path, status: "collision-archived" };
    }
  } finally {
    try {
      unlinkSync(stagedPath);
    } catch {
      // The staged file was never created or cleanup is best effort. A claimed
      // archive destination is already a complete hard link to these bytes.
    }
  }
}

function tryArchiveDestination(
  destination: string,
  stagedPath: string,
  content: string,
): { path: string; status: "archived" | "already-archived" } | undefined {
  try {
    linkSync(stagedPath, destination);
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
    if (!isRegularFile(destination)) {
      throw new Error(`Archive destination is not a direct regular file: ${destination}`);
    }
    if (readFileSync(destination, "utf8") !== content) return undefined;
    return { path: destination, status: "already-archived" };
  }
  return { path: destination, status: "archived" };
}

function unlinkArchivedSource(sourcePath: string, expectedContent: string): void {
  if (!isRegularFile(sourcePath)) {
    throw new Error(`Archived event source is not a direct regular file: ${sourcePath}`);
  }
  if (readFileSync(sourcePath, "utf8") !== expectedContent) {
    throw new Error(`Archived event source changed before unlink: ${sourcePath}`);
  }
  // Keep the already-claimed processed archive if unlink fails. A retry can
  // recognize the duplicate source+archive pair and finish the unlink safely.
  unlinkSync(sourcePath);
}

function claimArchiveReceipt(
  archiveDir: string,
  role: RunnerEventArchiveReceipt["role"],
  sourceFilename: string,
  runId: string,
  destinationFilename: string,
  acceptedTrigger: RunnerEventAcceptedTrigger,
  content: string,
): void {
  const archivedContentSha256 = createHash("sha256").update(content).digest("hex");
  const receiptPath = archiveReceiptPath(
    archiveDir,
    sourceFilename,
    runId,
    acceptedTrigger.occurrenceToken,
    acceptedTrigger.rawContentSha256,
  );
  if (isRegularFile(receiptPath)) {
    const existing = readArchiveReceiptProof(archiveDir, receiptPath);
    if (
      existing.receipt.role !== role
      || existing.receipt.destinationFilename !== destinationFilename
      || existing.receipt.acceptedRecordSha256 !== acceptedTrigger.normalizedRecordSha256
      || existing.receipt.archivedContentSha256 !== archivedContentSha256
    ) {
      throw new Error(`Archive receipt conflicts with claimed event: ${receiptPath}`);
    }
    return;
  }

  const occurrence = archiveReceiptPathsForIdentity(archiveDir, sourceFilename, runId)
    .map((path) => readArchiveReceipt(archiveDir, path).occurrence)
    .reduce((maximum, value) => Math.max(maximum, value), 0) + 1;
  const receipt: RunnerEventArchiveReceipt = {
    version: 2,
    role,
    occurrence,
    sourceFilename,
    runId,
    destinationFilename,
    occurrenceToken: acceptedTrigger.occurrenceToken,
    acceptedContentSha256: acceptedTrigger.rawContentSha256,
    acceptedRecordSha256: acceptedTrigger.normalizedRecordSha256,
    archivedContentSha256,
  };
  const receiptContent = `${JSON.stringify(receipt)}\n`;
  const stagedPath = join(
    archiveDir,
    `.event-receipt-stage-${process.pid}-${randomUUID()}.tmp`,
  );
  try {
    writeFileSync(stagedPath, receiptContent, { encoding: "utf8", flag: "wx", mode: 0o600 });
    try {
      linkSync(stagedPath, receiptPath);
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      if (!isRegularFile(receiptPath)) {
        throw new Error(`Archive receipt is not a direct regular file: ${receiptPath}`);
      }
      if (readFileSync(receiptPath, "utf8") !== receiptContent) {
        throw new Error(`Archive receipt conflicts with claimed event: ${receiptPath}`);
      }
    }
  } finally {
    try {
      unlinkSync(stagedPath);
    } catch {
      // The staged file was never created or cleanup is best effort. The receipt
      // path, when present, is already an immutable hard link to complete bytes.
    }
  }
}

function proveAlreadyArchived(
  root: string,
  sourcePath: string,
  input: ConsumeRunnerEventsInput,
  allAgentIds: string[],
): ArchiveRunnerEventResult {
  const configuredArchiveDir = join(root, "archive");
  if (!existsSync(configuredArchiveDir)) {
    throw new Error(`Triggered event file not found and no archive receipt exists: ${sourcePath}`);
  }
  const archiveDir = requireArchiveDir(root);
  const sourceFilename = basename(sourcePath);
  const receiptPath = archiveReceiptPath(
    archiveDir,
    sourceFilename,
    input.runId,
    input.acceptedTrigger.occurrenceToken,
    input.acceptedTrigger.rawContentSha256,
  );
  if (!isRegularFile(receiptPath)) {
    throw new Error(`Triggered event file not found and no archive receipt exists: ${sourcePath}`);
  }
  const proof = readArchiveReceiptProof(archiveDir, receiptPath);
  if (
    proof.receipt.role !== "trigger"
    || proof.receipt.occurrenceToken !== input.acceptedTrigger.occurrenceToken
    || proof.receipt.acceptedContentSha256 !== input.acceptedTrigger.rawContentSha256
    || proof.receipt.acceptedRecordSha256 !== input.acceptedTrigger.normalizedRecordSha256
    || !explicitTriggerMatches(proof.event, input, allAgentIds)
  ) {
    throw new Error(`Archive receipts do not prove the requested trigger identity: ${sourcePath}`);
  }
  return {
    filename: sourceFilename,
    path: sourcePath,
    destination: proof.destination,
    status: "already-archived",
    event: { ...proof.event, path: proof.destination },
  };
}

function readArchiveReceiptProof(
  archiveDir: string,
  receiptPath: string,
): RunnerEventArchiveProof {
  const receipt = readArchiveReceipt(archiveDir, receiptPath);
  const destination = join(archiveDir, receipt.destinationFilename);
  if (!isRegularFile(destination)) {
    throw new Error(`Archive receipt destination is missing: ${destination}`);
  }
  const content = readFileSync(destination, "utf8");
  const contentSha256 = createHash("sha256").update(content).digest("hex");
  if (contentSha256 !== receipt.archivedContentSha256) {
    throw new Error(`Archive receipt content hash does not match destination: ${destination}`);
  }
  const event = strictEventAtPath(destination, content);
  if (!event.processed) {
    throw new Error(`Archived proof is not processed: ${destination}`);
  }
  if (event.runId !== receipt.runId) {
    throw new Error(`Archived proof run id does not match receipt: ${destination}`);
  }
  return { receipt, destination, content, event };
}

function readArchiveReceipt(
  archiveDir: string,
  receiptPath: string,
): RunnerEventArchiveReceipt {
  if (!isRegularFile(receiptPath)) {
    throw new Error(`Archive receipt is not a direct regular file: ${receiptPath}`);
  }
  const receipt = parseArchiveReceipt(receiptPath, readFileSync(receiptPath, "utf8"));
  if (receiptPath !== archiveReceiptPath(
    archiveDir,
    receipt.sourceFilename,
    receipt.runId,
    receipt.occurrenceToken,
    receipt.acceptedContentSha256,
  )) {
    throw new Error(`Archive receipt filename does not match its identity: ${receiptPath}`);
  }
  return receipt;
}

function archiveReceiptIdentityDigest(sourceFilename: string, runId: string): string {
  return createHash("sha256")
    .update(sourceFilename)
    .update("\0")
    .update(runId)
    .digest("hex");
}

function archiveReceiptPath(
  archiveDir: string,
  sourceFilename: string,
  runId: string,
  occurrenceToken: string,
  acceptedContentSha256: string,
): string {
  const identityDigest = archiveReceiptIdentityDigest(sourceFilename, runId);
  return join(
    archiveDir,
    `.event-receipt-${identityDigest}-${occurrenceToken}-${acceptedContentSha256}.json`,
  );
}

function archiveReceiptPathsForIdentity(
  archiveDir: string,
  sourceFilename: string,
  runId: string,
): string[] {
  const prefix = `.event-receipt-${archiveReceiptIdentityDigest(sourceFilename, runId)}-`;
  return readdirSync(archiveDir, { withFileTypes: true })
    .filter((entry) => entry.name.startsWith(prefix) && ARCHIVE_RECEIPT_NAME.test(entry.name))
    .map((entry) => {
      const path = join(archiveDir, entry.name);
      if (!entry.isFile()) {
        throw new Error(`Archive receipt is not a direct regular file: ${path}`);
      }
      return path;
    })
    .sort(compareFileNames);
}

function parseArchiveReceipt(path: string, content: string): RunnerEventArchiveReceipt {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new Error(`Archive receipt is not valid JSON: ${path}`);
  }
  const keys = typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.keys(value)
    : [];
  if (
    typeof value !== "object"
    || value === null
    || Array.isArray(value)
    || keys.length !== ARCHIVE_RECEIPT_KEYS.length
    || ARCHIVE_RECEIPT_KEYS.some((key) => !keys.includes(key))
    || (value as Partial<RunnerEventArchiveReceipt>).version !== 2
    || (
      (value as Partial<RunnerEventArchiveReceipt>).role !== "trigger"
      && (value as Partial<RunnerEventArchiveReceipt>).role !== "owned-sibling"
    )
    || !Number.isSafeInteger((value as Partial<RunnerEventArchiveReceipt>).occurrence)
    || typeof (value as Partial<RunnerEventArchiveReceipt>).sourceFilename !== "string"
    || typeof (value as Partial<RunnerEventArchiveReceipt>).runId !== "string"
    || typeof (value as Partial<RunnerEventArchiveReceipt>).destinationFilename !== "string"
    || typeof (value as Partial<RunnerEventArchiveReceipt>).occurrenceToken !== "string"
    || typeof (value as Partial<RunnerEventArchiveReceipt>).acceptedContentSha256 !== "string"
    || typeof (value as Partial<RunnerEventArchiveReceipt>).acceptedRecordSha256 !== "string"
    || typeof (value as Partial<RunnerEventArchiveReceipt>).archivedContentSha256 !== "string"
  ) {
    throw new Error(`Archive receipt has an invalid shape: ${path}`);
  }
  const receipt = value as RunnerEventArchiveReceipt;
  if (
    !isDirectEventFilename(receipt.sourceFilename)
    || receipt.occurrence < 1
    || !receipt.runId.trim()
    || !isDirectEventFilename(receipt.destinationFilename)
    || !/^[a-f0-9]{64}$/.test(receipt.occurrenceToken)
    || !/^[a-f0-9]{64}$/.test(receipt.acceptedContentSha256)
    || !/^[a-f0-9]{64}$/.test(receipt.acceptedRecordSha256)
    || !/^[a-f0-9]{64}$/.test(receipt.archivedContentSha256)
  ) {
    throw new Error(`Archive receipt has invalid field values: ${path}`);
  }
  if (content !== `${JSON.stringify(receipt)}\n`) {
    throw new Error(`Archive receipt is not in canonical single-field form: ${path}`);
  }
  return receipt;
}

function collisionArchiveFilename(
  requestedFilename: string,
  contentDigest: string,
  uniqueSuffix?: string,
): string {
  const parsed = parse(requestedFilename);
  const suffix = uniqueSuffix ? `-${uniqueSuffix}` : "";
  const preferred = `${parsed.name}-collision-${contentDigest.slice(0, 16)}${suffix}${parsed.ext}`;
  if (Buffer.byteLength(preferred, "utf8") <= PORTABLE_NAME_MAX_BYTES) return preferred;
  return `event-collision-${contentDigest}${suffix}.event`;
}

function isDirectEventFilename(value: string): boolean {
  return Boolean(value)
    && basename(value) === value
    && value.endsWith(".event");
}

function strictEventAtPath(path: string, content: string): RunnerEventRecord {
  const raw = validateRawRunnerEvent(content);
  if (!raw.valid) {
    throw new Error(
      `Invalid runner event file ${path}: ${raw.issues.map((issue) => issue.code).join(", ")}`,
    );
  }
  return { ...parseRunnerEvent(content), path };
}

interface EventFileIdentity {
  dev: string;
  ino: string;
  size: string;
  mtimeNs: string;
  ctimeNs: string;
  birthtimeNs: string;
}

function eventFileIdentity(path: string): EventFileIdentity {
  const stat = lstatSync(path, { bigint: true });
  if (!stat.isFile()) {
    throw new Error(`Event file is not a direct regular file: ${path}`);
  }
  return {
    dev: stat.dev.toString(),
    ino: stat.ino.toString(),
    size: stat.size.toString(),
    mtimeNs: stat.mtimeNs.toString(),
    ctimeNs: stat.ctimeNs.toString(),
    birthtimeNs: stat.birthtimeNs.toString(),
  };
}

function acceptedTriggerForSnapshot(
  path: string,
  content: string,
  event: RunnerEventRecord,
  identity: EventFileIdentity,
): RunnerEventAcceptedTrigger {
  return {
    version: 1,
    sourceFilename: basename(path),
    occurrenceToken: createHash("sha256")
      .update(stableSerialize({ sourceFilename: basename(path), identity }))
      .digest("hex"),
    rawContentSha256: createHash("sha256").update(content).digest("hex"),
    normalizedRecordSha256: normalizedEventDigest(event),
  };
}

function normalizedEventDigest(event: RunnerEventRecord): string {
  return createHash("sha256").update(stableSerialize({
    event: event.event,
    source: event.source,
    runId: event.runId,
    timestamp: event.timestamp,
    processed: event.processed,
    data: event.data,
    fields: event.fields,
  })).digest("hex");
}

function assertAcceptedTriggerShape(
  value: RunnerEventAcceptedTrigger,
  expectedFilename: string,
): void {
  const keys = value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value).sort()
    : [];
  const expectedKeys = [
    "normalizedRecordSha256",
    "occurrenceToken",
    "rawContentSha256",
    "sourceFilename",
    "version",
  ];
  if (
    keys.length !== expectedKeys.length
    || keys.some((key, index) => key !== expectedKeys[index])
    || value.version !== 1
    || value.sourceFilename !== expectedFilename
    || !isDirectEventFilename(value.sourceFilename)
    || !/^[a-f0-9]{64}$/.test(value.occurrenceToken)
    || !/^[a-f0-9]{64}$/.test(value.rawContentSha256)
    || !/^[a-f0-9]{64}$/.test(value.normalizedRecordSha256)
  ) {
    throw new Error(`Accepted trigger fingerprint is invalid for ${expectedFilename}`);
  }
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => (
      `${JSON.stringify(key)}:${stableSerialize(record[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function requireConfiguredEventsDir(eventsDir: string): string {
  requireNonEmpty("eventsDir", eventsDir);
  if (!isAbsolute(eventsDir)) {
    throw new Error(`eventsDir must be an absolute configured path: ${eventsDir}`);
  }
  const root = resolve(eventsDir);
  if (!isRegularDirectory(root)) {
    throw new Error(`Configured eventsDir is not a directory: ${root}`);
  }
  return root;
}

function ensureArchiveDir(root: string): string {
  const archiveDir = join(root, "archive");
  if (existsSync(archiveDir)) {
    if (!isRegularDirectory(archiveDir)) {
      throw new Error(`Event archive is not a direct regular directory: ${archiveDir}`);
    }
    return archiveDir;
  }
  mkdirSync(archiveDir);
  return archiveDir;
}

function requireArchiveDir(root: string): string {
  const archiveDir = join(root, "archive");
  if (!isRegularDirectory(archiveDir)) {
    throw new Error(`Event archive is not a direct regular directory: ${archiveDir}`);
  }
  return archiveDir;
}

function resolveDirectEventPath(root: string, input: string, mustExist: boolean): string {
  requireNonEmpty("event file", input);
  const path = isAbsolute(input) ? resolve(input) : resolve(root, input);
  if (dirname(path) !== root || !basename(path).endsWith(".event")) {
    throw new Error(`Event file must be a direct *.event child of configured root: ${input}`);
  }
  if (mustExist && !isRegularFile(path)) {
    throw new Error(`Event file is not a direct regular file: ${path}`);
  }
  if (!mustExist && existsSync(path) && !isRegularFile(path)) {
    throw new Error(`Event file is not a direct regular file: ${path}`);
  }
  return path;
}

function completionEventMatches(
  event: RunnerEventRecord,
  input: FindRunnerEventInput,
  allAgentIds: string[],
): boolean {
  if (event.runId !== input.runId) return false;
  if (input.expectedEvent !== undefined && event.event !== input.expectedEvent) return false;
  if (DIAGNOSTIC_SOURCES.has(normalizeIdentity(event.source))) return false;
  return runnerEventIdentityMatches(event.source, input.agentId, input.sessionName, allAgentIds);
}

function explicitTriggerMatches(
  event: RunnerEventRecord,
  input: ConsumeRunnerEventsInput,
  allAgentIds: string[],
): boolean {
  return event.runId === input.runId
    && (input.expectedEvent === undefined || event.event === input.expectedEvent)
    && runnerEventIdentityMatches(event.source, input.source, input.sessionName, allAgentIds);
}

function assertExplicitTriggerMatches(
  event: RunnerEventRecord,
  input: ConsumeRunnerEventsInput,
  allAgentIds: string[],
  path: string,
): void {
  if (event.runId !== input.runId) {
    throw new Error(`Explicit trigger run id does not match requested run: ${path}`);
  }
  if (input.expectedEvent !== undefined && event.event !== input.expectedEvent) {
    throw new Error(`Explicit trigger event does not match expected event: ${path}`);
  }
  if (!runnerEventIdentityMatches(event.source, input.source, input.sessionName, allAgentIds)) {
    throw new Error(`Explicit trigger owner does not match requested source: ${path}`);
  }
}

function normalizeAgentIds(values: string[] | undefined): string[] {
  return Array.from(new Set((values || []).map(normalizeIdentity).filter(Boolean)));
}

function normalizeIdentity(value: string | undefined): string {
  return value?.trim().toLowerCase() || "";
}

function requireNonEmpty(label: string, value: string): void {
  if (!value || !value.trim()) throw new Error(`${label} must not be empty.`);
}

function compareFileNames(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function isRegularDirectory(path: string): boolean {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isRegularFile(path: string): boolean {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === "EEXIST";
}

function isMissingPath(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === "ENOENT";
}
