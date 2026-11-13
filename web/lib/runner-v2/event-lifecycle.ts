import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, parse, resolve } from "node:path";
import { withExclusiveFileClaim } from "@/lib/runner-v2/file-claim";
import { withEventSourceClaim, type EventSourceClaimIdentity } from "@/lib/runner-v2/event-source-claim";
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
  version: 2 | 3;
  role: "trigger" | "owned-sibling";
  occurrence: number;
  sourceFilename: string;
  runId: string;
  destinationFilename: string;
  occurrenceToken: string;
  acceptedContentSha256: string;
  acceptedRecordSha256: string;
  archivedContentSha256: string;
  occurrenceId?: string;
}

type ArchiveTransactionState = "prepared" | "claimed" | "archived" | "receipted" | "complete" | "conflict";

interface ArchiveTransactionManifest {
  version: 1;
  state: ArchiveTransactionState;
  transactionId: string;
  role: RunnerEventArchiveReceipt["role"];
  sourceFilename: string;
  runId: string;
  sourceIdentity: EventSourceClaimIdentity;
  ownerSource: string;
  expectedEvent?: string;
  sessionName?: string;
  allAgentIds: string[];
  occurrenceId: string;
  acceptedTrigger: RunnerEventAcceptedTrigger;
  fileIdentity: EventFileIdentity;
  fileMode: number;
  processedContentSha256: string;
  destinationFilename?: string;
  archivedContentSha256?: string;
  archiveStatus?: ArchiveRunnerEventStatus;
  conflictReason?: string;
}

export type ArchiveTransactionStage =
  | "prepared"
  | "renamed"
  | "claimed"
  | "processed"
  | "archived"
  | "receipted"
  | "complete";

export interface ArchiveTransactionHooks {
  /** Deterministic interruption hook used by the lifecycle recovery matrix. */
  afterStage?: (stage: ArchiveTransactionStage, transactionDir: string) => void;
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

interface ArchiveTransactionOwner {
  runId: string;
  source: string;
  expectedEvent?: string;
  sessionName?: string;
  allAgentIds: string[];
}

// The retired source label remains read-only compatibility for pre-cutover diagnostics.
const DIAGNOSTIC_SOURCES = new Set(["monitor", "watchdog", "chain-runner-complete"]);
const CLAIM_NAME = ".event-lifecycle.claim";
const CLAIM_WAIT_TIMEOUT_MS = 5_000;
const PORTABLE_NAME_MAX_BYTES = 255;
const TRANSACTION_ROOT_NAME = ".event-transactions";
const TRANSACTION_MANIFEST_NAME = "manifest.json";
const TRANSACTION_CLAIMED_NAME = "claimed.event";
const ARCHIVE_RECEIPT_V2_KEYS = [
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
const ARCHIVE_RECEIPT_V3_KEYS = [...ARCHIVE_RECEIPT_V2_KEYS, "occurrenceId"] as const;
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
  return {
    match: match || readPendingRunnerEventTransactions(input.eventsDir, input.runId)
      .find(({ event }) => completionEventMatches(event, input, allAgentIds)),
    invalid: scan.invalid,
  };
}

/**
 * Return exact trigger occurrences held by incomplete archive transactions.
 * They remain eligible for completion replay only while their original active
 * pathname is vacant; a later active occurrence always takes precedence.
 */
export function readPendingRunnerEventTransactions(eventsDir: string, runId: string): RunnerEventFile[] {
  const root = requireConfiguredEventsDir(eventsDir);
  requireNonEmpty("runId", runId);
  const transactionRoot = join(root, TRANSACTION_ROOT_NAME);
  if (!existsSync(transactionRoot)) return [];
  if (!isRegularDirectory(transactionRoot)) {
    throw new Error(`Event transaction root is not a direct regular directory: ${transactionRoot}`);
  }
  const pending: RunnerEventFile[] = [];
  const entries = readdirSync(transactionRoot, { withFileTypes: true })
    .sort((left, right) => compareFileNames(left.name, right.name));
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name)) {
      throw new Error(`Event transaction entry has an invalid name or type: ${join(transactionRoot, entry.name)}`);
    }
    const transactionDir = join(transactionRoot, entry.name);
    const manifestPath = join(transactionDir, TRANSACTION_MANIFEST_NAME);
    if (!existsSync(manifestPath)) continue;
    const manifest = readArchiveTransactionManifest(transactionDir);
    if (manifest.role !== "trigger" || manifest.runId !== runId || manifest.state === "conflict") continue;
    const sourcePath = join(root, manifest.sourceFilename);
    if (pathEntryExists(sourcePath)) continue;
    const replay = pendingArchiveTrigger(root, transactionDir, manifest);
    if (replay) pending.push(replay);
  }
  return pending.sort((left, right) => (
    compareFileNames(left.filename, right.filename)
    || compareFileNames(left.event.fields.occurrence_id || "", right.event.fields.occurrence_id || "")
  ));
}

function findPendingArchiveTrigger(
  root: string,
  sourceFilename: string,
  expected?: RunnerEventRecord,
): { acceptedTrigger: RunnerEventAcceptedTrigger } | undefined {
  const transactionRoot = join(root, TRANSACTION_ROOT_NAME);
  if (!existsSync(transactionRoot)) return undefined;
  if (!isRegularDirectory(transactionRoot)) {
    throw new Error(`Event transaction root is not a direct regular directory: ${transactionRoot}`);
  }
  const matches: ArchiveTransactionManifest[] = [];
  for (const entry of readdirSync(transactionRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name)) continue;
    const transactionDir = join(transactionRoot, entry.name);
    if (!pathEntryExists(join(transactionDir, TRANSACTION_MANIFEST_NAME))) continue;
    const manifest = readArchiveTransactionManifest(transactionDir);
    if (manifest.role !== "trigger"
      || manifest.sourceFilename !== sourceFilename
      || manifest.state === "conflict"
      || (expected?.runId && manifest.runId !== expected.runId)
      || pathEntryExists(join(root, sourceFilename))) continue;
    const pending = pendingArchiveTrigger(root, transactionDir, manifest);
    if (!pending) continue;
    if (expected && normalizedEventDigest(expected) !== normalizedEventDigest(pending.event)) continue;
    matches.push(manifest);
  }
  if (matches.length > 1) {
    throw new Error(`More than one pending event occurrence matches the accepted trigger: ${sourceFilename}`);
  }
  return matches[0] ? { acceptedTrigger: matches[0].acceptedTrigger } : undefined;
}

