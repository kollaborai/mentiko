import { Unauthorized } from "./api-errors";
import { resolveAppSecret } from "./dev-secret";
import { timingSafeEqual } from "./security";

interface InternalAuthOptions {
  allowDevLocalhost?: boolean;
}

function isLoopbackAddress(value: string): boolean {
  const host = value.trim().split(",")[0].trim().replace(/^\[/, "").replace(/\]$/, "");
  return (
    host === "" ||
    host === "::1" ||
    host === "localhost" ||
    host.startsWith("127.")
  );
}

function requestHost(request: Request): string {
  const host = request.headers.get("host") || "";
  return host.split(":")[0].toLowerCase();
}

export function isDevLocalInternalRequest(request: Request): boolean {
  if (process.env.NODE_ENV === "production") return false;
  if (process.env.BETTER_AUTH_SECRET) return false;
  if (process.env.DATABASE_URL) return false;

  const host = requestHost(request);
  const forwarded = request.headers.get("x-forwarded-for") || "";
  const realIp = request.headers.get("x-real-ip") || "";

  return (
    isLoopbackAddress(host) &&
    isLoopbackAddress(forwarded) &&
    isLoopbackAddress(realIp)
  );
}

export function resolveInternalAuthSecret(context: string): string {
  return resolveAppSecret(context);
}

export function hasInternalAuth(
  request: Request,
  context: string,
  { allowDevLocalhost = true }: InternalAuthOptions = {},
): boolean {
  if (allowDevLocalhost && isDevLocalInternalRequest(request)) {
    return true;
  }

  const auth = request.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return false;

  const token = auth.slice("Bearer ".length);
  const secret = resolveInternalAuthSecret(context);
  return timingSafeEqual(token, secret);
}

export function requireInternalAuth(
  request: Request,
  context: string,
  options?: InternalAuthOptions,
): void {
  if (!hasInternalAuth(request, context, options)) {
    throw new Unauthorized();
  }
}
