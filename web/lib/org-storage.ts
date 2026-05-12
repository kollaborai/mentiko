/**
 * organization storage layer
 * reads from sqlite (better-auth tables) when DATABASE_URL is set,
 * falls back to file-based persistence for orgs, members, and invites.
 * writes still go to filesystem (gradual migration).
 */

import { promises as fs } from "fs";
import { join } from "path";
import config from "./config";
import { getDb } from "./auth-server";

// storage paths relative to namespace root
const ORG_DIR = "org";

export interface Org {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
  memberCount?: number;
  settings?: {
    allowMemberInvite?: boolean;
    requireApproval?: boolean;
  };
}

export interface OrgMember {
  id: string;
  orgId: string;
  userId: string;
  email: string;
  role: "owner" | "admin" | "member" | "guest";
  joinedAt: string;
  invitedBy?: string;
}

export interface OrgInvite {
  id: string;
  orgId: string;
  email: string;
  role: "admin" | "member" | "viewer";
  token: string;
  createdAt: string;
  expiresAt: string;
  invitedBy: string;
  status: "pending" | "accepted" | "declined" | "expired" | "cancelled";
}

// ============================================================================
// sqlite readers (better-auth tables -> org-storage interfaces)
// ============================================================================

async function loadOrgFromDB(namespaceId: string): Promise<Org | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    const row = db.prepare(
      `SELECT id, name, slug, "createdAt", metadata FROM organization WHERE slug = ? LIMIT 1`,
    ).get(namespaceId) as Record<string, unknown> | undefined;
    if (!row) return null;
    let settings;
    if (row.metadata) {
      try {
        settings = JSON.parse(row.metadata as string);
      } catch { /* ignore */ }
    }
    return {
      id: row.id as string,
      name: row.name as string,
      slug: row.slug as string,
      createdAt: String(row.createdAt),
      updatedAt: String(row.createdAt),
      settings,
    };
  } catch {
    return null;
  }
}

async function listOrgsFromDB(): Promise<Org[]> {
  const db = await getDb();
  if (!db) return [];
  try {
    const rows = db.prepare(
      `SELECT o.id, o.name, o.slug, o."createdAt", o.metadata,
              COUNT(m.id) AS memberCount
       FROM organization o
       LEFT JOIN member m ON m."organizationId" = o.id
       GROUP BY o.id
       ORDER BY o."createdAt" ASC`,
    ).all() as Record<string, unknown>[];

    return rows.map((row) => {
      let settings;
      if (row.metadata) {
        try {
          settings = JSON.parse(row.metadata as string);
        } catch { /* ignore */ }
      }
      return {
        id: row.id as string,
        name: row.name as string,
        slug: row.slug as string,
        createdAt: String(row.createdAt),
        updatedAt: String(row.createdAt),
        memberCount: Number(row.memberCount || 0),
        settings,
      };
    });
  } catch {
    return [];
  }
}

async function loadMembersFromDB(namespaceId: string): Promise<OrgMember[]> {
  const db = await getDb();
  if (!db) return [];
  try {
    const rows = db.prepare(
      `SELECT m.id, m."organizationId", m."userId", m.role, m."createdAt",
              u.email
       FROM member m
       JOIN "user" u ON m."userId" = u.id
       JOIN organization o ON m."organizationId" = o.id
       WHERE o.slug = ?`,
    ).all(namespaceId) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as string,
      orgId: r.organizationId as string,
      userId: r.userId as string,
      email: r.email as string,
      role: ((r.role as string) || "member") as OrgMember["role"],
      joinedAt: String(r.createdAt),
    }));
  } catch {
    return [];
  }
}

function mapDbInvitationStatus(raw: string | undefined): OrgInvite["status"] {
  switch (raw) {
    case "pending":
      return "pending";
    case "accepted":
      return "accepted";
    case "rejected":
      return "declined";
    case "canceled":
      return "cancelled";
    default:
      return "pending";
  }
}

function mapDbInvitationRole(raw: string | undefined): OrgInvite["role"] {
  if (raw === "admin" || raw === "owner") return "admin";
  if (raw === "viewer" || raw === "guest") return "viewer";
  return "member";
}

