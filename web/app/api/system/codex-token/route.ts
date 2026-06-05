import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { checkAuth } from "@/lib/auth/api-auth";
import { apiSuccess, withErrorHandling } from "@/lib/api-response";
import { Unauthorized } from "@/lib/api-errors";

export const dynamic = "force-dynamic";

function firstString(value: unknown): string | null {
  if (typeof value === "string") {
    const token = value.trim();
    return token.length > 0 ? token : null;
  }
  return null;
}

function extractTokenFromValue(value: unknown, priorityKeys: string[] = []): string | null {
  if (!value || typeof value !== "object") return null;

  const obj = value as Record<string, unknown>;

  for (const key of priorityKeys) {
    const token = firstString(obj[key]);
    if (token) return token;
  }

  const token = firstString(obj.tokens);
  if (token) return token;

  for (const [k, v] of Object.entries(obj)) {
    const lower = k.toLowerCase();

    const direct = firstString(v);
    if (direct && (lower.includes("token") || lower.includes("api_key") || lower.includes("openai"))) {
      return direct;
    }

    if (typeof v === "object") {
      const nested = extractTokenFromValue(v, []);
      if (nested) return nested;
    }
  }

  return null;
}

function readCodexToken(): string | null {
  const authPath = join(homedir(), ".codex", "auth.json");
  if (!existsSync(authPath)) return null;

  try {
    const data = JSON.parse(readFileSync(authPath, "utf-8"));
    return extractTokenFromValue(data, ["OPENAI_API_KEY", "api_key", "apiKey"]);
  } catch {
    return null;
  }
}

export const GET = withErrorHandling(async (request: Request) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const token = readCodexToken();
  const hasToken = !!token;

  return apiSuccess({
    hasToken,
    token: hasToken ? token : null,
  });
});
