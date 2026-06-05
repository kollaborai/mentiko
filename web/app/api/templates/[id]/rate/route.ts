import { NextRequest } from "next/server";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { checkAuth } from "@/lib/auth/api-auth";
import { getNamespaceIdFromRequest } from "@/lib/namespace-config";
import { nsPath } from "@/lib/config";
import { Unauthorized, BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

interface Rating {
  average: number;
  count: number;
  distribution: Record<number, number>;
  use_count?: number;
}

interface TemplateRatings {
  [templateId: string]: Rating;
}

interface Context {
  params: Promise<{ id: string }>;
}

function getRatingsFile(namespaceId: string): string {
  return nsPath(namespaceId, "ratings.json");
}

function getRatings(namespaceId: string): TemplateRatings {
  const file = getRatingsFile(namespaceId);
  if (existsSync(file)) {
    try {
      const content = readFileSync(file, "utf-8");
      return JSON.parse(content);
    } catch {
      return {};
    }
  }
  return {};
}

function saveRatings(ratings: TemplateRatings, namespaceId: string) {
  writeFileSync(getRatingsFile(namespaceId), JSON.stringify(ratings, null, 2));
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

export const POST = withErrorHandling(async (request: NextRequest, context: Context) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const { id } = await context.params;
  const { rating } = await request.json();
  const namespaceId = await getNamespaceIdFromRequest(request);

  if (typeof rating !== "number" || rating < 1 || rating > 5) {
    throw new BadRequest("Rating must be between 1 and 5");
  }

  const ratings = getRatings(namespaceId);
  const current = ratings[id] || { average: 0, count: 0, distribution: {}, use_count: 0 };

  // update distribution
  const stars = Math.round(rating);
  current.distribution[stars] = (current.distribution[stars] || 0) + 1;
  current.count++;
  current.average = calculateAverage(current.distribution);

  ratings[id] = current;
  saveRatings(ratings, namespaceId);

  return apiSuccess({
    templateId: id,
    rating: current.average,
    count: current.count,
    distribution: current.distribution,
    use_count: current.use_count || 0,
  });
});

export const GET = withErrorHandling(async (request: NextRequest, context: Context) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const { id } = await context.params;
  const namespaceId = await getNamespaceIdFromRequest(request);
  const ratings = getRatings(namespaceId);

  if (!ratings[id]) {
    return apiSuccess({
      templateId: id,
      rating: 0,
      count: 0,
      distribution: {},
      use_count: 0,
    });
  }

  return apiSuccess({
    templateId: id,
    ...ratings[id],
  });
});
