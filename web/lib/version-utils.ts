/**
 * semver utilities for chain versioning
 * format: MAJOR.MINOR.PATCH (e.g., 1.0.0)
 * - MAJOR: breaking changes to agent structure or config schema
 * - MINOR: new features, new agents, new non-breaking fields
 * - PATCH: bug fixes, small tweaks, prompt changes
 */

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

export function parseSemVer(version: string): SemVer | null {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
  };
}

export function formatSemVer(ver: SemVer): string {
  return `${ver.major}.${ver.minor}.${ver.patch}`;
}

export function incrementPatch(version: string): string {
  const ver = parseSemVer(version);
  if (!ver) return "1.0.0";
  return formatSemVer({ ...ver, patch: ver.patch + 1 });
}

export function incrementMinor(version: string): string {
  const ver = parseSemVer(version);
  if (!ver) return "1.0.0";
  return formatSemVer({ ...ver, minor: ver.minor + 1, patch: 0 });
}

export function incrementMajor(version: string): string {
  const ver = parseSemVer(version);
  if (!ver) return "1.0.0";
  return formatSemVer({ ...ver, major: ver.major + 1, minor: 0, patch: 0 });
}

export function isValidSemVer(version: string): boolean {
  return parseSemVer(version) !== null;
}

export function getDefaultVersion(): string {
  return "1.0.0";
}
