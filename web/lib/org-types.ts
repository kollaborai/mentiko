// organization types for multi-namespace SaaS
import type { ValidationResult } from "./validators";

// ----------------------------------------------------------------------------
// ROLE TYPES
// ----------------------------------------------------------------------------

export type OrgRole = "owner" | "admin" | "member" | "guest";

export const ORG_ROLE_HIERARCHY: Record<OrgRole, number> = {
  owner: 4,
  admin: 3,
  member: 2,
  guest: 1,
};

export const ORG_ROLE_LABELS: Record<OrgRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
  guest: "Guest",
};

export function canRolePerformAction(role: OrgRole, action: OrgAction): boolean {
  const permissions: Record<OrgAction, number> = {
    manage_org: 4,
    manage_members: 3,
    manage_chains: 2,
    manage_tasks: 2,
    view_chains: 1,
    view_tasks: 1,
    view_audit: 3,
    invite_members: 3,
    remove_members: 4,
    transfer_ownership: 4,
    manage_billing: 3,  // owner + admin
  };
  return ORG_ROLE_HIERARCHY[role] >= permissions[action];
}

export type OrgAction =
  | "manage_org"
  | "manage_members"
  | "manage_chains"
  | "manage_tasks"
  | "view_chains"
  | "view_tasks"
  | "view_audit"
  | "invite_members"
  | "remove_members"
  | "transfer_ownership"
  | "manage_billing";

// ----------------------------------------------------------------------------
// SETTINGS TYPES
// ----------------------------------------------------------------------------

export interface OrgSettings {
  defaultChainExecutor?: string;
  defaultModelProfile?: string;
  timezone?: string;
  theme?: "light" | "dark" | "system";
  notifications: {
    enabled: boolean;
    emailOnComplete: boolean;
    emailOnError: boolean;
    webhookUrl?: string;
  };
  security: {
    require2fa: boolean;
    allowedDomains?: string[];
    ipWhitelist?: string[];
  };
  retention: {
    daysToKeepRuns: number;
    daysToKeepEvents: number;
  };
  email?: {
    // per-namespace send quota override (default: EMAIL_SEND_QUOTA_PER_DAY env)
    sendQuotaPerDay?: number;
    // per-namespace disk quota override in MB (default: EMAIL_DISK_QUOTA_MB env)
    diskQuotaMb?: number;
    // bounce notice: doc gap for v1 - bounces logged, no auto-processing until Phase 2
    bounceWebhookUrl?: string;
  };
  // physical mailing address (required for bulk email per CAN-SPAM)
  physicalAddress?: string;
}

export const DEFAULT_ORG_SETTINGS: OrgSettings = {
  defaultChainExecutor: "claude-code",
  timezone: "UTC",
  theme: "system",
  notifications: {
    enabled: true,
    emailOnComplete: false,
    emailOnError: true,
  },
  security: {
    require2fa: false,
  },
  retention: {
    daysToKeepRuns: 30,
    daysToKeepEvents: 7,
  },
};

// ----------------------------------------------------------------------------
// CORE ORG TYPES
// ----------------------------------------------------------------------------

export interface Org {
  id: string;
  name: string;
  slug: string;
  settings?: OrgSettings;
  createdAt: string;
  updatedAt: string;
}

export interface OrgMember {
  userId: string;
  email: string;
  role: OrgRole;
  joinedAt: string;
  invitedBy?: string;
}

export interface OrgInvite {
  id: string;
  email: string;
  role: OrgRole;
  token: string;
  expiresAt: string;
  invitedBy: string;
  createdAt: string;
  acceptedAt?: string;
}

// ----------------------------------------------------------------------------
// LIST/REQUEST TYPES
// ----------------------------------------------------------------------------

export interface OrgListItem {
  id: string;
  name: string;
  slug: string;
  memberCount: number;
  chainCount: number;
  taskCount: number;
  createdAt: string;
}

export interface OrgWithMembers extends Org {
  members: OrgMember[];
  pendingInvites: OrgInvite[];
}

// ----------------------------------------------------------------------------
// TYPE GUARDS
// ----------------------------------------------------------------------------

export function isOrgRole(value: unknown): value is OrgRole {
  return typeof value === "string" && ["owner", "admin", "member", "guest"].includes(value);
}

export function isOrg(value: unknown): value is Org {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.name === "string" &&
    typeof o.slug === "string" &&
    typeof o.createdAt === "string" &&
    typeof o.updatedAt === "string"
  );
}

export function isOrgMember(value: unknown): value is OrgMember {
  if (!value || typeof value !== "object") return false;
  const m = value as Record<string, unknown>;
  return (
    typeof m.userId === "string" &&
    typeof m.email === "string" &&
    isOrgRole(m.role) &&
    typeof m.joinedAt === "string"
  );
}

