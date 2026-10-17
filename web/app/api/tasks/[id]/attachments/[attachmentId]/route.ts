/**
 * GET /api/tasks/[id]/attachments/[attachmentId]
 *
 * Streams one stored attachment blob so <img> tags can render task images
 * (FEAT-001/TASK-006). Metadata comes from the row (taskAttachmentGet);
 * bytes are read from attachmentBlobPath(), the same path contract the
 * TASK-004 store writes. No directory listing, no path input from clients:
 * the blob filename is derived from the row, never from the URL.
 */

import { NextRequest, NextResponse } from "next/server";
import { statSync, readFileSync } from "fs";
import { join } from "path";
import config from "@/lib/config";
import { requirePermission } from "@/lib/auth/api-auth";
import { NotFound } from "@/lib/api-errors";
import { withErrorHandling } from "@/lib/api-response";
import { enforceGuestWrites } from "@/lib/middleware";
import {
  getNamespaceIdFromRequest,
  getOrgIdFromRequest,
} from "@/lib/namespace-config";
import { taskAttachmentGet } from "@/lib/tasks/task-attachment-store";
import { attachmentBlobPath } from "@/lib/tasks/task-attachment-types";

export const GET = requirePermission("view_tasks")(
  withErrorHandling(
    async (
      request: NextRequest,
      context: { params: Promise<{ id: string; attachmentId: string }> }
    ) => {
      const namespaceId = await getNamespaceIdFromRequest(request);
      const orgId = await getOrgIdFromRequest(request);
      const { id, attachmentId } = await context.params;
      const taskId = decodeURIComponent(id);

      const attachment = taskAttachmentGet(orgId, taskId, attachmentId, namespaceId);
      if (!attachment || attachment.status !== "stored") {
        throw new NotFound("Attachment", attachmentId);
      }

      const namespaceRoot = join(config.globalRoot, "namespaces", namespaceId ?? "default");
      const ext = attachment.storedFilename.slice(attachment.storedFilename.lastIndexOf("."));
      const blobPath = attachmentBlobPath(namespaceRoot, orgId, taskId, attachmentId, ext);

      let bytes: Buffer;
      try {
        statSync(blobPath);
        bytes = readFileSync(blobPath);
      } catch {
        // row exists but the blob is gone (out-of-band deletion): surface as
        // 404 rather than a 500 so the UI treats it like a missing image.
        throw new NotFound("Attachment blob", attachmentId);
      }

      return new NextResponse(new Uint8Array(bytes), {
        status: 200,
        headers: {
          "Content-Type": attachment.contentType,
          "Content-Length": String(bytes.length),
          "Cache-Control": "private, max-age=3600",
          // allow the image to be embedded by same-origin pages only
          "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
  )
);
