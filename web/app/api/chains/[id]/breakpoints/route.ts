import { NextRequest } from "next/server";
import { Unauthorized, BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { checkAuth } from "@/lib/auth/api-auth";
import config, { orgPath } from "@/lib/config";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { join } from "node:path";
import {
  BreakpointRecordValidationError,
  loadBreakpoints,
  setBreakpoint,
  clearBreakpoint,
  clearAllBreakpoints,
  replaceBreakpoints,
  requestResume,
  type Breakpoint,
} from "@/lib/runs/breakpoint-store";

export const dynamic = "force-dynamic";

/** Match config.sh: default project collapses into the request org; named projects live below it. */
async function resolveRequestBreakpointDebugDir(request: Request): Promise<string> {
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const requestOrgRoot = orgPath(namespaceId, orgId);
  const requestProjectRoot = config.projectDir === config.codeRoot
    ? requestOrgRoot
    : join(requestOrgRoot, "projects", config.projectId);
  return join(requestProjectRoot, "debug");
}

function asBadRequest(error: unknown): never {
  if (error instanceof BreakpointRecordValidationError) throw new BadRequest(error.message);
  throw error;
}

async function requestBody(request: NextRequest): Promise<Record<string, unknown>> {
  try {
    const value = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequest("Breakpoint request body must be an object.");
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof BadRequest) throw error;
    throw new BadRequest("Breakpoint request body must be valid JSON.");
  }
}

// GET - list breakpoints for a chain
export const GET = withErrorHandling(async (
  request: NextRequest,
  _context: { params: Promise<{ id: string }> }
) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const { id } = await _context.params;
  const chainId = decodeURIComponent(id);

  try {
    const state = loadBreakpoints(chainId, await resolveRequestBreakpointDebugDir(request));

    return apiSuccess({
      chainId: state.chainId,
      breakpoints: state.breakpoints,
      pausedAt: state.pausedAt,
      pausedAtTimestamp: state.pausedAtTimestamp,
      resumeRequested: state.resumeRequested,
      lastUpdated: state.lastUpdated,
    });
  } catch (error) {
    asBadRequest(error);
  }
});

// POST - set/clear breakpoints or resume
export const POST = withErrorHandling(async (
  request: NextRequest,
  _context: { params: Promise<{ id: string }> }
) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const { id } = await _context.params;
  const chainId = decodeURIComponent(id);
  const body = await requestBody(request);
  const { action, agentId, enabled, breakpoints } = body;
  const debugDir = await resolveRequestBreakpointDebugDir(request);

  try {
    let result;
    switch (action) {
      case "set":
        if (typeof agentId !== "string" || !agentId) throw new BadRequest("agentId required");
        if (enabled !== undefined && typeof enabled !== "boolean") throw new BadRequest("enabled must be boolean");
        result = setBreakpoint(chainId, agentId, enabled !== false, debugDir);
        break;

      case "clear":
        if (typeof agentId !== "string" || !agentId) throw new BadRequest("agentId required");
        result = clearBreakpoint(chainId, agentId, debugDir);
        break;

      case "clearAll":
        result = clearAllBreakpoints(chainId, debugDir);
        break;

      case "setMultiple":
        if (!Array.isArray(breakpoints)) throw new BadRequest("breakpoints array required");
        result = replaceBreakpoints(chainId, breakpoints as Breakpoint[], debugDir);
        break;

      case "resume":
        result = requestResume(chainId, debugDir);
        break;

      default:
        throw new BadRequest("Invalid action");
    }

    return apiSuccess({
      success: true,
      chainId: result.chainId,
      breakpoints: result.breakpoints,
      pausedAt: result.pausedAt,
      resumeRequested: result.resumeRequested,
      lastUpdated: result.lastUpdated,
    });
  } catch (error) {
    asBadRequest(error);
  }
});

// DELETE - remove all breakpoints
export const DELETE = withErrorHandling(async (
  request: NextRequest,
  _context: { params: Promise<{ id: string }> }
) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const { id } = await _context.params;
  const chainId = decodeURIComponent(id);

  let result;
  try {
    result = clearAllBreakpoints(chainId, await resolveRequestBreakpointDebugDir(request));
  } catch (error) {
    asBadRequest(error);
  }

  return apiSuccess({
    success: true,
    chainId: result.chainId,
    breakpoints: [],
    lastUpdated: result.lastUpdated,
  });
});
