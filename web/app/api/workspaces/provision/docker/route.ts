/**
 * GET  /api/workspaces/provision/docker          - list mentiko containers
 * POST /api/workspaces/provision/docker          - provision a new container
 * DELETE /api/workspaces/provision/docker?name=&removeVolume=true - remove container
 *
 * After provisioning, the caller creates a workspace with type: "docker"
 * using the returned containerName.
 *
 * POST body:
 *   { name: string, workspacePath?: string, image?: string,
 *     memoryLimit?: string, cpuLimit?: string, env?: Record<string,string>,
 *     createWorkspace?: boolean }
 */

import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/api-auth";
import { getNamespaceIdFromRequest } from "@/lib/namespace-config";
import {
  isDockerAvailable,
  provisionContainer,
  listMentikoContainers,
  removeContainer,
  stopContainer,
} from "@/lib/docker-provisioner";
import { BadRequest, Unauthorized, ServiceUnavailable } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { internalApiUrl } from "@/lib/internal-web-origin";

export const dynamic = "force-dynamic";

type Context = { params: Promise<Record<string, string>> };

export const GET = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const namespaceId = await getNamespaceIdFromRequest(request);
  const available = isDockerAvailable();

  if (!available) {
    return apiSuccess({
      available: false,
      containers: [],
      hint: "Docker daemon not running or not installed",
    });
  }

  const containers = listMentikoContainers(namespaceId);
  return apiSuccess({ available: true, containers });
});

export const POST = withErrorHandling(async (request: NextRequest, _context: Context) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const namespaceId = await getNamespaceIdFromRequest(request);

  if (!isDockerAvailable()) {
    throw new ServiceUnavailable("Docker daemon not available. Start Docker and try again.");
  }

  let body: {
    name?: string;
    workspacePath?: string;
    image?: string;
    memoryLimit?: string;
    cpuLimit?: string;
    env?: Record<string, string>;
    createWorkspace?: boolean;
  };

  try {
    body = await request.json();
  } catch {
    throw new BadRequest("Invalid JSON body");
  }

  if (!body.name || !/^[a-z0-9][a-z0-9-]*$/.test(body.name)) {
    throw new BadRequest("name required (lowercase alphanumeric + hyphens)", { field: "name" });
  }

  const info = await provisionContainer({
    name: body.name,
    namespaceId,
    workspacePath: body.workspacePath,
    image: body.image,
    memoryLimit: body.memoryLimit,
    cpuLimit: body.cpuLimit,
    env: body.env,
  });

  // optionally auto-create the workspace record
  if (body.createWorkspace) {
    const { headers } = request;
    const wsRes = await fetch(internalApiUrl("/api/workspaces", request.url), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-namespace-id": namespaceId,
        cookie: headers.get("cookie") || "",
      },
      body: JSON.stringify({
        name: body.name,
        path: info.workspacePath,
        execution: {
          type: "docker",
          docker: {
            container: info.containerName,
            path: info.workspacePath,
          },
        },
      }),
    });

    if (wsRes.ok) {
      const wsData = await wsRes.json();
      return apiSuccess({ container: info, workspace: wsData.data?.workspace || wsData.workspace }, undefined, 201);
    }
    // workspace creation failed — still return container info
  }

  return apiSuccess({ container: info }, undefined, 201);
});

export const DELETE = withErrorHandling(async (request: NextRequest, _context: Context) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const namespaceId = await getNamespaceIdFromRequest(request);
  const { searchParams } = new URL(request.url);
  const name = searchParams.get("name");
  const removeVolume = searchParams.get("removeVolume") === "true";
  const stopOnly = searchParams.get("stop") === "true";

  if (!name) {
    throw new BadRequest("name required", { field: "name" });
  }

  if (stopOnly) {
    await stopContainer(namespaceId, name);
    return apiSuccess({ ok: true, stopped: true });
  }

  await removeContainer(namespaceId, name, removeVolume);
  return apiSuccess({ ok: true, removed: true, volumeRemoved: removeVolume });
});
