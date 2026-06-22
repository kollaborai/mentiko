export const OPEN_FLOATING_APP_PANEL_EVENT = "open-floating-app-panel";

const FLOATING_PANEL_ROUTE_PREFIXES = [
  "/dashboard",
  "/updates",
  "/docs",
  "/runs",
  "/tasks",
  "/conversations",
  "/activity",
  "/schedules",
  "/chains",
  "/links",
  "/agents",
  "/artifacts",
  "/generation",
  "/email",
  "/webhooks",
  "/events",
  "/marketplace",
  "/settings",
  "/workspaces",
  "/preview",
];

export interface FloatingAppPanelRequest {
  href: string;
  title: string;
}

export function isFloatingPanelRoute(href: string) {
  if (!href.startsWith("/") || href.startsWith("//")) return false;
  let pathname: string;
  try {
    pathname = new URL(href, "http://mentiko.local").pathname;
  } catch {
    return false;
  }
  return FLOATING_PANEL_ROUTE_PREFIXES.some((prefix) => (
    pathname === prefix || pathname.startsWith(`${prefix}/`)
  ));
}

export function getFloatingPanelSrc(href: string) {
  const url = new URL(href, "http://mentiko.local");
  url.searchParams.set("surface", "panel");
  return `${url.pathname}${url.search}${url.hash}`;
}

export function getFloatingPanelRouteTitle(route: string) {
  try {
    const { pathname } = new URL(route, "http://mentiko.local");
    const lastSegment = pathname.split("/").filter(Boolean).pop();
    if (!lastSegment) return "Dashboard";
    return lastSegment
      .split("-")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  } catch {
    return "Workspace";
  }
}

export function isFloatingPanelFrameRequest(pathname: string, searchParams: URLSearchParams) {
  return searchParams.get("surface") === "panel" && isFloatingPanelRoute(pathname);
}

export function isFloatingPanelSurface(searchParams: Pick<URLSearchParams, "get">, isEmbeddedFrame = false) {
  return isEmbeddedFrame || searchParams.get("surface") === "panel";
}

export function applyFloatingPanelFrameHeaders(headers: Headers) {
  headers.set("x-frame-options", "SAMEORIGIN");

  const csp = headers.get("content-security-policy");
  if (!csp) return;

  const directives = csp
    .split(";")
    .map((directive) => directive.trim())
    .filter(Boolean)
    .filter((directive) => !directive.toLowerCase().startsWith("frame-ancestors"));
  directives.push("frame-ancestors 'self'");
  headers.set("content-security-policy", directives.join("; "));
}
