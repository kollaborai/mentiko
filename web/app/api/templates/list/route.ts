import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/api-auth";
import { getTemplates } from "@/lib/templates";
import { Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const templates = await getTemplates();
  return apiSuccess({ templates });
});
