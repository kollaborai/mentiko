/**
 * SaaS tenant signup gate: validates provisioning + org-invite tokens when
 * MENTIKO_DISABLE_PUBLIC_SIGNUP is enabled.
 */

import { timingSafeEqual } from "crypto";
import { loadInvites } from "@/lib/org-storage";

export function timingSafeTokenMatch(expected: string, received: string | undefined): boolean {
  if (!received || !expected) return false;
  try {
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(received, "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
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
