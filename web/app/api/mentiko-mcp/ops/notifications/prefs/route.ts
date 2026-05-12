import { NextResponse } from "next/server";
import { requireOpsAuth, requireOpsPermission } from "@/lib/mentiko-mcp-ops-auth";
import { loadPrefs, savePrefs, NotificationPreferences } from "@/lib/notification-prefs";

export const dynamic = "force-dynamic";

/** GET /api/mentiko-mcp/ops/notifications/prefs — read current notification preferences */
export async function GET(req: Request) {
  const ctx = await requireOpsAuth(req);
  if (ctx instanceof NextResponse) return ctx;

  const { namespaceId, orgId } = ctx;
  const prefs = loadPrefs(namespaceId, orgId, "default");

  return NextResponse.json(prefs);
}

/** POST /api/mentiko-mcp/ops/notifications/prefs — update notification preferences */
export async function POST(req: Request) {
  const ctx = await requireOpsAuth(req);
  if (ctx instanceof NextResponse) return ctx;
  const perm = requireOpsPermission(ctx, "manage_org", "notifications:write");
  if (perm) return perm;

  const { namespaceId, orgId } = ctx;
  const body = (await req.json()) as Partial<NotificationPreferences>;

  // Load existing prefs
  const existing = loadPrefs(namespaceId, orgId, "default");

  // Deep merge updates into existing
  const merged: NotificationPreferences = {
    ...existing,
    ...body,
    categories: mergeCategories(existing.categories, body.categories),
  };

  // Save merged prefs
  savePrefs(namespaceId, orgId, merged);

  return NextResponse.json(merged);
}

/**
 * Merge category updates into existing categories.
 * Matches by category field, updates matching ones, keeps others.
 */
function mergeCategories(
  existing: NotificationPreferences["categories"],
  updates: NotificationPreferences["categories"] | undefined,
): NotificationPreferences["categories"] {
  if (!updates) return existing;

  // Create a map of updates by category name
  const updatesMap = new Map(updates.map((u) => [u.category, u]));

  // Merge: update matching, keep others unchanged
  return existing.map((cat) => {
    const update = updatesMap.get(cat.category);
    if (!update) return cat;
    return {
      ...cat,
      ...update,
    };
  });
}
