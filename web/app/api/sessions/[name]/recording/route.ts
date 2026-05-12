import { NextResponse, type NextRequest } from "next/server";
import { readdir, readFile, stat } from "fs/promises";
import { join, basename } from "path";
import config from "@/lib/config";
import { checkAuth } from "@/lib/api-auth";
import { apiSuccess, apiError } from "@/lib/api-response";
import { BadRequest, NotFound, Unauthorized } from "@/lib/api-errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/sessions/[name]/recording
 *
 * Serves JSONL log files from agents/logs/ for session replay.
 * Finds the most recent .jsonl file matching the session name.
 *
 * Query params:
 *   ?file=<filename>    serve a specific log file
 *   ?list=1             list available recordings for this session
 *
 * Returns:
 *   application/x-ndjson   raw JSONL log content (default)
 *   application/json        list of available recordings (?list=1)
 */

const LOGS_DIR = join(config.root, "agents", "logs");

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  if (!(await checkAuth(request))) {
    return apiError(new Unauthorized());
  }
  const { name } = await params;
  const { searchParams } = new URL(request.url);

  if (!name) {
    return apiError(new BadRequest("session name required"));
  }

  try {
    const files = await readdir(LOGS_DIR).catch(() => [] as string[]);
    const matching = files
      .filter(
        (f) =>
          f.endsWith(".jsonl") &&
          f.startsWith(name)
      )
      .sort()
      .reverse(); // newest first (files include timestamp)

    // list mode: return available recordings
    if (searchParams.has("list")) {
      const recordings = await Promise.all(
        matching.map(async (f) => {
          const filePath = join(LOGS_DIR, f);
          const st = await stat(filePath).catch(() => null);
          return {
            file: f,
            session: name,
            size: st?.size ?? 0,
            modified: st?.mtime?.toISOString() ?? null,
          };
        })
      );
      return apiSuccess({ recordings });
    }

    // specific file or most recent
    const targetFile = searchParams.get("file");
    let logFile: string | undefined;

    if (targetFile) {
      // sanitize: only allow basename, no path traversal
      const safe = basename(targetFile);
      if (files.includes(safe)) {
        logFile = safe;
      }
    } else {
      logFile = matching[0];
    }

    if (!logFile) {
      return apiError(new NotFound("recording", name));
    }

    const content = await readFile(join(LOGS_DIR, logFile), "utf-8");

    return new NextResponse(content, {
      status: 200,
      headers: {
        "Content-Type": "application/x-ndjson",
        "Content-Disposition": `inline; filename="${logFile}"`,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (err) {
    return apiError(err);
  }
}
