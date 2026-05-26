import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from "fs";
import path from "path";
import { orgPath } from "./config";

// ============================================================
// types
// ============================================================

export interface AgentProfile {
  id: string;
  name: string;
  description?: string;
  isDefault: boolean;
  isAdvisorDefault?: boolean;
  cli: string;
  model?: string;
  relay_model?: string;
  pipe_flag?: string;
  permission_flag?: string;
  extra_args?: string[];
  disallowed_tools?: string;
  env?: Record<string, string>;
  pre_exec?: string;
  log_path?: string;
  log_format?: string;
  createdAt: string;
  updatedAt: string;
}

// ============================================================
// paths
// ============================================================

export function getProfilesDir(namespaceId: string, orgId: string): string {
  return orgPath(namespaceId, orgId, "agent-profiles");
}

function getProfileFile(namespaceId: string, orgId: string, id: string): string {
  const dir = getProfilesDir(namespaceId, orgId);
  return path.join(dir, `${id}.json`);
}

// ============================================================
// list
// ============================================================

export function listProfiles(namespaceId: string, orgId: string): AgentProfile[] {
  const dir = getProfilesDir(namespaceId, orgId);
  if (!existsSync(dir)) return [];

  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  const profiles: AgentProfile[] = [];

  for (const file of files) {
    try {
      const filePath = path.join(dir, file);
      const content = readFileSync(filePath, "utf-8");
      const profile = JSON.parse(content) as AgentProfile;
      profiles.push(profile);
    } catch {
      // skip invalid files
    }
  }

  return profiles.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

// ============================================================
// get
// ============================================================

export function getProfile(namespaceId: string, orgId: string, id: string): AgentProfile | null {
  const file = getProfileFile(namespaceId, orgId, id);
  if (!existsSync(file)) return null;

  try {
    const content = readFileSync(file, "utf-8");
    return JSON.parse(content) as AgentProfile;
  } catch {
    return null;
  }
}

// ============================================================
// create
// ============================================================

export function createProfile(
  namespaceId: string,
  orgId: string,
  profile: Omit<AgentProfile, "createdAt" | "updatedAt">
): AgentProfile {
  const now = new Date().toISOString();
  const newProfile: AgentProfile = {
    ...profile,
    createdAt: now,
    updatedAt: now,
  };

  // validate id is slug format
  const idError = validateProfileId(newProfile.id);
  if (idError) {
    throw new Error(idError);
  }

  const dir = getProfilesDir(namespaceId, orgId);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // check if profile already exists
  const existing = getProfile(namespaceId, orgId, newProfile.id);
  if (existing) {
    throw new Error(`Profile '${newProfile.id}' already exists`);
  }

  // if isDefault, clear isDefault on all others
  if (newProfile.isDefault) {
    const allProfiles = listProfiles(namespaceId, orgId);
    for (const p of allProfiles) {
      if (p.isDefault) {
        updateProfile(namespaceId, orgId, p.id, { isDefault: false });
      }
    }
  }

  // advisor default is separate from agent default, but still unique.
  if (newProfile.isAdvisorDefault) {
    const allProfiles = listProfiles(namespaceId, orgId);
    for (const p of allProfiles) {
      if (p.isAdvisorDefault) {
        updateProfile(namespaceId, orgId, p.id, { isAdvisorDefault: false });
      }
    }
  }

  // validate profile before saving
  const validationError = validateProfile(newProfile);
  if (validationError) {
    throw new Error(validationError);
  }

  const file = getProfileFile(namespaceId, orgId, newProfile.id);
  writeFileSync(file, JSON.stringify(newProfile, null, 2));

  return newProfile;
}

// ============================================================
// update
// ============================================================

export function updateProfile(
  namespaceId: string,
  orgId: string,
  id: string,
  updates: Partial<Omit<AgentProfile, "id" | "createdAt">>
): AgentProfile {
  const existing = getProfile(namespaceId, orgId, id);
  if (!existing) {
    throw new Error(`Profile '${id}' not found`);
  }

  const definedUpdates = Object.fromEntries(
    Object.entries(updates).filter(([, value]) => value !== undefined)
  ) as Partial<Omit<AgentProfile, "id" | "createdAt">>;

  // replace env entirely when provided (UI sends the full set of env vars)
  // null values within the object still mean "delete this key" for backwards compat
  let mergedEnv = existing.env || {};
  if (definedUpdates.env !== undefined) {
    mergedEnv = {};
    for (const [key, value] of Object.entries(definedUpdates.env)) {
      if (value !== null) {
        mergedEnv[key] = value;
      }
    }
  }

  const updated: AgentProfile = {
    ...existing,
    ...definedUpdates,
    env: mergedEnv,
    updatedAt: new Date().toISOString(),
  };

  // if setting isDefault=true, clear others
  if (definedUpdates.isDefault === true && !existing.isDefault) {
    const allProfiles = listProfiles(namespaceId, orgId);
    for (const p of allProfiles) {
      if (p.id !== id && p.isDefault) {
        const pFile = getProfileFile(namespaceId, orgId, p.id);
        const pData = JSON.parse(readFileSync(pFile, "utf-8")) as AgentProfile;
        pData.isDefault = false;
        writeFileSync(pFile, JSON.stringify(pData, null, 2));
      }
    }
  }

  // if setting isAdvisorDefault=true, clear others
  if (definedUpdates.isAdvisorDefault === true && !existing.isAdvisorDefault) {
    const allProfiles = listProfiles(namespaceId, orgId);
    for (const p of allProfiles) {
      if (p.id !== id && p.isAdvisorDefault) {
        const pFile = getProfileFile(namespaceId, orgId, p.id);
        const pData = JSON.parse(readFileSync(pFile, "utf-8")) as AgentProfile;
        pData.isAdvisorDefault = false;
        writeFileSync(pFile, JSON.stringify(pData, null, 2));
      }
    }
  }

  const validationError = validateProfile(updated);
  if (validationError) {
    throw new Error(validationError);
  }

  const file = getProfileFile(namespaceId, orgId, id);
  writeFileSync(file, JSON.stringify(updated, null, 2));

  return updated;
}

// ============================================================
// delete
// ============================================================

export function deleteProfile(namespaceId: string, orgId: string, id: string): { promoted?: string } {
  const allProfiles = listProfiles(namespaceId, orgId);
  const target = allProfiles.find((p) => p.id === id);

  if (!target) {
    throw new Error(`Profile '${id}' not found`);
  }

  if (allProfiles.length === 1) {
    throw new Error("Cannot delete the only profile");
  }

  const result: { promoted?: string } = {};

  // if is default, auto-promote oldest by createdAt
  if (target.isDefault) {
    const others = allProfiles.filter((p) => p.id !== id);
    const newDefault = others.sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    updateProfile(namespaceId, orgId, newDefault.id, { isDefault: true });
    result.promoted = newDefault.id;
  }

  const file = getProfileFile(namespaceId, orgId, id);
  unlinkSync(file);

  return result;
}

// ============================================================
// find default
// ============================================================

export function findDefaultProfile(namespaceId: string, orgId: string): AgentProfile | null {
  const profiles = listProfiles(namespaceId, orgId);
  return profiles.find((p) => p.isDefault) || null;
}

export function findAdvisorDefaultProfile(namespaceId: string, orgId: string): AgentProfile | null {
  const profiles = listProfiles(namespaceId, orgId);
  return profiles.find((p) => p.isAdvisorDefault) || null;
}

// ============================================================
// slugify
// ============================================================

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// ============================================================
// validation
// ============================================================

export function validateProfileId(id: string): string | null {
  if (!id) {
    return "ID is required";
  }
  if (id.length > 64) {
    return "ID must be at most 64 characters";
  }
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(id)) {
    return "ID must be lowercase alphanumeric with hyphens, must start and end with alphanumeric";
  }
  return null;
}