function pendingArchiveTrigger(
  root: string,
  transactionDir: string,
  manifest: ArchiveTransactionManifest,
): RunnerEventFile | undefined {
  if (manifest.role !== "trigger" || manifest.state === "conflict") return undefined;
  const sourcePath = join(root, manifest.sourceFilename);
  if (pathEntryExists(sourcePath)) return undefined;

  const claimedPath = join(transactionDir, TRANSACTION_CLAIMED_NAME);
  let acceptedContent: string;
  if (pathEntryExists(claimedPath)) {
    const claimed = snapshotEventFile(claimedPath);
    const claimedState = verifyClaimedTransactionSnapshot(claimed, manifest);
    if (!claimedState) return undefined;
    acceptedContent = claimedState === "raw"
      ? claimed.content
      : claimed.content.replace(/^(processed:[\t ]*)true([\t ]*)$/m, "$1false$2");
  } else if (manifest.state === "complete" && manifest.destinationFilename) {
    verifyTransactionReceipt(root, manifest);
    const archivePath = join(requireArchiveDir(root), manifest.destinationFilename);
    if (!isRegularFile(archivePath)) return undefined;
    const archivedContent = readFileSync(archivePath, "utf8");
    if (sha256(archivedContent) !== manifest.archivedContentSha256) return undefined;
    acceptedContent = archivedContent.replace(/^(processed:[\t ]*)true([\t ]*)$/m, "$1false$2");
  } else {
    return undefined;
  }

  if (sha256(acceptedContent) !== manifest.acceptedTrigger.rawContentSha256) return undefined;
  const event = strictEventAtPath(sourcePath, acceptedContent);
  if (event.processed
    || normalizedEventDigest(event) !== manifest.acceptedTrigger.normalizedRecordSha256
    || archiveOccurrenceId(event, manifest.acceptedTrigger) !== manifest.occurrenceId
    || stableSerialize(eventSourceClaimIdentity(event)) !== stableSerialize(manifest.sourceIdentity)
    || !archiveTransactionEventMatches(event, "trigger", manifestOwner(manifest))) return undefined;
  return { filename: manifest.sourceFilename, path: sourcePath, content: acceptedContent, event };
}

/** Strict, idempotent processed mutation using a same-directory temp+rename. */
export function markRunnerEventProcessed(input: {
  eventsDir: string;
  file: string;
}): MarkRunnerEventResult {
  const root = requireConfiguredEventsDir(input.eventsDir);
  return withExclusiveFileClaim(join(root, CLAIM_NAME), () => {
    const path = resolveDirectEventPath(root, input.file, true);
    const accepted = snapshotEventFile(path);
    return withEventSourceClaim(root, eventSourceClaimIdentity(accepted.event), () => {
      const current = snapshotEventFile(path);
      const acceptedTrigger = acceptedTriggerForSnapshot(path, accepted.content, accepted.event, accepted.identity);
      const currentTrigger = acceptedTriggerForSnapshot(path, current.content, current.event, current.identity);
      if (stableSerialize(acceptedTrigger) !== stableSerialize(currentTrigger)) {
        throw new Error(`Active event changed before processed marking: ${path}`);
      }
      return markRunnerEventProcessedUnlocked(path);
    });
  }, { waitTimeoutMs: CLAIM_WAIT_TIMEOUT_MS });
}

/** Capture one exact active trigger before downstream launches or effects. */
export function captureRunnerEventAcceptedTrigger(input: {
  eventsDir: string;
  file: string;
  expected?: RunnerEventRecord;
}): RunnerEventAcceptedTrigger {
  const root = requireConfiguredEventsDir(input.eventsDir);
  const requestedPath = resolveDirectEventPath(root, input.file, false);
  if (!pathEntryExists(requestedPath)) {
    const accepted = findPendingArchiveTrigger(root, basename(requestedPath), input.expected);
    if (!accepted) throw new Error(`Event file is not a direct regular file: ${requestedPath}`);
    return accepted.acceptedTrigger;
  }
  const path = resolveDirectEventPath(root, requestedPath, true);
  const snapshot = snapshotEventFile(path);
  const { content, event, identity } = snapshot;
  if (input.expected && normalizedEventDigest(input.expected) !== normalizedEventDigest(event)) {
    throw new Error(`Event file no longer matches the accepted normalized trigger: ${path}`);
  }
  if (event.processed) {
    throw new Error(`Accepted trigger must still be active and unprocessed: ${path}`);
  }
  return acceptedTriggerForSnapshot(path, content, event, identity);
}

/**
 * Validate the explicit trigger first, archive same-run owned siblings, and
 * consume the accepted trigger last. The active trigger remains the durable
 * retry token if any earlier cleanup fails. Every moved file is strict,
 * claimed in the archive with its processed bytes before the active source is
 * removed, and never overwrites an existing basename.
 */
