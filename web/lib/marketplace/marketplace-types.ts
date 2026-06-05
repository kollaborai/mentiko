/**
 * Marketplace shared types for org-private marketplace.
 */

// ── org-private marketplace item ──────────────────────────────────

export interface OrgMarketplaceItem {
  id: string;
  type: "chain" | "agent";
  name: string;
  description?: string;
  sharedAt: string;
  sharedBy?: string;
  visibility: "org";
  /** raw chain or agent config */
  data: Record<string, unknown>;
}
