import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/rbac-auth";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { BadRequest, ServiceUnavailable } from "@/lib/api-errors";

export const dynamic = "force-dynamic";

const SMTP_HOST = process.env.SMTP_HOST || "mail.privateemail.com";
const SMTP_PORT = parseInt(process.env.SMTP_PORT || "587");
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const SMTP_FROM = process.env.SMTP_FROM || process.env.SMTP_USER || "noreply@mentiko.com";

export const POST = withErrorHandling(async (request: NextRequest) => {
  const perm = await requirePermission(request, "manage_org");
  if (perm) return perm;

  if (!SMTP_USER || !SMTP_PASS) {
    throw new BadRequest("SMTP not configured");
  }

  const body = await request.json() as { to?: string };

  if (!body.to) {
    throw new BadRequest("Field 'to' is required", { field: "to" });
  }

  const to = body.to;

  // dynamic import - nodemailer optional
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let nodemailer: any = null;
  try {
    nodemailer = await import("nodemailer");
  } catch {
    throw new ServiceUnavailable("nodemailer not available");
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: false,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  await transporter.sendMail({
    from: SMTP_FROM,
    to,
    subject: "SMTP Test - mentiko",
    text: "This is a test email from mentiko to verify your SMTP configuration is working.",
  });

  return apiSuccess({
    ok: true,
    message: `Test email sent to ${to}`,
  });
});
