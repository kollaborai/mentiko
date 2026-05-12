/**
 * meta.ts
 *
 * MCP handlers for phase 3 meta/introspection endpoints.
 * Provides access to system information, docs, settings, and nav structure.
 */

import { opsGet } from "./ops-client.js";

interface SettingsPage {
  route: string;
  label: string;
  description: string;
  category: string;
}

interface DocArticle {
  route: string;
  title: string;
  description: string;
  tags: string[];
}

interface NavCategory {
  key: string;
  label: string;
  href: string;
  color: string;
  children: Array<{ href: string; label: string }>;
}

export async function getSettingsPages(): Promise<{ pages: SettingsPage[] }> {
  return await opsGet("/api/mentiko-mcp/ops/meta/settings");
}

export async function getDocsIndex(): Promise<{ articles: DocArticle[] }> {
  return await opsGet("/api/mentiko-mcp/ops/meta/docs");
}

export async function getNavStructure(): Promise<{ categories: NavCategory[] }> {
  return await opsGet("/api/mentiko-mcp/ops/meta/nav");
}

export async function getSystemInfo(): Promise<{
  version?: any;
  health?: any;
}> {
  const WEB_URL = process.env.MENTIKO_WEB_URL || "http://127.0.0.1:3000";
  const [version, health] = await Promise.all([
    fetch(`${WEB_URL}/api/version`)
      .then((r) => r.json())
      .catch(() => null),
    fetch(`${WEB_URL}/api/health`)
      .then((r) => r.json())
      .catch(() => null),
  ]);
  return { version, health };
}
