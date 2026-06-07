"use client";

import { PageBanner } from "@/components/ui/page-banner";
import { LockFilled } from "@aliimam/icons";

const CodeBlock = ({ children }: { children: string }) => (
  <pre className="bg-muted rounded-md p-3 font-mono text-[11px] text-foreground/70 whitespace-pre overflow-x-auto mb-4">
    {children}
  </pre>
);

export default function SecurityDocPage() {
  return (
    <div>
      <PageBanner
        title="Security"
        subtitle="Authentication, authorization, credential handling, and security headers."
        icon={LockFilled}
        sectionColor="#f59e0b"
      />
      <div className="px-6 pb-6 max-w-3xl">

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Authentication</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Built on better-auth with SQLite. Sessions expire after 7 days.
          Password minimum length is 12 characters.
        </p>
        <div className="bg-card rounded-md p-3 text-xs text-foreground/60 space-y-1 mb-3">
          <div><span className="text-foreground/70">Email/password</span> - standard signup and login</div>
          <div><span className="text-foreground/70">GitHub OAuth</span> - GITHUB_CLIENT_ID + GITHUB_CLIENT_SECRET</div>
          <div><span className="text-foreground/70">Google OAuth</span> - GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET</div>
          <div><span className="text-foreground/70">Microsoft OAuth</span> - MICROSOFT_CLIENT_ID + MICROSOFT_CLIENT_SECRET</div>
        </div>
        <p className="text-xs text-foreground/60 leading-relaxed">
          First user to sign up becomes the platform admin. Each new user gets
          a default organization and namespace directories created automatically.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Cookie Security</h2>
        <div className="bg-card rounded-md p-3 text-xs text-foreground/60 space-y-1">
          <div><code className="text-foreground/70">httpOnly: true</code> - no JavaScript access</div>
          <div><code className="text-foreground/70">secure: true</code> - HTTPS only (production)</div>
          <div><code className="text-foreground/70">sameSite: strict</code> - no cross-site requests</div>
          <div><code className="text-foreground/70">CSRF token</code> - token cookie is issued; double-submit validation is deferred</div>
          <div>Cookie names: <code className="text-foreground/70">__Secure-better-auth.session_token</code> over HTTPS and <code className="text-foreground/70">better-auth.session_token</code> locally</div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">RBAC Roles</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          4 roles with cascading permissions per organization:
        </p>
        <div className="bg-card rounded-md p-3 text-xs text-foreground/60 space-y-2">
          <div>
            <span className="text-foreground/70 font-medium">owner</span>
            <span className="ml-2">full org control, member management, settings, all chain/task ops</span>
          </div>
          <div>
            <span className="text-foreground/70 font-medium">admin</span>
            <span className="ml-2">org update, member create/update, invitations, all chain/task ops</span>
          </div>
          <div>
            <span className="text-foreground/70 font-medium">member</span>
            <span className="ml-2">create invitations, all chain/task ops, no org/member management</span>
          </div>
          <div>
            <span className="text-foreground/70 font-medium">guest</span>
            <span className="ml-2">view-only access to chains and tasks</span>
          </div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Multi-Tenant Isolation</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Namespaces are tenant and billing boundaries. Organizations live inside
          a namespace as teams or departments, with org-scoped data under
          <code className="text-foreground/70 bg-muted px-1 rounded">namespaces/{"{namespaceId}"}/orgs/{"{orgId}"}</code>.
          The default org collapses into the namespace root for backward compatibility.
        </p>
        <div className="bg-card rounded-md p-3 text-xs text-foreground/60 space-y-1">
          <div>Namespace directories are created for the active tenant</div>
          <div>Each namespace can contain multiple organizations</div>
          <div>Members can only access organizations they belong to</div>
          <div>Session context tracks active namespace and active organization</div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Credential Protection</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Environment variables in agent profiles are never exposed in output.
        </p>
        <CodeBlock>{`# agent profile env sourcing flow:
1. write env to temp file: mktemp /tmp/agent-env-XXXXXX
2. chmod 600 (owner-only read)
3. source + immediate delete:
   source /tmp/agent-env-XXXXXX; rm -f /tmp/agent-env-XXXXXX; claude ...
4. env file never appears in terminal, logs, or web UI`}</CodeBlock>
        <p className="text-xs text-foreground/60 leading-relaxed mt-3">
          Secret references (<code className="text-foreground/70 bg-muted px-1 rounded">{"{secret:NAME}"}</code>)
          are resolved at runtime via the secrets vault and never stored in plaintext.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Output Sanitization</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Defense-in-depth redaction applied to all agent output before display:
        </p>
        <div className="bg-card rounded-md p-3 text-xs text-foreground/60 space-y-1">
          <div>ANSI escape sequence stripping (CSI, OSC, DCS)</div>
          <div>Credential pattern redaction (API keys, tokens, secrets)</div>
          <div>Bearer token detection (20+ character tokens)</div>
          <div>Hex token detection (32+ character hex strings)</div>
          <div>Line ending normalization (CRLF/CR to LF)</div>
          <div>Zero-width character removal</div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Security Headers</h2>
        <div className="bg-card rounded-md p-3 text-xs text-foreground/60 space-y-1">
          <div><code className="text-foreground/70">X-Frame-Options: DENY</code></div>
          <div><code className="text-foreground/70">X-Content-Type-Options: nosniff</code></div>
          <div><code className="text-foreground/70">X-XSS-Protection: 1; mode=block</code></div>
          <div><code className="text-foreground/70">Referrer-Policy: strict-origin-when-cross-origin</code></div>
          <div><code className="text-foreground/70">Cross-Origin-Opener-Policy: same-origin</code></div>
          <div><code className="text-foreground/70">Cross-Origin-Resource-Policy: same-origin</code></div>
          <div><code className="text-foreground/70">Permissions-Policy</code> - camera, microphone, geolocation disabled</div>
          <div><code className="text-foreground/70">HSTS</code> - max-age=31536000, includeSubDomains, preload (production)</div>
          <div><code className="text-foreground/70">CSP</code> - default-src self, ws: wss: for websockets (production)</div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Rate Limiting</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          In-memory rate limiter with automatic cleanup every 60 seconds.
          Always active. Set DISABLE_RATE_LIMITING=true to bypass.
        </p>
        <div className="bg-card rounded-md p-3 text-xs text-foreground/60 space-y-1 mb-3">
          <div><code className="text-foreground/70">user</code> - 300 requests per minute</div>
          <div><code className="text-foreground/70">tenant</code> - 1500 requests per minute</div>
          <div><code className="text-foreground/70">burst</code> - 100 requests per 10 seconds</div>
          <div>Streaming, auth, health, and high-frequency read polling routes opt out</div>
        </div>
        <p className="text-xs text-foreground/60 leading-relaxed">
          Rate-limit responses use HTTP 429 with <code className="text-foreground/70 bg-muted px-1 rounded">Retry-After</code>.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Input Sanitization</h2>
        <div className="bg-card rounded-md p-3 text-xs text-foreground/60 space-y-1">
          <div><code className="text-foreground/70">sanitizeShellInput()</code> - alphanumeric, spaces, hyphens, underscores, slashes, dots, colons</div>
          <div><code className="text-foreground/70">sanitizeSessionName()</code> - alphanumeric, hyphens, underscores only</div>
          <div><code className="text-foreground/70">sanitizeChainId()</code> - alphanumeric, hyphens, underscores</div>
          <div><code className="text-foreground/70">sanitizePath()</code> - removes null bytes, blocks directory traversal</div>
          <div><code className="text-foreground/70">isValidUrl()</code> - http, https, ftp protocols only</div>
          <div><code className="text-foreground/70">sanitizeSvg()</code> - removes script tags, on* handlers, javascript: hrefs</div>
        </div>
      </section>
      </div>
    </div>
  );
}
