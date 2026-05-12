import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import {
  getArtifactTemplates,
  saveArtifactTemplates,
  type ArtifactTemplate,
  type ArtifactType,
} from "@/lib/artifact-template-storage";
import { Unauthorized, BadRequest, Conflict } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

const VALID_TYPES: ArtifactType[] = [
  "markdown", "json", "code", "patch", "csv", "text", "image",
];

export const GET = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }
  const nsId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const templates = getArtifactTemplates(nsId, orgId);
  return apiSuccess({ templates });
});

export const POST = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const nsId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const body = await request.json();
  const { id, name, type, description, content } = body as Partial<ArtifactTemplate>;

  if (!id || typeof id !== "string" || !/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new BadRequest("id is required and must match pattern [a-zA-Z0-9_-]+");
  }
  if (!name || typeof name !== "string") {
    throw new BadRequest("name is required", { field: "name" });
  }
  if (!type || !VALID_TYPES.includes(type)) {
    throw new BadRequest(`type must be one of: ${VALID_TYPES.join(", ")}`);
  }

  const templates = getArtifactTemplates(nsId, orgId);
  if (templates.find((t) => t.id === id)) {
    throw new Conflict(`template with id '${id}' already exists`, { id });
  }

  const newTemplate: ArtifactTemplate = {
    id,
    name,
    type,
    description: description ?? "",
    content: content ?? "",
    updatedAt: new Date().toISOString(),
  };

  saveArtifactTemplates(nsId, orgId, [...templates, newTemplate]);
  return apiSuccess({ template: newTemplate }, undefined, 201);
});
