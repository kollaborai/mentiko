/**
 * Shared email utility for Mentiko.
 * Provider preference: RESEND_API_KEY (smtp.resend.com) > generic SMTP_*.
 * Falls back to console.log in dev when neither is configured.
 */

export interface EmailOptions {
  to: string;
  subject: string;
  text: string;
  html: string;
}

const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const SMTP_HOST = process.env.SMTP_HOST || "smtp.titan.email";
const SMTP_PORT = parseInt(process.env.SMTP_PORT || "465");
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const SMTP_FROM =
  process.env.SMTP_FROM ||
  process.env.SMTP_USER ||
  "Mentiko <support@mentiko.com>";

const useResend = Boolean(RESEND_API_KEY);
const useSmtp = Boolean(SMTP_USER && SMTP_PASS);
const hasProvider = useResend || useSmtp;

/**
 * Send an email. Returns true on success, false on failure.
 * Never throws — logs errors instead.
 */
export async function sendEmail(opts: EmailOptions): Promise<boolean> {
  if (!hasProvider) {
    // dev mode: log to console, don't block
    console.log(`[email] dev mode — would send to ${opts.to}`);
    console.log(`[email]   subject: ${opts.subject}`);
    if (process.env.NODE_ENV === "production") {
      console.log("[email]   No email provider configured (set RESEND_API_KEY or SMTP_USER/SMTP_PASS); message body suppressed in production logs.");
    } else {
      console.log(`[email]   text:\n${opts.text}`);
    }
    return true;
  }

  try {
    const nodemailerMod = await import("nodemailer");
    const transport = useResend
      ? nodemailerMod.createTransport({
          host: "smtp.resend.com",
          port: 465,
          secure: true,
          auth: { user: "resend", pass: RESEND_API_KEY },
        })
      : nodemailerMod.createTransport({
          host: SMTP_HOST,
          port: SMTP_PORT,
          secure: SMTP_PORT === 465,
          auth: { user: SMTP_USER, pass: SMTP_PASS },
        });

    await transport.sendMail({
      from: SMTP_FROM,
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
    });

    return true;
  } catch (err) {
    console.error("[email] failed to send:", err);
    return false;
  }
}
