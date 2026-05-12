import { opsGet, opsPost } from "./ops-client.js";

export async function readFile(path: string) {
  return await opsGet<{ path: string; content: string; size: number }>(
    "/api/mentiko-mcp/ops/files",
    { path },
  );
}

export async function writeFile(path: string, content: string, mode?: string) {
  return await opsPost<{ path: string; bytes: number }>(
    "/api/mentiko-mcp/ops/files",
    { path, content, mode },
  );
}