async function loadInvitesFromDB(namespaceId: string): Promise<OrgInvite[]> {
  const db = await getDb();
  if (!db) return [];
  try {
    const rows = db.prepare(
      `SELECT i.id, i."organizationId", i.email, i.role, i.status,
              i."expiresAt", i."inviterId", i."createdAt"
       FROM invitation i
       JOIN organization o ON i."organizationId" = o.id
       WHERE o.slug = ?`,
    ).all(namespaceId) as Record<string, unknown>[];
    return rows.map((r) => {
      const id = r.id as string;
      return {
        id,
        orgId: r.organizationId as string,
        email: (r.email as string).toLowerCase(),
        role: mapDbInvitationRole(r.role as string | undefined),
        // better-auth invitation has no separate token column — invite links use row id
        token: id,
        createdAt: r.createdAt != null ? String(r.createdAt) : "",
        expiresAt: String(r.expiresAt),
        invitedBy: (r.inviterId as string) || "",
        status: mapDbInvitationStatus(r.status as string | undefined),
      };
    });
  } catch {
    return [];
  }
}

/** union DB (better-auth) + filesystem invites; last wins on duplicate token */
function mergeInviteSources(dbInvites: OrgInvite[], fsInvites: OrgInvite[]): OrgInvite[] {
  const byToken = new Map<string, OrgInvite>();
  for (const inv of dbInvites) {
    const key = inv.token || inv.id;
    if (key) byToken.set(key, inv);
  }
  for (const inv of fsInvites) {
    const key = inv.token || inv.id;
    if (key) byToken.set(key, inv);
  }
  return [...byToken.values()];
}

// ============================================================================
// filesystem helpers (original implementation)
// ============================================================================

function getOrgDir(namespaceId: string): string {
  const namespaceRoot = join(config.namespacesBase, namespaceId);
  return join(namespaceRoot, ORG_DIR);
}

function getOrgPath(namespaceId: string): string {
  return join(getOrgDir(namespaceId), "org.json");
}

function getOrgsDir(namespaceId: string): string {
  const namespaceRoot = join(config.namespacesBase, namespaceId);
  return join(namespaceRoot, "orgs");
}

function getOrgRecordPath(namespaceId: string, orgId: string): string {
  return join(getOrgsDir(namespaceId), `${orgId}.json`);
}

function getMembersPath(namespaceId: string): string {
  return join(getOrgDir(namespaceId), "members.json");
}

function getInvitesPath(namespaceId: string): string {
  return join(getOrgDir(namespaceId), "invites.json");
}

async function ensureDir(namespaceId: string): Promise<void> {
  const dir = getOrgDir(namespaceId);
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch {
    // ignore if already exists
  }
}

async function loadOrgFromFS(namespaceId: string): Promise<Org | null> {
  const path = getOrgPath(namespaceId);
  try {
    const data = await fs.readFile(path, "utf-8");
    return JSON.parse(data) as Org;
  } catch {
    return null;
  }
}

async function listOrgsFromFS(namespaceId: string): Promise<Org[]> {
  const orgs = new Map<string, Org>();
  const legacyOrg = await loadOrgFromFS(namespaceId);
  if (legacyOrg) {
    orgs.set(legacyOrg.id, legacyOrg);
  }

  try {
    const dir = getOrgsDir(namespaceId);
    const entries = await fs.readdir(dir);
    await Promise.all(entries.map(async (entry) => {
      if (!entry.endsWith(".json")) return;
      try {
        const raw = await fs.readFile(join(dir, entry), "utf-8");
        const org = JSON.parse(raw) as Org;
        orgs.set(org.id, org);
      } catch {
        // ignore malformed org records
      }
    }));
  } catch {
    // no multi-org directory yet
  }

  return [...orgs.values()].sort((a, b) => (
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  ));
}

async function loadMembersFromFS(namespaceId: string): Promise<OrgMember[]> {
  const path = getMembersPath(namespaceId);
  try {
    const data = await fs.readFile(path, "utf-8");
    return JSON.parse(data) as OrgMember[];
  } catch {
    return [];
  }
}

