import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { parseAiJsonOutput } from "../../../lib/job-runner-output-parser.mjs";
import { isPayloadCompatibleWithKind, normalizeResultForKind } from "@/lib/generation/payload-contract";

const CAPTURE_ARTIFACT_RE = /-(profile|conversations|events|files-changed|summary|started-at|git-before)\.json$/;

export interface ResolvedGenerationPayload {
  result: Record<string, unknown>;
  source: string;
}

export function isGenerationPayloadAlias(path: string): boolean {
  const name = basename(path);
  return name === "generation-result.json" || name.endsWith("-generation-result.json") || name.endsWith("-output.json") || name.endsWith("-result.json");
}

/**
 * Resolve only the run's owned artifact directory, event handoff, and the
 * transcript locations recorded by typed activity capture. Arbitrary caller
 * paths never become file reads.
 */
export function resolveGenerationPayload(
  explicitPath: string,
  artifactsDir: string,
  kind = "",
  eventData = process.env.MENTIKO_COMPLETION_EVENT_DATA ?? "",
): ResolvedGenerationPayload | null {
  const root = canonicalArtifactRoot(artifactsDir);
  const canonical = explicitPath ? artifactPath(root, explicitPath) : ownedArtifactFile(root, "generation-result.json");
  const direct = canonical ? readJsonRecord(canonical) : null;
  if (canonical && direct && isPayloadCompatibleWithKind(direct, kind)) return { result: direct, source: canonical };

  for (const name of readdirSafe(root)) {
    if (!name.endsWith(".json") || name === "generation-result.json" || CAPTURE_ARTIFACT_RE.test(name) || !isGenerationPayloadAlias(name)) continue;
    const source = ownedArtifactFile(root, name);
    if (!source) continue;
    const candidate = readJsonRecord(source);
    if (candidate && isPayloadCompatibleWithKind(candidate, kind)) return { result: candidate, source };
  }

  if (eventData.trim()) {
    const candidate = parseJsonValue(eventData);
    if (isRecord(candidate) && isPayloadCompatibleWithKind(candidate, kind)) return { result: candidate, source: "event-data" };
  }

  const transcript = resolveFromTranscript(root, kind);
  if (transcript) return transcript;

  for (const name of readdirSafe(root)) {
    if (!name.endsWith("-output.txt")) continue;
    const source = ownedArtifactFile(root, name);
    if (!source) continue;
    const candidate = parseAiJsonOutput(readFileSafe(source));
    if (isPayloadCompatibleWithKind(candidate, kind)) return { result: candidate, source };
  }
  return null;
}

function resolveFromTranscript(artifactsDir: string, kind: string): ResolvedGenerationPayload | null {
  for (const name of readdirSafe(artifactsDir)) {
    if (!name.endsWith("-conversations.json")) continue;
    const manifest = ownedArtifactFile(artifactsDir, name);
    if (!manifest) continue;
    const entries = parseJsonValue(readFileSafe(manifest));
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      const path = isRecord(entry) && typeof entry.path === "string" ? entry.path : "";
      if (!path || !isAbsolute(path) || !path.endsWith(".jsonl") || !existsSync(path) || lstatSync(path).isSymbolicLink()) continue;
      const result = scanTranscriptJsonl(realpathSync(path), kind);
      if (result) return { result, source: path };
    }
  }
  return null;
}

function scanTranscriptJsonl(path: string, kind: string): Record<string, unknown> | null {
  let last: Record<string, unknown> | null = null;
  for (const line of readFileSafe(path).split("\n")) {
    const event = parseJsonValue(line);
    const message = isRecord(event) && isRecord(event.message) ? event.message : undefined;
    const content = message && Array.isArray(message.content) ? message.content : [];
    for (const block of content) {
      if (!isRecord(block)) continue;
      const text = block.type === "text" && typeof block.text === "string"
        ? block.text
        : block.type === "tool_use" && isRecord(block.input) && isGenerationPayloadAlias(String(block.input.file_path ?? block.input.path ?? "")) && typeof block.input.content === "string"
          ? block.input.content
          : "";
      const result = text ? parseAiJsonOutput(text) : null;
      if (isPayloadCompatibleWithKind(result, kind)) last = result;
    }
  }
  return last;
}

function canonicalArtifactRoot(artifactsDir: string): string {
  if (!artifactsDir || !isAbsolute(artifactsDir) || !existsSync(artifactsDir)) throw new Error("ARTIFACTS_DIR must be an existing absolute run artifact directory.");
  const root = realpathSync(artifactsDir);
  if (!lstatSync(root).isDirectory()) throw new Error("ARTIFACTS_DIR must be a directory.");
  return root;
}

function artifactPath(root: string, path: string): string {
  if (!isAbsolute(path)) throw new Error("Generation artifact path must be absolute.");
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error("Generation artifact path must not be a symbolic link.");
  const resolved = existsSync(path) ? realpathSync(path) : resolve(path);
  const rel = relative(root, resolved);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error("Generation artifact path must resolve beneath ARTIFACTS_DIR.");
  return resolved;
}

function ownedArtifactFile(root: string, name: string): string | null {
  if (basename(name) !== name) return null;
  const path = join(root, name);
  if (!existsSync(path) || lstatSync(path).isSymbolicLink() || !lstatSync(path).isFile()) return null;
  const resolved = realpathSync(path);
  const rel = relative(root, resolved);
  return rel && !rel.startsWith("..") && !isAbsolute(rel) ? resolved : null;
}

function readdirSafe(path: string): string[] { try { return readdirSync(path); } catch { return []; } }
function readFileSafe(path: string): string { try { return readFileSync(path, "utf8"); } catch { return ""; } }
function readJsonRecord(path: string): Record<string, unknown> | null { const value = parseJsonValue(readFileSafe(path)); return isRecord(value) ? value : null; }
function parseJsonValue(content: string): unknown { try { return JSON.parse(content) as unknown; } catch { return null; } }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }

export { normalizeResultForKind };
