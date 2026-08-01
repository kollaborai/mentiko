/**
 * THE authoritative generated-chain acceptance service
 * (chain-contract-plan-of-record.md B3/B5/B8).
 *
 * Every door — job completion import, /api/chains/save, artifact recovery,
 * CLI generation, run start — accepts a generated chain through this one
 * pipeline:
 *
 *   decode -> materialize (pure) -> structural chain validation ->
 *   versioned generated-contract validation (semantic rules subject to the
 *   admin circuit breaker) -> deterministic-rejection ledger -> COMMIT
 *   (registry writes, and the manifest when persisted under a chain id)
 *
 * No route or CLI may implement a semantic validator outside this service.
 * Side effects happen only after every validation has passed; a rejected
 * candidate leaves the registry and manifest untouched.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { orgPath } from "@/lib/config";
import { validateChain } from "@/lib/validators";
import { resolveChainAgents } from "@/lib/agents/agent-loader";
import {
  commitAgentRegistryWrites,
  materializeGeneratedChain,
  type MaterializedChain,
} from "@/lib/chains/chain-postprocessor";
import {
  GENERATED_CHAIN_VALIDATOR_REVISION,
  GeneratedChainContractError,
  isGeneratedChainContract,
  validateGeneratedChainDeliveryContractDetailed,
} from "@/lib/chains/generated-chain-delivery-contract";
import {
  buildGeneratedChainRejectionEnvelope,
  canonicalGeneratedChainHash,
  findGeneratedChainRejection,
  recordGeneratedChainRejection,
  type GeneratedChainRejectionEnvelope,
  type GeneratedChainRejectionPhase,
} from "@/lib/chains/generated-chain-rejections";
import { resolveSemanticPolicyMode } from "@/lib/system/system-settings";

export interface GeneratedChainWarning {
  rule: string;
  message: string;
  /** present when a semantic rule was demoted by the admin override */
  demoted_by_policy?: boolean;
}

export interface AcceptedGeneratedChain {
  /** the authored (user/model-facing) definition as submitted */
  authoredChain: Record<string, unknown>;
  /** fully materialized execution candidate ($ref-rewritten) */
  manifestChain: Record<string, unknown>;
  /** canonical digest of the manifest chain — binds acceptance to execution */
  digest: string;
  contractVersion: number;
  acceptanceRevision: string;
  warnings: GeneratedChainWarning[];
  createdAgents: { id: string; name: string }[];
  extractedCount: number;
}

export class GeneratedChainRejectedError extends GeneratedChainContractError {
  constructor(
    errors: string[],
    readonly envelope: GeneratedChainRejectionEnvelope,
    readonly duplicate: boolean = false,
  ) {
    super(errors);
    this.name = "GeneratedChainRejectedError";
  }
}

function contractVersionOf(chain: Record<string, unknown>): number {
  const metadata = chain.metadata as Record<string, unknown> | undefined;
  const contract = metadata?.generated_chain_contract as Record<string, unknown> | undefined;
  return typeof contract?.version === "number" ? contract.version : 1;
}

/**
 * The candidate as the RUNNER would see it: every $ref resolved. Staged (not
 * yet committed) registry records resolve from the plan; pre-existing refs
 * resolve from the registry. An unresolvable ref stays raw so the rejection
 * names its missing declarations instead of swallowing the chain.
 */
function resolvedValidationView(materialized: MaterializedChain, namespaceId: string, orgId: string): Record<string, unknown> {
  const chain = materialized.chain;
  if (!Array.isArray(chain.agents)) return chain;

  const stagedById = new Map(materialized.stagedWrites.map((write) => [write.finalId, write.record]));
  const agents = chain.agents.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
    const record = entry as Record<string, unknown>;
    if (typeof record.$ref !== "string") return entry;

    const staged = stagedById.get(record.$ref);
    if (staged) {
      const { $ref: _ref, ...overrides } = record;
      return { ...(staged as unknown as Record<string, unknown>), ...overrides };
    }
    try {
      return (resolveChainAgents([entry], namespaceId, orgId) as unknown[])[0];
    } catch {
      return entry;
    }
  });
  return { ...chain, agents };
}

/**
 * Accept a generated chain candidate. Throws GeneratedChainRejectedError with
 * a typed envelope on rejection (recorded in the shared ledger); returns the
 * accepted manifest + digest on success, with registry writes committed.
 *
 * `phase` names the calling door for the envelope. `skipStructuralChainCheck`
 * exists for callers that already ran validateChain on the same candidate.
 */
