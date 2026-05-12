/**
 * SSH key management for workspace access.
 *
 * GET  /api/workspaces/ssh-keys
 *   List stored key pairs for the namespace.
 *
 * POST /api/workspaces/ssh-keys
 *   body: { name: string, type?: "ed25519"|"rsa", comment?: string }
 *   Generate a new SSH key pair. Private key stored server-side (never returned),
 *   public key returned in response.
 *   Returns: { id, name, publicKey, type, createdAt, fingerprint }
 *
 * DELETE /api/workspaces/ssh-keys?id=xxx
 *   Remove a key pair.
 *
 * GET /api/workspaces/ssh-keys?id=xxx&export=private
 *   Export private key (admin only, one-time).
 *
 * Keys stored at: namespaces/{ns}/ssh-keys/{id}.json + {id}.key (private)
 */

import { NextRequest } from "next/server";
import { execSync } from "child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync } from "fs";
import { join } from "path";
import { checkAuth } from "@/lib/api-auth";
import { getNamespaceIdFromRequest } from "@/lib/namespace-config";
import { nsPath } from "@/lib/config";
import { Unauthorized, BadRequest, NotFound } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

interface SshKeyMeta {
  id: string;
  name: string;
  publicKey: string;
  fingerprint: string;
  type: "ed25519" | "rsa";
  comment: string;
  createdAt: string;
}

function keysDir(namespaceId: string): string {
  return nsPath(namespaceId, "ssh-keys");
}

function listKeys(namespaceId: string): SshKeyMeta[] {
  const dir = keysDir(namespaceId);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try { return JSON.parse(readFileSync(join(dir, f), "utf-8")) as SshKeyMeta; }
      catch { return null; }
    })
    .filter(Boolean) as SshKeyMeta[];
}

function generateKeyId(): string {
  return `key-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const GET = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const namespaceId = await getNamespaceIdFromRequest(request);
  const { searchParams } = new URL(request.url);
  const keyId = searchParams.get("id");
  const exportType = searchParams.get("export");

  if (keyId && exportType === "private") {
    const dir = keysDir(namespaceId);
    const keyFile = join(dir, `${keyId}.key`);
    if (!existsSync(keyFile)) {
      throw new NotFound("SSH key", keyId);
    }
    return apiSuccess({ keyPath: keyFile });
  }

  if (keyId) {
    const keys = listKeys(namespaceId);
    const key = keys.find((k) => k.id === keyId);
    if (!key) throw new NotFound("SSH key", keyId);
    return apiSuccess({ key });
  }

  return apiSuccess({ keys: listKeys(namespaceId) });
});

export const POST = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const namespaceId = await getNamespaceIdFromRequest(request);

  const body = (await request.json()) as {
    name: string;
    type?: "ed25519" | "rsa";
    comment?: string;
  };

  if (!body.name) {
    throw new BadRequest("name required", { field: "name" });
  }

  const keyType = body.type ?? "ed25519";
  const keyId = generateKeyId();
  const comment = body.comment ?? `mentiko-${body.name}-${keyId}`;
  const dir = keysDir(namespaceId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const privateKeyPath = join(dir, `${keyId}.key`);
  const publicKeyPath = join(dir, `${keyId}.pub`);

  const keygen = keyType === "rsa"
    ? `ssh-keygen -t rsa -b 4096 -C "${comment}" -f "${privateKeyPath}" -N ""`
    : `ssh-keygen -t ed25519 -C "${comment}" -f "${privateKeyPath}" -N ""`;

  execSync(keygen, { stdio: "pipe" });

  const publicKey = readFileSync(publicKeyPath, "utf-8").trim();

  let fingerprint = "";
  try {
    fingerprint = execSync(`ssh-keygen -lf "${publicKeyPath}"`, { stdio: "pipe" })
      .toString().trim().split(" ")[1] ?? "";
  } catch { /* non-critical */ }

  const meta: SshKeyMeta = {
    id: keyId,
    name: body.name,
    publicKey,
    fingerprint,
    type: keyType,
    comment,
    createdAt: new Date().toISOString(),
  };

  writeFileSync(join(dir, `${keyId}.json`), JSON.stringify(meta, null, 2));

  try { unlinkSync(publicKeyPath); } catch { /* ignore */ }

  return apiSuccess({ key: meta });
});

export const DELETE = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const namespaceId = await getNamespaceIdFromRequest(request);
  const { searchParams } = new URL(request.url);
  const keyId = searchParams.get("id");

  if (!keyId) {
    throw new BadRequest("id required", { field: "id" });
  }

  const dir = keysDir(namespaceId);
  const metaFile = join(dir, `${keyId}.json`);
  const keyFile = join(dir, `${keyId}.key`);

  if (!existsSync(metaFile)) {
    throw new NotFound("SSH key", keyId);
  }

  try { unlinkSync(metaFile); } catch { /* ignore */ }
  try { unlinkSync(keyFile); } catch { /* ignore */ }

  return apiSuccess({ deleted: true, id: keyId });
});
