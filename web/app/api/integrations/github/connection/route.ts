import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/auth/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { apiSuccess, withErrorHandling } from "@/lib/api-response";
import { Unauthorized } from "@/lib/api-errors";
import { readOnboardingState } from "@/lib/onboarding/onboarding-state";
export const GET = withErrorHandling(async (request: NextRequest) => { if (!(await checkAuth(request))) throw new Unauthorized(); const s=readOnboardingState(await getNamespaceIdFromRequest(request),await getOrgIdFromRequest(request)); return apiSuccess({status:s.github.status,account:s.github.account}); });
