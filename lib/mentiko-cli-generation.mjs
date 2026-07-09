#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { parseAiJsonOutput } from "./job-runner-output-parser.mjs";

// Kind-aware payload contract — the SINGLE source of truth, shared with the
// in-process auto-run consumer (web/lib/runs/job-store.ts + auto-run/route.ts)
// so the two doors can never drift. It lives under web/lib/ so the Next
// standalone build traces it natively; the Dockerfile assemble step flattens
// web/lib/ into /opt/mentiko/lib/ (Dockerfile ~L80-81), so at tenant runtime the
// contract is a sibling of this CLI, while in the dev checkout it sits at
// ../web/lib/. Resolve whichever path exists.
const contractUrl =
  [
    new URL("./generation/payload-contract.mjs", import.meta.url),
    new URL("../web/lib/generation/payload-contract.mjs", import.meta.url),
  ].find((candidate) => existsSync(candidate)) ??
  new URL("./generation/payload-contract.mjs", import.meta.url);
const { isPayloadCompatibleWithKind, normalizeResultForKind } = await import(contractUrl.href);

const args = process.argv.slice(2);

// Artifacts written by the orchestration's activity capture (chain-runner-complete.sh /
// agent-activity-capture.sh) -- these are NOT the agent's generation payload, so the
// salvage scan must skip them when globbing the artifacts dir for a stray *.json.
const CAPTURE_ARTIFACT_RE =
  /-(profile|conversations|events|files-changed|summary|started-at|git-before)\.json$/;

function isGenerationPayloadAlias(path) {
  const name = basename(path || "");
  return (
    name === "generation-result.json" ||
    name.endsWith("-generation-result.json") ||
    name.endsWith("-output.json") ||
    name.endsWith("-result.json")
  );
}

// isPayloadCompatibleWithKind is imported from the shared payload contract above.

function tryParseJsonFile(path) {
  try {
    const obj = JSON.parse(readFileSync(path, "utf8"));
    return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : null;
  } catch {
    return null;
  }
}

// Scan an agent session transcript (JSONL) for the last JSON object the agent produced.
// This is the CONVERGENCE source: it sits upstream of every handoff fumble (wrong filename,
// malformed emit, terminal-only output) because it's the agent's actual turn output. We pull
// both `text` blocks (agent printed the JSON) and `tool_use` inputs (agent wrote it to a
// file), run them through the same parser, and keep the LAST match. Claude format by default;
// unexpected shapes just yield nothing and fall through to the remaining sources.
function scanTranscriptJsonl(jsonlPath, kind = "") {
  let raw;
  try {
    raw = readFileSync(jsonlPath, "utf8");
  } catch {
    return null;
  }
  let last = null;
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    const content = ev && ev.message && Array.isArray(ev.message.content) ? ev.message.content : null;
    if (!content) continue;
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      // Gather candidate text. Text blocks may contain the final JSON directly. Tool calls
      // are accepted only when they write/edit a known generation result filename; shell
      // commands and schemas often contain unrelated JSON examples.
      const texts = [];
      if (block.type === "text" && typeof block.text === "string") {
        texts.push(block.text);
      } else if (block.type === "tool_use" && block.input && typeof block.input === "object") {
        const input = block.input;
        const targetPath =
          typeof input.file_path === "string" ? input.file_path :
          typeof input.path === "string" ? input.path :
          "";
        if (isGenerationPayloadAlias(targetPath) && typeof input.content === "string") {
          texts.push(input.content);
        }
      }
      for (const text of texts) {
        const obj = parseAiJsonOutput(text);
        if (isPayloadCompatibleWithKind(obj, kind)) last = obj; // keep last
      }
    }
  }
  return last;
}

