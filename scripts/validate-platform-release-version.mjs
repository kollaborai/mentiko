#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const releaseTag = process.env.GITHUB_REF_TYPE === "tag"
  ? process.env.GITHUB_REF_NAME
  : "";

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function parseStableTag(tag) {
  const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag);
  if (!match) return null;
  return {
    tag,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function compareSemver(a, b) {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

function isPatchIncrement(previous, next) {
  return previous.major === next.major &&
    previous.minor === next.minor &&
    next.patch === previous.patch + 1;
}

function readRepoFile(path) {
  return readFileSync(join(repoRoot, path), "utf8");
}

if (!releaseTag) {
  console.log("platform release guard: non-tag build, skipping semver guard");
  process.exit(0);
}

const current = parseStableTag(releaseTag);
if (!current) {
  fail(`platform releases must use strict vX.Y.Z tags, got ${releaseTag}`);
}

const packageJson = JSON.parse(readRepoFile("web/package.json"));
if (packageJson.version !== releaseTag.slice(1)) {
  fail(`web/package.json version must be ${releaseTag.slice(1)}, got ${packageJson.version}`);
}

const releasesSource = readRepoFile("web/lib/releases.ts");
const releaseMatches = [...releasesSource.matchAll(/version:\s*"([^"]+)"/g)];
const latestRelease = releaseMatches[0]?.[1] ?? "";
if (latestRelease !== releaseTag) {
  fail(`web/lib/releases.ts latest release must be ${releaseTag}, got ${latestRelease || "none"}`);
}

const strictTags = execFileSync(
  "git",
  ["tag", "--list", "v[0-9]*.[0-9]*.[0-9]*"],
  { cwd: repoRoot, encoding: "utf8" },
)
  .split("\n")
  .map((tag) => parseStableTag(tag.trim()))
  .filter(Boolean)
  .filter((tag) => tag.tag !== releaseTag)
  .sort(compareSemver);

const previous = strictTags.at(-1);
if (previous && !isPatchIncrement(previous, current)) {
  fail(`platform release must increment ${previous.tag} by 0.0.1, got ${releaseTag}`);
}

console.log(`platform release guard: ${releaseTag} is a strict patch release`);
