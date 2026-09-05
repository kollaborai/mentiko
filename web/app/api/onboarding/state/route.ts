import { NextRequest, NextResponse } from "next/server";
import { checkAuth } from "@/lib/auth/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { apiSuccess, withErrorHandling } from "@/lib/api-response";
import { deriveNextAction } from "@/lib/onboarding/onboarding-state";
import { deriveOnboardingState } from "@/lib/onboarding/derive-onboarding-state";
export const dynamic = "force-dynamic";
// The record is a pointer to the last action, not permission to claim success
// (spec "Derived status"): readiness/sampleRun are re-derived from the live
// run record on every read, never trusted verbatim off disk.
export const GET = withErrorHandling(async (request: NextRequest) => { if (!(await checkAuth(request))) return new NextResponse(JSON.stringify({ success:false, error:{code:"UNAUTHORIZED",message:"Unauthorized"} }), { status: 401, headers: { "content-type": "application/json" } }); const s=deriveOnboardingState(await getNamespaceIdFromRequest(request),await getOrgIdFromRequest(request)); return apiSuccess({...s,nextAction:deriveNextAction(s)}); });
