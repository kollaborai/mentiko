/**
 * SaaS tenant signup gate: validates provisioning + org-invite tokens when
 * MENTIKO_DISABLE_PUBLIC_SIGNUP is enabled.
 */

import { timingSafeEqual } from "@/lib/auth/security";
import { loadInvites } from "@/lib/orgs/org-storage";

// Constant-time comparison delegates to security.timingSafeEqual (same
// Buffer/length/try-catch core). The empty-string guard stays here because
// callers treat a missing or blank token as an automatic non-match.
export function timingSafeTokenMatch(expected: string, received: string | undefined): boolean {
  if (!received || !expected) return false;
  return timingSafeEqual(expected, received);
}

/**
 * invite links carry token in URL; signup POST includes inviteToken + matching email.
 */
export async function isValidOrgInviteSignup(
  inviteToken: string | undefined,
  email: string | undefined,
): Promise<boolean> {
  if (!inviteToken || !email) return false;
  const namespaceId = process.env.NAMESPACE_ID || "default";

  const invites = await loadInvites(namespaceId);
  const invite = invites.find((i) => i.token === inviteToken);
  if (!invite || invite.status !== "pending") return false;
  if (new Date(invite.expiresAt) < new Date()) return false;
  return invite.email.toLowerCase() === email.toLowerCase();
}
