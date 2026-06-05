/**
 * email processing route
 * polls unread emails and fires chain triggers
 * called by polling mechanism or manually
 */

import { NextRequest } from "next/server";
import { promises as fs } from "fs";
import { join } from "path";
import { nsPath, orgPath } from "@/lib/config";
import {
  loadInboxes,
  claimEmail,
  moveEmail,
  appendAuditLog,
  readEmail,
} from "@/lib/email/email-storage";
import { requirePermission } from "@/lib/auth/rbac-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import type { NormalizedEmail } from "@/lib/email/email-types";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

async function loadChain(
  namespaceId: string,
  orgId: string,
  chainId: string
): Promise<Record<string, unknown> | null> {
  try {
    const chainPath = join(orgPath(namespaceId, orgId, "chains"), chainId, "chain.json");
    const content = await fs.readFile(chainPath, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function fireChainTrigger(
  chain: Record<string, unknown>,
  email: NormalizedEmail,
  namespaceId: string
): Promise<{ success: boolean; error?: string; runId?: string }> {
  try {
    const chainId = chain.id as string | undefined;
    if (!chainId) {
      return { success: false, error: "chain missing id" };
    }

    // build chain run request body
    const runBody = {
      chain,
      chainId,
      userPrompt: `Process incoming email from ${email.from}: ${email.subject}`,
      debug: false,
    };

    // invoke chain run endpoint
    const baseUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";
    const runUrl = `${baseUrl}/api/chains/run`;

    const response = await fetch(runUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-namespace-id": namespaceId,
        cookie: `email-processor=true`, // minimal auth marker
      },
      body: JSON.stringify(runBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: `chain run failed: ${response.status} ${errorText}` };
    }

    const result = (await response.json()) as { data?: { runId?: string }; runId?: string };
    return { success: true, runId: result.data?.runId || result.runId };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

async function processInbox(
  namespaceId: string,
  orgId: string,
  inbox: { id: string; folder: string; chainId?: string; enabled: boolean }
): Promise<{ processed: number; skipped: number; errors: string[] }> {
  const result = { processed: 0, skipped: 0, errors: [] as string[] };

  // skip inboxes without a chain configured
  if (!inbox.enabled || !inbox.chainId) {
    return result;
  }

  // list unread emails in the inbox folder
  const unreadDir = nsPath(namespaceId, inbox.folder, "unread");

  let files: string[];
  try {
    files = await fs.readdir(unreadDir);
  } catch {
    // dir doesn't exist yet
    return result;
  }

  const jsonFiles = files.filter((f) => f.endsWith(".json"));

  for (const file of jsonFiles) {
    const internalId = file.slice(0, -5); // strip .json

    // atomic claim - prevents double processing
    const claimed = await claimEmail(namespaceId, orgId, inbox.folder, internalId);
    if (!claimed) {
      result.skipped++;
      continue;
    }

    // read the email
    const email = await readEmail(namespaceId, orgId, inbox.folder, "processing", internalId);
    if (!email) {
      result.errors.push(`email ${internalId} not found after claim`);
      await moveEmail(namespaceId, orgId, inbox.folder, internalId, "processing", "failed");
      continue;
    }

    // log email_received event
    await appendAuditLog(namespaceId, orgId, {
      timestamp: new Date().toISOString(),
      event: "email_received",
      namespaceId,
      details: {
        internalId: email.internalId,
        from: email.from,
        subject: email.subject,
        inboxId: inbox.id,
        inboxFolder: inbox.folder,
        chainId: inbox.chainId,
      },
    });

    // load and fire the chain
    const chain = await loadChain(namespaceId, orgId, inbox.chainId);
    if (!chain) {
      result.errors.push(`chain ${inbox.chainId} not found for email ${internalId}`);
      await moveEmail(namespaceId, orgId, inbox.folder, internalId, "processing", "failed");
      await appendAuditLog(namespaceId, orgId, {
        timestamp: new Date().toISOString(),
        event: "chain_triggered_failed",
        namespaceId,
        details: {
          internalId,
          reason: "chain_not_found",
          chainId: inbox.chainId,
        },
      });
      continue;
    }

    const fireResult = await fireChainTrigger(
      chain,
      email,
      namespaceId
    );

    if (fireResult.success) {
      await moveEmail(namespaceId, orgId, inbox.folder, internalId, "processing", "processed");
      await appendAuditLog(namespaceId, orgId, {
        timestamp: new Date().toISOString(),
        event: "chain_triggered",
        namespaceId,
        details: {
          internalId,
          chainId: inbox.chainId,
          runId: fireResult.runId,
        },
      });
      result.processed++;
    } else {
      result.errors.push(fireResult.error || `failed to trigger chain for ${internalId}`);
      await moveEmail(namespaceId, orgId, inbox.folder, internalId, "processing", "failed");
      await appendAuditLog(namespaceId, orgId, {
        timestamp: new Date().toISOString(),
        event: "chain_triggered_failed",
        namespaceId,
        details: {
          internalId,
          reason: fireResult.error,
          chainId: inbox.chainId,
        },
      });
    }
  }

  return result;
}

// POST /api/email/process - process unread emails and fire chain triggers
export const POST = withErrorHandling(async (request: NextRequest) => {
  const perm = await requirePermission(request, "view_chains");
  if (perm) return perm;

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);

  const inboxes = await loadInboxes(namespaceId, orgId);

  let processed = 0;
  let skipped = 0;
  const errors: string[] = [];

  // process each inbox in parallel
  const results = await Promise.all(
    inboxes.map((inbox) =>
      processInbox(namespaceId, orgId, inbox).catch((err) => ({
        processed: 0,
        skipped: 0,
        errors: [err.message],
      }))
    )
  );

  for (const r of results) {
    processed += r.processed;
    skipped += r.skipped;
    errors.push(...r.errors);
  }

  return apiSuccess({
    processed,
    skipped,
    errors: errors.length > 0 ? errors : undefined,
  });
});