export function isOrgInvite(value: unknown): value is OrgInvite {
  if (!value || typeof value !== "object") return false;
  const i = value as Record<string, unknown>;
  return (
    typeof i.id === "string" &&
    typeof i.email === "string" &&
    isOrgRole(i.role) &&
    typeof i.token === "string" &&
    typeof i.expiresAt === "string" &&
    typeof i.invitedBy === "string" &&
    typeof i.createdAt === "string"
  );
}

export function isValidSlug(value: unknown): boolean {
  if (typeof value !== "string") return false;
  // slug: lowercase alphanumeric, hyphens, 3-39 chars, must start with letter
  return /^[a-z][a-z0-9-]{2,38}$/.test(value);
}

// ----------------------------------------------------------------------------
// VALIDATION FUNCTIONS
// ----------------------------------------------------------------------------

function collect(errors: string[], field: string, msg: string): void {
  errors.push(`${field}: ${msg}`);
}

function requiredString(value: unknown, field: string, errors: string[]): void {
  if (!value || typeof value !== "string" || !value.trim()) {
    collect(errors, field, "required and must be non-empty");
  }
}

export function validateOrgSlug(slug: unknown): ValidationResult {
  const errors: string[] = [];

  if (typeof slug !== "string") {
    collect(errors, "slug", "must be a string");
    return { valid: false, errors };
  }

  if (!slug) {
    collect(errors, "slug", "required");
    return { valid: false, errors };
  }

  if (!isValidSlug(slug)) {
    collect(errors, "slug", "must be 3-39 chars, start with letter, lowercase alphanumeric and hyphens only");
  }

  return { valid: errors.length === 0, errors };
}

export function validateOrgRole(role: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isOrgRole(role)) {
    collect(errors, "role", "must be one of: owner, admin, member, guest");
  }

  return { valid: errors.length === 0, errors };
}

