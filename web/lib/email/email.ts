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
  from?: string;
}

function getEmailConfig() {
  const resendApiKey = process.env.RESEND_API_KEY || "";
  const smtpUser = process.env.SMTP_USER || "";
  const smtpPass = process.env.SMTP_PASS || "";
  const explicitSmtpHost = process.env.SMTP_HOST || "";
  const smtpHost = explicitSmtpHost || (smtpUser && smtpPass ? "smtp.titan.email" : "");
  const smtpPort = parseInt(process.env.SMTP_PORT || (explicitSmtpHost ? "587" : "465"), 10);
  const smtpFrom =
    process.env.SMTP_FROM ||
    smtpUser ||
    "Mentiko <support@mentiko.com>";

  if (resendApiKey) {
    return {
      mode: "resend" as const,
      from: smtpFrom,
      transport: {
        host: "smtp.resend.com",
        port: 465,
        secure: true,
        auth: { user: "resend", pass: resendApiKey },
      },
    };
  }

  if (smtpHost && smtpUser && smtpPass) {
    return {
      mode: "auth" as const,
      from: smtpFrom,
      transport: {
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: { user: smtpUser, pass: smtpPass },
      },
    };
  }

  if (explicitSmtpHost && process.env.SMTP_FROM) {
    return {
      mode: "relay" as const,
      from: smtpFrom,
      transport: {
        host: explicitSmtpHost,
        port: smtpPort,
        secure: false,
      },
    };
  }

  return { mode: "none" as const, from: smtpFrom, transport: null };
}

/**
 * Send an email. Returns true on success, false on failure.
 * Never throws — logs errors instead.
 */
export async function sendEmail(opts: EmailOptions): Promise<boolean> {
  const config = getEmailConfig();

  if (config.mode === "none") {
    // dev mode: log to console, don't block
    console.log(`[email] dev mode — would send to ${opts.to}`);
    console.log(`[email]   subject: ${opts.subject}`);
    if (process.env.NODE_ENV === "production") {
      console.log("[email]   No email provider configured (set RESEND_API_KEY or SMTP_HOST plus SMTP_FROM or SMTP_USER/SMTP_PASS); message body suppressed in production logs.");
    } else {
      console.log(`[email]   text:\n${opts.text}`);
    }
    return true;
  }

  try {
    const nodemailerMod = await import("nodemailer");
    const transport = nodemailerMod.createTransport(config.transport);

    await transport.sendMail({
      from: opts.from || config.from,
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