export function acceptGeneratedChain(input: {
  chain: Record<string, unknown>;
  namespaceId: string;
  orgId: string;
  phase: GeneratedChainRejectionPhase;
  /** persist manifest.json under this chain id (save door) */
  persistManifestForChainId?: string;
  /** skip validateChain when the caller already applied it to the same bytes */
  skipStructuralChainCheck?: boolean;
}): AcceptedGeneratedChain {
  const { chain, namespaceId, orgId, phase } = input;
  const authoredHash = canonicalGeneratedChainHash(chain);

  // Deterministic-duplicate answer before any work (A4): same candidate under
  // the same validator revision fails identically at every door.
  const prior = findGeneratedChainRejection(namespaceId, orgId, authoredHash);
  if (prior) {
    const envelope: GeneratedChainRejectionEnvelope = { ...prior, phase, at: new Date().toISOString() };
    throw new GeneratedChainRejectedError([prior.message], envelope, true);
  }

  // Pure materialization: nothing persists until acceptance completes.
  const materialized = materializeGeneratedChain(chain, namespaceId, orgId);

  const reject = (errors: string[]): never => {
    const envelope = buildGeneratedChainRejectionEnvelope({ phase, chain, errors });
    recordGeneratedChainRejection(namespaceId, orgId, envelope);
    throw new GeneratedChainRejectedError(errors, envelope);
  };

  // Validate the RESOLVED candidate — the exact definition the runner would
  // execute, with staged registry records standing in for their $refs.
  const validationView = resolvedValidationView(materialized, namespaceId, orgId);
  if (!input.skipStructuralChainCheck) {
    const structural = validateChain(validationView);
    if (!structural.valid) reject(structural.errors);
  }

  // Versioned generated-chain contract. Structural errors always block;
  // typed semantic lifecycle rules honor the namespace circuit breaker and
  // surface as warnings when demoted (visibly, never silently).
  const detail = validateGeneratedChainDeliveryContractDetailed(validationView);
  if (detail.errors.length > 0) reject(detail.errors);

  const warnings: GeneratedChainWarning[] = [];
  const enforcedViolations: string[] = [];
  for (const violation of detail.semanticViolations) {
    if (resolveSemanticPolicyMode(namespaceId, violation.rule) === "warn") {
      warnings.push({ rule: violation.rule, message: violation.message, demoted_by_policy: true });
    } else {
      enforcedViolations.push(violation.message);
    }
  }
  if (enforcedViolations.length > 0) reject(enforcedViolations);

  // Every validation passed — commit.
  commitAgentRegistryWrites(materialized.stagedWrites);

  const accepted: AcceptedGeneratedChain = {
    authoredChain: chain,
    manifestChain: materialized.chain,
    digest: canonicalGeneratedChainHash(materialized.chain),
    contractVersion: contractVersionOf(chain),
    acceptanceRevision: GENERATED_CHAIN_VALIDATOR_REVISION,
    warnings,
    createdAgents: materialized.createdAgents,
    extractedCount: materialized.extractedCount,
  };

  if (input.persistManifestForChainId) {
    persistAcceptedManifest(namespaceId, orgId, input.persistManifestForChainId, accepted);
  }

  return accepted;
}

// --- accepted execution manifest (B5) --------------------------------------

export interface AcceptedManifestRecord {
  authored_chain: Record<string, unknown>;
  manifest_chain: Record<string, unknown>;
  digest: string;
  contract_version: number;
  acceptance_revision: string;
  warnings: GeneratedChainWarning[];
  accepted_at: string;
}

const MANIFEST_FILE = "manifest.json";

function manifestPath(namespaceId: string, orgId: string, chainId: string): string {
  return join(orgPath(namespaceId, orgId, "chains", chainId), MANIFEST_FILE);
}

/** Atomic (temp + rename) persistence of the accepted execution manifest. */
export function persistAcceptedManifest(
  namespaceId: string,
  orgId: string,
  chainId: string,
  accepted: AcceptedGeneratedChain,
): void {
  const record: AcceptedManifestRecord = {
    authored_chain: accepted.authoredChain,
    manifest_chain: accepted.manifestChain,
    digest: accepted.digest,
    contract_version: accepted.contractVersion,
    acceptance_revision: accepted.acceptanceRevision,
    warnings: accepted.warnings,
    accepted_at: new Date().toISOString(),
  };
  const path = manifestPath(namespaceId, orgId, chainId);
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(record, null, 2));
  renameSync(temp, path);
}

export function readAcceptedManifest(
  namespaceId: string,
  orgId: string,
  chainId: string,
): AcceptedManifestRecord | null {
  const path = manifestPath(namespaceId, orgId, chainId);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    return parsed && typeof parsed === "object" && typeof parsed.digest === "string"
      ? parsed as AcceptedManifestRecord
      : null;
  } catch {
    return null;
  }
}

export type ManifestVerification =
  | { state: "accepted"; record: AcceptedManifestRecord }
  | { state: "drifted"; record: AcceptedManifestRecord; currentDigest: string }
  | { state: "none" };

/**
 * Run-start verification (B5): a chain with an accepted manifest executes
 * under the semantics it was ACCEPTED with — a later release must not
 * reinterpret it. Digest match => execute; drift => the authored content or
 * its materialized dependencies changed and explicit re-acceptance is
 * required; no manifest => legacy/manual chain, current-rules validation.
 */
export function verifyAcceptedManifest(
  namespaceId: string,
  orgId: string,
  chainId: string,
  effectiveChain: Record<string, unknown>,
): ManifestVerification {
  if (!isGeneratedChainContract(effectiveChain)) return { state: "none" };
  const record = readAcceptedManifest(namespaceId, orgId, chainId);
  if (!record) return { state: "none" };
  const currentDigest = canonicalGeneratedChainHash(effectiveChain);
  if (currentDigest === record.digest) return { state: "accepted", record };
  return { state: "drifted", record, currentDigest };
}
