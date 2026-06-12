const SESSION_COOKIE_NAMES = [
  "__Secure-better-auth.session_token",
  "better-auth.session_token",
];

function hasSessionCookie(cookieHeader: string | null): boolean {
  if (!cookieHeader) return false;
  return cookieHeader
    .split(";")
    .some((part) => {
      const name = part.trim().split("=", 1)[0];
      return SESSION_COOKIE_NAMES.includes(name);
    });
}

export function headersForCookieSession(headers: Headers): Headers {
  const nextHeaders = new Headers(headers);
  if (hasSessionCookie(nextHeaders.get("cookie"))) {
    nextHeaders.delete("authorization");
  }
  return nextHeaders;
}

export function requestForCookieSession(request: Request): Request {
  const headers = headersForCookieSession(request.headers);
  if (!request.headers.get("authorization") || headers.get("authorization")) {
    return request;
  }
  return new Request(request, { headers });
}
