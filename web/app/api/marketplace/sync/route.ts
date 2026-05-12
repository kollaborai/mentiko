import { NextRequest } from "next/server";
import { existsSync } from "fs";
import { join } from "path";
import config from "@/lib/config";
import { requirePermission } from "@/lib/rbac-auth";
import { syncMarketplace } from "@/lib/marketplace-sync";
import { BadRequest, Conflict } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (request: NextRequest) => {
  const denied = await requirePermission(request, "manage_org");
  if (denied) return denied;

  const body = await request.json().catch(() => ({}));
  const { url, force = false } = body as { url?: string; force?: boolean };

  if (url && !url.match(/^https:\/\/github\.com\//) && !url.match(/^git@github\.com:/)) {
    throw new BadRequest("url must be a github.com URL (https or git@)");
  }

  const marketplaceDir = join(config.globalRoot, "marketplace");
  if (!force && existsSync(marketplaceDir) && !existsSync(join(marketplaceDir, ".git"))) {
    throw new Conflict("marketplace/ exists but is not a git repo. Use force=true to re-clone.");
  }

  const result = await syncMarketplace({ url, force });
  return apiSuccess(result);
});
