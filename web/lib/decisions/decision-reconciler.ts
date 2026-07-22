import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import config from "@/lib/config";
import {
  advanceDecisionAfterPhase,
  getActiveDecisionGenerationPhase,
  inspectDecisionGenerationRecovery,
  type DecisionGenerationRecovery,
} from "@/lib/decisions/decision-auto-advance";
import { listDecisions } from "@/lib/decisions/decision-storage";
import type { Decision } from "@/lib/decisions/decision-types";
import { listWorkspaces } from "@/lib/workspaces/workspace-storage";

export const DECISION_RECOVERY_MAX_ATTEMPTS = 3;
export const DECISION_RECOVERY_BASE_COOLDOWN_MS = 60_000;
export const DECISION_RECOVERY_MAX_COOLDOWN_MS = 15 * 60_000;

interface DecisionRecoveryLedgerEntry {
  namespaceId: string;
  orgId: string;
  decisionId: string;
  workspacePath?: string;
  phase: "questions" | "options" | "plan";
  selectedOptionId?: string;
  attempts: number;
  lastAttemptAt: string;
  nextAttemptAt: string;
  lastRunId?: string;
  lastJobId?: string;
}

interface DecisionRecoveryLedger {
  version: 1;
  entries: Record<string, DecisionRecoveryLedgerEntry>;
}

export interface DecisionReconcileResult {
  examined: number;
  activeGenerating: number;
  deadPointers: number;
  awaitingImports: number;
  eligibleRecoveries: number;
  recoveriesScheduled: number;
  replaysScheduled: number;
  exhausted: number;
  coolingDown: number;
  errors: string[];
}

export interface DecisionReconcilerDependencies {
  listWorkspaces: (
    namespaceId: string,
    orgId: string,
  ) => Array<{ id: string; path: string }>;
  listDecisions: (
    namespaceId: string,
    orgId: string,
    workspacePath?: string,
  ) => Decision[];
  inspectRecovery: (input: {
    namespaceId: string;
    orgId: string;
    decision: Decision;
  }) => DecisionGenerationRecovery | null;
  advance: typeof advanceDecisionAfterPhase;
}

export interface ReconcileDecisionsOptions {
  namespaceId?: string;
  orgId?: string;
  nowMs?: number;
  dryRun?: boolean;
  ledgerPath?: string;
  maxAttempts?: number;
  baseCooldownMs?: number;
  maxCooldownMs?: number;
  codeRoot?: string;
  dependencies?: DecisionReconcilerDependencies;
}

const DEFAULT_DEPENDENCIES: DecisionReconcilerDependencies = {
  listWorkspaces,
  listDecisions,
  inspectRecovery: inspectDecisionGenerationRecovery,
  advance: advanceDecisionAfterPhase,
};

function emptyLedger(): DecisionRecoveryLedger {
  return { version: 1, entries: {} };
}

function readLedger(path: string): DecisionRecoveryLedger {
  try {
    if (!existsSync(path)) return emptyLedger();
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<DecisionRecoveryLedger>;
    if (parsed.version !== 1 || !parsed.entries || typeof parsed.entries !== "object") {
      return emptyLedger();
    }
    return { version: 1, entries: parsed.entries };
  } catch {
    return emptyLedger();
  }
}

