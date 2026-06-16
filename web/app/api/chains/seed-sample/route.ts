// -------------------------------------------------------------------
// POST /api/chains/seed-sample
// -------------------------------------------------------------------
// One-click new-user activation: a brand-new tenant has no chains, so
// every "run a chain" entry point dead-ends. This route idempotently
// creates ONE starter sample chain ("sample-starter") in the caller's
// current namespace/org and returns it. Calling again returns the
// existing chain without duplicating it.
//
// Session-authenticated (browser cookie) via checkAuth — the same helper
// used by sibling chain routes (chains/import, chains/save).
//
// Response contract (exact top-level shape, not the apiSuccess envelope):
//   200 { success: true,  chainId: string, alreadyExisted: boolean }
//   xxx { success: false, error: string }
// -------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import { checkAuth } from "@/lib/auth/api-auth";
import { enforceGuestWrites } from "@/lib/middleware";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { ensureSampleChain } from "@/lib/onboarding/sample-chain-template";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  _context: { params: Promise<Record<string, string>> },
) {
  // Next.js 16: route params are async even when unused.
  await _context.params;

  try {
    const blockResult = await enforceGuestWrites(request);
    if (blockResult?.blocked) {
      return NextResponse.json(
        { success: false, error: "Guest accounts cannot create chains" },
        { status: 403 },
      );
    }

    if (!(await checkAuth(request))) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    const namespaceId = await getNamespaceIdFromRequest(request);
    const orgId = await getOrgIdFromRequest(request);

    // Idempotent: writes the chain only if missing (or our managed copy is
    // out of date). `created` is true only when this call wrote the file, so
    // alreadyExisted is its negation.
    const result = ensureSampleChain(namespaceId, orgId);

    return NextResponse.json(
      {
        success: true,
        chainId: result.id,
        alreadyExisted: !result.created,
      },
      { status: 200 },
    );
  } catch (error) {
    const message =
      process.env.NODE_ENV !== "production" && error instanceof Error
        ? error.message
        : "Failed to create sample chain";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
