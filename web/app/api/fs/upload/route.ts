import { NextRequest } from "next/server";
import { existsSync, mkdirSync, unlinkSync, readdirSync, createWriteStream } from "fs";
import { join, extname, basename } from "path";
import { execSync, ExecSyncOptionsWithBufferEncoding } from "child_process";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import os from "os";
import { checkAuth } from "@/lib/api-auth";
import { resolveAndValidate, getAllowedRoots } from "@/lib/path-validation";
import { BadRequest, Forbidden, InternalServerError, Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

// allow large uploads in Next.js App Router
export const maxDuration = 120; // 2 min timeout for large files

const MAX_FILE_SIZE = 1500 * 1024 * 1024; // 1.5GB

const ALLOWED_EXTENSIONS = new Set([".zip", ".tar", ".tar.gz", ".tgz"]);

const ALLOWED_MIMES = new Set([
  "application/zip",
  "application/x-zip-compressed",
  "application/x-tar",
  "application/gzip",
  "application/x-gzip",
  "application/x-compressed-tar",
  "application/octet-stream",
]);

function getExtension(filename: string): string {
  if (filename.endsWith(".tar.gz")) return ".tar.gz";
  return extname(filename).toLowerCase();
}

function stripExtension(filename: string): string {
  if (filename.endsWith(".tar.gz")) return filename.slice(0, -7);
  if (filename.endsWith(".tgz")) return filename.slice(0, -4);
  if (filename.endsWith(".tar")) return filename.slice(0, -4);
  if (filename.endsWith(".zip")) return filename.slice(0, -4);
  return filename;
}

export const POST = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const extractTo = formData.get("extractTo") as string | null;

  if (!file) {
    throw new BadRequest("file is required", { field: "file" });
  }

  if (!extractTo) {
    throw new BadRequest("extractTo is required", { field: "extractTo" });
  }

  // validate file size
  if (file.size > MAX_FILE_SIZE) {
    throw new BadRequest("file exceeds 500MB limit", { field: "file", maxBytes: MAX_FILE_SIZE });
  }

  // validate extension
  const ext = getExtension(file.name);
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new BadRequest("unsupported file type, allowed: .zip, .tar, .tar.gz, .tgz", {
      field: "file",
      extension: ext,
    });
  }

  // validate MIME type
  if (!ALLOWED_MIMES.has(file.type)) {
    throw new BadRequest("unsupported MIME type", {
      field: "file",
      mimeType: file.type,
    });
  }

  // resolve and validate extractTo path against allowed roots
  const expanded = extractTo.startsWith("~")
    ? join(os.homedir(), extractTo.slice(1))
    : extractTo;

  const allowedRoots = await getAllowedRoots(request);
  const targetDir = resolveAndValidate(expanded, allowedRoots);
  if (!targetDir) {
    throw new Forbidden("Extraction path not within any registered workspace");
  }

  // validate target directory is within allowed roots
  const validated = resolveAndValidate(targetDir, await getAllowedRoots(request));
  if (!validated) {
    throw new Forbidden("Extraction path not within any registered workspace");
  }

  // create a subfolder named after the project inside the target
  const projectName = stripExtension(basename(file.name));
  const projectDir = join(validated, projectName);

  // ensure project directory exists
  if (!existsSync(projectDir)) {
    try {
      mkdirSync(projectDir, { recursive: true });
    } catch {
      throw new BadRequest("cannot create project directory", { field: "extractTo", path: projectDir });
    }
  }

  // stream uploaded file to temp location (avoids loading entire file into memory)
  const tmpFile = join(os.tmpdir(), `upload-${Date.now()}-${basename(file.name)}`);
  try {
    const webStream = file.stream();
    const nodeStream = Readable.fromWeb(webStream as Parameters<typeof Readable.fromWeb>[0]);
    await pipeline(nodeStream, createWriteStream(tmpFile));
  } catch (_writeErr) {
    throw new InternalServerError("failed to write temp file");
  }

  // extract based on extension
  try {
    let cmd: string;
    switch (ext) {
      case ".zip":
        cmd = `unzip -o ${JSON.stringify(tmpFile)} -d ${JSON.stringify(projectDir)}`;
        break;
      case ".tar.gz":
      case ".tgz":
        cmd = `tar xzf ${JSON.stringify(tmpFile)} -C ${JSON.stringify(projectDir)}`;
        break;
      case ".tar":
        cmd = `tar xf ${JSON.stringify(tmpFile)} -C ${JSON.stringify(projectDir)}`;
        break;
      default:
        throw new BadRequest("unsupported file type");
    }

    execSync(cmd, {
      timeout: 60000,
      stdio: "pipe",
    } as ExecSyncOptionsWithBufferEncoding);
  } catch (extractErr) {
    // clean up temp file before throwing
    try { unlinkSync(tmpFile); } catch { /* ignore */ }
    if (extractErr instanceof BadRequest) throw extractErr;
    const err = extractErr as { stderr?: Buffer | string; message?: string };
    const stderr = err.stderr ? err.stderr.toString().trim() : "";
    const msg = stderr.split("\n")[0] || err.message || "extraction failed";
    throw new InternalServerError(msg);
  }

  // clean up temp file
  try { unlinkSync(tmpFile); } catch { /* ignore */ }

  // count extracted files
  let fileCount = 0;
  try {
    const entries = readdirSync(projectDir);
    fileCount = entries.length;
  } catch { /* ignore */ }

  return apiSuccess({ path: projectDir, name: projectName, fileCount });
});
