import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/auth/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { apiSuccess, withErrorHandling } from "@/lib/api-response";
import { readOnboardingState, deriveNextAction } from "@/lib/onboarding/onboarding-state";
export const dynamic = "force-dynamic";
export const GET = withErrorHandling(async (request: NextRequest) => { if (!(await checkAuth(request))) return new (require("next/server").NextResponse)(JSON.stringify({ success:false, error:{code:"UNAUTHORIZED",message:"Unauthorized"} }), { status: 401, headers: { "content-type": "application/json" } }); const s=readOnboardingState(await getNamespaceIdFromRequest(request),await getOrgIdFromRequest(request)); return apiSuccess({...s,nextAction:deriveNextAction(s)}); });
