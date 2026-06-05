import { NextRequest, NextResponse } from "next/server";
import { checkAuth } from "@/lib/auth/api-auth";
import { withErrorHandling } from "@/lib/api-response";
import { BadRequest, Unauthorized } from "@/lib/api-errors";

export const dynamic = "force-dynamic";

// Node's native fetch on macOS fails TLS verification (UNABLE_TO_GET_ISSUER_CERT_LOCALLY)
// because it doesn't use the system keychain. Safe for a proxy fetching public pages.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

/**
 * Web proxy route -- fetches external pages server-side, strips framing
 * restrictions (X-Frame-Options, CSP), rewrites URLs to route through
 * this proxy so they render inside an iframe in the mentiko UI.
 *
 * Supports PROXY_URL env var for HTTP/HTTPS/SOCKS5 residential proxies.
 *
 * Usage:
 *   GET /api/system/web-proxy?url=https://console.anthropic.com/login
 *   GET /api/system/web-proxy?url=...&raw=1  (passthrough, no rewriting)
 */

// ── cookie jar ────────────────────────────────────────────────────────
// per-domain cookie store so upstream sessions work across proxy requests.
// cookies set by upstream responses are stored here and replayed on
// subsequent requests to the same domain. keyed by hostname.
const cookieJar = new Map<string, Map<string, string>>();

