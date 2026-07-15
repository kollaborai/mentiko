import { NextRequest } from "next/server";
import { writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import config from "@/lib/config";
import { Unauthorized, BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { checkAuth } from "@/lib/auth/api-auth";
import { serializeRunnerEvent } from "@/lib/runner-v2/events";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const body = await request.json();
  const { event, source, data, runId } = body;

  if (!event || typeof event !== "string") {
    throw new BadRequest("event is required", { field: "event" });
  }

  if (!source || typeof source !== "string") {
    throw new BadRequest("source is required", { field: "source" });
  }

  const eventsDir = config.eventsDir;

  if (!existsSync(eventsDir)) {
    mkdirSync(eventsDir, { recursive: true });
  }

  const timestamp = new Date().toISOString();
  // filename: source-event.event (matches existing convention)
  const safeSource = source.replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeEvent = event.replace(/[^a-zA-Z0-9_-]/g, "_");
  const filename = `${safeSource}-${safeEvent}.event`;
  const filePath = join(eventsDir, filename);

  let content: string;
  try {
    content = serializeRunnerEvent({
      event,
      source,
      runId: typeof runId === "string" ? runId : "",
      timestamp,
      data: data === undefined ? "" : typeof data === "string" ? data : JSON.stringify(data),
    });
  } catch (error) {
    throw new BadRequest(error instanceof Error ? error.message : "Invalid runner event");
  }

  writeFileSync(filePath, content, "utf-8");

  return apiSuccess({
    success: true,
    event,
    source,
    filename,
    timestamp,
  });
});
