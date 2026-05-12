import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/rbac-auth";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = parseInt(process.env.SMTP_PORT || "587");
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const SMTP_FROM = process.env.SMTP_FROM || "";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";

function maskSmtpUser(smtpUser: string): string {
  if (!smtpUser) return "";
  const parts = smtpUser.split("@");
  const localPart = parts[0] || "";
  const domain = parts[1] || "";
  const maskedLocal = localPart.slice(0, 3) + "***";
  return domain ? `${maskedLocal}@${domain}` : maskedLocal;
}

// Delivery modes:
//   resend  - RESEND_API_KEY set (routes through smtp.resend.com)
//   auth    - SMTP_HOST + SMTP_USER + SMTP_PASS (traditional SMTP with credentials)
//   relay   - SMTP_HOST + SMTP_FROM only (IP-based relay, no auth — used by mentiko.com hosting)
//   none    - no config, emails are queued but not delivered
type SmtpMode = "resend" | "auth" | "relay" | "none";

function getSmtpMode(): SmtpMode {
  if (RESEND_API_KEY) return "resend";
  if (SMTP_HOST && SMTP_USER && SMTP_PASS) return "auth";
  if (SMTP_HOST && SMTP_FROM) return "relay";
  return "none";
}

export const GET = withErrorHandling(async (request: NextRequest) => {
  const perm = await requirePermission(request, "view_chains");
  if (perm) return perm;

  const mode = getSmtpMode();
  const configured = mode !== "none";

  const displayUser = mode === "resend"
    ? "resend"
    : mode === "auth"
    ? maskSmtpUser(SMTP_USER)
    : "";

  const displayHost = mode === "resend" ? "smtp.resend.com" : SMTP_HOST;

  // inbound email is active when this is a mentiko.com-hosted instance
  // (TENANT_ID is injected by the control plane during provisioning)
  const tenantId = process.env.TENANT_ID || "";
  const smtpFromDomain = SMTP_FROM ? SMTP_FROM.replace(/^[^@]+@/, "") : "";
  const inboundEnabled = !!(tenantId && smtpFromDomain);

  return apiSuccess({
    configured,
    mode,
    host: displayHost,
    port: mode === "resend" ? 465 : SMTP_PORT,
    from: SMTP_FROM,
    user: displayUser,
    inboundEnabled,
    emailDomain: smtpFromDomain,
  });
});
