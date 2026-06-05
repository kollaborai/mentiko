import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/auth/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import {
  getArtifactTemplates,
  saveArtifactTemplates,
  type ArtifactTemplate,
  type ArtifactType,
} from "@/lib/system/artifact-template-storage";
import { Unauthorized, BadRequest, NotFound } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

const VALID_TYPES: ArtifactType[] = [
  "markdown", "json", "code", "patch", "csv", "text", "image",
];

interface Context {
  params: Promise<{ id: string }>;
}

export const GET = withErrorHandling(async (request: NextRequest, context: Context) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }
  const nsId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const { id } = await context.params;
  const templates = getArtifactTemplates(nsId, orgId);
  const template = templates.find((t) => t.id === id);
  if (!template) {
    throw new NotFound("ArtifactTemplate", id);
  }
  return apiSuccess({ template });
});

export const PUT = withErrorHandling(async (request: NextRequest, context: Context) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const nsId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const { id } = await context.params;
  const body = await request.json();
  const { name, type, description, content } = body as Partial<ArtifactTemplate>;

  if (type && !VALID_TYPES.includes(type)) {
    throw new BadRequest(`type must be one of: ${VALID_TYPES.join(", ")}`);
  }

  const templates = getArtifactTemplates(nsId, orgId);
  const idx = templates.findIndex((t) => t.id === id);
  if (idx === -1) {
    throw new NotFound("ArtifactTemplate", id);
  }

  const updated: ArtifactTemplate = {
    ...templates[idx],
    ...(name !== undefined && { name }),
    ...(type !== undefined && { type }),
    ...(description !== undefined && { description }),
    ...(content !== undefined && { content }),
    updatedAt: new Date().toISOString(),
  };

  templates[idx] = updated;
  saveArtifactTemplates(nsId, orgId, templates);
  return apiSuccess({ template: updated });
});

export const DELETE = withErrorHandling(async (request: NextRequest, context: Context) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }
  const nsId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const { id } = await context.params;
  const templates = getArtifactTemplates(nsId, orgId);
  const idx = templates.findIndex((t) => t.id === id);
  if (idx === -1) {
    throw new NotFound("ArtifactTemplate", id);
  }
  const remaining = templates.filter((t) => t.id !== id);
  saveArtifactTemplates(nsId, orgId, remaining);
  return apiSuccess({ deleted: id });
});
