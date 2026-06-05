import { syncMarketplace } from "@/lib/marketplace/marketplace-sync";
import { InternalServerError } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async () => {
  try {
    const result = await syncMarketplace({ timeout: 60000 });
    return apiSuccess({ result });
  } catch (error) {
    console.error("Failed to refresh marketplace:", error);
    throw new InternalServerError(error instanceof Error ? error.message : "Failed to refresh marketplace");
  }
});
