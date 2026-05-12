import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/api-auth";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { BadRequest, Unauthorized, NotFound } from "@/lib/api-errors";
import { viewportManager } from "@/lib/viewport-manager";

export const dynamic = "force-dynamic";

/**
 * Viewport session management API.
 *
 * POST /api/system/viewport
 *   { action: "create", url, width?, height? }       -> create session
 *   { action: "navigate", sessionId, url }            -> navigate
 *   { action: "back", sessionId }                     -> go back
 *   { action: "forward", sessionId }                  -> go forward
 *   { action: "update", sessionId, url?, title?, loading? } -> update state
 *   { action: "screenshot", sessionId, data }         -> store screenshot
 *   { action: "dom", sessionId, data }                -> store DOM snapshot
 *   { action: "event", sessionId, type, data }        -> record interaction event
 *   { action: "destroy", sessionId }                  -> close session
 *
 * GET /api/system/viewport?sessionId=...              -> get session state
 * GET /api/system/viewport                            -> list all sessions
 */

// POST -- session actions
export const POST = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const body = await request.json();
  const { action } = body as { action?: string };

  if (!action) {
    throw new BadRequest("action is required");
  }

  switch (action) {
    case "create": {
      const { url, width, height } = body as { url?: string; width?: number; height?: number };
      if (!url) throw new BadRequest("url is required for create");
      const session = viewportManager.create(url, { width, height });
      return apiSuccess(session);
    }

    case "navigate": {
      const { sessionId, url } = body as { sessionId?: string; url?: string };
      if (!sessionId) throw new BadRequest("sessionId is required");
      if (!url) throw new BadRequest("url is required for navigate");
      const session = viewportManager.navigate(sessionId, url);
      if (!session) throw new NotFound("viewport session", sessionId);
      return apiSuccess(session);
    }

    case "back": {
      const { sessionId } = body as { sessionId?: string };
      if (!sessionId) throw new BadRequest("sessionId is required");
      const session = viewportManager.back(sessionId);
      if (!session) throw new NotFound("viewport session", sessionId);
      return apiSuccess(session);
    }

    case "forward": {
      const { sessionId } = body as { sessionId?: string };
      if (!sessionId) throw new BadRequest("sessionId is required");
      const session = viewportManager.forward(sessionId);
      if (!session) throw new NotFound("viewport session", sessionId);
      return apiSuccess(session);
    }

    case "update": {
      const { sessionId, url, title, loading } = body as {
        sessionId?: string;
        url?: string;
        title?: string;
        loading?: boolean;
      };
      if (!sessionId) throw new BadRequest("sessionId is required");
      const session = viewportManager.update(sessionId, { url, title, loading });
      if (!session) throw new NotFound("viewport session", sessionId);
      return apiSuccess(session);
    }

    case "screenshot": {
      const { sessionId, data } = body as { sessionId?: string; data?: string };
      if (!sessionId) throw new BadRequest("sessionId is required");
      if (!data) throw new BadRequest("data (base64) is required for screenshot");
      const session = viewportManager.update(sessionId, { lastScreenshot: data });
      if (!session) throw new NotFound("viewport session", sessionId);
      return apiSuccess({ stored: true });
    }

    case "dom": {
      const { sessionId, data } = body as { sessionId?: string; data?: string };
      if (!sessionId) throw new BadRequest("sessionId is required");
      if (!data) throw new BadRequest("data is required for dom");
      const session = viewportManager.update(sessionId, { lastDom: data });
      if (!session) throw new NotFound("viewport session", sessionId);
      return apiSuccess({ stored: true });
    }

    case "event": {
      const { sessionId, type, data } = body as {
        sessionId?: string;
        type?: string;
        data?: Record<string, unknown>;
      };
      if (!sessionId) throw new BadRequest("sessionId is required");
      if (!type) throw new BadRequest("type is required for event");
      viewportManager.recordEvent(sessionId, {
        type: type as "click" | "type" | "scroll" | "navigate",
        data: data ?? {},
      });
      return apiSuccess({ recorded: true });
    }

    case "destroy": {
      const { sessionId } = body as { sessionId?: string };
      if (!sessionId) throw new BadRequest("sessionId is required");
      const destroyed = viewportManager.destroy(sessionId);
      if (!destroyed) throw new NotFound("viewport session", sessionId);
      return apiSuccess({ destroyed: true });
    }

    default:
      throw new BadRequest(`unknown action: ${action}`);
  }
});

// GET -- query session state
export const GET = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");

  if (sessionId) {
    const session = viewportManager.get(sessionId);
    if (!session) throw new NotFound("viewport session", sessionId);

    const events = searchParams.get("events") === "1"
      ? viewportManager.getEvents(sessionId)
      : undefined;

    return apiSuccess({ ...session, events });
  }

  // list all sessions
  const sessions = viewportManager.list();
  return apiSuccess({ sessions });
});