async function loadInvitesFromFS(namespaceId: string): Promise<OrgInvite[]> {
  const path = getInvitesPath(namespaceId);
  try {
    const data = await fs.readFile(path, "utf-8");
    return JSON.parse(data) as OrgInvite[];
  } catch {
    return [];
  }
}

// ============================================================================
// public API: sqlite first, fallback to filesystem
// ============================================================================

export async function loadOrg(namespaceId: string): Promise<Org | null> {
  const dbOrg = await loadOrgFromDB(namespaceId);
  if (dbOrg) return dbOrg;
  return loadOrgFromFS(namespaceId);
}

export async function listOrgs(namespaceId: string): Promise<Org[]> {
  const dbOrgs = await listOrgsFromDB();
  const fsOrgs = await listOrgsFromFS(namespaceId);
  const orgs = new Map<string, Org>();
  for (const org of dbOrgs) orgs.set(org.id, org);
  for (const org of fsOrgs) orgs.set(org.id, org);
  return [...orgs.values()].sort((a, b) => (
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  ));
}

export async function loadOrgById(namespaceId: string, id: string): Promise<Org | null> {
  const orgs = await listOrgs(namespaceId);
  return orgs.find((org) => orgMatchesId(org, id)) ?? null;
}

/** check if an org matches a given identifier (UUID or slug) */
export function orgMatchesId(org: Org, id: string): boolean {
  return org.id === id || org.slug === id;
}

export async function saveOrg(namespaceId: string, org: Org): Promise<void> {
  await ensureDir(namespaceId);
  org.updatedAt = new Date().toISOString();
  const path = getOrgPath(namespaceId);
  await fs.writeFile(path, JSON.stringify(org, null, 2));
  await fs.mkdir(getOrgsDir(namespaceId), { recursive: true });
  await fs.writeFile(getOrgRecordPath(namespaceId, org.id), JSON.stringify(org, null, 2));
}

export async function createOrg(namespaceId: string, org: Org): Promise<void> {
  await ensureDir(namespaceId);
  org.updatedAt = new Date().toISOString();
  await fs.mkdir(getOrgsDir(namespaceId), { recursive: true });
  await fs.writeFile(getOrgRecordPath(namespaceId, org.id), JSON.stringify(org, null, 2));
}

export async function deleteOrg(namespaceId: string, org: Org): Promise<void> {
  try {
    await fs.unlink(getOrgRecordPath(namespaceId, org.id));
  } catch {
    // ignore missing multi-org record
  }

  const legacyOrg = await loadOrgFromFS(namespaceId);
  if (legacyOrg && orgMatchesId(legacyOrg, org.id)) {
    try {
      await fs.unlink(getOrgPath(namespaceId));
    } catch {
      // ignore missing legacy record
    }
  }
}

export async function loadMembers(namespaceId: string): Promise<OrgMember[]> {
  const dbMembers = await loadMembersFromDB(namespaceId);
  if (dbMembers.length > 0) return dbMembers;
  return loadMembersFromFS(namespaceId);
}

export async function saveMembers(
  namespaceId: string,
  members: OrgMember[]
): Promise<void> {
  await ensureDir(namespaceId);
  const path = getMembersPath(namespaceId);
  await fs.writeFile(path, JSON.stringify(members, null, 2));
}

export async function loadInvites(namespaceId: string): Promise<OrgInvite[]> {
  const dbInvites = await loadInvitesFromDB(namespaceId);
  const fsInvites = await loadInvitesFromFS(namespaceId);
  if (dbInvites.length === 0) return fsInvites;
  if (fsInvites.length === 0) return dbInvites;
  return mergeInviteSources(dbInvites, fsInvites);
}

export async function saveInvites(
  namespaceId: string,
  invites: OrgInvite[]
): Promise<void> {
  await ensureDir(namespaceId);
  const path = getInvitesPath(namespaceId);
  await fs.writeFile(path, JSON.stringify(invites, null, 2));
}