export function consumeRunnerEvents(
  input: ConsumeRunnerEventsInput,
  hooks: ArchiveTransactionHooks = {},
): ConsumeRunnerEventsResult {
  requireNonEmpty("runId", input.runId);
  requireNonEmpty("source", input.source);
  requireNonEmpty("triggered", input.triggered);
  if (input.expectedEvent !== undefined) requireNonEmpty("expectedEvent", input.expectedEvent);
  const root = requireConfiguredEventsDir(input.eventsDir);
  const allAgentIds = normalizeAgentIds(input.allAgentIds);

  return withExclusiveFileClaim(join(root, CLAIM_NAME), () => {
    recoverArchiveTransactions(root, hooks);
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
        {
          runId: input.runId,
          source: input.source,
          expectedEvent: input.expectedEvent,
          sessionName: input.sessionName,
          allAgentIds,
        },
        acceptedSibling,
        hooks,
      ));
    }

    const triggered = processAndArchiveUnlocked(root, triggeredPath, "trigger", {
      runId: input.runId,
      source: input.source,
      expectedEvent: input.expectedEvent,
      sessionName: input.sessionName,
      allAgentIds,
    }, input.acceptedTrigger, hooks);

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
  owner: ArchiveTransactionOwner,
  acceptedTrigger: RunnerEventAcceptedTrigger,
  hooks: ArchiveTransactionHooks,
): ArchiveRunnerEventResult {
  const snapshot = snapshotEventFile(path);
  const observedTrigger = acceptedTriggerForSnapshot(path, snapshot.content, snapshot.event, snapshot.identity);
  if (stableSerialize(observedTrigger) !== stableSerialize(acceptedTrigger)) {
    throw new Error(`Active event no longer matches the accepted trigger occurrence: ${path}`);
  }
  assertArchiveTransactionEvent(snapshot.event, receiptRole, owner, path);

  return withEventSourceClaim(root, eventSourceClaimIdentity(snapshot.event), () => {
    const lockedSnapshot = snapshotEventFile(path);
    const lockedTrigger = acceptedTriggerForSnapshot(
      path,
      lockedSnapshot.content,
      lockedSnapshot.event,
      lockedSnapshot.identity,
    );
    if (stableSerialize(lockedTrigger) !== stableSerialize(acceptedTrigger)) {
      throw new Error(`Active event changed before archive claim: ${path}`);
    }
    assertArchiveTransactionEvent(lockedSnapshot.event, receiptRole, owner, path);

    const transactionRoot = ensureTransactionRoot(root);
    const transactionDir = join(transactionRoot, acceptedTrigger.occurrenceToken);
    if (existsSync(transactionDir)) {
      throw new Error(`Archive transaction already exists for active occurrence: ${transactionDir}`);
    }
    mkdirSync(transactionDir, { mode: 0o700 });
    syncDirectory(transactionRoot);

    const prepared = prepareRunnerEventContent(path, lockedSnapshot.content, lockedSnapshot.mode);
    const manifest: ArchiveTransactionManifest = {
      version: 1,
      state: "prepared",
      transactionId: acceptedTrigger.occurrenceToken,
      role: receiptRole,
      sourceFilename: basename(path),
      runId: lockedSnapshot.event.runId,
      sourceIdentity: eventSourceClaimIdentity(lockedSnapshot.event),
      ownerSource: owner.source,
      ...(owner.expectedEvent ? { expectedEvent: owner.expectedEvent } : {}),
      ...(owner.sessionName ? { sessionName: owner.sessionName } : {}),
      allAgentIds: owner.allAgentIds,
      occurrenceId: lockedSnapshot.event.fields.occurrence_id || acceptedTrigger.occurrenceToken,
      acceptedTrigger,
      fileIdentity: lockedSnapshot.identity,
      fileMode: lockedSnapshot.mode,
      processedContentSha256: sha256(prepared.processed),
    };
    writeArchiveTransactionManifest(transactionDir, manifest);
    hooks.afterStage?.("prepared", transactionDir);
    const result = resumeArchiveTransaction(root, transactionDir, manifest, hooks, true);
    if (!result) throw new Error(`Archive transaction was preserved without completion: ${transactionDir}`);
    return result;
  });
}

function prepareRunnerEventForProcessing(path: string): PreparedRunnerEvent {
  const original = readFileSync(path, "utf8");
  const mode = statSync(path).mode & 0o777;
  return prepareRunnerEventContent(path, original, mode);
}

