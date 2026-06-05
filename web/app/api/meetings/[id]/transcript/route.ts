/**
 * GET /api/meetings/{id}/transcript
 *
 * returns all transcript entries for a meeting, ordered by epoch.
 * reads from peer-output dir, matching files that contain the meeting
 * timestamp in their filename.
 */

import { NextRequest } from "next/server";
import { join } from "path";
import { readdirSync, readFileSync } from "fs";
import { getNamespaceIdFromRequest } from "@/lib/namespace-config";
import { requirePermission } from "@/lib/auth/rbac-auth";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { BadRequest, NotFound } from "@/lib/api-errors";
import { resolvePeerOutputDir } from "@/lib/links/link-run-runtime";

export const dynamic = "force-dynamic";

export const runtime = "nodejs";

interface TranscriptEntry {
  role: "red" | "blue";
  session: string;
  round: number;
  epoch: number;
  text: string;
}

const MEETING_ID_RE = /^\d{8}-\d{6}$/;

export const GET = withErrorHandling(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const perm = await requirePermission(request, "view_chains");
  if (perm) return perm;

  const { id: meetingId } = await params;
  if (!MEETING_ID_RE.test(meetingId)) {
    throw new BadRequest("Invalid meeting ID");
  }

  const namespaceId = await getNamespaceIdFromRequest(request);
  const peerOutputDir = resolvePeerOutputDir(namespaceId);

  let files: string[];
  try {
    files = readdirSync(peerOutputDir);
  } catch {
    throw new NotFound("Meeting", meetingId);
  }

  // match files containing the meeting timestamp
  // filename: {role}-{topic}-{timestamp}-r{round}-{epoch}.txt
  // the timestamp IS the meetingId (e.g. "20260321-234120")
  const re = new RegExp(
    `^(red|blue)-(.+)-${meetingId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-r(\\d+)-(\\d+)\\.txt$`
  );

  const transcript: TranscriptEntry[] = [];

  for (const f of files) {
    const m = f.match(re);
    if (!m) continue;

    const [, role, topic, roundStr, epochStr] = m;
    const text = readFileSync(join(peerOutputDir, f), "utf-8");

    transcript.push({
      role: role as "red" | "blue",
      session: `${role}-${topic}-${meetingId}`,
      round: parseInt(roundStr, 10),
      epoch: parseInt(epochStr, 10),
      text,
    });
  }

  if (transcript.length === 0) {
    throw new NotFound("Meeting transcript", meetingId);
  }

  // sort by epoch (chronological)
  transcript.sort((a, b) => a.epoch - b.epoch);

  return apiSuccess({ transcript });
});
