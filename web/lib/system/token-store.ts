/**
 * Token usage tracking store.
 * Persists per-agent, per-run token usage in the namespace directory.
 * Storage: namespaces/{ns}/tokens/{runId}/{agentId}.json
 * Aggregated index: namespaces/{ns}/tokens/_index.json
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { nsPath } from "../config";
import { DEFAULT_COST_MODEL } from "../agents/agent-provider-catalog";

// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

export interface TokenUsageRecord {
  runId: string;
  chainName: string;
  agentId: string;
  agentName?: string;
  provider: "claude" | "openai" | "gemini" | "ollama" | "unknown";
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  // computed at record time
  costCents: number;
  namespaceId: string;
  userId?: string;
  recordedAt: string;
}

export interface RunTokenSummary {
  runId: string;
  chainName: string;
  namespaceId: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostCents: number;
  agentBreakdown: Array<{
    agentId: string;
    agentName?: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    costCents: number;
  }>;
  recordedAt: string;
}

// ---------------------------------------------------------------------------
// pricing table (USD per 1M tokens → stored as micro-cents for precision)
// price in cents per 1M tokens
// ---------------------------------------------------------------------------

interface ModelPricing {
  inputCentsPerMillion: number;
  outputCentsPerMillion: number;
  cacheReadCentsPerMillion?: number;
  cacheWriteCentsPerMillion?: number;
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  // Claude (Anthropic)
  "claude-opus-4-7":               { inputCentsPerMillion: 500,  outputCentsPerMillion: 2500 },
  "claude-opus-4-6":               { inputCentsPerMillion: 1500, outputCentsPerMillion: 7500 },
  "claude-opus-4":                 { inputCentsPerMillion: 1500, outputCentsPerMillion: 7500 },
  "claude-sonnet-4-6":             { inputCentsPerMillion: 300,  outputCentsPerMillion: 1500 },
  "claude-sonnet-4-5":             { inputCentsPerMillion: 300,  outputCentsPerMillion: 1500 },
  "claude-sonnet-3-5":             { inputCentsPerMillion: 300,  outputCentsPerMillion: 1500 },
  "claude-haiku-4-5":              { inputCentsPerMillion: 100,  outputCentsPerMillion: 500,  cacheReadCentsPerMillion: 10,  cacheWriteCentsPerMillion: 125 },
  "claude-haiku-3-5":              { inputCentsPerMillion: 80,   outputCentsPerMillion: 400 },
  "claude-3-5-sonnet-20241022":    { inputCentsPerMillion: 300,  outputCentsPerMillion: 1500 },
  "claude-3-5-haiku-20241022":     { inputCentsPerMillion: 80,   outputCentsPerMillion: 400 },
  "claude-3-opus-20240229":        { inputCentsPerMillion: 1500, outputCentsPerMillion: 7500 },
  // OpenAI
  "gpt-5.5":                       { inputCentsPerMillion: 500,  outputCentsPerMillion: 3000 },
  "gpt-5.4":                       { inputCentsPerMillion: 250,  outputCentsPerMillion: 1500 },
  "gpt-5.4-mini":                  { inputCentsPerMillion: 75,   outputCentsPerMillion: 450 },
  // Legacy models remain here only so old run logs can still price correctly.
  "gpt-4o":                        { inputCentsPerMillion: 250,  outputCentsPerMillion: 1000 },
  "gpt-4o-mini":                   { inputCentsPerMillion: 15,   outputCentsPerMillion: 60 },
  "gpt-4-turbo":                   { inputCentsPerMillion: 1000, outputCentsPerMillion: 3000 },
  "gpt-4":                         { inputCentsPerMillion: 3000, outputCentsPerMillion: 6000 },
  "gpt-3.5-turbo":                 { inputCentsPerMillion: 50,   outputCentsPerMillion: 150 },
  "o1":                            { inputCentsPerMillion: 1500, outputCentsPerMillion: 6000 },
  "o1-mini":                       { inputCentsPerMillion: 300,  outputCentsPerMillion: 1200 },
  "o3-mini":                       { inputCentsPerMillion: 110,  outputCentsPerMillion: 440 },
  // Gemini
  "gemini-3.5-flash":              { inputCentsPerMillion: 8,    outputCentsPerMillion: 30 },
  "gemini-3.1-pro-preview":        { inputCentsPerMillion: 125,  outputCentsPerMillion: 500 },
  "gemini-3.1-flash-lite":         { inputCentsPerMillion: 8,    outputCentsPerMillion: 30 },
  "gemini-1.5-pro":                { inputCentsPerMillion: 125,  outputCentsPerMillion: 500 },
  "gemini-1.5-flash":              { inputCentsPerMillion: 8,    outputCentsPerMillion: 30 },
  "gemini-2.0-flash":              { inputCentsPerMillion: 8,    outputCentsPerMillion: 30 },
};

export function computeTokenCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
  cacheWriteTokens = 0
): number {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING[DEFAULT_COST_MODEL];
  const inputCost  = (inputTokens  / 1_000_000) * pricing.inputCentsPerMillion;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputCentsPerMillion;
  const cacheRead  = cacheReadTokens  > 0 ? (cacheReadTokens  / 1_000_000) * (pricing.cacheReadCentsPerMillion  ?? pricing.inputCentsPerMillion * 0.1) : 0;
  const cacheWrite = cacheWriteTokens > 0 ? (cacheWriteTokens / 1_000_000) * (pricing.cacheWriteCentsPerMillion ?? pricing.inputCentsPerMillion * 1.25) : 0;
  return Math.ceil(inputCost + outputCost + cacheRead + cacheWrite);
}

export function getModelPricing(model: string): ModelPricing {
  return MODEL_PRICING[model] || MODEL_PRICING[DEFAULT_COST_MODEL];
}

export function listKnownModels(): string[] {
  return Object.keys(MODEL_PRICING);
}

// ---------------------------------------------------------------------------
// storage helpers
// ---------------------------------------------------------------------------

function tokensDir(namespaceId: string): string {
  return nsPath(namespaceId, "tokens");
}

function runTokensDir(namespaceId: string, runId: string): string {
  return join(tokensDir(namespaceId), runId);
}

function indexPath(namespaceId: string): string {
  return join(tokensDir(namespaceId), "_index.json");
}

function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(path: string, data: unknown): void {
  const dir = join(path, "..");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2));
}

// ---------------------------------------------------------------------------
// index: lightweight summary per run for fast aggregation queries
// ---------------------------------------------------------------------------

interface IndexEntry {
  runId: string;
  chainName: string;
  namespaceId: string;
  totalCostCents: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  recordedAt: string;
}

function readIndex(namespaceId: string): IndexEntry[] {
  return readJson<IndexEntry[]>(indexPath(namespaceId), []);
}

function upsertIndex(namespaceId: string, entry: IndexEntry): void {
  const idx = readIndex(namespaceId);
  const existing = idx.findIndex((e) => e.runId === entry.runId);
  if (existing >= 0) {
    idx[existing] = entry;
  } else {
    idx.push(entry);
  }
  // keep last 10k entries
  if (idx.length > 10_000) idx.splice(0, idx.length - 10_000);
  writeJson(indexPath(namespaceId), idx);
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

export function saveTokenUsage(namespaceId: string, record: TokenUsageRecord): void {
  const dir = runTokensDir(namespaceId, record.runId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = join(dir, `${record.agentId}.json`);
  writeJson(path, record);

  // update index: sum all agents in this run
  const allAgentFiles = readdirSync(dir).filter((f) => f.endsWith(".json"));
  let totalCost = 0, totalIn = 0, totalOut = 0;
  for (const f of allAgentFiles) {
    const r = readJson<TokenUsageRecord>(join(dir, f), {} as TokenUsageRecord);
    totalCost += r.costCents ?? 0;
    totalIn   += r.inputTokens ?? 0;
    totalOut  += r.outputTokens ?? 0;
  }
  upsertIndex(namespaceId, {
    runId: record.runId,
    chainName: record.chainName,
    namespaceId,
    totalCostCents: totalCost,
    totalInputTokens: totalIn,
    totalOutputTokens: totalOut,
    recordedAt: record.recordedAt,
  });
}

export function getRunTokenUsage(namespaceId: string, runId: string): RunTokenSummary | null {
  const dir = runTokensDir(namespaceId, runId);
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  if (files.length === 0) return null;

  const agents: RunTokenSummary["agentBreakdown"] = [];
  let totalIn = 0, totalOut = 0, totalCost = 0;
  let chainName = "";

  for (const f of files) {
    const r = readJson<TokenUsageRecord>(join(dir, f), {} as TokenUsageRecord);
    chainName = r.chainName || chainName;
    totalIn   += r.inputTokens   ?? 0;
    totalOut  += r.outputTokens  ?? 0;
    totalCost += r.costCents      ?? 0;
    agents.push({
      agentId: r.agentId,
      agentName: r.agentName,
      model: r.model,
      inputTokens: r.inputTokens ?? 0,
      outputTokens: r.outputTokens ?? 0,
      costCents: r.costCents ?? 0,
    });
  }

  return {
    runId,
    chainName,
    namespaceId,
    totalInputTokens: totalIn,
    totalOutputTokens: totalOut,
    totalCostCents: totalCost,
    agentBreakdown: agents,
    recordedAt: agents[0] ? (files[0] ? new Date().toISOString() : "") : "",
  };
}

export function listRunTokenUsage(
  namespaceId: string,
  opts: {
    chainName?: string;
    limit?: number;
    since?: string;
  } = {}
): IndexEntry[] {
  let index = readIndex(namespaceId);
  if (opts.chainName) index = index.filter((e) => e.chainName === opts.chainName);
  if (opts.since)     index = index.filter((e) => e.recordedAt >= opts.since!);
  index.sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  return index.slice(0, opts.limit ?? 100);
}

export interface UsageAggregate {
  totalCostCents: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  runCount: number;
  avgCostCentsPerRun: number;
  byChain: Record<string, { costCents: number; inputTokens: number; outputTokens: number; runCount: number }>;
  byDay: Record<string, { costCents: number; inputTokens: number; outputTokens: number }>;
}

export function aggregateTokenUsage(
  namespaceId: string,
  opts: { chainName?: string; since?: string; until?: string } = {}
): UsageAggregate {
  let index = readIndex(namespaceId);
  if (opts.chainName) index = index.filter((e) => e.chainName === opts.chainName);
  if (opts.since)     index = index.filter((e) => e.recordedAt >= opts.since!);
  if (opts.until)     index = index.filter((e) => e.recordedAt <= opts.until!);

  const agg: UsageAggregate = {
    totalCostCents: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    runCount: index.length,
    avgCostCentsPerRun: 0,
    byChain: {},
    byDay: {},
  };

  for (const entry of index) {
    agg.totalCostCents      += entry.totalCostCents;
    agg.totalInputTokens    += entry.totalInputTokens;
    agg.totalOutputTokens   += entry.totalOutputTokens;

    // by chain
    if (!agg.byChain[entry.chainName]) {
      agg.byChain[entry.chainName] = { costCents: 0, inputTokens: 0, outputTokens: 0, runCount: 0 };
    }
    agg.byChain[entry.chainName].costCents    += entry.totalCostCents;
    agg.byChain[entry.chainName].inputTokens  += entry.totalInputTokens;
    agg.byChain[entry.chainName].outputTokens += entry.totalOutputTokens;
    agg.byChain[entry.chainName].runCount     += 1;

    // by day (YYYY-MM-DD)
    const day = entry.recordedAt.slice(0, 10);
    if (!agg.byDay[day]) agg.byDay[day] = { costCents: 0, inputTokens: 0, outputTokens: 0 };
    agg.byDay[day].costCents    += entry.totalCostCents;
    agg.byDay[day].inputTokens  += entry.totalInputTokens;
    agg.byDay[day].outputTokens += entry.totalOutputTokens;
  }

  if (agg.runCount > 0) {
    agg.avgCostCentsPerRun = Math.round(agg.totalCostCents / agg.runCount);
  }

  return agg;
}