export function validateOrgSettings(settings: unknown): ValidationResult {
  const errors: string[] = [];

  if (!settings || typeof settings !== "object") {
    return { valid: false, errors: ["settings: must be an object"] };
  }

  const s = settings as Record<string, unknown>;

  // defaultChainExecutor: optional string
  if (s.defaultChainExecutor !== undefined && typeof s.defaultChainExecutor !== "string") {
    collect(errors, "defaultChainExecutor", "must be a string");
  }

  // timezone: optional, validate if present
  if (s.timezone !== undefined) {
    if (typeof s.timezone !== "string") {
      collect(errors, "timezone", "must be a string");
    } else {
      try {
        Intl.DateTimeFormat(undefined, { timeZone: s.timezone });
      } catch {
        collect(errors, "timezone", "invalid timezone (e.g., 'America/New_York')");
      }
    }
  }

  // theme: optional enum
  if (s.theme !== undefined) {
    const valid = ["light", "dark", "system"];
    if (!valid.includes(s.theme as string)) {
      collect(errors, "theme", `must be one of: ${valid.join(", ")}`);
    }
  }

  // notifications: optional object
  if (s.notifications !== undefined) {
    if (typeof s.notifications !== "object" || s.notifications === null) {
      collect(errors, "notifications", "must be an object");
    } else {
      const n = s.notifications as Record<string, unknown>;
      if (n.enabled !== undefined && typeof n.enabled !== "boolean") {
        collect(errors, "notifications.enabled", "must be boolean");
      }
      if (n.emailOnComplete !== undefined && typeof n.emailOnComplete !== "boolean") {
        collect(errors, "notifications.emailOnComplete", "must be boolean");
      }
      if (n.emailOnError !== undefined && typeof n.emailOnError !== "boolean") {
        collect(errors, "notifications.emailOnError", "must be boolean");
      }
      if (n.webhookUrl !== undefined && typeof n.webhookUrl !== "string") {
        collect(errors, "notifications.webhookUrl", "must be a string");
      }
    }
  }

  // security: optional object
  if (s.security !== undefined) {
    if (typeof s.security !== "object" || s.security === null) {
      collect(errors, "security", "must be an object");
    } else {
      const sec = s.security as Record<string, unknown>;
      if (sec.require2fa !== undefined && typeof sec.require2fa !== "boolean") {
        collect(errors, "security.require2fa", "must be boolean");
      }
      if (sec.allowedDomains !== undefined && !Array.isArray(sec.allowedDomains)) {
        collect(errors, "security.allowedDomains", "must be an array");
      }
      if (sec.ipWhitelist !== undefined && !Array.isArray(sec.ipWhitelist)) {
        collect(errors, "security.ipWhitelist", "must be an array");
      }
    }
  }

  // retention: optional object
  if (s.retention !== undefined) {
    if (typeof s.retention !== "object" || s.retention === null) {
      collect(errors, "retention", "must be an object");
    } else {
      const r = s.retention as Record<string, unknown>;
      if (typeof r.daysToKeepRuns !== "number" || r.daysToKeepRuns < 0) {
        collect(errors, "retention.daysToKeepRuns", "must be a number >= 0");
      }
      if (typeof r.daysToKeepEvents !== "number" || r.daysToKeepEvents < 0) {
        collect(errors, "retention.daysToKeepEvents", "must be a number >= 0");
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export function validateOrg(org: unknown): ValidationResult {
  const errors: string[] = [];

  if (!org || typeof org !== "object") {
    return { valid: false, errors: ["org: must be an object"] };
  }

  const o = org as Record<string, unknown>;

  // id: required
  requiredString(o.id, "id", errors);

  // name: required, 1-100 chars
  if (typeof o.name !== "string") {
    collect(errors, "name", "required and must be a string");
  } else if (o.name.length < 1 || o.name.length > 100) {
    collect(errors, "name", "must be 1-100 characters");
  }

  // slug: required, validate format
  const slugResult = validateOrgSlug(o.slug);
  errors.push(...slugResult.errors);

  // createdAt: required iso date
  requiredString(o.createdAt, "createdAt", errors);
  if (o.createdAt && isNaN(Date.parse(o.createdAt as string))) {
    collect(errors, "createdAt", "must be a valid ISO date");
  }

  // updatedAt: required iso date
  requiredString(o.updatedAt, "updatedAt", errors);
  if (o.updatedAt && isNaN(Date.parse(o.updatedAt as string))) {
    collect(errors, "updatedAt", "must be a valid ISO date");
  }

  // settings: optional, validate if present
  if (o.settings !== undefined) {
    const settingsResult = validateOrgSettings(o.settings);
    errors.push(...settingsResult.errors);
  }

  return { valid: errors.length === 0, errors };
}

export function validateOrgMember(member: unknown): ValidationResult {
  const errors: string[] = [];

  if (!member || typeof member !== "object") {
    return { valid: false, errors: ["member: must be an object"] };
  }

  const m = member as Record<string, unknown>;

  // userId: required
  requiredString(m.userId, "userId", errors);

  // email: required, valid format
  if (typeof m.email !== "string") {
    collect(errors, "email", "required and must be a string");
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.email)) {
    collect(errors, "email", "invalid email format");
  }

  // role: required
  const roleResult = validateOrgRole(m.role);
  errors.push(...roleResult.errors);

  // joinedAt: required iso date
  requiredString(m.joinedAt, "joinedAt", errors);
  if (m.joinedAt && isNaN(Date.parse(m.joinedAt as string))) {
    collect(errors, "joinedAt", "must be a valid ISO date");
  }

  return { valid: errors.length === 0, errors };
}

export function validateOrgInvite(invite: unknown): ValidationResult {
  const errors: string[] = [];

  if (!invite || typeof invite !== "object") {
    return { valid: false, errors: ["invite: must be an object"] };
  }

  const i = invite as Record<string, unknown>;

  // id: required
  requiredString(i.id, "id", errors);

  // email: required, valid format
  if (typeof i.email !== "string") {
    collect(errors, "email", "required and must be a string");
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(i.email)) {
    collect(errors, "email", "invalid email format");
  }

  // role: required
  const roleResult = validateOrgRole(i.role);
  errors.push(...roleResult.errors);

  // token: required (non-empty string)
  requiredString(i.token, "token", errors);

  // expiresAt: required, future date
  requiredString(i.expiresAt, "expiresAt", errors);
  if (i.expiresAt && isNaN(Date.parse(i.expiresAt as string))) {
    collect(errors, "expiresAt", "must be a valid ISO date");
  } else if (i.expiresAt && new Date(i.expiresAt as string) < new Date()) {
    collect(errors, "expiresAt", "must be a future date");
  }

  // invitedBy: required
  requiredString(i.invitedBy, "invitedBy", errors);

  // createdAt: required
  requiredString(i.createdAt, "createdAt", errors);

  // acceptedAt: optional, must be valid iso date if present
  if (i.acceptedAt !== undefined && i.acceptedAt !== null) {
    if (typeof i.acceptedAt !== "string") {
      collect(errors, "acceptedAt", "must be a string");
    } else if (isNaN(Date.parse(i.acceptedAt))) {
      collect(errors, "acceptedAt", "must be a valid ISO date");
    }
  }

  return { valid: errors.length === 0, errors };
}
