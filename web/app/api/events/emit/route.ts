import { NextRequest } from "next/server";
import { existsSync, mkdirSync } from "fs";
import config from "@/lib/config";
import { Unauthorized, BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { checkAuth } from "@/lib/auth/api-auth";
import { emitRunnerEvent } from "@/lib/runner-v2/event-emitter";
import { serializeRunnerEvent } from "@/lib/runner-v2/events";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const body = await request.json();
  const { event, source, data, runId, idempotencyKey } = body;

  if (!event || typeof event !== "string") {
    throw new BadRequest("event is required", { field: "event" });
  }

  if (!source || typeof source !== "string") {
    throw new BadRequest("source is required", { field: "source" });
  }
  if (idempotencyKey !== undefined && (typeof idempotencyKey !== "string" || !idempotencyKey.trim())) {
    throw new BadRequest("idempotencyKey must be a non-empty string", { field: "idempotencyKey" });
  }

  const eventsDir = config.eventsDir;

  if (!existsSync(eventsDir)) {
    mkdirSync(eventsDir, { recursive: true });
  }

  const timestamp = new Date().toISOString();
  const normalizedRunId = typeof runId === "string" ? runId : "";
  const eventData: string = data === undefined
    ? ""
    : typeof data === "string"
      ? data
      : JSON.stringify(data) ?? "";
  try {
    serializeRunnerEvent({
      event,
      source,
      runId: normalizedRunId,
      timestamp,
      data: eventData,
    });
  } catch (error) {
    throw new BadRequest(error instanceof Error ? error.message : "Invalid runner event");
  }

  let emitted;
  try {
    emitted = emitRunnerEvent({
      event,
      source,
      runId: normalizedRunId,
      scope: normalizedRunId ? "run" : "ingress",
      filenameMode: "api",
      eventsDir,
      timestamp,
      data: eventData,
      ...(typeof idempotencyKey === "string" ? { idempotencyKey } : {}),
    });
  } catch (error) {
    if (error instanceof Error && /run lifecycle event .* cannot use ingress scope/.test(error.message)) {
      throw new BadRequest(error.message);
    }
    throw error;
  }

  return apiSuccess({
    success: true,
    event,
    source,
    filename: emitted.filename,
    timestamp,
  });
});