function prepareRunnerEventContent(path: string, original: string, mode: number): PreparedRunnerEvent {
  const parsed = strictEventAtPath(path, original);
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

function resumeArchiveTransaction(
  root: string,
  transactionDir: string,
  initialManifest: ArchiveTransactionManifest,
  hooks: ArchiveTransactionHooks,
  returnResult: boolean,
): ArchiveRunnerEventResult | undefined {
  let manifest = initialManifest;
  if (manifest.state === "conflict") return undefined;
  const sourcePath = join(root, manifest.sourceFilename);
  const claimedPath = join(transactionDir, TRANSACTION_CLAIMED_NAME);

  if (manifest.state === "prepared") {
    if (!existsSync(claimedPath)) {
      if (!existsSync(sourcePath)) {
        return markArchiveTransactionConflict(
          root,
          transactionDir,
          manifest,
          `accepted source and private claim are both missing: ${sourcePath}`,
        );
      }
      const source = snapshotEventFile(sourcePath);
      if (!matchesAcceptedSourceSnapshot(sourcePath, source, manifest)) {
        writeArchiveTransactionManifest(transactionDir, {
          ...manifest,
          state: "conflict",
          conflictReason: `active source no longer matches accepted occurrence: ${sourcePath}`,
        });
        return undefined;
      }
      if (existsSync(claimedPath)) {
        return markArchiveTransactionConflict(root, transactionDir, manifest, "private claim path was occupied");
      }
      renameSync(sourcePath, claimedPath);
      syncDirectory(root);
      syncDirectory(transactionDir);
      hooks.afterStage?.("renamed", transactionDir);
    }

    const moved = snapshotEventFile(claimedPath);
    if (!matchesRenamedSourceSnapshot(moved, manifest)) {
      return markArchiveTransactionConflict(
        root,
        transactionDir,
        manifest,
        "renamed private file did not match the accepted occurrence",
        claimedPath,
      );
    }
    manifest = { ...manifest, state: "claimed" };
    writeArchiveTransactionManifest(transactionDir, manifest);
    hooks.afterStage?.("claimed", transactionDir);
  }

  if (manifest.state === "claimed" || manifest.state === "archived") {
    if (!existsSync(claimedPath)) {
      return markArchiveTransactionConflict(root, transactionDir, manifest, "private claimed file is missing");
    }
    let claimed = snapshotEventFile(claimedPath);
    const claimedState = verifyClaimedTransactionSnapshot(claimed, manifest);
    if (!claimedState) {
      return markArchiveTransactionConflict(
        root,
        transactionDir,
        manifest,
        "private claimed file failed occurrence, content, or owner verification",
        claimedPath,
      );
    }
    assertArchiveTransactionEvent(claimed.event, manifest.role, manifestOwner(manifest), claimedPath);

    if (claimedState === "raw") {
      const prepared = prepareRunnerEventContent(claimedPath, claimed.content, manifest.fileMode);
      if (sha256(prepared.processed) !== manifest.processedContentSha256) {
        return markArchiveTransactionConflict(root, transactionDir, manifest, "processed event digest changed");
      }
      const temporaryPath = join(transactionDir, `.processed-${process.pid}-${randomUUID()}.tmp`);
      writeDurableFile(temporaryPath, prepared.processed, manifest.fileMode);
      renameSync(temporaryPath, claimedPath);
      syncDirectory(transactionDir);
      hooks.afterStage?.("processed", transactionDir);
      claimed = snapshotEventFile(claimedPath);
      if (verifyClaimedTransactionSnapshot(claimed, manifest) !== "processed") {
        return markArchiveTransactionConflict(root, transactionDir, manifest, "processed private file failed verification");
      }
    }

    if (manifest.state === "claimed") {
      const archive = ensureArchiveTransactionCopy(root, transactionDir, claimed.content, manifest);
      manifest = {
        ...manifest,
        state: "archived",
        destinationFilename: archive.filename,
        archivedContentSha256: sha256(claimed.content),
        archiveStatus: archive.status,
      };
      writeArchiveTransactionManifest(transactionDir, manifest);
      hooks.afterStage?.("archived", transactionDir);
    } else {
      if (!manifest.destinationFilename || !manifest.archivedContentSha256
        || manifest.archivedContentSha256 !== sha256(claimed.content)) {
        return markArchiveTransactionConflict(root, transactionDir, manifest, "archived manifest digest is inconsistent");
      }
      const archivedPath = join(requireArchiveDir(root), manifest.destinationFilename);
      if (!isRegularFile(archivedPath) || sha256(readFileSync(archivedPath, "utf8")) !== manifest.archivedContentSha256) {
        return markArchiveTransactionConflict(root, transactionDir, manifest, "archived destination failed verification");
      }
    }
  }

  if (manifest.state === "archived") {
    if (!manifest.destinationFilename || !manifest.archivedContentSha256) {
      return markArchiveTransactionConflict(root, transactionDir, manifest, "archived manifest is incomplete");
    }
    const archiveDir = requireArchiveDir(root);
    const archivedPath = join(archiveDir, manifest.destinationFilename);
    if (!isRegularFile(archivedPath)) {
      return markArchiveTransactionConflict(root, transactionDir, manifest, "archived destination disappeared");
    }
    const archivedContent = readFileSync(archivedPath, "utf8");
    if (sha256(archivedContent) !== manifest.archivedContentSha256) {
      return markArchiveTransactionConflict(root, transactionDir, manifest, "archived destination digest changed");
    }
    claimArchiveReceipt(
      archiveDir,
      manifest.role,
      manifest.sourceFilename,
      manifest.runId,
      manifest.destinationFilename,
      manifest.acceptedTrigger,
      archivedContent,
      manifest.occurrenceId,
    );
    syncDirectory(archiveDir);
    verifyTransactionReceipt(root, manifest);
    manifest = { ...manifest, state: "receipted" };
    writeArchiveTransactionManifest(transactionDir, manifest);
    hooks.afterStage?.("receipted", transactionDir);
  }

  if (manifest.state === "receipted" || manifest.state === "complete") {
    verifyTransactionReceipt(root, manifest);
    if (manifest.state === "receipted") {
      manifest = { ...manifest, state: "complete" };
      writeArchiveTransactionManifest(transactionDir, manifest);
      hooks.afterStage?.("complete", transactionDir);
    }
    cleanupArchiveTransaction(root, transactionDir, manifest);
    if (!returnResult || !manifest.destinationFilename || !manifest.archiveStatus) return undefined;
    const proof = readArchiveReceiptProof(requireArchiveDir(root), archiveReceiptPath(
      requireArchiveDir(root),
      manifest.sourceFilename,
      manifest.runId,
      manifest.acceptedTrigger.occurrenceToken,
      manifest.acceptedTrigger.rawContentSha256,
    ));
    return {
      filename: manifest.sourceFilename,
      path: sourcePath,
      destination: proof.destination,
      status: manifest.archiveStatus,
      event: { ...proof.event, path: proof.destination },
    };
  }

  return undefined;
}

function recoverArchiveTransactions(root: string, hooks: ArchiveTransactionHooks): void {
  const transactionRoot = join(root, TRANSACTION_ROOT_NAME);
  if (!existsSync(transactionRoot)) return;
  if (!isRegularDirectory(transactionRoot)) {
    throw new Error(`Event transaction root is not a direct regular directory: ${transactionRoot}`);
  }
  const entries = readdirSync(transactionRoot, { withFileTypes: true })
    .sort((left, right) => compareFileNames(left.name, right.name));
  for (const entry of entries) {
    const transactionDir = join(transactionRoot, entry.name);
    if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name)) {
      throw new Error(`Event transaction entry has an invalid name or type: ${transactionDir}`);
    }
    const manifestPath = join(transactionDir, TRANSACTION_MANIFEST_NAME);
    if (!existsSync(manifestPath)) {
      cleanupUnmanifestedTransaction(transactionRoot, transactionDir);
      continue;
    }
    const manifest = readArchiveTransactionManifest(transactionDir);
    if (manifest.state === "conflict") continue;
    withEventSourceClaim(root, manifest.sourceIdentity, () => {
      resumeArchiveTransaction(root, transactionDir, manifest, hooks, false);
    });
  }
  cleanupOrphanedArchiveStages(root);
}

