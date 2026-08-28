import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/auth/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { apiSuccess, withErrorHandling } from "@/lib/api-response";
import { BadRequest, Unauthorized } from "@/lib/api-errors";
import { getProfile } from "@/lib/agents/agent-profile-storage";
import { getWorkspace } from "@/lib/workspaces/workspace-storage";
import { readOnboardingState, nextOperation, CURRENT_SETUP_VERSION } from "@/lib/onboarding/onboarding-state";
export const POST = withErrorHandling(async (request: NextRequest) => { if (!(await checkAuth(request))) throw new Unauthorized(); const b=await request.json(); const profileId=String(b.profileId||""),workspaceId=String(b.workspaceId||""),key=String(b.idempotencyKey||""),setupVersion=Number(b.setupVersion); if(!profileId||!workspaceId||!key) throw new BadRequest("profileId, workspaceId and idempotencyKey are required"); if(setupVersion!==CURRENT_SETUP_VERSION) throw new BadRequest("Unsupported setupVersion",{setupVersion,current:CURRENT_SETUP_VERSION}); const ns=await getNamespaceIdFromRequest(request),org=await getOrgIdFromRequest(request); const s=readOnboardingState(ns,org); if(s.provider.selectedProfileId!==profileId||s.provider.status!=="ready") throw new BadRequest("Profile is not verified for onboarding"); if(s.workspace.id!==workspaceId||s.workspace.status!=="ready"||!getWorkspace(ns,org,workspaceId)) throw new BadRequest("Workspace is not ready for onboarding"); const {op}=nextOperation(ns,org,"sample_run",key,"sample-run"); return apiSuccess({operationId:op.operationId,status:op.status,runId:null,profileId,workspaceId,mutatesWorkspace:false}); });
