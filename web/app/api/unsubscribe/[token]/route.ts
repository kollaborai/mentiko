/**
 * GET /api/unsubscribe/[token] - validate token (public, no auth)
 * returns token status and masked email for display
 */

import { NextRequest } from "next/server";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { BadRequest, Gone } from "@/lib/api-errors";
import { validateUnsubscribeToken } from "@/lib/unsubscribe-token";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (
  _request: NextRequest,
  context: { params: Promise<{ token: string }> },
) => {
  const { token } = await context.params;

  const result = validateUnsubscribeToken(token);

  if (!result.valid) {
    const reasonMap = {
      invalid: "invalid",
      bad_signature: "invalid",
      expired: "expired",
    };
    if (result.reason === "expired") {
      throw new Gone(reasonMap[result.reason]);
    }
    throw new BadRequest(reasonMap[result.reason]);
  }

  // mask email for privacy (show first 3 chars + domain)
  const maskEmail = (email: string): string => {
    const [local, domain] = email.split("@");
    if (!domain) return email;
    return `${local.slice(0, 3)}***@${domain}`;
  };

  return apiSuccess({
    valid: true,
    email: maskEmail(result.email),
    namespaceId: result.namespaceId,
  });
});