function cleanupOrphanedArchiveStages(root: string): void {
  const archiveDir = join(root, "archive");
  if (!existsSync(archiveDir)) return;
  if (!isRegularDirectory(archiveDir)) throw new Error(`Event archive is not a direct regular directory: ${archiveDir}`);
  for (const entry of readdirSync(archiveDir, { withFileTypes: true })) {
    const match = /^\.event-(archive|receipt)-stage-([a-f0-9]{64})\.tmp$/.exec(entry.name);
    if (!match || !entry.isFile()) continue;
    const [, kind, token] = match;
    if (existsSync(join(root, TRANSACTION_ROOT_NAME, token))) continue;
    const receiptPath = readdirSync(archiveDir, { withFileTypes: true })
      .find((candidate) => candidate.isFile()
        && candidate.name.includes(`-${token}-`)
        && ARCHIVE_RECEIPT_NAME.test(candidate.name));
    if (!receiptPath) continue;
    const proof = readArchiveReceiptProof(archiveDir, join(archiveDir, receiptPath.name));
    const stagePath = join(archiveDir, entry.name);
    const stagedContent = readFileSync(stagePath, "utf8");
    if (kind === "archive" && stagedContent === proof.content) {
      unlinkSync(stagePath);
      syncDirectory(archiveDir);
    } else if (kind === "receipt" && stagedContent === readFileSync(join(archiveDir, receiptPath.name), "utf8")) {
      unlinkSync(stagePath);
      syncDirectory(archiveDir);
    }
  }
}

function matchesAcceptedSourceSnapshot(
  sourcePath: string,
  snapshot: EventFileSnapshot,
  manifest: ArchiveTransactionManifest,
): boolean {
  const accepted = acceptedTriggerForSnapshot(
    sourcePath,
    snapshot.content,
    snapshot.event,
    snapshot.identity,
  );
  return stableSerialize(accepted) === stableSerialize(manifest.acceptedTrigger)
    && identityMatches(snapshot.identity, manifest.fileIdentity)
    && archiveOccurrenceId(snapshot.event, manifest.acceptedTrigger) === manifest.occurrenceId
    && stableSerialize(eventSourceClaimIdentity(snapshot.event)) === stableSerialize(manifest.sourceIdentity)
    && archiveTransactionEventMatches(snapshot.event, manifest.role, manifestOwner(manifest))
    && Boolean(verifyClaimedTransactionSnapshot(snapshot, manifest, true));
}

function matchesRenamedSourceSnapshot(
  snapshot: EventFileSnapshot,
  manifest: ArchiveTransactionManifest,
): boolean {
  return identityMatchesAfterRename(snapshot.identity, manifest.fileIdentity)
    && sha256(snapshot.content) === manifest.acceptedTrigger.rawContentSha256
    && normalizedEventDigest(snapshot.event) === manifest.acceptedTrigger.normalizedRecordSha256
    && archiveOccurrenceId(snapshot.event, manifest.acceptedTrigger) === manifest.occurrenceId
    && stableSerialize(eventSourceClaimIdentity(snapshot.event)) === stableSerialize(manifest.sourceIdentity)
    && archiveTransactionEventMatches(snapshot.event, manifest.role, manifestOwner(manifest));
}

function verifyClaimedTransactionSnapshot(
  snapshot: EventFileSnapshot,
  manifest: ArchiveTransactionManifest,
  requireOriginalIdentity = false,
): "raw" | "processed" | undefined {
  const contentHash = sha256(snapshot.content);
  const occurrenceId = archiveOccurrenceId(snapshot.event, manifest.acceptedTrigger);
  if (occurrenceId !== manifest.occurrenceId
    || stableSerialize(eventSourceClaimIdentity(snapshot.event)) !== stableSerialize(manifest.sourceIdentity)) return undefined;
  if (contentHash === manifest.acceptedTrigger.rawContentSha256) {
    if (normalizedEventDigest(snapshot.event) !== manifest.acceptedTrigger.normalizedRecordSha256) return undefined;
    if (requireOriginalIdentity && !identityMatches(snapshot.identity, manifest.fileIdentity)) return undefined;
    if (!identityMatchesAfterRename(snapshot.identity, manifest.fileIdentity)) return undefined;
    return "raw";
  }
  if (contentHash !== manifest.processedContentSha256 || !snapshot.event.processed) return undefined;
  const acceptedRecord = normalizedEventDigest({
    ...snapshot.event,
    processed: false,
    fields: { ...snapshot.event.fields, processed: "false" },
  });
  if (acceptedRecord !== manifest.acceptedTrigger.normalizedRecordSha256) return undefined;
  return "processed";
}

function archiveOccurrenceId(event: RunnerEventRecord, accepted: RunnerEventAcceptedTrigger): string {
  return event.fields.occurrence_id || accepted.occurrenceToken;
}

function assertArchiveTransactionEvent(
  event: RunnerEventRecord,
  role: RunnerEventArchiveReceipt["role"],
  owner: ArchiveTransactionOwner,
  path: string,
): void {
  if (!archiveTransactionEventMatches(event, role, owner)) {
    throw new Error(`Archive transaction event no longer matches its accepted owner: ${path}`);
  }
}

function archiveTransactionEventMatches(
  event: RunnerEventRecord,
  role: RunnerEventArchiveReceipt["role"],
  owner: ArchiveTransactionOwner,
): boolean {
  if (event.runId !== owner.runId) return false;
  if (role === "trigger") {
    return (owner.expectedEvent === undefined || event.event === owner.expectedEvent)
      && runnerEventIdentityMatches(event.source, owner.source, owner.sessionName, owner.allAgentIds);
  }
  return eventIsStrictlyOwned(event, {
    runId: owner.runId,
    source: owner.source,
    sessionName: owner.sessionName,
    allAgentIds: owner.allAgentIds,
  });
}

function manifestOwner(manifest: ArchiveTransactionManifest): ArchiveTransactionOwner {
  return {
    runId: manifest.runId,
    source: manifest.ownerSource,
    expectedEvent: manifest.expectedEvent,
    sessionName: manifest.sessionName,
    allAgentIds: manifest.allAgentIds,
  };
}

function eventSourceClaimIdentity(event: RunnerEventRecord): EventSourceClaimIdentity {
  return {
    scope: "run",
    runId: event.runId,
    source: DIAGNOSTIC_SOURCES.has(normalizeIdentity(event.source)) && event.fields.agent
      ? event.fields.agent
      : event.source,
  };
}

function identityMatches(left: EventFileIdentity, right: EventFileIdentity): boolean {
  return stableSerialize(left) === stableSerialize(right);
}

function identityMatchesAfterRename(left: EventFileIdentity, right: EventFileIdentity): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.birthtimeNs === right.birthtimeNs;
}

