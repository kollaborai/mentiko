// preview-proxy: same-origin reverse-proxy helpers for previewing an
// in-container dev server (e.g. a scaffolded `next dev` on localhost:3001)
// inside the mentiko UI — a "Lovable-style" live preview.
//
// SECURITY (read before touching the allowlist):
//   The preview proxy only ever connects to 127.0.0.1:<port>, and only to
//   ports on an explicit allowlist. This is deliberately NOT a general
//   localhost proxy — an open one would be an SSRF hole into internal
//   services (kollabor-engine on 7433, the platform itself on 3000/3099, the
//   PTY daemon, etc.). The route layer is responsible for hard-pinning the
//   host to loopback; this module owns the port policy and URL rewriting.
//
// Why rewriting at all: a dev server emits root-absolute asset paths
// (`/_next/...`, `/favicon.ico`). Loaded in an iframe whose document lives at
// `/api/preview/<port>/…`, a *relative* URL already resolves under the prefix,
// but a *root-absolute* one resolves to the platform root and 404s. So we
// rewrite root-absolute URLs (and self-referential absolute URLs) to the
// prefix in HTML/CSS, and inject a runtime interceptor for URLs the app
// constructs dynamically (webpack chunks, fetch/XHR, client routing).

export const PREVIEW_BASE_PATH = "/api/preview";

// Ports we must never expose, even if an operator widens the range:
//   3000  platform app      3099  platform secondary      7433  kollabor-engine
const RESERVED_PORTS = new Set<number>([3000, 3099, 7433]);

// Typical dev-server range. Override with MENTIKO_PREVIEW_PORTS, e.g.
// "3001-3010,5173,8080". Reserved ports are always removed afterwards.
const DEFAULT_PREVIEW_PORT_SPEC = "3001-3010";

function parsePortSpec(spec: string): Set<number> {
  const ports = new Set<number>();
  for (const partRaw of spec.split(",")) {
    const part = partRaw.trim();
    if (!part) continue;
    const range = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const lo = Number(range[1]);
      const hi = Number(range[2]);
      if (Number.isInteger(lo) && Number.isInteger(hi) && lo <= hi && hi - lo <= 1000) {
        for (let p = lo; p <= hi; p++) ports.add(p);
      }
      continue;
    }
    const single = Number(part);
    if (Number.isInteger(single)) ports.add(single);
  }
  return ports;
}

export function getAllowedPreviewPorts(): Set<number> {
  const spec = process.env.MENTIKO_PREVIEW_PORTS?.trim() || DEFAULT_PREVIEW_PORT_SPEC;
  const ports = parsePortSpec(spec);
  for (const reserved of RESERVED_PORTS) ports.delete(reserved);
  // unprivileged, valid TCP range only
  for (const p of [...ports]) {
    if (p < 1024 || p > 65535) ports.delete(p);
  }
  return ports;
}

export function isAllowedPreviewPort(port: number): boolean {
  if (!Number.isInteger(port)) return false;
  return getAllowedPreviewPorts().has(port);
}

/** Path prefix the iframe is served under, e.g. "/api/preview/3001" (no trailing slash). */
export function previewPrefix(port: number): string {
  return `${PREVIEW_BASE_PATH}/${port}`;
}

// ── URL rewriting ─────────────────────────────────────────────────────

/**
 * Rewrite one root-absolute URL ("/x") to the preview prefix. Leaves alone:
 * protocol-relative ("//host"), absolute ("http://…"), relative ("x"),
 * data:/blob:, and already-prefixed URLs.
 */
function rewriteUrlValue(value: string, prefix: string): string {
  const v = value.trim();
  if (!v) return value;
  if (v.startsWith("//")) return value; // protocol-relative -> external
  if (!v.startsWith("/")) return value; // relative -> resolves under prefix natively
  if (v === prefix || v.startsWith(`${prefix}/`)) return value; // already rewritten
  return prefix + v;
}

function rewriteCssUrls(css: string, prefix: string): string {
  return css.replace(/url\(\s*(['"]?)(\/[^"')]*)\1\s*\)/gi, (match, quote, url) => {
    const rewritten = rewriteUrlValue(url, prefix);
    return rewritten === url ? match : `url(${quote}${rewritten}${quote})`;
  });
}

export function rewriteCssForPreview(css: string, port: number): string {
  return rewriteCssUrls(css, previewPrefix(port));
}

