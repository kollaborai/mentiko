import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/auth/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { apiSuccess, withErrorHandling } from "@/lib/api-response";
import { BadRequest, NotFound, ServiceUnavailable, Unauthorized } from "@/lib/api-errors";
import { readOnboardingState } from "@/lib/onboarding/onboarding-state";
import { getSecretValue } from "@/lib/secrets/secrets-store";

const MAX_LIMIT = 50;
const GITHUB_HEADERS = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};

type GitHubRepository = {
  id: number;
  full_name: string;
  name: string;
  owner?: { login?: string };
  private?: boolean;
  visibility?: string;
  default_branch?: string;
  language?: string | null;
  updated_at?: string | null;
  permissions?: { admin?: boolean; push?: boolean; pull?: boolean; maintain?: boolean; triage?: boolean };
};

function safeRepository(repo: GitHubRepository) {
  return {
    id: repo.id,
    full_name: repo.full_name,
    name: repo.name,
    owner: repo.owner?.login ?? repo.full_name.split("/")[0],
    visibility: repo.visibility ?? (repo.private ? "private" : "public"),
    default_branch: repo.default_branch ?? "main",
    language: repo.language ?? null,
    updated_at: repo.updated_at ?? null,
    permissions: repo.permissions ?? {},
  };
}

export const GET = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) throw new Unauthorized();
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const state = readOnboardingState(namespaceId, orgId);
  const tokenSecretId = (state.github.account as { tokenSecretId?: string } | null)?.tokenSecretId;
  if (state.github.status !== "connected" || !tokenSecretId) {
    throw new NotFound("GitHub connection");
  }
  const token = getSecretValue(namespaceId, orgId, tokenSecretId);
  if (!token) throw new ServiceUnavailable("GitHub connection requires reauthorization");

  const params = request.nextUrl.searchParams;
  const query = (params.get("query") ?? params.get("q") ?? "").trim();
  const owner = (params.get("owner") ?? "").trim().toLowerCase();
  const visibility = (params.get("visibility") ?? "").trim().toLowerCase();
  const limitRaw = Number(params.get("limit") ?? 25);
  if (!Number.isInteger(limitRaw) || limitRaw < 1) throw new BadRequest("limit must be a positive integer");
  const limit = Math.min(limitRaw, MAX_LIMIT);
  const cursorRaw = params.get("cursor") ?? "1";
  const page = Number(cursorRaw);
  if (!Number.isInteger(page) || page < 1 || page > 1000) throw new BadRequest("cursor must be a valid page");

  const url = new URL("https://api.github.com/user/repos");
  url.searchParams.set("per_page", String(limit));
  url.searchParams.set("page", String(page));
  url.searchParams.set("sort", "updated");
  url.searchParams.set("direction", "desc");
  url.searchParams.set("affiliation", "owner,collaborator,organization_member");
  if (visibility === "public" || visibility === "private") url.searchParams.set("visibility", visibility);

  const response = await fetch(url.toString(), { headers: { ...GITHUB_HEADERS, Authorization: `Bearer ${token}` } });
  if (response.status === 401 || response.status === 403) throw new ServiceUnavailable("GitHub connection requires reauthorization");
  if (!response.ok) throw new ServiceUnavailable("GitHub repository listing is unavailable");
  const payload = await response.json() as GitHubRepository[];
  const repositories = payload
    .filter((repo) => !owner || (repo.owner?.login ?? "").toLowerCase() === owner)
    .filter((repo) => !query || repo.full_name.toLowerCase().includes(query.toLowerCase()) || repo.name.toLowerCase().includes(query.toLowerCase()))
    .map(safeRepository);
  return apiSuccess({ repositories, nextCursor: payload.length === limit ? String(page + 1) : null, limit });
});
