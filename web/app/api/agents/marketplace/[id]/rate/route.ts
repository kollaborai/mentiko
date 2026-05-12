import { NextRequest } from "next/server";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { nsPath } from "@/lib/config";
import { checkAuth } from "@/lib/api-auth";
import { getNamespaceIdFromRequest } from "@/lib/namespace-config";
import { BadRequest, InternalServerError } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

interface Rating {
  average: number;
  count: number;
  distribution: Record<number, number>;
  use_count?: number;
}

interface AgentRatings {
  [agentId: string]: Rating;
}

function getRatingsFile(namespaceId: string): string {
  return nsPath(namespaceId, "ratings.json");
}

function getRatings(namespaceId: string): AgentRatings {
  const ratingsFile = getRatingsFile(namespaceId);
  if (existsSync(ratingsFile)) {
    try {
      return JSON.parse(readFileSync(ratingsFile, "utf-8"));
    } catch {
      return {};
    }
  }
  return {};
}

function saveRatings(ratings: AgentRatings, namespaceId: string) {
  const ratingsFile = getRatingsFile(namespaceId);
  const dir = join(ratingsFile, "..");
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(ratingsFile, JSON.stringify(ratings, null, 2));
  } catch {
    // ratings write failed (read-only filesystem, permissions) - non-fatal
    console.warn("[marketplace] failed to save ratings to", ratingsFile);
  }
}

function calculateAverage(distribution: Record<number, number>): number {
  let sum = 0;
  let total = 0;
  for (const [stars, count] of Object.entries(distribution)) {
    sum += parseInt(stars, 10) * count;
    total += count;
  }
  return total > 0 ? Math.round((sum / total) * 10) / 10 : 0;
}

interface Context {
  params: Promise<{ id: string }>;
}

export const POST = withErrorHandling(async (request: NextRequest, context: Context) => {
  if (!(await checkAuth(request))) {
    throw new InternalServerError("Authentication check failed");
  }

  const { id } = await context.params;
  const { rating } = await request.json();
  const namespaceId = await getNamespaceIdFromRequest(request);

  if (typeof rating !== "number" || rating < 1 || rating > 5) {
    throw new BadRequest("Rating must be between 1 and 5", { field: "rating" });
  }

  const ratings = getRatings(namespaceId);
  const current = ratings[id] || {
    average: 0,
    count: 0,
    distribution: {},
    use_count: 0,
  };

  const stars = Math.round(rating);
  current.distribution[stars] = (current.distribution[stars] || 0) + 1;
  current.count++;
  current.average = calculateAverage(current.distribution);

  ratings[id] = current;
  saveRatings(ratings, namespaceId);

  return apiSuccess({
    agentId: id,
    rating: current.average,
    count: current.count,
    distribution: current.distribution,
    use_count: current.use_count || 0,
  });
});

export const GET = withErrorHandling(async (request: NextRequest, context: Context) => {
  if (!(await checkAuth(request))) {
    throw new InternalServerError("Authentication check failed");
  }

  const { id } = await context.params;
  const namespaceId = await getNamespaceIdFromRequest(request);
  const ratings = getRatings(namespaceId);

  if (!ratings[id]) {
    return apiSuccess({
      agentId: id,
      rating: 0,
      count: 0,
      distribution: {},
      use_count: 0,
    });
  }

  return apiSuccess({
    agentId: id,
    ...ratings[id],
  });
});
