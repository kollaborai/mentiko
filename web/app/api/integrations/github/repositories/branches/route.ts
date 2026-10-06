import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/auth/api-auth";
import { apiSuccess, withErrorHandling } from "@/lib/api-response";
import { BadRequest, NotFound, ServiceUnavailable, Unauthorized } from "@/lib/api-errors";
import { getOnboardingGithubToken, GITHUB_API_HEADERS } from "@/lib/integrations/gh-token";

const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export const GET = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) throw new Unauthorized();
  const repo = (request.nextUrl.searchParams.get("repo") || "").trim().replace(/\.git$/, "");
  if (!REPO.test(repo)) throw new BadRequest("repo must be owner/name");
  const token = await getOnboardingGithubToken(request);
  if (!token) throw new NotFound("GitHub connection");

  const response = await fetch(`https://api.github.com/repos/${repo}/branches?per_page=100`, {
    headers: { ...GITHUB_API_HEADERS, Authorization: `Bearer ${token}` },
  });
  if (response.status === 401 || response.status === 403) throw new ServiceUnavailable("GitHub connection requires reauthorization");
  if (!response.ok) throw new ServiceUnavailable("GitHub branch listing is unavailable");
  const payload = (await response.json()) as { name?: string }[];
  const branches = payload.map((b) => b.name).filter((n): n is string => Boolean(n));
  return apiSuccess({ branches });
});
