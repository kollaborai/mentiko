/**
 * auth.ts: compatibility shim over Better Auth.
 * keeps the same exports so 90+ importing routes don't break.
 */

import { checkAuthCompat, getServerSession } from "./auth-bridge";

export async function isAuthenticated(): Promise<boolean> {
  // can't check without a request in server components
  // use validateRequest(request) in API routes instead
  return false;
}

export async function validateRequest(request: Request): Promise<boolean> {
  return checkAuthCompat(request);
}

export function getBearerToken(_request: Request): string | null {
  return null;
}

export { getServerSession };