function markArchiveTransactionConflict(
  root: string,
  transactionDir: string,
  manifest: ArchiveTransactionManifest,
  reason: string,
  claimedPath?: string,
): undefined {
  const sourcePath = join(root, manifest.sourceFilename);
  writeArchiveTransactionManifest(transactionDir, {
    ...manifest,
    state: "conflict",
    conflictReason: reason,
  });
  if (claimedPath && isRegularFile(claimedPath) && !existsSync(sourcePath)) {
    try {
      linkSync(claimedPath, sourcePath);
      unlinkSync(claimedPath);
      syncDirectory(root);
      syncDirectory(transactionDir);
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
    }
  }
  return undefined;
}

function ensureArchiveTransactionCopy(
  root: string,
  transactionDir: string,
  content: string,
  manifest: ArchiveTransactionManifest,
): { filename: string; status: "archived" | "collision-archived" } {
  const archiveDir = ensureArchiveDir(root);
  const requestedFilename = manifest.sourceFilename;
  const requestedPath = join(archiveDir, requestedFilename);
  if (existsSync(requestedPath) && !isRegularFile(requestedPath)) {
    throw new Error(`Archive destination is not a direct regular file: ${requestedPath}`);
  }
  const contentDigest = sha256(content);
  const stagePath = join(archiveDir, `.event-archive-stage-${manifest.transactionId}.tmp`);
  if (!existsSync(stagePath)) writeDurableFile(stagePath, content, manifest.fileMode);
  if (!isRegularFile(stagePath) || sha256(readFileSync(stagePath, "utf8")) !== contentDigest) {
    throw new Error(`Archive transaction staging file is invalid: ${stagePath}`);
  }

  let candidate = manifest.destinationFilename;
  let attempt = 0;
  while (true) {
    if (!candidate) {
      candidate = !existsSync(requestedPath)
        ? requestedFilename
        : collisionArchiveFilename(requestedFilename, contentDigest, `${manifest.transactionId.slice(0, 16)}${attempt ? `-${attempt}` : ""}`);
    }
    if (!isDirectEventFilename(candidate)) {
      throw new Error(`Archive transaction destination is not a direct event filename: ${candidate}`);
    }
    const destinationPath = join(archiveDir, candidate);
    if (existsSync(destinationPath)) {
      if (sameFileIdentity(destinationPath, stagePath)) {
        return {
          filename: candidate,
          status: candidate === requestedFilename ? "archived" : "collision-archived",
        };
      }
      candidate = undefined;
      attempt += 1;
      continue;
    }

    // Persist the candidate before linking it. The deterministic staging inode
    // lets recovery recognize a completed no-clobber link after a crash.
    const stagedManifest = { ...manifest, destinationFilename: candidate };
    writeArchiveTransactionManifest(transactionDir, stagedManifest);
    try {
      linkSync(stagePath, destinationPath);
      syncDirectory(archiveDir);
      return {
        filename: candidate,
        status: candidate === requestedFilename ? "archived" : "collision-archived",
      };
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      if (sameFileIdentity(destinationPath, stagePath)) {
        return {
          filename: candidate,
          status: candidate === requestedFilename ? "archived" : "collision-archived",
        };
      }
      candidate = undefined;
      attempt += 1;
    }
  }
}

function sameFileIdentity(leftPath: string, rightPath: string): boolean {
  try {
    const left = lstatSync(leftPath, { bigint: true });
    const right = lstatSync(rightPath, { bigint: true });
    return left.isFile() && right.isFile() && left.dev === right.dev && left.ino === right.ino;
  } catch {
    return false;
  }
}

function verifyTransactionReceipt(root: string, manifest: ArchiveTransactionManifest): void {
  if (!manifest.destinationFilename || !manifest.archivedContentSha256) {
    throw new Error(`Archive transaction is missing its archived identity: ${manifest.transactionId}`);
  }
  const archiveDir = requireArchiveDir(root);
  const receiptPath = archiveReceiptPath(
    archiveDir,
    manifest.sourceFilename,
    manifest.runId,
    manifest.acceptedTrigger.occurrenceToken,
    manifest.acceptedTrigger.rawContentSha256,
  );
  const proof = readArchiveReceiptProof(archiveDir, receiptPath);
  const claimedPath = join(transactionPath(root, manifest), TRANSACTION_CLAIMED_NAME);
  const claimedStillPresent = existsSync(claimedPath);
  if (
    proof.receipt.role !== manifest.role
    || proof.receipt.destinationFilename !== manifest.destinationFilename
    || proof.receipt.occurrenceToken !== manifest.acceptedTrigger.occurrenceToken
    || proof.receipt.acceptedContentSha256 !== manifest.acceptedTrigger.rawContentSha256
    || proof.receipt.acceptedRecordSha256 !== manifest.acceptedTrigger.normalizedRecordSha256
    || proof.receipt.archivedContentSha256 !== manifest.archivedContentSha256
    || (proof.receipt.version === 3 && proof.receipt.occurrenceId !== manifest.occurrenceId)
    || (claimedStillPresent && (!isRegularFile(claimedPath) || proof.content !== readFileSync(claimedPath, "utf8")))
    || (!claimedStillPresent && manifest.state !== "complete")
  ) {
    throw new Error(`Archive transaction receipt does not prove the claimed occurrence: ${receiptPath}`);
  }
}

function transactionPath(root: string, manifest: ArchiveTransactionManifest): string {
  return join(root, TRANSACTION_ROOT_NAME, manifest.transactionId);
}

function ensureTransactionRoot(root: string): string {
  const transactionRoot = join(root, TRANSACTION_ROOT_NAME);
  if (existsSync(transactionRoot)) {
    if (!isRegularDirectory(transactionRoot)) {
      throw new Error(`Event transaction root is not a direct regular directory: ${transactionRoot}`);
    }
    return transactionRoot;
  }
  mkdirSync(transactionRoot, { mode: 0o700 });
  syncDirectory(root);
  return transactionRoot;
}

function writeArchiveTransactionManifest(
  transactionDir: string,
  manifest: ArchiveTransactionManifest,
): void {
  const manifestPath = join(transactionDir, TRANSACTION_MANIFEST_NAME);
  const temporaryPath = join(transactionDir, `.manifest-${process.pid}-${randomUUID()}.tmp`);
  writeDurableFile(temporaryPath, `${JSON.stringify(manifest)}\n`, 0o600);
  renameSync(temporaryPath, manifestPath);
  syncDirectory(transactionDir);
}

