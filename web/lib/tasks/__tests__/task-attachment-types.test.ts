/** @jest-environment node */

import {
  attachmentBlobPath,
  attachmentTaskBlobDir,
  newTaskAttachmentId,
  taskAttachmentStoredFilename,
  TASK_ATTACHMENT_ALLOWED_MIME_TYPES,
  TASK_ATTACHMENT_MAX_BYTES,
} from "../task-attachment-types";

describe("task-attachment-types", () => {
  it("pins the 10MB size limit and image-only allowlist", () => {
    expect(TASK_ATTACHMENT_MAX_BYTES).toBe(10 * 1024 * 1024);
    expect([...TASK_ATTACHMENT_ALLOWED_MIME_TYPES]).toEqual([
      "image/png",
      "image/jpeg",
      "image/gif",
      "image/webp",
    ]);
  });

  it("derives canonical blob paths under the namespace data root", () => {
    expect(
      attachmentBlobPath("/ns-root", "org1", "TASK-001", "att_x", ".png")
    ).toBe("/ns-root/data/task-attachments/org1/TASK-001/att_x.png");
    expect(
      attachmentTaskBlobDir("/ns-root", "org1", "TASK-001")
    ).toBe("/ns-root/data/task-attachments/org1/TASK-001");
  });

  it("builds stored filenames from the server id plus a normalized extension", () => {
    expect(taskAttachmentStoredFilename("att_x", ".png")).toBe("att_x.png");
    expect(taskAttachmentStoredFilename("att_x", "PNG")).toBe("att_x.png");
    expect(taskAttachmentStoredFilename("att_x", "")).toBe("att_x");
  });

  it("generates opaque, non-empty, unique attachment ids", () => {
    const a = newTaskAttachmentId();
    const b = newTaskAttachmentId();
    expect(a).toMatch(/^att_[0-9a-z]+_[0-9a-f]{24}$/);
    expect(a).not.toBe(b);
  });
});