export function rewriteHtmlForPreview(html: string, port: number): string {
  const prefix = previewPrefix(port);
  let out = html;

  // 1. collapse self-referential absolute URLs (http://localhost:<port>/x) to
  //    the prefix first, so the attribute pass then treats them as done.
  const selfRe = new RegExp(`https?://(?:localhost|127\\.0\\.0\\.1):${port}(?=[/"'\\s)]|$)`, "gi");
  out = out.replace(selfRe, prefix);

  // 2. root-absolute attribute URLs
  out = out.replace(
    /\b(href|src|action|poster)\s*=\s*(["'])(\/[^"']*)\2/gi,
    (match, attr, quote, url) => {
      const rewritten = rewriteUrlValue(url, prefix);
      return rewritten === url ? match : `${attr}=${quote}${rewritten}${quote}`;
    },
  );

  // 3. srcset (comma-separated "url descriptor" candidates)
  out = out.replace(
    /\b(srcset)\s*=\s*(["'])([^"']*)\2/gi,
    (_match, attr, quote, value) => {
      const rewritten = value
        .split(",")
        .map((candidate: string) => {
          const trimmed = candidate.trim();
          if (!trimmed) return candidate;
          const sp = trimmed.indexOf(" ");
          const url = sp === -1 ? trimmed : trimmed.slice(0, sp);
          const descriptor = sp === -1 ? "" : trimmed.slice(sp);
          return rewriteUrlValue(url, prefix) + descriptor;
        })
        .join(", ");
      return `${attr}=${quote}${rewritten}${quote}`;
    },
  );

  // 4. CSS url() inside inline styles and <style> blocks
  out = rewriteCssUrls(out, prefix);

  // 5. inject the runtime interceptor at the very top of <head> so it runs
  //    before any framework bootstrap that constructs URLs at runtime.
  const script = buildPreviewInterceptor(port);
  if (/<head[^>]*>/i.test(out)) {
    out = out.replace(/<head([^>]*)>/i, `<head$1>${script}`);
  } else if (/<html[^>]*>/i.test(out)) {
    out = out.replace(/<html([^>]*)>/i, `<html$1>${script}`);
  } else {
    out = script + out;
  }
  return out;
}

/**
 * Client-side interceptor. Rewrites root-absolute and self-absolute URLs to the
 * preview prefix for: fetch, XHR, WebSocket (HMR — pointed off the platform
 * origin; v1 has no WS upgrade so live-reload is intentionally inert), and
 * dynamically created <script>/<link>/<img>/<source> elements + setAttribute,
 * plus history pushState/replaceState so reloads resolve under the prefix.
 */
export function buildPreviewInterceptor(port: number): string {
  const prefix = previewPrefix(port);
  // values are embedded via JSON.stringify so they are safely quoted
  return `<script data-mentiko-preview="${port}">
(function(){
  var PREFIX=${JSON.stringify(prefix)};
  var PORT=${JSON.stringify(String(port))};
  var SELF=new RegExp("^https?://(?:localhost|127\\\\.0\\\\.0\\\\.1):"+PORT);
  function rw(u){
    try{
      if(u==null) return u;
      var s=String(u);
      if(SELF.test(s)) s=s.replace(SELF,PREFIX);
      if(s.indexOf("/")!==0) return s;            // not root-absolute
      if(s.indexOf("//")===0) return s;           // protocol-relative -> external
      if(s===PREFIX||s.indexOf(PREFIX+"/")===0) return s; // already prefixed
      return PREFIX+s;
    }catch(e){return u;}
  }
  var of=window.fetch;
  if(of){window.fetch=function(input,init){
    try{
      if(typeof input==="string") input=rw(input);
      else if(input&&input.url){var nu=rw(input.url); if(nu!==input.url) input=new Request(nu,input);}
    }catch(e){}
    return of.call(this,input,init);
  };}
  var ox=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(method,url){
    try{arguments[1]=rw(url);}catch(e){}
    return ox.apply(this,arguments);
  };
  var OW=window.WebSocket;
  if(OW){
    var PW=function(url,protocols){
      var u=url; try{ u=String(url).replace(/^(wss?:\\/\\/[^\\/]+)(\\/)/,function(_,h,sl){return h+PREFIX+sl;}); }catch(e){}
      return protocols!==undefined?new OW(u,protocols):new OW(u);
    };
    PW.prototype=OW.prototype; PW.CONNECTING=OW.CONNECTING; PW.OPEN=OW.OPEN; PW.CLOSING=OW.CLOSING; PW.CLOSED=OW.CLOSED;
    window.WebSocket=PW;
  }
  function patchProp(proto,prop){
    try{
      var d=Object.getOwnPropertyDescriptor(proto,prop);
      if(!d||!d.set||!d.get) return;
      Object.defineProperty(proto,prop,{configurable:true,enumerable:d.enumerable,
        get:function(){return d.get.call(this);},
        set:function(v){return d.set.call(this,rw(v));}});
    }catch(e){}
  }
  if(window.HTMLScriptElement) patchProp(HTMLScriptElement.prototype,"src");
  if(window.HTMLLinkElement) patchProp(HTMLLinkElement.prototype,"href");
  if(window.HTMLImageElement) patchProp(HTMLImageElement.prototype,"src");
  if(window.HTMLSourceElement) patchProp(HTMLSourceElement.prototype,"src");
  var sa=Element.prototype.setAttribute;
  Element.prototype.setAttribute=function(name,value){
    try{var ln=String(name).toLowerCase(); if(ln==="src"||ln==="href"||ln==="action"||ln==="poster") value=rw(value);}catch(e){}
    return sa.call(this,name,value);
  };
  function patchHistory(name){
    var orig=history[name]; if(typeof orig!=="function") return;
    history[name]=function(state,title,url){ try{ if(typeof url==="string") url=rw(url); }catch(e){} return orig.call(this,state,title,url); };
  }
  patchHistory("pushState"); patchHistory("replaceState");
  try{ parent.postMessage({type:"mentiko-preview-loaded",port:Number(PORT),path:(location.pathname.indexOf(PREFIX)===0?location.pathname.slice(PREFIX.length):location.pathname)||"/"},location.origin); }catch(e){}
})();
</script>`;
}
