import { opsGet } from "./ops-client.js";

export async function listDir(path: string) {
  return await opsGet(`/api/mentiko-mcp/ops/fs?action=list_dir&path=${encodeURIComponent(path)}`);
}

export async function tree(path: string, depth = 2) {
  return await opsGet(`/api/mentiko-mcp/ops/fs?action=tree&path=${encodeURIComponent(path)}&depth=${depth}`);
}

export async function findFiles(path: string, pattern: string, maxResults = 20) {
  return await opsGet(
    `/api/mentiko-mcp/ops/fs?action=find_files&path=${encodeURIComponent(path)}&pattern=${encodeURIComponent(pattern)}&maxResults=${maxResults}`,
  );
}