// Resolve the transcript path(s) from <agent>-conversations.json (written by activity capture)
// and scan them for the payload.
function resolveFromTranscript(artifactsDir, kind = "") {
  let convFiles = [];
  try {
    convFiles = readdirSync(artifactsDir).filter((f) => f.endsWith("-conversations.json"));
  } catch {
    return null;
  }
  for (const cf of convFiles) {
    let entries;
    try {
      entries = JSON.parse(readFileSync(join(artifactsDir, cf), "utf8"));
    } catch {
      continue;
    }
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      const jsonlPath = entry && typeof entry === "object" ? entry.path : null;
      if (!jsonlPath || !existsSync(jsonlPath)) continue;
      const obj = scanTranscriptJsonl(jsonlPath, kind);
      if (obj) return { result: obj, source: jsonlPath };
    }
  }
  return null;
}

/**
 * Resolve the generation payload object.
 *
 * LLM agents are unreliable about WHERE they leave the payload. Observed in the wild:
 *   - $ARTIFACTS_DIR/generation-result.json   (as instructed)
 *   - $ARTIFACTS_DIR/<agent>-output.json       (agent inferred the dir's naming convention)
 *   - the completion event's `data:` field     (agent hand-wrote/emitted the event with data)
 *   - only the agent's terminal output          (agent printed it, wrote nothing)
 * The orchestration backstop runs this import on EVERY generation-chain completion, so we
 * salvage from whichever source actually holds the clean JSON. Priority favors clean files
 * and event data over scraping the ANSI-laden PTY capture.
 */
function resolveGenerationPayload(explicitPath, artifactsDir, kind = "") {
  // 1. explicit positional arg, or the canonical generation-result.json
  const canonical =
    explicitPath || (artifactsDir ? join(artifactsDir, "generation-result.json") : "");
  if (canonical && existsSync(canonical)) {
    const obj = tryParseJsonFile(canonical);
    if (isPayloadCompatibleWithKind(obj, kind)) return { result: obj, source: canonical };
  }

  // 2. known generation-result aliases in artifacts dir (skip capture/scratch artifacts)
  if (artifactsDir && existsSync(artifactsDir)) {
    let entries = [];
    try {
      entries = readdirSync(artifactsDir);
    } catch {
      entries = [];
    }
    const candidates = entries.filter(
      (f) =>
        f.endsWith(".json") &&
        f !== "generation-result.json" &&
        !CAPTURE_ARTIFACT_RE.test(f) &&
        isGenerationPayloadAlias(f)
    );
    for (const f of candidates) {
      const obj = tryParseJsonFile(join(artifactsDir, f));
      if (isPayloadCompatibleWithKind(obj, kind)) return { result: obj, source: join(artifactsDir, f) };
    }
  }

  // 3. completion event `data:` field, forwarded by the orchestration backstop via env
  const eventData = (process.env.MENTIKO_COMPLETION_EVENT_DATA || "").trim();
  if (eventData) {
    try {
      const obj = JSON.parse(eventData);
      if (isPayloadCompatibleWithKind(obj, kind)) {
        return { result: obj, source: "event-data" };
      }
    } catch {
      // not JSON -- fall through
    }
  }

  // 4. the agent's session transcript -- the convergence source. Catches every handoff
  //    fumble (wrong filename, malformed emit, terminal-only output) because it's the agent's
  //    actual turn output. If this finds nothing, the agent likely never produced a payload.
  if (artifactsDir && existsSync(artifactsDir)) {
    const fromTranscript = resolveFromTranscript(artifactsDir, kind);
    if (fromTranscript) return fromTranscript;
  }

  // 5. last resort: scrape the agent's raw PTY capture (ANSI/TUI noise, balanced-brace scan)
  if (artifactsDir && existsSync(artifactsDir)) {
    let entries = [];
    try {
      entries = readdirSync(artifactsDir);
    } catch {
      entries = [];
    }
    for (const f of entries.filter((f) => f.endsWith("-output.txt"))) {
      const obj = parseAiJsonOutput(readFileSync(join(artifactsDir, f), "utf8"));
      if (isPayloadCompatibleWithKind(obj, kind)) {
        return { result: obj, source: join(artifactsDir, f) };
      }
    }
  }

  return null;
}

// normalizeResultForKind is imported from the shared payload contract above.

