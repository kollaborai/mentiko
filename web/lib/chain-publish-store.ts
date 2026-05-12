/**
 * Chain publish store.
 *
 * Published chains are written to {root}/marketplace/published/{slug}/
 * so they appear alongside community templates in the marketplace catalog.
 * Each published entry includes chain.json (the chain) and publish.json (meta).
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
import config from "@/lib/config";

export type ChainVisibility = "public" | "org" | "private";

export interface PublishedChainMeta {
  chainId: string;
  slug: string;
  publisherId: string;
  publisherName: string;
  publisherEmail?: string;
  name: string;
  description: string;
  tags: string[];
  category: string;
  visibility: ChainVisibility;
  publishedAt: string;
  updatedAt: string;
  installCount: number;
  rating: number;
  ratingCount: number;
  ratingDistribution: Record<string, number>;
  agentCount: number;
  version: string;
  namespaceId: string;
}

export interface PublishRequest {
  description?: string;
  tags?: string[];
  category?: string;
  visibility?: ChainVisibility;
}

function publishedBase(): string {
  return join(config.namespacesBase, "marketplace", "published");
}

function publishedDir(slug: string): string {
  return join(publishedBase(), slug);
}

function safifySlug(chainId: string): string {
  return chainId.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").slice(0, 64);
}

export function getPublishedChain(chainId: string): PublishedChainMeta | null {
  const slug = safifySlug(chainId);
  const metaPath = join(publishedDir(slug), "publish.json");
  if (!existsSync(metaPath)) return null;
  try {
    return JSON.parse(readFileSync(metaPath, "utf-8")) as PublishedChainMeta;
  } catch {
    return null;
  }
}

export function listPublishedChains(): PublishedChainMeta[] {
  const base = publishedBase();
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      try {
        const metaPath = join(base, e.name, "publish.json");
        if (!existsSync(metaPath)) return null;
        return JSON.parse(readFileSync(metaPath, "utf-8")) as PublishedChainMeta;
      } catch {
        return null;
      }
    })
    .filter(Boolean) as PublishedChainMeta[];
}

export function publishChain(
  chainId: string,
  chainData: Record<string, unknown>,
  publisherInfo: { id: string; name: string; email?: string },
  namespaceId: string,
  req: PublishRequest
): PublishedChainMeta {
  const slug = safifySlug(chainId);
  const dir = publishedDir(slug);
  mkdirSync(dir, { recursive: true });

  const existing = getPublishedChain(chainId);
  const now = new Date().toISOString();

  const meta: PublishedChainMeta = {
    chainId,
    slug,
    publisherId: publisherInfo.id,
    publisherName: publisherInfo.name,
    publisherEmail: publisherInfo.email,
    name: (chainData.name as string) || chainId,
    description: req.description || (chainData.description as string) || "",
    tags: req.tags || [],
    category: req.category || (chainData as { metadata?: { category?: string } }).metadata?.category || "general",
    visibility: req.visibility ?? "public",
    publishedAt: existing?.publishedAt || now,
    updatedAt: now,
    installCount: existing?.installCount || 0,
    rating: existing?.rating || 0,
    ratingCount: existing?.ratingCount || 0,
    ratingDistribution: existing?.ratingDistribution || {},
    agentCount: Array.isArray(chainData.agents) ? chainData.agents.length : 0,
    version: (chainData.version as string) || "1.0",
    namespaceId,
  };

  // write chain definition
  writeFileSync(join(dir, "chain.json"), JSON.stringify(chainData, null, 2), "utf-8");
  // write publish metadata
  writeFileSync(join(dir, "publish.json"), JSON.stringify(meta, null, 2), "utf-8");

  return meta;
}

export function unpublishChain(chainId: string): boolean {
  const slug = safifySlug(chainId);
  const dir = publishedDir(slug);
  if (!existsSync(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}

export function incrementInstallCount(chainId: string): void {
  const slug = safifySlug(chainId);
  const metaPath = join(publishedDir(slug), "publish.json");
  if (!existsSync(metaPath)) return;
  try {
    const meta = JSON.parse(readFileSync(metaPath, "utf-8")) as PublishedChainMeta;
    meta.installCount = (meta.installCount || 0) + 1;
    meta.updatedAt = new Date().toISOString();
    writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf-8");
  } catch { /* ignore */ }
}