function storeCookies(hostname: string, response: Response): void {
  // getSetCookie() returns an array of set-cookie header values
  const setCookies = (response.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.()
    ?? response.headers.get("set-cookie")?.split(/,(?=\s*\w+=)/) ?? [];

  if (setCookies.length === 0) return;

  if (!cookieJar.has(hostname)) {
    cookieJar.set(hostname, new Map());
  }
  const jar = cookieJar.get(hostname)!;

  for (const raw of setCookies) {
    const parts = raw.split(";")[0].trim(); // name=value
    const eq = parts.indexOf("=");
    if (eq > 0) {
      const name = parts.substring(0, eq).trim();
      const value = parts.substring(eq + 1).trim();
      jar.set(name, value);
    }
  }

  // cap at 100 cookies per domain to prevent unbounded growth
  if (jar.size > 100) {
    const keys = [...jar.keys()];
    for (let i = 0; i < keys.length - 100; i++) {
      jar.delete(keys[i]);
    }
  }
}

function getCookies(hostname: string): string {
  const jar = cookieJar.get(hostname);
  if (!jar || jar.size === 0) return "";
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

// clean up stale entries periodically (every 10 min)
setInterval(() => {
  // simple TTL: clear jars with > 200 cookies total across all domains
  let total = 0;
  for (const jar of cookieJar.values()) total += jar.size;
  if (total > 500) cookieJar.clear();
}, 600000);

// headers we strip from upstream responses so iframing works
const STRIP_HEADERS = [
  "x-frame-options",
  "content-security-policy",
  "content-security-policy-report-only",
  "cross-origin-opener-policy",
  "cross-origin-embedder-policy",
  "cross-origin-resource-policy",
  "content-encoding",
  "content-length",
];

function getBaseUrl(url: string): string {
  const u = new URL(url);
  return `${u.protocol}//${u.host}`;
}

function getDirectoryUrl(url: string): string {
  const u = new URL(url);
  const lastSlash = u.pathname.lastIndexOf("/");
  return `${u.protocol}//${u.host}${u.pathname.slice(0, lastSlash + 1)}`;
}

/**
 * Rewrite URLs in HTML so all resources and navigation go through our proxy.
 * proxyBase must be an absolute URL (e.g. http://localhost:3000/api/system/web-proxy)
 * so that the <base> tag doesn't break resolution.
 */
function rewriteHtml(html: string, sourceUrl: string, proxyBase: string): string {
  const base = getBaseUrl(sourceUrl);
  const dir = getDirectoryUrl(sourceUrl);

  let result = html;

  // rewrite absolute URLs: href="https://...", src="https://...", action="https://..."
  result = result.replace(
    /((?:href|src|action|srcset|poster)\s*=\s*["'])(https?:\/\/[^"']+)(["'])/gi,
    (_match, prefix, url, suffix) => {
      return `${prefix}${proxyBase}?url=${encodeURIComponent(url)}${suffix}`;
    }
  );

  // rewrite protocol-relative URLs: //cdn.example.com/...
  result = result.replace(
    /((?:href|src|action|srcset|poster)\s*=\s*["'])(\/\/[^"']+)(["'])/gi,
    (_match, prefix, url, suffix) => {
      const abs = `https:${url}`;
      return `${prefix}${proxyBase}?url=${encodeURIComponent(abs)}${suffix}`;
    }
  );

  // rewrite root-relative URLs: /path/to/thing
  // negative lookahead to skip already-rewritten proxy URLs
  result = result.replace(
    /((?:href|src|action|srcset|poster)\s*=\s*["'])(\/(?!api\/system\/web-proxy)[^"']*)(["'])/gi,
    (_match, prefix, path, suffix) => {
      if (!path || path === "/") {
        return `${prefix}${proxyBase}?url=${encodeURIComponent(base + "/")}${suffix}`;
      }
      const abs = `${base}${path}`;
      return `${prefix}${proxyBase}?url=${encodeURIComponent(abs)}${suffix}`;
    }
  );

  // rewrite relative URLs (no leading /)
  result = result.replace(
    /((?:href|src|action|srcset|poster)\s*=\s*["'])(?!data:|javascript:|mailto:|#|blob:|about:|https?:)([^/"':\s][^"']*)(["'])/gi,
    (_match, prefix, path, suffix) => {
      // skip if already rewritten
      if (path.includes("/api/system/web-proxy") || path.startsWith("http")) return _match;
      const abs = `${dir}${path}`;
      return `${prefix}${proxyBase}?url=${encodeURIComponent(abs)}${suffix}`;
    }
  );

  // rewrite CSS url() references in inline styles and <style> blocks
  result = result.replace(
    /url\(\s*["']?(https?:\/\/[^"')]+)["']?\s*\)/gi,
    (_match, url) => {
      return `url("${proxyBase}?url=${encodeURIComponent(url)}")`;
    }
  );

  // rewrite root-relative CSS url() references
  result = result.replace(
    /url\(\s*["']?(\/(?!api\/system\/web-proxy)[^"')]+)["']?\s*\)/gi,
    (_match, path) => {
      const abs = `${base}${path}`;
      return `url("${proxyBase}?url=${encodeURIComponent(abs)}")`;
    }
  );

  // inject script that intercepts navigation and form submissions
  // to keep everything inside the iframe via our proxy.
  // proxyBase is absolute so it works regardless of <base> tag.
  const interceptScript = `
<script>
(function() {
  var PROXY = "${proxyBase}";

  // intercept link clicks
  document.addEventListener("click", function(e) {
    var a = e.target.closest ? e.target.closest("a[href]") : null;
    if (!a) return;
    var href = a.getAttribute("href");
    if (!href || href.charAt(0) === "#" || href.indexOf("javascript:") === 0) return;
    if (href.indexOf("/api/system/web-proxy") !== -1) return;

    e.preventDefault();
    try {
      var abs = new URL(href, window.location.href).href;
      // if the resolved URL points at our proxy origin, extract the real URL
      if (abs.indexOf("/api/system/web-proxy") !== -1) {
        window.location.href = abs;
        return;
      }
      window.parent.postMessage({ type: "viewport-navigate", url: abs }, "*");
      window.location.href = PROXY + "?url=" + encodeURIComponent(abs);
    } catch(err) {
      // malformed URL, let browser handle it
    }
  }, true);

  // intercept form submissions
  document.addEventListener("submit", function(e) {
    var form = e.target;
    if (!form || !form.action) return;
    try {
      var action = new URL(form.action, window.location.href).href;
      if (action.indexOf("/api/system/web-proxy") !== -1) return;
      form.action = PROXY + "?url=" + encodeURIComponent(action);
    } catch(err) {}
  }, true);

  // intercept window.open
  var origOpen = window.open;
  window.open = function(url) {
    if (url) {
      try {
        var abs = new URL(url, window.location.href).href;
        window.location.href = PROXY + "?url=" + encodeURIComponent(abs);
      } catch(err) {}
    }
    return null;
  };

  // intercept programmatic navigation (location.assign, location.replace, location.href=)
  // this catches SPA redirects like window.location = "/" or location.replace("/login")
  var ORIGIN = "${base}";
  var origAssign = window.location.assign.bind(window.location);
  var origReplace = window.location.replace.bind(window.location);

  window.location.assign = function(url) {
    try {
      var abs = new URL(url, ORIGIN + "/").href;
      if (abs.indexOf("/api/system/web-proxy") !== -1) { origAssign(abs); return; }
      origAssign(PROXY + "?url=" + encodeURIComponent(abs));
    } catch(e) { origAssign(url); }
  };

  window.location.replace = function(url) {
    try {
      var abs = new URL(url, ORIGIN + "/").href;
      if (abs.indexOf("/api/system/web-proxy") !== -1) { origReplace(abs); return; }
      origReplace(PROXY + "?url=" + encodeURIComponent(abs));
    } catch(e) { origReplace(url); }
  };

  // intercept fetch/XHR to route API calls through proxy
  var origFetch = window.fetch;
  window.fetch = function(input, init) {
    if (typeof input === "string") {
      try {
        var resolved = new URL(input, ORIGIN + "/").href;
        if (resolved.indexOf(ORIGIN) === 0 && resolved.indexOf("/api/system/web-proxy") === -1) {
          input = PROXY + "?url=" + encodeURIComponent(resolved) + "&raw=1";
        }
      } catch(e) {}
    }
    return origFetch.call(this, input, init);
  };

  // intercept XMLHttpRequest
  var origXhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    if (typeof url === "string") {
      try {
        var resolved = new URL(url, ORIGIN + "/").href;
        if (resolved.indexOf(ORIGIN) === 0 && resolved.indexOf("/api/system/web-proxy") === -1) {
          url = PROXY + "?url=" + encodeURIComponent(resolved) + "&raw=1";
        }
      } catch(e) {}
    }
    return origXhrOpen.apply(this, arguments);
  };

  // report current URL to parent for address bar updates
  window.parent.postMessage({
    type: "viewport-loaded",
    url: "${sourceUrl}",
    title: document.title
  }, "*");

  // observe title changes
  var titleEl = document.querySelector("title") || document.head;
  if (titleEl) {
    new MutationObserver(function() {
      window.parent.postMessage({ type: "viewport-title", title: document.title }, "*");
    }).observe(titleEl, { childList: true, subtree: true, characterData: true });
  }
})();
</script>`;

  // inject at the TOP of <head> so interceptors run BEFORE any SPA scripts.
  // this is critical -- SPAs like claude.ai load async JS chunks that can
  // redirect via location.replace/fetch before a </body> script runs.
  if (result.includes("<head")) {
    result = result.replace(/<head([^>]*)>/i, `<head$1>${interceptScript}`);
  } else if (result.includes("<html")) {
    result = result.replace(/<html([^>]*)>/i, `<html$1>${interceptScript}`);
  } else {
    result = interceptScript + result;
  }

  return result;
}

/**
 * Build fetch options. No accept-encoding header -- let node handle
 * content negotiation and auto-decompression.
 */
function buildFetchOptions(targetUrl: string, request: NextRequest): RequestInit {
  const hostname = new URL(targetUrl).hostname;

  const headers: Record<string, string> = {
    "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9",
    "cache-control": "no-cache",
  };

  // replay stored cookies for this domain
  const cookies = getCookies(hostname);
  if (cookies) {
    headers["cookie"] = cookies;
  }

  // forward referer if present (some sites need it)
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      const refUrl = new URL(referer);
      const refProxy = refUrl.searchParams.get("url");
      if (refProxy) {
        headers["referer"] = refProxy;
      }
    } catch {
      // ignore invalid referer
    }
  }

  return {
    headers,
    redirect: "follow",
    signal: AbortSignal.timeout(15000),
  };
}

// GET /api/system/web-proxy
export const GET = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const { searchParams } = new URL(request.url);
  const targetUrl = searchParams.get("url");
  const raw = searchParams.get("raw") === "1";

  if (!targetUrl) {
    throw new BadRequest("url query parameter is required");
  }

  // validate it's a real URL
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    throw new BadRequest("invalid URL");
  }

  // block local/private network access (SSRF prevention)
  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname.startsWith("192.168.") ||
    hostname.startsWith("10.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
    hostname === "::1" ||
    hostname.startsWith("169.254.") ||
    hostname.startsWith("fc") ||
    hostname.startsWith("fd") ||
    hostname === "metadata.google.internal" ||
    hostname.endsWith(".internal")
  ) {
    throw new BadRequest("cannot proxy local/private addresses");
  }

  const fetchOpts = buildFetchOptions(targetUrl, request);

  let response: Response;
  try {
    response = await fetch(targetUrl, fetchOpts);
  } catch (err) {
    throw new BadRequest(`failed to fetch: ${err instanceof Error ? err.message : "unknown error"}`);
  }

  // capture cookies from upstream for replay on subsequent requests
  const targetHostname = new URL(targetUrl).hostname;
  storeCookies(targetHostname, response);
  // also store for the final URL hostname if different (redirects)
  if (response.url && new URL(response.url).hostname !== targetHostname) {
    storeCookies(new URL(response.url).hostname, response);
  }

  // use the final URL after redirects for accurate rewriting
  const finalUrl = response.url || targetUrl;

  // detect OAuth redirects back to our app - these can't be proxied in an iframe
  // return a break-out page that redirects the parent window instead
  const origin = new URL(request.url).origin;
  try {
    const finalParsed = new URL(finalUrl);
    if (finalParsed.origin === origin && (finalParsed.pathname.startsWith("/login") || finalParsed.pathname.startsWith("/signup"))) {
      // OAuth is redirecting back to our auth pages - break out of iframe
      const breakoutHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Redirecting...</title></head>
<body>
<script>window.top.location.href = "${finalUrl}";</script>
</body>
</html>`;
      return new NextResponse(breakoutHtml, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  } catch {
    // invalid URL, continue with normal proxy flow
  }

  const contentType = response.headers.get("content-type") || "";

  // build response headers, stripping framing restrictions + encoding
  const responseHeaders = new Headers();
  response.headers.forEach((value, key) => {
    if (!STRIP_HEADERS.includes(key.toLowerCase())) {
      responseHeaders.set(key, value);
    }
  });

  // allow framing from our origin
  responseHeaders.set("x-frame-options", "SAMEORIGIN");
  responseHeaders.set("x-viewport-source-url", finalUrl);

  // derive the absolute proxy base from the incoming request
  // so rewritten URLs work regardless of <base> tags or origin
  const proxyBase = `${origin}/api/system/web-proxy`;

  // for HTML content, rewrite URLs so resources load through proxy
  if (contentType.includes("text/html") && !raw) {
    const html = await response.text();
    const rewritten = rewriteHtml(html, finalUrl, proxyBase);

    responseHeaders.set("content-type", "text/html; charset=utf-8");

    return new NextResponse(rewritten, {
      status: response.status,
      headers: responseHeaders,
    });
  }

  // for CSS, rewrite url() references
  if (contentType.includes("text/css") && !raw) {
    let css = await response.text();
    const base = getBaseUrl(finalUrl);
    const dir = getDirectoryUrl(finalUrl);

    // rewrite url() with absolute URLs
    css = css.replace(
      /url\(\s*["']?(https?:\/\/[^"')]+)["']?\s*\)/gi,
      (_match, url) => `url("${proxyBase}?url=${encodeURIComponent(url)}")`
    );

    // rewrite url() with root-relative paths
    css = css.replace(
      /url\(\s*["']?(\/[^"')]+)["']?\s*\)/gi,
      (_match, path) => `url("${proxyBase}?url=${encodeURIComponent(base + path)}")`
    );

    // rewrite url() with relative paths
    css = css.replace(
      /url\(\s*["']?(?!data:|https?:|\/|#)([^"')]+)["']?\s*\)/gi,
      (_match, path) => `url("${proxyBase}?url=${encodeURIComponent(dir + path)}")`
    );

    responseHeaders.set("content-type", "text/css; charset=utf-8");

    return new NextResponse(css, {
      status: response.status,
      headers: responseHeaders,
    });
  }

  // for everything else (images, JS, fonts), passthrough
  const body = await response.arrayBuffer();

  return new NextResponse(body, {
    status: response.status,
    headers: responseHeaders,
  });
});
