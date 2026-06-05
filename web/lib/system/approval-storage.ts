/**
 * approval state storage
 * file-based persistence for approval requests
 */

import { promises as fs } from "fs";
import { join } from "path";
import { orgPath } from "../config";
import type {
  ApprovalRequest,
  ChainApprovalConfig,
} from "./approval-types";

const APPROVAL_DIR = "approvals";

function getApprovalDir(namespaceId: string, orgId: string): string {
  return orgPath(namespaceId, orgId, APPROVAL_DIR);
}

function getChainConfigPath(namespaceId: string, orgId: string, chainId: string): string {
  return join(getApprovalDir(namespaceId, orgId), `${chainId}-config.json`);
}

function getRequestsPath(namespaceId: string, orgId: string): string {
  return join(getApprovalDir(namespaceId, orgId), "requests.jsonl");
}

function getRequestPath(namespaceId: string, orgId: string, requestId: string): string {
  return join(getApprovalDir(namespaceId, orgId), `${requestId}.json`);
}

async function ensureDir(namespaceId: string, orgId: string): Promise<void> {
  const dir = getApprovalDir(namespaceId, orgId);
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch {
    // ignore
  }
}

// chain config
export async function getChainApprovalConfig(
  namespaceId: string,
  orgId: string,
  chainId: string
): Promise<ChainApprovalConfig | null> {
  const path = getChainConfigPath(namespaceId, orgId, chainId);

  try {
    const data = await fs.readFile(path, "utf-8");
    return JSON.parse(data) as ChainApprovalConfig;
  } catch {
    return null;
  }
}

export async function saveChainApprovalConfig(
  namespaceId: string,
  orgId: string,
  chainId: string,
  config: ChainApprovalConfig
): Promise<void> {
  await ensureDir(namespaceId, orgId);
  const path = getChainConfigPath(namespaceId, orgId, chainId);
  await fs.writeFile(path, JSON.stringify(config, null, 2));
}

export async function deleteChainApprovalConfig(
  namespaceId: string,
  orgId: string,
  chainId: string
): Promise<void> {
  const path = getChainConfigPath(namespaceId, orgId, chainId);
  try {
    await fs.unlink(path);
  } catch {
    // ignore
  }
}

// approval requests
export async function createApprovalRequest(
  namespaceId: string,
  orgId: string,
  request: ApprovalRequest
): Promise<void> {
  await ensureDir(namespaceId, orgId);

  // save individual request file
  const requestPath = getRequestPath(namespaceId, orgId, request.id);
  await fs.writeFile(requestPath, JSON.stringify(request, null, 2));

  // append to requests log
  const requestsPath = getRequestsPath(namespaceId, orgId);
  const line = JSON.stringify(request) + "\n";
  await fs.appendFile(requestsPath, line);
}

export async function getApprovalRequest(
  namespaceId: string,
  orgId: string,
  requestId: string
): Promise<ApprovalRequest | null> {
  const path = getRequestPath(namespaceId, orgId, requestId);

  try {
    const data = await fs.readFile(path, "utf-8");
    return JSON.parse(data) as ApprovalRequest;
  } catch {
    return null;
  }
}

export async function updateApprovalRequest(
  namespaceId: string,
  orgId: string,
  request: ApprovalRequest
): Promise<void> {
  const path = getRequestPath(namespaceId, orgId, request.id);
  await fs.writeFile(path, JSON.stringify(request, null, 2));
}

export async function listApprovalRequests(
  namespaceId: string,
  orgId: string,
  filters?: {
    chainId?: string;
    runId?: string;
    status?: ApprovalRequest["status"];
    limit?: number;
  }
): Promise<ApprovalRequest[]> {
  const dir = getApprovalDir(namespaceId, orgId);

  try {
    const files = await fs.readdir(dir);
    const requestFiles = files.filter((f) => f.endsWith(".json") && !f.endsWith("-config.json"));

    const requests: ApprovalRequest[] = [];
    for (const file of requestFiles) {
      try {
        const data = await fs.readFile(join(dir, file), "utf-8");
        const request = JSON.parse(data) as ApprovalRequest;

        // apply filters
        if (filters?.chainId && request.chainId !== filters.chainId) continue;
        if (filters?.runId && request.runId !== filters.runId) continue;
        if (filters?.status && request.status !== filters.status) continue;

        requests.push(request);
      } catch {
        // skip malformed
      }
    }

    // sort by requestedAt (newest first)
    requests.sort((a, b) =>
      b.requestedAt.localeCompare(a.requestedAt)
    );

    if (filters?.limit) {
      return requests.slice(0, filters.limit);
    }

    return requests;
  } catch {
    return [];
  }
}

export async function deleteApprovalRequest(
  namespaceId: string,
  orgId: string,
  requestId: string
): Promise<void> {
  const path = getRequestPath(namespaceId, orgId, requestId);
  try {
    await fs.unlink(path);
  } catch {
    // ignore
  }
}

// pending approvals (for chain runner to check)
export async function getPendingApproval(
  namespaceId: string,
  orgId: string,
  runId: string,
  stepName: string
): Promise<ApprovalRequest | null> {
  const requests = await listApprovalRequests(namespaceId, orgId, {
    status: "pending",
  });

  return (
    requests.find(
      (r) => r.runId === runId && r.stepName === stepName
    ) || null
  );
}

// cleanup expired requests
export async function cleanupExpiredRequests(namespaceId: string, orgId: string): Promise<number> {
  const requests = await listApprovalRequests(namespaceId, orgId);
  const now = new Date().toISOString();
  let cleaned = 0;

  for (const request of requests) {
    if (request.status === "pending" && request.expiresAt && request.expiresAt < now) {
      request.status = "cancelled";
      await updateApprovalRequest(namespaceId, orgId, request);
      cleaned++;
    }
  }

  return cleaned;
}
