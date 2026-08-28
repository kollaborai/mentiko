import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/auth/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { apiSuccess, withErrorHandling } from "@/lib/api-response";
import { BadRequest, Unauthorized } from "@/lib/api-errors";
import { getProfile } from "@/lib/agents/agent-profile-storage";
import { readOnboardingState, writeOnboardingState, nextOperation } from "@/lib/onboarding/onboarding-state";
export const POST = withErrorHandling(async (request: NextRequest) => { if (!(await checkAuth(request))) throw new Unauthorized(); const b=await request.json(); const profileId=String(b.profileId||""), key=String(b.idempotencyKey||""); if(!profileId||!key) throw new BadRequest("profileId and idempotencyKey are required"); const ns=await getNamespaceIdFromRequest(request),org=await getOrgIdFromRequest(request), profile=getProfile(ns,org,profileId); if(!profile) throw new BadRequest("Profile not found"); const {state,op}=nextOperation(ns,org,"provider_readiness",key,"readiness"); const s=readOnboardingState(ns,org); s.provider.selectedProfileId=profileId; s.readiness={status:profile.readiness?.enabled?"in_progress":"unverified",runId:null,operationId:op.operationId}; writeOnboardingState(ns,org,s,state.revision); return apiSuccess({operationId:op.operationId,runId:null,pollUrl:null,deadline:new Date(Date.now()+90000).toISOString(),status:s.readiness.status,profileId}); });
