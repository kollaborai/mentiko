/**
 * auth-server: Better Auth server instance. (db rebuilt 2026-03-08)
 * lazily initialized on first use to avoid blocking startup.
 *
 * requires DATABASE_URL to be set.
 *
 * set MOCK_OAUTH_URL (e.g. http://localhost:8080) to use mock OAuth
 * server for testing. see docker-compose.test.yml.
 */

import { mkdirSync, existsSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";
import { nsPath, config } from "./config";
import { resolveAppSecret } from "./dev-secret";
import type { AuditExecOptions, AuditLogMetadata } from "./audit-exec";
import { isManagedTenantSignupLocked } from "./auth-deployment";
import { isValidOrgInviteSignup, timingSafeTokenMatch } from "./auth-signup-gate";

const DEFAULT_AUTH_URL = "http://localhost:3000";


function ensureNamespaceDirs(slug: string) {
  const nsDir = nsPath(slug);
  const subdirs = [
    "chains", "state", "events", "workspace", "workspaces",
    "reports", "agent-profiles", "runs", "jobs", "schedules",
  ];
  for (const sub of subdirs) {
    const dir = join(nsDir, sub);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

// exported for use by org creation API
export { ensureNamespaceDirs };

/**
 * decode JWT payload without verification (mock server only).
 * the mock server's userinfo endpoint doesn't always return claims
 * when the token exchange doesn't include the scope parameter,
 * so we fall back to reading claims from the id_token JWT.
 */
function decodeJwtPayload(jwt: string): Record<string, unknown> {
  try {
    const payload = jwt.split(".")[1];
    return JSON.parse(Buffer.from(payload, "base64url").toString());
  } catch {
    return {};
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildMockOAuthProviders(mockUrl: string, genericOAuth: any) {
  const oauthSignupLock = isManagedTenantSignupLocked()
    ? { disableImplicitSignUp: true as const }
    : {};

  // shared helper: try userinfo first, fall back to id_token claims
  async function getMockUserInfo(
    providerId: string,
    tokens: { accessToken: string; idToken?: string },
  ) {
    // try userinfo endpoint first
    const res = await fetch(`${mockUrl}/${providerId}/userinfo`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    let profile = await res.json();

    // if userinfo didn't return email, decode the id_token
    if (!profile.email && tokens.idToken) {
      const idClaims = decodeJwtPayload(tokens.idToken);
      profile = { ...profile, ...idClaims };
    }

    return profile;
  }

  return genericOAuth({
    config: [
      {
        providerId: "github",
        discoveryUrl: `${mockUrl}/github/.well-known/openid-configuration`,
        clientId: "mock-github-client",
        clientSecret: "mock-github-secret",
        scopes: ["openid", "profile", "email"],
        getUserInfo: async (tokens: { accessToken: string; idToken?: string }) => {
          const profile = await getMockUserInfo("github", tokens);
          return {
            id: profile.sub,
            name: profile.name || profile.login,
            email: profile.email,
            image: profile.avatar_url || profile.picture,
            emailVerified: true,
          };
        },
        ...oauthSignupLock,
      },
      {
        providerId: "google",
        discoveryUrl: `${mockUrl}/google/.well-known/openid-configuration`,
        clientId: "mock-google-client",
        clientSecret: "mock-google-secret",
        scopes: ["openid", "profile", "email"],
        getUserInfo: async (tokens: { accessToken: string; idToken?: string }) => {
          const profile = await getMockUserInfo("google", tokens);
          return {
            id: profile.sub,
            name: profile.name,
            email: profile.email,
            image: profile.picture,
            emailVerified: profile.email_verified ?? true,
          };
        },
        ...oauthSignupLock,
      },
      {
        providerId: "microsoft",
        discoveryUrl: `${mockUrl}/microsoft/.well-known/openid-configuration`,
        clientId: "mock-microsoft-client",
        clientSecret: "mock-microsoft-secret",
        scopes: ["openid", "profile", "email"],
        getUserInfo: async (tokens: { accessToken: string; idToken?: string }) => {
          const profile = await getMockUserInfo("microsoft", tokens);
          return {
            id: profile.sub,
            name: profile.name || profile.preferred_username,
            email: profile.email || profile.preferred_username,
            image: null,
            emailVerified: true,
          };
        },
        ...oauthSignupLock,
      },
    ],
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _auth: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _db: any = null;
let _initialized = false;
let _initPromise: Promise<void> | null = null;

function tenantHelpSenderFromAuthUrl(authUrl = process.env.BETTER_AUTH_URL): string | undefined {
  if (!authUrl) return undefined;

  try {
    const host = new URL(authUrl).hostname.toLowerCase();
    if (
      !host ||
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      !host.includes(".") ||
      host.includes("..") ||
      !/^[a-z0-9.-]+$/.test(host)
    ) {
      return undefined;
    }

    return `Mentiko Help <mentiko-help@${host}>`;
  } catch {
    return undefined;
  }
}

async function sendPasswordResetEmail(user: { email: string; name?: string }, url: string) {
  const [{ sendEmail }, { renderPasswordReset }] = await Promise.all([
    import("./email"),
    import("./email-templates"),
  ]);
  const tpl = renderPasswordReset({ name: user.name, resetUrl: url });
  const from = tenantHelpSenderFromAuthUrl();
  await sendEmail({ to: user.email, ...tpl, ...(from ? { from } : {}) });
}

async function sendDeleteAccountEmail(user: { email: string; name?: string }, url: string) {
  const [{ sendEmail }, { renderAccountDeletion }] = await Promise.all([
    import("./email"),
    import("./email-templates"),
  ]);
  const tpl = renderAccountDeletion({ name: user.name, confirmUrl: url });
  await sendEmail({ to: user.email, ...tpl });
}

async function sendEmailChangeEmail(user: { email: string; name?: string }, newEmail: string, url: string) {
  const [{ sendEmail }, { renderEmailChange }] = await Promise.all([
    import("./email"),
    import("./email-templates"),
  ]);
  const tpl = renderEmailChange({ name: user.name, oldEmail: user.email, verifyUrl: url });
  await sendEmail({ to: newEmail, ...tpl });
}

async function sendVerificationEmail(user: { email: string; name?: string }, url: string) {
  const [{ sendEmail }, { renderEmailVerification }] = await Promise.all([
    import("./email"),
    import("./email-templates"),
  ]);
  const tpl = renderEmailVerification({ name: user.name, verifyUrl: url });
  await sendEmail({ to: user.email, ...tpl });
}

async function sendWelcomeEmail(user: { email: string; name?: string }, dashboardUrl: string) {
  const [{ sendEmail }, { renderWelcome }] = await Promise.all([
    import("./email"),
    import("./email-templates"),
  ]);
  const tpl = renderWelcome({ name: user.name, dashboardUrl });
  await sendEmail({ to: user.email, ...tpl });
}

async function writeAuthAuditLog(
  eventType: string,
  description: string,
  metadata: AuditLogMetadata,
  options?: AuditExecOptions
) {
  const { execAuditLog } = await import("./audit-exec");
  await execAuditLog(eventType, description, metadata, options);
}

/**
 * parse DATABASE_URL for sqlite.
 * supports: file:/path/to/db, file:./relative/db, /absolute/path
 * strips query params (e.g. ?connectionLimit=1).
 */
function parseSqlitePath(url: string): string {
  let p = url.replace(/^file:/, "").split("?")[0];
  // expand tilde (shell doesn't expand it in env files)
  if (p.startsWith("~/") || p === "~") {
    p = join(homedir(), p.slice(2));
  }
  // resolve relative paths from AGENT_CHAIN_ROOT/web
  if (p.startsWith("./") || (!p.startsWith("/") && !p.includes(":"))) {
    p = join(process.cwd(), p);
  }
  return p;
}

function originFromUrl(value?: string | null): string | null {
  if (!value) return null;

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function buildTrustedOrigins(baseURL: string): string[] {
  const origins = new Set<string>();
  const add = (value?: string | null) => {
    const origin = originFromUrl(value);
    if (origin) origins.add(origin);
  };

  add(baseURL);
  add(process.env.NEXT_PUBLIC_APP_URL);
  add(process.env.APP_URL);
  add(process.env.PUBLIC_APP_URL);

  const configured = process.env.BETTER_AUTH_TRUSTED_ORIGINS || process.env.AUTH_TRUSTED_ORIGINS;
  configured?.split(",").forEach((origin) => add(origin.trim()));

  const baseOrigin = originFromUrl(baseURL);
  if (baseOrigin) {
    const base = new URL(baseOrigin);
    const isLocal =
      base.hostname === "localhost" ||
      base.hostname === "127.0.0.1" ||
      base.hostname === "::1" ||
      base.hostname === "[::1]";

    if (isLocal) {
      const port = base.port ? `:${base.port}` : "";
      add(`${base.protocol}//localhost${port}`);
      add(`${base.protocol}//127.0.0.1${port}`);
      add(`${base.protocol}//[::1]${port}`);
    }
  }

  return Array.from(origins);
}

/** get the shared better-sqlite3 Database instance (null if not configured). */
export async function getDb() {
  // trigger lazy init if needed (now async)
  if (!_initialized) await getAuth();
  return _db;
}

/**
 * lazily create the better-auth instance.
 * only imports better-sqlite3 and better-auth when DATABASE_URL is set.
 * returns null if no database configured.
 *
 * IMPORTANT: now async to ensure migrations complete before auth is usable.
 * all callers must await: const auth = await getAuth();
 */
export async function getAuth() {
  // if already initialized, return immediately (migrations already done)
  if (_initialized) return _auth;

  // if init is in progress, wait for it
  if (_initPromise) {
    await _initPromise;
    return _auth;
  }

  // start initialization
  _initialized = true;
  _initPromise = (async () => {
    try {
      const databaseUrl = process.env.DATABASE_URL || `file:${config.globalRoot}/data/auth.db`;

      // dynamic imports to avoid blocking startup when deps aren't available
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { betterAuth } = require("better-auth");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { nextCookies } = require("better-auth/next-js");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { organization, bearer } = require("better-auth/plugins");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Database = require("better-sqlite3-multiple-ciphers");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const permissions = require("./auth-permissions");

      // open sqlite database, creating parent dir if needed
      const dbPath = parseSqlitePath(databaseUrl);
      const dbDir = dirname(dbPath);
      if (!existsSync(dbDir)) {
        mkdirSync(dbDir, { recursive: true });
      }
      _db = new Database(dbPath);

      // SQLCipher encryption: enabled when AUTH_DB_ENCRYPT=1
      // Key derived from resolveAppSecret("vault") so rotation (F2) can piggyback.
      // Cipher pragmas MUST come before WAL — otherwise the DB is created plain
      // and the key pragma reads it as encrypted, failing with "file is not a database".
      if (process.env.AUTH_DB_ENCRYPT === "1") {
        const vaultKey = resolveAppSecret("vault");
        _db.pragma("cipher='sqlcipher'");
        _db.pragma("legacy=4");
        _db.exec(`PRAGMA key = '${vaultKey.replace(/'/g, "''")}'`);
      }

      _db.pragma("journal_mode = WAL");

      const mockUrl = process.env.MOCK_OAUTH_URL;

      const oauthSignupLock = isManagedTenantSignupLocked()
        ? { disableImplicitSignUp: true as const }
        : {};

      // build social providers (real) or mock providers (test)
      const socialProviders = mockUrl ? {} : {
        ...(process.env.GITHUB_CLIENT_ID && {
          github: {
            clientId: process.env.GITHUB_CLIENT_ID,
            clientSecret: process.env.GITHUB_CLIENT_SECRET,
            ...oauthSignupLock,
          },
        }),
        ...(process.env.GOOGLE_CLIENT_ID && {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            ...oauthSignupLock,
          },
        }),
        ...(process.env.MICROSOFT_CLIENT_ID && {
          microsoft: {
            clientId: process.env.MICROSOFT_CLIENT_ID,
            clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
            tenantId: process.env.MICROSOFT_TENANT_ID || "common",
            ...oauthSignupLock,
          },
        }),
      };

      // plugins array
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const plugins: any[] = [
        organization({
          ac: permissions.ac,
          roles: {
            owner: permissions.owner,
            admin: permissions.admin,
            member: permissions.member,
            guest: permissions.guest,
          },
          allowUserToCreateOrganization: true,
          organizationLimit: 10,
          creatorRole: "owner",
          membershipLimit: 100,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          async sendInvitationEmail(data: any) {
            console.log(`[auth] invitation sent to ${data.email} for org ${data.organization.id}`);
          },
        }),
        bearer(),
        nextCookies(),
      ];

      // add mock OAuth providers for testing
      if (mockUrl) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { genericOAuth } = require("better-auth/plugins");
        plugins.push(buildMockOAuthProviders(mockUrl, genericOAuth));
        console.log(`[auth] mock OAuth enabled -> ${mockUrl}`);
      }

      const db = _db;
      const authBaseURL = process.env.BETTER_AUTH_URL || DEFAULT_AUTH_URL;

      _auth = betterAuth({
        database: db,
        baseURL: authBaseURL,
        basePath: "/api/auth",
        secret: resolveAppSecret("session", "current"),

        emailAndPassword: {
          enabled: true,
          minPasswordLength: 12,
          resetPasswordTokenExpiresIn: 3600, // 1 hour
          sendResetPassword: async ({ user, url }: { user: { email: string; name?: string }; url: string }) => {
            try {
              await sendPasswordResetEmail(user, url);
            } catch (err) {
              console.error("[auth] password reset email failed:", err);
            }
          },
          sendDeleteAccountVerification: async ({ user, url }: { user: { email: string; name?: string }; url: string }) => {
            try {
              await sendDeleteAccountEmail(user, url);
            } catch (err) {
              console.error("[auth] delete account email failed:", err);
            }
          },
        },

        user: {
          additionalFields: {
            mustChangePassword: {
              type: "boolean",
              required: false,
              input: false,
              defaultValue: false,
            },
          },
          changeEmail: {
            enabled: true,
            sendChangeEmailVerification: async ({ user, newEmail, url }: { user: { email: string; name?: string }; newEmail: string; url: string }) => {
              try {
                await sendEmailChangeEmail(user, newEmail, url);
              } catch (err) {
                console.error("[auth] email change verification failed:", err);
              }
            },
          },
        },

        socialProviders,

        session: {
          expiresIn: 60 * 60 * 24 * 7,
          updateAge: 60 * 60 * 24,
        },

        trustedOrigins: buildTrustedOrigins(authBaseURL),

        plugins,

        emailVerification: {
          sendOnSignUp: true,
          autoSignInAfterVerification: true,
          expiresIn: 86400,
          sendVerificationEmail: async ({ user, url }: { user: { email: string; name?: string }; url: string }) => {
            try {
              await sendVerificationEmail(user, url);
            } catch (err) {
              // don't fail signup if email isn't ready yet (fresh tenant)
              console.error("[auth] verification email failed (non-fatal):", err);
            }
          },
        },

        databaseHooks: {
          user: {
            create: {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              before: async (user: any, context: any) => {
                if (!isManagedTenantSignupLocked()) return;

                // eslint-disable-next-line @typescript-eslint/no-require-imports
                const { APIError } = require("better-auth/api");

                // resolve request body first — email / tokens are read from it below
                const body = context?.body as Record<string, unknown> | undefined;

                const row = db.prepare("SELECT COUNT(*) as c FROM \"user\"").get() as { c: number } | undefined;
                const count = Number(row?.c ?? 0);
                const email = (
                  (typeof user.email === "string" && user.email) ||
                  (typeof body?.email === "string" ? body.email : "") ||
                  ""
                ).toLowerCase();
                const inviteToken =
                  typeof body?.inviteToken === "string" ? body.inviteToken : undefined;
                const provisioningToken =
                  typeof body?.provisioningToken === "string" ? body.provisioningToken : undefined;
                const envProvToken = process.env.MENTIKO_PROVISIONING_TOKEN || "";

                if (
                  provisioningToken &&
                  envProvToken &&
                  timingSafeTokenMatch(envProvToken, provisioningToken) &&
                  count === 0
                ) {
                  return {
                    data: {
                      ...user,
                      mustChangePassword: true,
                    },
                  };
                }

                if (inviteToken && (await isValidOrgInviteSignup(inviteToken, email))) {
                  return;
                }

                // OSS bootstrap: fresh install with no users and no provisioning
                // token gets one open signup so the first admin can self-onboard.
                // auto-locks after that because count > 0 on the next attempt.
                if (count === 0 && !envProvToken) {
                  return;
                }

                throw APIError.from("FORBIDDEN", {
                  message:
                    "Public sign-up is disabled. Ask your organization admin for an invitation link.",
                });
              },
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              after: async (user: any) => {
                try {
                  // eslint-disable-next-line @typescript-eslint/no-require-imports
                  const { randomUUID } = require("crypto");
                  const userId = user.id;

                  // ensure "default" org exists
                  let orgId: string;
                  try {
                    const orgRow = db.prepare(
                      "SELECT id FROM organization WHERE slug = ?",
                    ).get("default");

                    if (orgRow) {
                      orgId = orgRow.id;
                    } else {
                      orgId = randomUUID();
                      // name the org after the first user (e.g. "Marco's org")
                      const firstName = (user.name || "").split(" ")[0] || "My";
                      const orgName = `${firstName}'s org`;
                      db.prepare(
                        `INSERT INTO organization (id, name, slug, "createdAt") VALUES (?, ?, ?, datetime('now'))`,
                      ).run(orgId, orgName, "default");
                      ensureNamespaceDirs("default");
                    }
                  } catch (err) {
                    console.error("[auth] org creation failed (table may not exist yet):", err);
                    // continue anyway - org can be created later
                    return;
                  }

                  // add user as member if not already present
                  try {
                    const existing = db.prepare(
                      `SELECT id FROM member WHERE "organizationId" = ? AND "userId" = ?`,
                    ).get(orgId, userId);

                    if (!existing) {
                      // first member becomes owner, rest become members
                      const countRow = db.prepare(
                        `SELECT COUNT(*) as cnt FROM member WHERE "organizationId" = ?`,
                      ).get(orgId);
                      const isFirst = countRow.cnt === 0;
                      const role = isFirst ? "owner" : "member";

                      db.prepare(
                        `INSERT INTO member (id, "organizationId", "userId", role, "createdAt") VALUES (?, ?, ?, ?, datetime('now'))`,
                      ).run(randomUUID(), orgId, userId, role);

                      // first user on the platform becomes platform admin
                      if (isFirst) {
                        try {
                          db.prepare(
                            `UPDATE "user" SET is_admin = 1 WHERE id = ?`,
                          ).run(userId);
                        } catch {
                          // is_admin column may not exist yet
                        }

                        // send welcome email to new workspace owner (non-blocking)
                        if (user.email) {
                          const dashboardUrl = `${authBaseURL}/dashboard`;
                          sendWelcomeEmail(user, dashboardUrl).catch((err) => {
                            console.error("[auth] welcome email failed:", err);
                          });
                        }
                      }
                    }
                  } catch (err) {
                    console.error("[auth] member creation failed:", err);
                  }

                  // create linux user account (Phase 2 user split)
                  // runs on VPS tier only, no-op elsewhere
                  try {
                    const { createLinuxUser } = await import("./linux-users");
                    const linuxResult = await createLinuxUser(
                      user.email,
                      randomUUID().slice(0, 12), // temp password, user changes via terminal
                    );
                    if (linuxResult.created) {
                      // store linux username on user record for pty-manager
                      try {
                        db.prepare(
                          `UPDATE "user" SET linux_username = ? WHERE id = ?`,
                        ).run(linuxResult.username, userId);
                      } catch {
                        // linux_username column may not exist yet
                      }
                    }
                  } catch (err) {
                    console.error("[auth] linux user creation failed:", err);
                  }
                } catch (err) {
                  console.error("[auth] auto-org-creation failed:", err);
                }
              },
            },
          },
          organization: {
            create: {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              after: async (org: any) => {
                try {
                  if (org.slug) {
                    ensureNamespaceDirs(org.slug);
                    console.log(`[auth] created namespace dirs for org ${org.slug}`);
                  }
                } catch (err) {
                  console.error("[auth] org dir creation failed:", err);
                }
              },
            },
          },
          session: {
            create: {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              after: async (session: any) => {
                try {
                  const user = db.prepare(
                    `SELECT id FROM "user" WHERE id = ?`,
                  ).get(session.userId);

                  if (user?.id) {
                    await writeAuthAuditLog(
                      "auth_login",
                      "user logged in",
                      { user_id: user.id },
                      { source: "auth", ip: process.env.AUDIT_IP }
                    ).catch((err) => {
                      console.error("[auth] audit-login failed:", err);
                    });

                    // backfill DEK for users who don't have one yet
                    try {
                      const dekRow = db.prepare(
                        `SELECT wrapped_dek FROM "user" WHERE id = ?`,
                      ).get(user.id) as { wrapped_dek: Buffer | null } | undefined;
                      if (!dekRow?.wrapped_dek) {
                        const { generateDEKForUser } = await import("./user-crypto");
                        await generateDEKForUser(user.id, db);
                      }
                    } catch (err) {
                      console.error("[auth] DEK backfill failed:", err);
                    }
                  }

                  // skip if session already has an active org
                  if (session.activeOrganizationId) return;

                  // find user's default org membership
                  const row = db.prepare(
                    `SELECT o.id FROM organization o
                     JOIN member m ON m."organizationId" = o.id
                     WHERE m."userId" = ? AND o.slug = 'default' LIMIT 1`,
                  ).get(session.userId);

                  if (row) {
                    db.prepare(
                      `UPDATE session SET "activeOrganizationId" = ? WHERE id = ?`,
                    ).run(row.id, session.id);
                  }
                } catch (err) {
                  console.error("[auth] auto-set-active-org failed:", err);
                }
              },
            },
            delete: {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              after: async (session: any) => {
                try {
                  const user = db.prepare(
                    `SELECT id FROM "user" WHERE id = ?`,
                  ).get(session.userId);

                  if (user?.id) {
                    await writeAuthAuditLog(
                      "auth_logout",
                      "user logged out",
                      { user_id: user.id },
                      { source: "auth" }
                    ).catch((err) => {
                      console.error("[auth] audit-logout failed:", err);
                    });
                  }
                } catch (err) {
                  console.error("[auth] audit-logout failed:", err);
                  // don't fail the logout if audit fails
                }
              },
            },
          },
        },
      });

      // RUN MIGRATIONS SYNCHRONOUSLY - wait for tables before returning auth
      // this fixes the race condition where provisioner hits signup before tables exist
      console.log("[auth] running migrations...");
      const { getMigrations } = await import("better-auth/db/migration");
      const { runMigrations } = await getMigrations(_auth.options);
      await runMigrations();
      console.log("[auth] migrations complete");
    } catch (err) {
      console.error("[auth] failed to initialize better-auth:", err);
      _auth = null;
      throw err;
    }
  })();

  await _initPromise;
  return _auth;
}

/**
 * clear the forced password-change flag after the user sets a new password
 * (server-only; not exposed on better-auth client updateUser for invite-only tenants).
 */
export async function clearMustChangePasswordFlag(userId: string): Promise<void> {
  const db = await getDb();
  if (!db) {
    throw new Error("auth database not initialized");
  }
  db.prepare(`UPDATE "user" SET mustChangePassword = 0 WHERE id = ?`).run(userId);
}

export function onOrgCreated(slug: string) {
  try {
    ensureNamespaceDirs(slug);
  } catch (err) {
    console.error(`[auth] failed to create namespace dirs for ${slug}:`, err);
  }
}
