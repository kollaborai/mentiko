import { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth-bridge";
import {
  listSshKeys,
  addSshKey,
  removeSshKey,
  getSshKeyFingerprint,
  getSshKeyAlgorithm,
  isValidSshKey,
} from "@/lib/linux-users";
import { Unauthorized, BadRequest, Conflict, InternalServerError } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (request: NextRequest) => {
  const user = await getSessionUser(request);
  if (!user) {
    throw new Unauthorized();
  }

  if (!user.linuxUsername) {
    return apiSuccess({ keys: [], noLinuxUser: true });
  }

  try {
    const rawKeys = await listSshKeys(user.linuxUsername);
    const keys = await Promise.all(
      rawKeys.map(async (key) => ({
        fingerprint: await getSshKeyFingerprint(key),
        algorithm: getSshKeyAlgorithm(key),
        comment: key.trim().split(/\s+/).slice(2).join(" ") || "",
        raw: key,
      })),
    );
    return apiSuccess({ keys });
  } catch (err) {
    throw new InternalServerError(err instanceof Error ? err.message : "Failed to list keys");
  }
});

export const POST = withErrorHandling(async (request: NextRequest) => {
  const user = await getSessionUser(request);
  if (!user) {
    throw new Unauthorized();
  }

  if (!user.linuxUsername) {
    throw new BadRequest("No linux account found. SSH keys require a VPS-tier instance.");
  }

  const body = await request.json();
  const { publicKey } = body;

  if (!publicKey || typeof publicKey !== "string") {
    throw new BadRequest("publicKey is required", { field: "publicKey" });
  }

  if (!isValidSshKey(publicKey)) {
    throw new BadRequest("Invalid SSH public key format. Must start with ssh-rsa, ssh-ed25519, or ecdsa-*");
  }

  try {
    await addSshKey(user.linuxUsername, publicKey);
    const fingerprint = await getSshKeyFingerprint(publicKey);
    return apiSuccess({
      added: true,
      fingerprint,
      algorithm: getSshKeyAlgorithm(publicKey),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to add key";
    if (msg.includes("already added")) {
      throw new Conflict(msg);
    }
    throw new InternalServerError(msg);
  }
});

export const DELETE = withErrorHandling(async (request: NextRequest) => {
  const user = await getSessionUser(request);
  if (!user) {
    throw new Unauthorized();
  }

  if (!user.linuxUsername) {
    throw new BadRequest("No linux account");
  }

  const { searchParams } = new URL(request.url);
  const fingerprint = searchParams.get("fingerprint");

  if (!fingerprint) {
    throw new BadRequest("fingerprint query param required", { field: "fingerprint" });
  }

  try {
    await removeSshKey(user.linuxUsername, fingerprint);
    return apiSuccess({ removed: true });
  } catch (err) {
    throw new InternalServerError(err instanceof Error ? err.message : "Failed to remove key");
  }
});
