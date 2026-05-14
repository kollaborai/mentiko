import {
  applyFloatingPanelFrameHeaders,
  getFloatingPanelRouteTitle,
  getFloatingPanelSrc,
  isFloatingPanelFrameRequest,
  isFloatingPanelRoute,
  isFloatingPanelSurface,
} from "../floating-app-panel-routing";

describe("floating app panel routing", () => {
  it("allows only safe internal app routes", () => {
    expect(isFloatingPanelRoute("/runs")).toBe(true);
    expect(isFloatingPanelRoute("/settings/pill-nav")).toBe(true);
    expect(isFloatingPanelRoute("/marketplace/chains?q=ai")).toBe(true);
    expect(isFloatingPanelRoute("/api/runs")).toBe(false);
    expect(isFloatingPanelRoute("/login")).toBe(false);
    expect(isFloatingPanelRoute("/welcome")).toBe(false);
    expect(isFloatingPanelRoute("/invite/abc")).toBe(false);
    expect(isFloatingPanelRoute("/unsubscribe/abc")).toBe(false);
    expect(isFloatingPanelRoute("https://mentiko.com")).toBe(false);
    expect(isFloatingPanelRoute("//mentiko.com")).toBe(false);
  });

  it("adds the panel surface param while preserving route state", () => {
    expect(getFloatingPanelSrc("/runs?runId=abc#output")).toBe(
      "/runs?runId=abc&surface=panel#output",
    );
    expect(getFloatingPanelSrc("/settings?surface=page")).toBe(
      "/settings?surface=panel",
    );
  });

  it("derives readable panel titles from routes", () => {
    expect(getFloatingPanelRouteTitle("/runs")).toBe("Runs");
    expect(getFloatingPanelRouteTitle("/settings/pill-nav")).toBe("Pill Nav");
    expect(getFloatingPanelRouteTitle("/")).toBe("Dashboard");
  });

  it("detects panel frame requests from path and search params", () => {
    expect(isFloatingPanelFrameRequest("/runs", new URLSearchParams("surface=panel"))).toBe(true);
    expect(isFloatingPanelFrameRequest("/login", new URLSearchParams("surface=panel"))).toBe(false);
    expect(isFloatingPanelFrameRequest("/runs", new URLSearchParams())).toBe(false);
  });

  it("treats embedded same-app frames as panel surfaces even after query loss", () => {
    expect(isFloatingPanelSurface(new URLSearchParams("surface=panel"))).toBe(true);
    expect(isFloatingPanelSurface(new URLSearchParams(), true)).toBe(true);
    expect(isFloatingPanelSurface(new URLSearchParams())).toBe(false);
  });

  it("relaxes frame headers only to same-origin framing", () => {
    const headers = new Headers({
      "x-frame-options": "DENY",
      "content-security-policy": "default-src 'self'; frame-ancestors 'none'; connect-src 'self'",
    });

    applyFloatingPanelFrameHeaders(headers);

    expect(headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(headers.get("content-security-policy")).toBe(
      "default-src 'self'; connect-src 'self'; frame-ancestors 'self'",
    );
  });
});