function readArchiveTransactionManifest(transactionDir: string): ArchiveTransactionManifest {
  const manifestPath = join(transactionDir, TRANSACTION_MANIFEST_NAME);
  let fd: number | undefined;
  try {
    fd = openSync(manifestPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    if (!fstatSync(fd).isFile()) throw new Error("manifest is not a regular file");
    const content = readFileSync(fd, "utf8");
    const value = JSON.parse(content) as Partial<ArchiveTransactionManifest>;
    if (!isValidArchiveTransactionManifest(value)) {
      throw new Error("manifest has an invalid shape");
    }
    if (content !== `${JSON.stringify(value)}\n`) throw new Error("manifest is not canonical");
    return value as ArchiveTransactionManifest;
  } catch (error) {
    throw new Error(`Unable to read archive transaction manifest ${manifestPath}: ${String(error)}`);
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function isValidArchiveTransactionManifest(value: Partial<ArchiveTransactionManifest>): boolean {
  if (!value || typeof value !== "object") return false;
  const knownKeys = [
    "version", "state", "transactionId", "role", "sourceFilename", "runId", "sourceIdentity",
    "ownerSource", "expectedEvent", "sessionName", "allAgentIds", "occurrenceId", "acceptedTrigger",
    "fileIdentity", "fileMode", "processedContentSha256", "destinationFilename", "archivedContentSha256",
    "archiveStatus", "conflictReason",
  ];
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !knownKeys.includes(key))) return false;
  return value.version === 1
    && ["prepared", "claimed", "archived", "receipted", "complete", "conflict"].includes(String(value.state))
    && /^[a-f0-9]{64}$/.test(value.transactionId || "")
    && (value.role === "trigger" || value.role === "owned-sibling")
    && isDirectEventFilename(value.sourceFilename || "")
    && Boolean(value.runId?.trim())
    && value.sourceIdentity?.scope === "run"
    && value.sourceIdentity.runId === value.runId
    && Boolean(value.sourceIdentity.source?.trim())
    && Boolean(value.ownerSource?.trim())
    && Array.isArray(value.allAgentIds)
    && value.allAgentIds.every((id) => typeof id === "string")
    && Boolean(value.occurrenceId?.trim())
    && value.acceptedTrigger !== undefined
    && value.acceptedTrigger?.sourceFilename === value.sourceFilename
    && value.acceptedTrigger.occurrenceToken === value.transactionId
    && value.fileIdentity !== undefined
    && ["dev", "ino", "size", "mtimeNs", "ctimeNs", "birthtimeNs"]
      .every((key) => typeof (value.fileIdentity as unknown as Record<string, unknown>)[key] === "string")
    && Number.isInteger(value.fileMode)
    && /^[a-f0-9]{64}$/.test(value.processedContentSha256 || "")
    && (value.destinationFilename === undefined || isDirectEventFilename(value.destinationFilename))
    && (value.archivedContentSha256 === undefined || /^[a-f0-9]{64}$/.test(value.archivedContentSha256))
    && (value.archiveStatus === undefined || ["archived", "collision-archived", "already-archived"].includes(value.archiveStatus))
    && (value.conflictReason === undefined || typeof value.conflictReason === "string");
}

function cleanupArchiveTransaction(
  root: string,
  transactionDir: string,
  manifest: ArchiveTransactionManifest,
): void {
  const transactionRoot = join(root, TRANSACTION_ROOT_NAME);
  const archiveDir = join(root, "archive");
  const manifestPath = join(transactionDir, TRANSACTION_MANIFEST_NAME);
  const entries = readdirSync(transactionDir, { withFileTypes: true });
  const allowed = new Set([
    TRANSACTION_CLAIMED_NAME,
    TRANSACTION_MANIFEST_NAME,
  ]);
  for (const entry of entries) {
    if (/^\.manifest-[0-9]+-[0-9a-f-]+\.tmp$/.test(entry.name)
      || /^\.processed-[0-9]+-[0-9a-f-]+\.tmp$/.test(entry.name)) allowed.add(entry.name);
    if (!allowed.has(entry.name) || !entry.isFile()) {
      throw new Error(`Unexpected archive transaction entry: ${join(transactionDir, entry.name)}`);
    }
  }
  for (const entry of entries) {
    if (entry.name === TRANSACTION_CLAIMED_NAME
      || /^\.manifest-[0-9]+-[0-9a-f-]+\.tmp$/.test(entry.name)
      || /^\.processed-[0-9]+-[0-9a-f-]+\.tmp$/.test(entry.name)) {
      unlinkSync(join(transactionDir, entry.name));
    }
  }
  if (existsSync(manifestPath)) unlinkSync(manifestPath);
  syncDirectory(transactionDir);
  try { rmdirSync(transactionDir); } catch { return; }
  syncDirectory(transactionRoot);
  if (existsSync(archiveDir)) {
    const stagePath = join(archiveDir, `.event-archive-stage-${basename(transactionDir)}.tmp`);
    const destinationPath = manifest.destinationFilename
      ? join(archiveDir, manifest.destinationFilename)
      : "";
    if (destinationPath && isRegularFile(stagePath) && sameFileIdentity(stagePath, destinationPath)) {
      unlinkSync(stagePath);
      syncDirectory(archiveDir);
    }
    const receiptStagePath = join(archiveDir, `.event-receipt-stage-${basename(transactionDir)}.tmp`);
    const receiptPath = archiveReceiptPath(
      archiveDir,
      manifest.sourceFilename,
      manifest.runId,
      manifest.acceptedTrigger.occurrenceToken,
      manifest.acceptedTrigger.rawContentSha256,
    );
    if (isRegularFile(receiptStagePath) && isRegularFile(receiptPath)
      && readFileSync(receiptStagePath, "utf8") === readFileSync(receiptPath, "utf8")) {
      unlinkSync(receiptStagePath);
      syncDirectory(archiveDir);
    }
  }
}

function cleanupUnmanifestedTransaction(transactionRoot: string, transactionDir: string): void {
  const entries = readdirSync(transactionDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!/^\.manifest-[0-9]+-[0-9a-f-]+\.tmp$/.test(entry.name) || !entry.isFile()) return;
    unlinkSync(join(transactionDir, entry.name));
  }
  try { rmdirSync(transactionDir); } catch { return; }
  syncDirectory(transactionRoot);
}

