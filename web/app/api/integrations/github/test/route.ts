import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/api-auth";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { BadRequest, Unauthorized } from "@/lib/api-errors";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }
  const body = await request.json();
  const { token, owner, repo } = body;

  if (!token) {
    throw new BadRequest("token is required");
  }

  const results: Record<string, unknown> = { token: null, repo: null };

  const userResp = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (userResp.ok) {
    const user = await userResp.json() as Record<string, unknown>;
    results.token = {
      success: true,
      login: user.login,
      name: user.name,
    };
  } else {
    const err = await userResp.json().catch(() => ({})) as Record<string, unknown>;
    results.token = {
      success: false,
      error: (err.message as string | undefined) || "invalid token",
    };
    return apiSuccess(results);
  }

  if (owner && repo) {
    const repoResp = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (repoResp.ok) {
      const repoData = await repoResp.json() as Record<string, unknown>;
      results.repo = {
        success: true,
        full_name: repoData.full_name,
        private: repoData.private,
        permissions: repoData.permissions || {},
      };
    } else {
      const err = await repoResp.json().catch(() => ({})) as Record<string, unknown>;
      results.repo = {
        success: false,
        error: (err.message as string | undefined) || "repo not accessible",
      };
    }
  }

  return apiSuccess(results);
});
