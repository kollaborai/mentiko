/** @jest-environment node */

import {
  sanitizeTaskAttachmentFilename,
  sniffImageMime,
  taskAttachmentExtForMime,
  validateTaskAttachmentFile,
} from "../task-attachment-validation";

const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_HEAD = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const GIF_HEAD = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const WEBP_HEAD = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);
const TEXT_HEAD = Buffer.from("<?php echo 1; ?>");

describe("task-attachment-validation", () => {
  describe("validateTaskAttachmentFile", () => {
    it("accepts an image whose magic bytes agree with the declared type", () => {
      expect(
        validateTaskAttachmentFile({ size: 1024, contentType: "image/png", head: PNG_HEAD })
      ).toEqual({ valid: true });
      expect(
        validateTaskAttachmentFile({ size: 1024, contentType: "image/jpeg", head: JPEG_HEAD })
      ).toEqual({ valid: true });
      expect(
        validateTaskAttachmentFile({ size: 1024, contentType: "image/gif", head: GIF_HEAD })
      ).toEqual({ valid: true });
      expect(
        validateTaskAttachmentFile({ size: 1024, contentType: "image/webp", head: WEBP_HEAD })
      ).toEqual({ valid: true });
    });

    it("rejects empty files and oversize files", () => {
      expect(
        validateTaskAttachmentFile({ size: 0, contentType: "image/png", head: PNG_HEAD }).reason
      ).toBe("empty_file");
      expect(
        validateTaskAttachmentFile({
          size: 10 * 1024 * 1024 + 1,
          contentType: "image/png",
          head: PNG_HEAD,
        }).reason
      ).toBe("file_too_large");
    });

    it("rejects disallowed content types", () => {
      expect(
        validateTaskAttachmentFile({ size: 10, contentType: "application/zip", head: TEXT_HEAD })
          .reason
      ).toBe("invalid_mime_type");
    });

    it("rejects content that does not sniff as an image (spoof attempt)", () => {
      const result = validateTaskAttachmentFile({
        size: 64,
        contentType: "image/png",
        head: TEXT_HEAD,
      });
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("mime_mismatch");
    });

    it("rejects mismatched image formats (declared type != sniffed type)", () => {
      const result = validateTaskAttachmentFile({
        size: 64,
        contentType: "image/jpeg",
        head: PNG_HEAD,
      });
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("mime_mismatch");
    });
  });

  describe("sniffImageMime", () => {
    it("identifies png, jpeg, gif87a, gif89a, and webp signatures", () => {
      expect(sniffImageMime(PNG_HEAD)).toBe("image/png");
      expect(sniffImageMime(JPEG_HEAD)).toBe("image/jpeg");
      expect(sniffImageMime(Buffer.from("GIF87a..."))).toBe("image/gif");
      expect(sniffImageMime(GIF_HEAD)).toBe("image/gif");
      expect(sniffImageMime(WEBP_HEAD)).toBe("image/webp");
      expect(sniffImageMime(TEXT_HEAD)).toBeNull();
      expect(sniffImageMime(new Uint8Array(4))).toBeNull();
    });
  });

  describe("taskAttachmentExtForMime", () => {
    it("maps allowlisted types to canonical extensions and others to empty", () => {
      expect(taskAttachmentExtForMime("image/png")).toBe(".png");
      expect(taskAttachmentExtForMime("image/jpeg")).toBe(".jpg");
      expect(taskAttachmentExtForMime("image/gif")).toBe(".gif");
      expect(taskAttachmentExtForMime("image/webp")).toBe(".webp");
      expect(taskAttachmentExtForMime("application/zip")).toBe("");
    });
  });

  describe("sanitizeTaskAttachmentFilename", () => {
    it("strips path components and control characters", () => {
      expect(sanitizeTaskAttachmentFilename("../../etc/passwd.png")).toBe("passwd.png");
      expect(sanitizeTaskAttachmentFilename("C:\\evil\\..\\shot.png")).toBe("shot.png");
      expect(sanitizeTaskAttachmentFilename("a\u0000b\u001f.png")).toBe("ab.png");
    });

    it("falls back to a safe name for empty or dot-only input", () => {
      expect(sanitizeTaskAttachmentFilename("")).toBe("unnamed");
      expect(sanitizeTaskAttachmentFilename("..")).toBe("unnamed");
      expect(sanitizeTaskAttachmentFilename(".")).toBe("unnamed");
    });

    it("caps length at 255 characters", () => {
      expect(sanitizeTaskAttachmentFilename("x".repeat(400) + ".png").length).toBe(255);
    });
  });
});
