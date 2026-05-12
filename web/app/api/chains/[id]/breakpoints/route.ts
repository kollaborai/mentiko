import { NextRequest } from "next/server";
import { Unauthorized, BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { checkAuth } from "@/lib/api-auth";
import {
  loadBreakpoints,
  setBreakpoint,
  clearBreakpoint,
  clearAllBreakpoints,
  requestResume,
  type Breakpoint,
} from "@/lib/breakpoint-store";

export const dynamic = "force-dynamic";

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

  const state = loadBreakpoints(chainId);

  return apiSuccess({
    chainId: state.chainId,
    breakpoints: state.breakpoints,
    pausedAt: state.pausedAt,
    pausedAtTimestamp: state.pausedAtTimestamp,
    resumeRequested: state.resumeRequested,
    lastUpdated: state.lastUpdated,
  });
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
  const body = await request.json();

  const { action, agentId, enabled, breakpoints } = body;

  let result;

  switch (action) {
    case "set":
      if (!agentId) {
        throw new BadRequest("agentId required");
      }
      result = setBreakpoint(chainId, agentId, enabled !== false);
      break;

    case "clear":
      if (!agentId) {
        throw new BadRequest("agentId required");
      }
      result = clearBreakpoint(chainId, agentId);
      break;

    case "clearAll":
      result = clearAllBreakpoints(chainId);
      break;

    case "setMultiple":
      if (!Array.isArray(breakpoints)) {
        throw new BadRequest("breakpoints array required");
      }
      // clear existing, then set new ones
      result = clearAllBreakpoints(chainId);
      for (const bp of breakpoints as Breakpoint[]) {
        setBreakpoint(chainId, bp.agentId, bp.enabled);
      }
      result = loadBreakpoints(chainId);
      break;

    case "resume":
      result = requestResume(chainId);
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

  const result = clearAllBreakpoints(chainId);

  return apiSuccess({
    success: true,
    chainId: result.chainId,
    breakpoints: [],
    lastUpdated: result.lastUpdated,
  });
});
