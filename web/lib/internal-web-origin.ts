function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "localhost" || host === "::1" || host.startsWith("127.");
}

function parsedOrigin(value?: string): URL | null {
  if (!value) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function resolveInternalWebOrigin(requestOrigin?: string): string {
  const configured = process.env.MENTIKO_INTERNAL_WEB_ORIGIN?.trim();
  if (configured) return trimTrailingSlash(configured);

  const requestUrl = parsedOrigin(requestOrigin);
  if (requestUrl && isLoopbackHost(requestUrl.hostname)) {
    return requestUrl.origin;
  }

  return `http://127.0.0.1:${process.env.WEB_PORT || process.env.PORT || "3000"}`;
}

export function internalApiUrl(path: string, requestOrigin?: string): string {
  const origin = resolveInternalWebOrigin(requestOrigin);
  return new URL(path, `${origin}/`).toString();
}
