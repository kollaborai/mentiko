import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/auth/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import {
  getProfile,
  updateProfile,
  deleteProfile,
} from "@/lib/agents/agent-profile-storage";
import { NotFound, Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(
  async (
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
  ) => {
    if (!(await checkAuth(request))) {
      throw new Unauthorized();
    }

    const { id } = await context.params;
    const namespaceId = await getNamespaceIdFromRequest(request);
    const orgId = await getOrgIdFromRequest(request);
    const profile = getProfile(namespaceId, orgId, decodeURIComponent(id));

    if (!profile) {
      throw new NotFound("Profile", id);
    }

    return apiSuccess({ profile });
  }
);

export const PATCH = withErrorHandling(
  async (
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
  ) => {
    if (!(await checkAuth(request))) {
      throw new Unauthorized();
    }

    const { id } = await context.params;
    const namespaceId = await getNamespaceIdFromRequest(request);
    const orgId = await getOrgIdFromRequest(request);
    const body = await request.json();

    // Check if profile exists first
    const existing = getProfile(
      namespaceId,
      orgId,
      decodeURIComponent(id)
    );
    if (!existing) {
      throw new NotFound("Profile", id);
    }

    const {
      name,
      description,
      isDefault,
      isAdvisorDefault,
      cli,
      model,
      relay_model,
      pipe_flag,
      permission_flag,
      extra_args,
      disallowed_tools,
      env,
      pre_exec,
      log_path,
      log_format,
    } = body as {
      name?: string;
      description?: string;
      isDefault?: boolean;
      isAdvisorDefault?: boolean;
      cli?: string;
      model?: string;
      relay_model?: string;
      pipe_flag?: string;
      permission_flag?: string;
      extra_args?: string[];
      disallowed_tools?: string;
      env?: Record<string, string | null>;
      pre_exec?: string;
      log_path?: string;
      log_format?: string;
    };

    const updated = updateProfile(namespaceId, orgId, decodeURIComponent(id), {
      name,
      description,
      isDefault,
      isAdvisorDefault,
      cli,
      model,
      relay_model,
      pipe_flag,
      permission_flag,
      extra_args,
      disallowed_tools,
      env: env
        ? Object.fromEntries(
          Object.entries(env)
            .filter(([, v]) => v !== null)
            .map(([k, v]) => [k, v ?? ""])
        )
        : undefined,
      pre_exec,
      log_path,
      log_format,
    });

    return apiSuccess({ profile: updated });
  }
);

export const DELETE = withErrorHandling(
  async (
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
  ) => {
    if (!(await checkAuth(request))) {
      throw new Unauthorized();
    }

    const { id } = await context.params;
    const namespaceId = await getNamespaceIdFromRequest(request);
    const orgId = await getOrgIdFromRequest(request);

    // Check if profile exists first
    const existing = getProfile(
      namespaceId,
      orgId,
      decodeURIComponent(id)
    );
    if (!existing) {
      throw new NotFound("Profile", id);
    }

    const result = deleteProfile(namespaceId, orgId, decodeURIComponent(id));
    return apiSuccess({ success: true, ...result });
  }
);
