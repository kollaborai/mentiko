/**
 * Typed deterministic-rejection envelope + fingerprint ledger for generated
 * chains (chain-contract-plan-of-record.md, Track A3/A4).
 *
 * A generated-chain rejection is deterministic: the same candidate bytes fail
 * the same validator revision the same way forever. The 2026-07-30/31 devv
 * incident burned the full auto_run_retries budget re-submitting one rejected
 * artifact through generate -> import -> recovery -> save. Every rejection door
 * (import boundary, artifact recovery, /api/chains/save, run start) records
 * and consults ONE ledger keyed by the canonical artifact hash, so an
 * identical candidate stops immediately instead of looping.
 *
 * Retry logic must branch on this envelope, never on message strings.
 */

import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { orgPath } from "@/lib/config";
import { GENERATED_CHAIN_VALIDATOR_REVISION } from "@/lib/chains/generated-chain-delivery-contract";

export type GeneratedChainRejectionPhase = "import" | "recovery" | "save" | "run_start";

export const GENERATED_CHAIN_CONTRACT_REJECTION_CODE = "generated_chain_contract_violation";

export interface GeneratedChainRejectionEnvelope {
  phase: GeneratedChainRejectionPhase;
  code: string;
  deterministic: boolean;
  artifact_hash: string;
  validator_revision: string;
  contract_version: number;
  paths: string[];
  message: string;
  at: string;
}

/** Stable serialization: object keys sorted at every depth, arrays in order. */
function canonicalSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalSerialize).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalSerialize(v)}`);
  return `{${entries.join(",")}}`;
}

/** Canonical content hash of the exact candidate being accepted. */
export function canonicalGeneratedChainHash(chain: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalSerialize(chain), "utf8").digest("hex")}`;
}

/**
 * The deterministic-failure identity: same artifact + same rule class + same
 * contract + same validator revision => same outcome, no retry can change it.
 */
export function generatedChainRejectionFingerprint(envelope: Pick<
  GeneratedChainRejectionEnvelope,
  "artifact_hash" | "code" | "contract_version" | "validator_revision"
>): string {
  return `${envelope.artifact_hash}:${envelope.code}:v${envelope.contract_version}:${envelope.validator_revision}`;
}

function contractVersionOf(chain: unknown): number {
  const metadata = chain && typeof chain === "object" && !Array.isArray(chain)
    ? (chain as Record<string, unknown>).metadata
    : undefined;
  const contract = metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>).generated_chain_contract
    : undefined;
  const version = contract && typeof contract === "object" && !Array.isArray(contract)
    ? (contract as Record<string, unknown>).version
    : undefined;
  return typeof version === "number" && Number.isFinite(version) ? version : 1;
}

function pathsFromErrors(errors: string[]): string[] {
  const paths = new Set<string>();
  for (const error of errors) {
    const match = /^(agents\[\d+\](?:\.[a-z_]+)?|metadata\.generated_chain_contract(?:\.[a-z_]+)?)/.exec(error);
    if (match) paths.add(match[1]);
  }
  return [...paths];
}

export function buildGeneratedChainRejectionEnvelope(input: {
  phase: GeneratedChainRejectionPhase;
  chain: unknown;
  errors: string[];
  code?: string;
}): GeneratedChainRejectionEnvelope {
  return {
    phase: input.phase,
    code: input.code ?? GENERATED_CHAIN_CONTRACT_REJECTION_CODE,
    deterministic: true,
    artifact_hash: canonicalGeneratedChainHash(input.chain),
    validator_revision: GENERATED_CHAIN_VALIDATOR_REVISION,
    contract_version: contractVersionOf(input.chain),
    paths: pathsFromErrors(input.errors),
    message: input.errors.join("; "),
    at: new Date().toISOString(),
  };
}

const LEDGER_FILE = ".generated-chain-rejections.json";
const LEDGER_CAP = 100;

function ledgerPath(namespaceId: string, orgId: string): string {
  return join(orgPath(namespaceId, orgId, "chains"), LEDGER_FILE);
}

function readLedger(namespaceId: string, orgId: string): GeneratedChainRejectionEnvelope[] {
  const path = ledgerPath(namespaceId, orgId);
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    return Array.isArray(parsed) ? parsed as GeneratedChainRejectionEnvelope[] : [];
  } catch {
    return [];
  }
}

/** Append a rejection so import, recovery, and save all see the same decision. */
export function recordGeneratedChainRejection(
  namespaceId: string,
  orgId: string,
  envelope: GeneratedChainRejectionEnvelope,
): void {
  const path = ledgerPath(namespaceId, orgId);
  try {
    const entries = readLedger(namespaceId, orgId);
    entries.push(envelope);
    const bounded = entries.slice(-LEDGER_CAP);
    mkdirSync(dirname(path), { recursive: true });
    const temp = `${path}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(bounded, null, 2));
    renameSync(temp, path);
  } catch {
    // The ledger is a stop-early optimization; a failed write must never turn
    // a rejection into a crash. The candidate still fails validation directly.
  }
}

/**
 * Latest recorded rejection for this exact artifact under the CURRENT
 * validator revision. A revision bump deliberately misses old entries so an
 * upgraded validator re-evaluates the candidate once under the new rules.
 */
export function findGeneratedChainRejection(
  namespaceId: string,
  orgId: string,
  artifactHash: string,
): GeneratedChainRejectionEnvelope | undefined {
  const entries = readLedger(namespaceId, orgId);
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (
      entry
      && entry.artifact_hash === artifactHash
      && entry.validator_revision === GENERATED_CHAIN_VALIDATOR_REVISION
      && entry.deterministic === true
    ) {
      return entry;
    }
  }
  return undefined;
}
