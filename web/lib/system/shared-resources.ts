/**
 * Org shared resources: chains, config profiles, secrets.
 * Stored in namespaces/{ns}/org/shared/{type}/
 *
 * Access control:
 *   - Any authenticated member can read chains and profiles.
 *   - Only admin/owner can write chains and profiles.
 *   - Secrets: read access gated by minRole per secret.
 *     Value masked to "***" for roles below minRole.
 *     Value encrypted at rest using AES-256-GCM.
 *   - Only admin/owner can write secrets.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "fs";
import { join } from "path";
import { orgPath } from "@/lib/config";
import type { OrgRole } from "@/lib/orgs/org-types";
import { encrypt, decrypt } from "@/lib/secrets/secrets-store";

// ── encryption for shared secrets ─────────────────────────────────────

interface StoredSharedSecret extends Omit<SharedSecret, "value"> {
  encryptedValue: string;
}

// ── paths ─────────────────────────────────────────────────────────

function sharedDir(namespaceId: string, orgId: string, ...segments: string[]): string {
  return orgPath(namespaceId, orgId, "shared", ...segments);
}

// ── shared chains ─────────────────────────────────────────────────

export interface SharedChain {
  name: string;
  description?: string;
  sharedAt: string;
  sharedBy?: string;
  chainData: Record<string, unknown>;
}

export function listSharedChains(namespaceId: string, orgId: string): SharedChain[] {
  const dir = sharedDir(namespaceId, orgId, "chains");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith(".json"))
    .map((d) => {
      try {
        return JSON.parse(readFileSync(join(dir, d.name), "utf-8")) as SharedChain;
      } catch {
        return null;
      }
    })
    .filter(Boolean) as SharedChain[];
}

export function getSharedChain(namespaceId: string, orgId: string, name: string): SharedChain | null {
  const safe = name.replace(/[^a-zA-Z0-9_-]/g, "_");
  const p = sharedDir(namespaceId, orgId, "chains", `${safe}.json`);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as SharedChain;
  } catch {
    return null;
  }
}

export function saveSharedChain(
  namespaceId: string,
  orgId: string,
  chain: SharedChain
): void {
  const safe = chain.name.replace(/[^a-zA-Z0-9_-]/g, "_");
  const dir = sharedDir(namespaceId, orgId, "chains");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${safe}.json`), JSON.stringify(chain, null, 2), "utf-8");
}

export function deleteSharedChain(namespaceId: string, orgId: string, name: string): boolean {
  const safe = name.replace(/[^a-zA-Z0-9_-]/g, "_");
  const p = sharedDir(namespaceId, orgId, "chains", `${safe}.json`);
  if (!existsSync(p)) return false;
  rmSync(p);
  return true;
}

// ── shared config profiles ────────────────────────────────────────

export interface SharedProfile {
  type: string;
  name: string;
  description?: string;
  sharedAt: string;
  sharedBy?: string;
  profileData: Record<string, unknown>;
}

export function listSharedProfiles(namespaceId: string, orgId: string, type?: string): SharedProfile[] {
  const base = sharedDir(namespaceId, orgId, "profiles");
  if (!existsSync(base)) return [];

  const types = type
    ? [type]
    : readdirSync(base, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);

  const results: SharedProfile[] = [];
  for (const t of types) {
    const dir = join(base, t);
    if (!existsSync(dir)) continue;
    readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .forEach((f) => {
        try {
          const p = JSON.parse(readFileSync(join(dir, f), "utf-8")) as SharedProfile;
          results.push(p);
        } catch {
          // skip
        }
      });
  }
  return results;
}

export function saveSharedProfile(namespaceId: string, orgId: string, profile: SharedProfile): void {
  const safe = profile.name.replace(/[^a-zA-Z0-9_-]/g, "_");
  const dir = sharedDir(namespaceId, orgId, "profiles", profile.type);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${safe}.json`), JSON.stringify(profile, null, 2), "utf-8");
}

export function deleteSharedProfile(
  namespaceId: string,
  orgId: string,
  type: string,
  name: string
): boolean {
  const safe = name.replace(/[^a-zA-Z0-9_-]/g, "_");
  const p = sharedDir(namespaceId, orgId, "profiles", type, `${safe}.json`);
  if (!existsSync(p)) return false;
  rmSync(p);
  return true;
}

// ── shared secrets ────────────────────────────────────────────────

export type SecretMinRole = "member" | "admin" | "owner";

export interface SharedSecret {
  name: string;
  description?: string;
  minRole: SecretMinRole;
  /** Decrypted value - never persisted to disk */
  value: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
}

