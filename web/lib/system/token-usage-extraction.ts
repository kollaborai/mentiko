/**
 * Typed owner of token-usage extraction from agent transcripts.
 *
 * Replaces lib/token-extractor.sh, which scraped agent stdout with grep -oP and
 * a `"usage":{[^}]*}` regex. That regex truncates on the nested `server_tool_use`
 * object real Claude transcripts carry, and its OpenAI branch matched
 * prompt_tokens/completion_tokens, which codex transcripts never emit.
 *
 * Two transcript dialects are supported, and they accumulate differently:
 *
 *   claude  per-assistant-message `message.usage`; input_tokens EXCLUDES the
 *           cache counters, so usage SUMS across messages.
 *   codex   `event_msg` / `token_count` payloads whose `info.total_token_usage`
 *           is CUMULATIVE, so the last event wins and must never be summed.
 *           input_tokens INCLUDES cached_input_tokens (observed:
 *           32440 input + 380 output === 32820 total_tokens), so the uncached
 *           remainder is what maps onto the Claude-shaped record.
 */

import { existsSync, readFileSync } from "fs";

import type { TokenUsageRecord } from "./token-store";

export type TokenProvider = TokenUsageRecord["provider"];

export interface TranscriptTokenTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Model named by the transcript. Undefined when no transcript line named one. */
  observedModel?: string;
}

export function emptyTokenTotals(): TranscriptTokenTotals {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
}

export function hasTokenCounts(totals: TranscriptTokenTotals): boolean {
  return totals.inputTokens > 0 || totals.outputTokens > 0;
}

// ---------------------------------------------------------------------------
// provider derivation
// ---------------------------------------------------------------------------

const PROVIDER_MODEL_PREFIXES: Array<[TokenProvider, RegExp]> = [
  ["claude", /^claude[-.]/],
  ["openai", /^(gpt[-.]|o[13][-.]?|codex[-.]?|text-davinci)/],
  ["gemini", /^gemini[-.]/],
  ["ollama", /^(ollama[-.:/]|llama[-.]|mistral[-.]|mixtral[-.]|qwen[-.]|deepseek[-.]|phi[-.]|gemma[-.])/],
];

/**
 * Derive the provider from a model id actually observed in a transcript.
 * An unobserved or unrecognized model yields "unknown" rather than a guess —
 * the record states what was seen, not what was likely.
 */
export function providerForModel(model: string | undefined): TokenProvider {
  if (!model) return "unknown";
  const normalized = model.trim().toLowerCase();
  if (!normalized) return "unknown";
  for (const [provider, pattern] of PROVIDER_MODEL_PREFIXES) {
    if (pattern.test(normalized)) return provider;
  }
  return "unknown";
}

// ---------------------------------------------------------------------------
// transcript line shapes
// ---------------------------------------------------------------------------

interface ClaudeUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

interface CodexTokenUsage {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
}

interface TranscriptLine {
  type?: string;
  message?: { model?: string; usage?: ClaudeUsage };
  payload?: {
    type?: string;
    model?: string;
    info?: { total_token_usage?: CodexTokenUsage };
  };
}

function count(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Claude Code names synthetic assistant messages "<synthetic>" and emits one as
 * the final message of a transcript. Angle-bracketed values are sentinels, not
 * model ids, so they must never overwrite the real model a transcript observed.
 */
function observedModelValue(model: string | undefined): string | undefined {
  if (!model) return undefined;
  const trimmed = model.trim();
  if (!trimmed || /^<.*>$/.test(trimmed)) return undefined;
  return trimmed;
}

// ---------------------------------------------------------------------------
// parsing
// ---------------------------------------------------------------------------

/**
 * Parse one transcript's JSONL content into token totals. Malformed lines are
 * skipped; an unparseable transcript yields zeroed totals rather than throwing.
 */
export function parseTranscriptTokens(content: string): TranscriptTokenTotals {
  const totals = emptyTokenTotals();
  // codex reports a running cumulative total, so the final event replaces
  // rather than adds to whatever earlier events reported.
  let codexCumulative: TranscriptTokenTotals | undefined;

  for (const line of content.split("\n")) {
    if (!line.trim()) continue;

    let entry: TranscriptLine;
    try {
      entry = JSON.parse(line) as TranscriptLine;
    } catch {
      continue;
    }

    if (entry.type === "assistant" && entry.message?.usage) {
      const usage = entry.message.usage;
      totals.observedModel = observedModelValue(entry.message.model) ?? totals.observedModel;
      totals.inputTokens += count(usage.input_tokens);
      totals.outputTokens += count(usage.output_tokens);
      totals.cacheReadTokens += count(usage.cache_read_input_tokens);
      totals.cacheWriteTokens += count(usage.cache_creation_input_tokens);
      continue;
    }

    // codex names the model on its session_meta payload, separately from usage.
    totals.observedModel = observedModelValue(entry.payload?.model) ?? totals.observedModel;

    if (entry.payload?.type === "token_count") {
      const usage = entry.payload.info?.total_token_usage;
      if (!usage) continue;
      const input = count(usage.input_tokens);
      const cached = Math.min(count(usage.cached_input_tokens), input);
      codexCumulative = {
        inputTokens: input - cached,
        outputTokens: count(usage.output_tokens),
        cacheReadTokens: cached,
        cacheWriteTokens: 0,
      };
    }
  }

  if (codexCumulative) {
    totals.inputTokens += codexCumulative.inputTokens;
    totals.outputTokens += codexCumulative.outputTokens;
    totals.cacheReadTokens += codexCumulative.cacheReadTokens;
  }

  return totals;
}

/** Parse a transcript file. A missing or unreadable file yields zeroed totals. */
export function readTranscriptTokens(filePath: string): TranscriptTokenTotals {
  try {
    if (!existsSync(filePath)) return emptyTokenTotals();
    return parseTranscriptTokens(readFileSync(filePath, "utf-8"));
  } catch {
    return emptyTokenTotals();
  }
}

/** Combine totals across transcripts belonging to one agent. */
export function addTokenTotals(
  base: TranscriptTokenTotals,
  next: TranscriptTokenTotals,
): TranscriptTokenTotals {
  return {
    inputTokens: base.inputTokens + next.inputTokens,
    outputTokens: base.outputTokens + next.outputTokens,
    cacheReadTokens: base.cacheReadTokens + next.cacheReadTokens,
    cacheWriteTokens: base.cacheWriteTokens + next.cacheWriteTokens,
    observedModel: next.observedModel ?? base.observedModel,
  };
}