export function validateProfile(profile: AgentProfile): string | null {
  if (!profile.name || profile.name.trim().length === 0) {
    return "Name is required";
  }
  if (profile.name.length > 128) {
    return "Name must be at most 128 characters";
  }

  if (!profile.cli || profile.cli.trim().length === 0) {
    return "CLI is required";
  }

  if (profile.model && profile.model.length > 128) {
    return "Model must be at most 128 characters";
  }

  if (profile.pipe_flag && profile.pipe_flag.length > 64) {
    return "Pipe flag must be at most 64 characters";
  }

  if (profile.permission_flag && profile.permission_flag.length > 128) {
    return "Permission flag must be at most 128 characters";
  }

  if (profile.extra_args) {
    for (const arg of profile.extra_args) {
      if (arg.length > 256) {
        return "Extra args must be at most 256 characters each";
      }
    }
  }

  if (profile.pre_exec && profile.pre_exec.length > 8192) {
    return "Pre-exec script must be at most 8192 characters";
  }

  if (profile.env) {
    for (const [key, value] of Object.entries(profile.env)) {
      if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) {
        return `Env key '${key}' must be uppercase alphanumeric with underscores`;
      }
      if (value.length > 2048) {
        return `Env value for '${key}' must be at most 2048 characters`;
      }
    }
  }

  return null;
}