export interface SharedSecretPublic extends Omit<SharedSecret, "value"> {
  value: "***";
  canRead: boolean;
}

const ROLE_ORDER: Record<OrgRole, number> = {
  owner: 4,
  admin: 3,
  member: 2,
  guest: 1,
};

function canReadSecret(secret: SharedSecret, role: OrgRole): boolean {
  const minRoleOrder: Record<SecretMinRole, number> = {
    member: 2,
    admin: 3,
    owner: 4,
  };
  return ROLE_ORDER[role] >= minRoleOrder[secret.minRole];
}

export function listSharedSecrets(
  namespaceId: string,
  orgId: string,
  callerRole: OrgRole
): (SharedSecret | SharedSecretPublic)[] {
  const dir = sharedDir(namespaceId, orgId, "secrets");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        const raw = JSON.parse(readFileSync(join(dir, f), "utf-8"));
        // check if this is legacy plaintext format (has "value" instead of "encryptedValue")
        if ("value" in raw && !("encryptedValue" in raw)) {
          // migration: legacy plaintext secret
          const legacy = raw as SharedSecret;
          if (canReadSecret(legacy, callerRole)) {
            // migrate to encrypted format
            saveSharedSecret(namespaceId, orgId, legacy);
            return legacy;
          }
          const pub: SharedSecretPublic = { ...legacy, value: "***", canRead: false };
          return pub;
        }
        const stored = raw as StoredSharedSecret;
        const canRead = canReadSecret({ ...stored, value: "" }, callerRole);
        if (canRead) {
          try {
            return { ...stored, value: decrypt(stored.encryptedValue) ?? "***" };
          } catch {
            // decryption failed - return masked version
            const pub: SharedSecretPublic = { ...stored, value: "***", canRead: false };
            return pub;
          }
        }
        const pub: SharedSecretPublic = { ...stored, value: "***", canRead: false };
        return pub;
      } catch {
        return null;
      }
    })
    .filter(Boolean) as (SharedSecret | SharedSecretPublic)[];
}

export function getSharedSecret(
  namespaceId: string,
  orgId: string,
  name: string,
  callerRole: OrgRole
): SharedSecret | SharedSecretPublic | null {
  const safe = name.replace(/[^a-zA-Z0-9_-]/g, "_");
  const p = sharedDir(namespaceId, orgId, "secrets", `${safe}.json`);
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, "utf-8"));
    // check if this is legacy plaintext format (has "value" instead of "encryptedValue")
    if ("value" in raw && !("encryptedValue" in raw)) {
      // migration: legacy plaintext secret - auto-encrypt on read
      const legacy = raw as SharedSecret;
      if (canReadSecret(legacy, callerRole)) {
        // migrate to encrypted format
        saveSharedSecret(namespaceId, orgId, legacy);
        return legacy;
      }
      return { ...legacy, value: "***", canRead: false };
    }
    const stored = raw as StoredSharedSecret;
    if (canReadSecret({ ...stored, value: "" }, callerRole)) {
      try {
        return { ...stored, value: decrypt(stored.encryptedValue) ?? "***" };
      } catch {
        // decryption failed
        return { ...stored, value: "***", canRead: false };
      }
    }
    return { ...stored, value: "***", canRead: false };
  } catch {
    return null;
  }
}

export function saveSharedSecret(namespaceId: string, orgId: string, secret: SharedSecret): void {
  const safe = secret.name.replace(/[^a-zA-Z0-9_-]/g, "_");
  const dir = sharedDir(namespaceId, orgId, "secrets");
  mkdirSync(dir, { recursive: true });
  const { value: _v, ...secretWithoutValue } = secret;
  void _v;
  const stored: StoredSharedSecret = {
    ...secretWithoutValue,
    encryptedValue: encrypt(secret.value),
  };
  writeFileSync(join(dir, `${safe}.json`), JSON.stringify(stored, null, 2), { mode: 0o600 });
}

export function deleteSharedSecret(namespaceId: string, orgId: string, name: string): boolean {
  const safe = name.replace(/[^a-zA-Z0-9_-]/g, "_");
  const p = sharedDir(namespaceId, orgId, "secrets", `${safe}.json`);
  if (!existsSync(p)) return false;
  rmSync(p);
  return true;
}
