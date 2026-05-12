/**
 * Shared email utility for Mentiko.
 * Uses nodemailer with SMTP config from env vars.
 * Falls back to console.log in dev when SMTP_USER is not set.
 */

export interface EmailOptions {
  to: string;
  subject: string;
  text: string;
  html: string;
}

const SMTP_HOST = process.env.SMTP_HOST || "smtp.titan.email";
const SMTP_PORT = parseInt(process.env.SMTP_PORT || "465");
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const SMTP_FROM =
  process.env.SMTP_FROM ||
  process.env.SMTP_USER ||
  "Mentiko <support@mentiko.com>";

const hasSmtp = Boolean(SMTP_USER && SMTP_PASS);

/**
 * Send an email. Returns true on success, false on failure.
 * Never throws — logs errors instead.
 */
export async function sendEmail(opts: EmailOptions): Promise<boolean> {
  if (!hasSmtp) {
    // dev mode: log to console, don't block
    console.log(`[email] dev mode — would send to ${opts.to}`);
    console.log(`[email]   subject: ${opts.subject}`);
    if (process.env.NODE_ENV === "production") {
      console.log("[email]   SMTP is not configured; message body suppressed in production logs.");
    } else {
      console.log(`[email]   text:\n${opts.text}`);
    }
    return true;
  }

  try {
    const nodemailerMod = await import("nodemailer");
    const transport = nodemailerMod.createTransport({
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
