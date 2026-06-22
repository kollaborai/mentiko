import {
  isAllowedPreviewPort,
  getAllowedPreviewPorts,
  previewPrefix,
  rewriteHtmlForPreview,
  rewriteCssForPreview,
  buildPreviewInterceptor,
} from "../system/preview-proxy";

describe("preview proxy — port allowlist (SSRF guard)", () => {
  const original = process.env.MENTIKO_PREVIEW_PORTS;
  afterEach(() => {
    if (original === undefined) delete process.env.MENTIKO_PREVIEW_PORTS;
    else process.env.MENTIKO_PREVIEW_PORTS = original;
  });

  it("allows the default dev-server range", () => {
    delete process.env.MENTIKO_PREVIEW_PORTS;
    expect(isAllowedPreviewPort(3001)).toBe(true);
    expect(isAllowedPreviewPort(3005)).toBe(true);
    expect(isAllowedPreviewPort(3010)).toBe(true);
  });

  it("never allows reserved platform/internal ports", () => {
    delete process.env.MENTIKO_PREVIEW_PORTS;
    expect(isAllowedPreviewPort(3000)).toBe(false); // platform app
    expect(isAllowedPreviewPort(3099)).toBe(false); // platform secondary
    expect(isAllowedPreviewPort(7433)).toBe(false); // kollabor-engine
  });

  it("rejects out-of-range, privileged, and invalid ports", () => {
    delete process.env.MENTIKO_PREVIEW_PORTS;
    expect(isAllowedPreviewPort(3011)).toBe(false);
    expect(isAllowedPreviewPort(80)).toBe(false);
    expect(isAllowedPreviewPort(22)).toBe(false);
    expect(isAllowedPreviewPort(0)).toBe(false);
    expect(isAllowedPreviewPort(-1)).toBe(false);
    expect(isAllowedPreviewPort(70000)).toBe(false);
    expect(isAllowedPreviewPort(3001.5)).toBe(false);
    expect(isAllowedPreviewPort(NaN)).toBe(false);
  });

  it("honours MENTIKO_PREVIEW_PORTS override but still drops reserved ports", () => {
    process.env.MENTIKO_PREVIEW_PORTS = "4000-4002,5173,3000";
    const ports = getAllowedPreviewPorts();
    expect(ports.has(4000)).toBe(true);
    expect(ports.has(5173)).toBe(true);
    expect(isAllowedPreviewPort(5173)).toBe(true);
    expect(isAllowedPreviewPort(3001)).toBe(false); // no longer in range
    expect(isAllowedPreviewPort(3000)).toBe(false); // reserved, removed even if listed
  });
});

describe("preview proxy — prefix", () => {
  it("builds the path prefix without a trailing slash", () => {
    expect(previewPrefix(3001)).toBe("/api/preview/3001");
  });
});

describe("preview proxy — HTML rewriting", () => {
  it("rewrites root-absolute asset URLs to the preview prefix", () => {
    const html = `<head></head><body><script src="/_next/static/chunks/main.js"></script><link href="/app.css"></body>`;
    const out = rewriteHtmlForPreview(html, 3001);
    expect(out).toContain(`src="/api/preview/3001/_next/static/chunks/main.js"`);
    expect(out).toContain(`href="/api/preview/3001/app.css"`);
  });

  it("leaves relative, external, and protocol-relative URLs alone", () => {
    const html = `<head></head><img src="logo.png"><img src="https://cdn.example.com/a.png"><script src="//cdn.example.com/b.js"></script>`;
    const out = rewriteHtmlForPreview(html, 3001);
    expect(out).toContain(`src="logo.png"`);
    expect(out).toContain(`src="https://cdn.example.com/a.png"`);
    expect(out).toContain(`src="//cdn.example.com/b.js"`);
  });

  it("does not double-prefix already-rewritten URLs", () => {
    const html = `<head></head><script src="/api/preview/3001/_next/x.js"></script>`;
    const out = rewriteHtmlForPreview(html, 3001);
    expect(out).toContain(`src="/api/preview/3001/_next/x.js"`);
    expect(out).not.toContain(`/api/preview/3001/api/preview/3001`);
  });

  it("collapses self-referential absolute URLs to the prefix", () => {
    const html = `<head></head><a href="http://localhost:3001/about">about</a>`;
    const out = rewriteHtmlForPreview(html, 3001);
    expect(out).toContain(`href="/api/preview/3001/about"`);
  });

  it("rewrites srcset candidates", () => {
    const html = `<head></head><img srcset="/a.png 1x, /b.png 2x">`;
    const out = rewriteHtmlForPreview(html, 3001);
    expect(out).toContain("/api/preview/3001/a.png 1x");
    expect(out).toContain("/api/preview/3001/b.png 2x");
  });

  it("injects the runtime interceptor at the top of <head>", () => {
    const html = `<html><head><title>app</title></head><body></body></html>`;
    const out = rewriteHtmlForPreview(html, 3001);
    expect(out).toContain(`data-mentiko-preview="3001"`);
    expect(out.indexOf(`data-mentiko-preview`)).toBeLessThan(out.indexOf("<title>"));
  });
});

describe("preview proxy — CSS rewriting", () => {
  it("rewrites root-absolute url() references", () => {
    expect(rewriteCssForPreview(`.a{background:url(/img/bg.png)}`, 3001)).toBe(
      `.a{background:url(/api/preview/3001/img/bg.png)}`,
    );
    expect(rewriteCssForPreview(`.a{background:url("/x.woff2")}`, 3001)).toBe(
      `.a{background:url("/api/preview/3001/x.woff2")}`,
    );
  });

  it("leaves external and data url() references alone", () => {
    expect(rewriteCssForPreview(`.a{background:url(https://cdn/x.png)}`, 3001)).toBe(
      `.a{background:url(https://cdn/x.png)}`,
    );
    expect(rewriteCssForPreview(`.a{background:url(data:image/png;base64,AAAA)}`, 3001)).toBe(
      `.a{background:url(data:image/png;base64,AAAA)}`,
    );
  });
});

describe("preview proxy — interceptor", () => {
  it("embeds the prefix and port", () => {
    const script = buildPreviewInterceptor(3001);
    expect(script).toContain(`"/api/preview/3001"`);
    expect(script).toContain(`data-mentiko-preview="3001"`);
    // patches the runtime URL surfaces
    expect(script).toContain("window.fetch");
    expect(script).toContain("XMLHttpRequest.prototype.open");
    expect(script).toContain("WebSocket");
  });
});