function writeLedger(path: string, ledger: DecisionRecoveryLedger): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(tmp, `${JSON.stringify(ledger, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
}

function recoveryKey(input: {
  namespaceId: string;
  orgId: string;
  decisionId: string;
  workspacePath?: string;
  phase: string;
  selectedOptionId?: string;
}): string {
  return [
    input.namespaceId,
    input.orgId,
    input.workspacePath ?? "<organization>",
    input.decisionId,
    input.phase,
    input.selectedOptionId ?? "",
  ].map(encodeURIComponent).join("|");
}

function cooldownMs(
  attempt: number,
  baseCooldownMs: number,
  maxCooldownMs: number,
): number {
  return Math.min(baseCooldownMs * (2 ** Math.max(0, attempt - 1)), maxCooldownMs);
}

function scopedDecisions(input: {
  namespaceId: string;
  orgId: string;
  codeRoot: string;
  dependencies: DecisionReconcilerDependencies;
}): Decision[] {
  const scopes: Array<string | undefined> = [undefined];
  const seenScopes = new Set<string>();
  for (const workspace of input.dependencies.listWorkspaces(input.namespaceId, input.orgId)) {
    if (!workspace.path || workspace.path === input.codeRoot || seenScopes.has(workspace.path)) continue;
    seenScopes.add(workspace.path);
    scopes.push(workspace.path);
  }

  const seenDecisions = new Set<string>();
  const decisions: Decision[] = [];
  for (const scope of scopes) {
    const listed = input.dependencies.listDecisions(input.namespaceId, input.orgId, scope);
    for (const stored of listed) {
      const decision = stored.workspacePath || !scope
        ? stored
        : { ...stored, workspacePath: scope };
      const key = `${decision.workspacePath ?? "<organization>"}:${decision.id}`;
      if (seenDecisions.has(key)) continue;
      seenDecisions.add(key);
      decisions.push(decision);
    }
  }
  return decisions;
}

/**
 * Reconcile decision generation from the supervised background worker.
 *
 * Phase routes remain the only launch owner. This scanner merely schedules
 * those existing routes, while a durable ledger caps automatic dead-pointer
 * recovery across worker restarts. Manual route requests remain available
 * after the automatic budget is exhausted.
 */
export function reconcileDecisions(
  options: ReconcileDecisionsOptions = {},
): DecisionReconcileResult {
  const namespaceId = options.namespaceId ?? process.env.NAMESPACE_ID ?? "default";
  const orgId = options.orgId ?? process.env.ORG_ID ?? "default";
  const nowMs = options.nowMs ?? Date.now();
  const now = new Date(nowMs).toISOString();
  const dryRun = options.dryRun ?? false;
  const maxAttempts = options.maxAttempts ?? DECISION_RECOVERY_MAX_ATTEMPTS;
  const baseCooldownMs = options.baseCooldownMs ?? DECISION_RECOVERY_BASE_COOLDOWN_MS;
  const maxCooldownMs = options.maxCooldownMs ?? DECISION_RECOVERY_MAX_COOLDOWN_MS;
  const ledgerPath = options.ledgerPath ?? join(config.stateDir, "decision-reconciler.json");
  const dependencies = options.dependencies ?? DEFAULT_DEPENDENCIES;
  const result: DecisionReconcileResult = {
    examined: 0,
    activeGenerating: 0,
    deadPointers: 0,
    awaitingImports: 0,
    eligibleRecoveries: 0,
    recoveriesScheduled: 0,
    replaysScheduled: 0,
    exhausted: 0,
    coolingDown: 0,
    errors: [],
  };
  const ledger = readLedger(ledgerPath);
  const activeKeys = new Set<string>();
  let ledgerDirty = false;

  const decisions = scopedDecisions({
    namespaceId,
    orgId,
    codeRoot: options.codeRoot ?? config.codeRoot,
    dependencies,
  });

  for (const decision of decisions) {
    result.examined += 1;
    try {
      const active = getActiveDecisionGenerationPhase(decision);
      const key = active
        ? recoveryKey({
            namespaceId,
            orgId,
            decisionId: decision.id,
            workspacePath: decision.workspacePath,
            phase: active.phase,
            selectedOptionId: active.selectedOptionId,
          })
        : undefined;
      if (key) {
        activeKeys.add(key);
        result.activeGenerating += 1;
      }

      const recovery = dependencies.inspectRecovery({ namespaceId, orgId, decision });
      if (recovery?.kind === "dead" && key) {
        result.deadPointers += 1;
        const previous = ledger.entries[key];
        const storedAttempts = previous?.attempts;
        const previousAttempts = typeof storedAttempts === "number"
          && Number.isInteger(storedAttempts)
          && storedAttempts >= 0
          ? storedAttempts
          : 0;
        if (previousAttempts >= maxAttempts) {
          result.exhausted += 1;
          continue;
        }
        const nextAttemptMs = previous ? Date.parse(previous.nextAttemptAt) : 0;
        if (Number.isFinite(nextAttemptMs) && nextAttemptMs > nowMs) {
          result.coolingDown += 1;
          continue;
        }

        result.eligibleRecoveries += 1;
        if (dryRun) continue;

        const attempt = previousAttempts + 1;
        ledger.entries[key] = {
          namespaceId,
          orgId,
          decisionId: decision.id,
          workspacePath: decision.workspacePath,
          phase: recovery.phase,
          selectedOptionId: recovery.selectedOptionId,
          attempts: attempt,
          lastAttemptAt: now,
          nextAttemptAt: new Date(
            nowMs + cooldownMs(attempt, baseCooldownMs, maxCooldownMs),
          ).toISOString(),
          lastRunId: recovery.pointer.runId,
          lastJobId: recovery.pointer.jobId,
        };
        // Commit the budget before scheduling the side effect. A crash may
        // conservatively consume one attempt, but cannot create an uncounted
        // relaunch after restart.
        writeLedger(ledgerPath, ledger);
        dependencies.advance({ namespaceId, orgId, decision });
        result.recoveriesScheduled += 1;
        continue;
      }

      if (recovery?.kind === "awaiting_import") {
        result.awaitingImports += 1;
        if (!dryRun) {
          dependencies.advance({ namespaceId, orgId, decision });
          result.replaysScheduled += 1;
        }
        continue;
      }

      if (!dryRun) dependencies.advance({ namespaceId, orgId, decision });
    } catch (error) {
      result.errors.push(
        `${decision.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const prefix = [namespaceId, orgId].map(encodeURIComponent).join("|") + "|";
  for (const key of Object.keys(ledger.entries)) {
    if (!key.startsWith(prefix) || activeKeys.has(key)) continue;
    delete ledger.entries[key];
    ledgerDirty = true;
  }
  if (!dryRun && ledgerDirty) writeLedger(ledgerPath, ledger);

  return result;
}
