/**
 * deployment-mode helpers for mentiko (OSS vs SaaS tenant containers).
 *
 * default is LOCKED. signup is closed unless one of:
 *   - MENTIKO_DISABLE_PUBLIC_SIGNUP=false (explicit unlock for OSS / dev)
 *   - the user table is empty (count===0 bootstrap path in auth-server.ts;
 *     allows a fresh OSS install to create its first admin without env vars)
 *
 * legacy tenants that were provisioned before the control plane started
 * writing this env var will fail-closed, which is the desired behavior —
 * better to surface "invitation required" than silently allow public signup.
 *
 * OAuth side effect: when locked, the better-auth providers carry
 * `disableImplicitSignUp: true` (auth-server.ts). that gate fires before
 * the user.create.before hook, so the count===0 OSS escape does NOT cover
 * first-time-OAuth-signup. self-hosters with GITHUB_CLIENT_ID etc must
 * either explicitly set MENTIKO_DISABLE_PUBLIC_SIGNUP=false or bootstrap
 * via email/password first.
 */

export function isManagedTenantSignupLocked(): boolean {
  return process.env.MENTIKO_DISABLE_PUBLIC_SIGNUP !== "false";
}