function writeDurableFile(path: string, content: string, mode: number): void {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, mode);
  try {
    writeFileSync(fd, content, { encoding: "utf8" });
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function syncDirectory(path: string): void {
  const fd = openSync(path, constants.O_RDONLY);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function claimArchiveReceipt(
  archiveDir: string,
  role: RunnerEventArchiveReceipt["role"],
  sourceFilename: string,
  runId: string,
  destinationFilename: string,
  acceptedTrigger: RunnerEventAcceptedTrigger,
  content: string,
  occurrenceId: string,
): void {
  const archivedContentSha256 = sha256(content);
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
      || (existing.receipt.version === 3 && existing.receipt.occurrenceId !== occurrenceId)
    ) {
      throw new Error(`Archive receipt conflicts with claimed event: ${receiptPath}`);
    }
    const stagedPath = join(archiveDir, `.event-receipt-stage-${acceptedTrigger.occurrenceToken}.tmp`);
    if (isRegularFile(stagedPath) && readFileSync(stagedPath, "utf8") === readFileSync(receiptPath, "utf8")) {
      unlinkSync(stagedPath);
      syncDirectory(archiveDir);
    }
    return;
  }

  const occurrence = archiveReceiptPathsForIdentity(archiveDir, sourceFilename, runId)
    .map((path) => readArchiveReceipt(archiveDir, path).occurrence)
    .reduce((maximum, value) => Math.max(maximum, value), 0) + 1;
  const receipt: RunnerEventArchiveReceipt = {
    version: 3,
    role,
    occurrence,
    sourceFilename,
    runId,
    destinationFilename,
    occurrenceToken: acceptedTrigger.occurrenceToken,
    acceptedContentSha256: acceptedTrigger.rawContentSha256,
    acceptedRecordSha256: acceptedTrigger.normalizedRecordSha256,
    archivedContentSha256,
    occurrenceId,
  };
  const receiptContent = `${JSON.stringify(receipt)}\n`;
  const stagedPath = join(archiveDir, `.event-receipt-stage-${acceptedTrigger.occurrenceToken}.tmp`);
  try {
    if (existsSync(stagedPath)) {
      if (!isRegularFile(stagedPath) || readFileSync(stagedPath, "utf8") !== receiptContent) {
        throw new Error(`Archive receipt staging file conflicts with occurrence: ${stagedPath}`);
      }
    } else {
      writeDurableFile(stagedPath, receiptContent, 0o600);
    }
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
    syncDirectory(archiveDir);
  } finally {
    try {
      unlinkSync(stagedPath);
      syncDirectory(archiveDir);
    } catch {
      // The transaction manifest lets recovery finish staged receipt cleanup.
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
  if (receipt.version === 3 && receipt.occurrenceId !== archiveOccurrenceId(event, {
    version: 1,
    sourceFilename: receipt.sourceFilename,
    occurrenceToken: receipt.occurrenceToken,
    rawContentSha256: receipt.acceptedContentSha256,
    normalizedRecordSha256: receipt.acceptedRecordSha256,
  })) {
    throw new Error(`Archive receipt occurrence ID does not match destination: ${destination}`);
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
  const version = typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as { version?: unknown }).version
    : undefined;
  const expectedKeys = version === 2
    ? ARCHIVE_RECEIPT_V2_KEYS
    : version === 3
      ? ARCHIVE_RECEIPT_V3_KEYS
      : [];
  if (
    typeof value !== "object"
    || value === null
    || Array.isArray(value)
    || keys.length !== expectedKeys.length
    || expectedKeys.some((key) => !keys.includes(key))
    || (version !== 2 && version !== 3)
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
    || (version === 3 && typeof (value as Partial<RunnerEventArchiveReceipt>).occurrenceId !== "string")
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
    || (receipt.version === 3 && !/^[A-Za-z0-9._-]{1,128}$/.test(receipt.occurrenceId || ""))
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

interface EventFileSnapshot {
  content: string;
  event: RunnerEventRecord;
  identity: EventFileIdentity;
  mode: number;
}

function eventFileIdentity(path: string): EventFileIdentity {
  const stat = lstatSync(path, { bigint: true });
  if (!stat.isFile()) {
    throw new Error(`Event file is not a direct regular file: ${path}`);
  }
  return eventFileIdentityFromStat(stat);
}

function eventFileIdentityFromStat(stat: {
  dev: bigint;
  ino: bigint;
  size: bigint;
  mtimeNs: bigint;
  ctimeNs: bigint;
  birthtimeNs: bigint;
}): EventFileIdentity {
  return {
    dev: stat.dev.toString(),
    ino: stat.ino.toString(),
    size: stat.size.toString(),
    mtimeNs: stat.mtimeNs.toString(),
    ctimeNs: stat.ctimeNs.toString(),
    birthtimeNs: stat.birthtimeNs.toString(),
  };
}

function snapshotEventFile(path: string): EventFileSnapshot {
  const flags = constants.O_RDONLY | constants.O_NOFOLLOW;
  let fd: number | undefined;
  try {
    fd = openSync(path, flags);
    const before = fstatSync(fd, { bigint: true });
    if (!before.isFile()) throw new Error(`Event file is not a direct regular file: ${path}`);
    const content = readFileSync(fd, "utf8");
    const after = fstatSync(fd, { bigint: true });
    const pathIdentity = eventFileIdentity(path);
    const beforeIdentity = eventFileIdentityFromStat(before);
    if (
      stableSerialize(beforeIdentity) !== stableSerialize(eventFileIdentityFromStat(after))
      || stableSerialize(beforeIdentity) !== stableSerialize(pathIdentity)
    ) {
      throw new Error(`Event file changed while capturing accepted trigger: ${path}`);
    }
    return {
      content,
      event: strictEventAtPath(path, content),
      identity: beforeIdentity,
      mode: Number(before.mode) & 0o777,
    };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
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

function pathEntryExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (isMissingPath(error)) return false;
    throw error;
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