function usage() {
  console.error("usage: mentiko generation import <artifact.json> --job <id> --kind <kind> [--run <runId>]");
  process.exit(2);
}

function readFlag(name) {
  const index = args.indexOf(name);
  if (index === -1) return "";
  return args[index + 1] || "";
}

function readRunScopedToken(artifactPath, filename) {
  const resolved = resolve(artifactPath);
  const artifactDir = dirname(resolved);
  const runDir = dirname(artifactDir);
  const tokenPath = join(runDir, ".internal", filename);
  if (basename(artifactDir) !== "artifacts" || !existsSync(tokenPath)) {
    return "";
  }
  try {
    return readFileSync(tokenPath, "utf8").trim();
  } catch {
    return "";
  }
}

async function main() {
  const command = args[0] || "";
  if (command !== "import") usage();

  // job/kind/run are env-defaulted: LLM agents type structured args unreliably, so
  // `mentiko generation import` with no args must Just Work from the run environment.
  const jobId = readFlag("--job") || process.env.MENTIKO_GENERATION_JOB_ID || "";
  const kind = readFlag("--kind") || process.env.MENTIKO_GENERATION_KIND || "";
  const runId = readFlag("--run") || process.env.MENTIKO_RUN_ID || process.env.RUN_ID || "";
  if (!jobId || !kind) usage();

  // Resolve the payload from whatever source the agent actually used (see
  // resolveGenerationPayload). The orchestration backstop forwards the completion event's
  // data: field via MENTIKO_COMPLETION_EVENT_DATA so it can be salvaged here too.
  const positional = args[1] && !args[1].startsWith("--") ? args[1] : "";
  const artifactsDir = process.env.ARTIFACTS_DIR || "";
  const payload = resolveGenerationPayload(positional, artifactsDir, kind);
  if (!payload) {
    console.error(
      `no generation payload found (looked in generation-result.json, a stray *.json in ` +
        `ARTIFACTS_DIR, the completion event data, the agent session transcript, and the raw ` +
        `terminal output) -- the agent likely never produced a payload. ` +
        `ARTIFACTS_DIR=${artifactsDir || "(unset)"}`
    );
    process.exit(1);
  }
  const result = normalizeResultForKind(payload.result, kind);

  // The run-scoped import token lives at <runDir>/.internal/generation-import-token, derived
  // from <runDir>/artifacts/<file>. Anchor on the canonical artifact path so the token still
  // resolves when the payload was salvaged from event data or output.txt rather than a file.
  const tokenAnchorPath =
    (positional && existsSync(positional) && positional) ||
    (artifactsDir ? join(artifactsDir, "generation-result.json") : payload.source);

  const baseUrl = process.env.MENTIKO_WEB_URL || `http://localhost:${process.env.WEB_PORT || process.env.PORT || 3000}`;
  const token =
    process.env.MENTIKO_JOB_IMPORT_TOKEN ||
    readRunScopedToken(tokenAnchorPath, "generation-import-token") ||
    process.env.BETTER_AUTH_SECRET ||
    "";
  const response = await fetch(`${baseUrl}/api/jobs/${encodeURIComponent(jobId)}/complete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "x-namespace-id": process.env.NAMESPACE_ID || "default",
      "x-org-id": process.env.ORG_ID || "default",
    },
    body: JSON.stringify({
      status: "complete",
      result,
      runId: runId || undefined,
      generationKind: kind,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    console.error(`generation import failed: ${response.status} ${text}`);
    process.exit(1);
  }

  console.log(
    `generation import complete: ${jobId} ${kind}${runId ? ` ${runId}` : ""} [source: ${payload.source}]`
  );
}

// Only run the CLI when invoked directly (node mentiko-cli-generation.mjs / via bin/mentiko).
// When imported by a test, skip main() so the salvage helpers can be exercised in isolation.
const invokedDirectly =
  !!process.argv[1] && resolve(process.argv[1]).endsWith("mentiko-cli-generation.mjs");
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error?.message || String(error));
    process.exit(1);
  });
}

export { resolveGenerationPayload, normalizeResultForKind };
