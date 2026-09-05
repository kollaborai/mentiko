/**
 * Client-safe onboarding constants — zero Node/server-only imports.
 *
 * onboarding-state.ts (this module's sibling) is server-only: it imports
 * "fs"/"path" to persist the onboarding record. A "use client" component
 * that imports ANYTHING from onboarding-state.ts — even a pure constant —
 * pulls that "fs" import into the client bundle graph and breaks the whole
 * app ("Module not found: Can't resolve 'fs'"). A client component that
 * needs the setup version or a deadline constant should import it from
 * here instead; onboarding-state.ts re-exports the same values for its
 * existing server-side importers.
 */
export const CURRENT_SETUP_VERSION = 11;
export const READINESS_DEADLINE_MS = 90_000;
export const SAMPLE_RUN_DEADLINE_MS = 5 * 60_000;
