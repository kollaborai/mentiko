/**
 * Email templates for Mentiko.
 * All templates return { subject, text, html }.
 * HTML uses inline CSS only (no build step, email client safe).
 */

export interface EmailTemplate {
  subject: string;
  text: string;
  html: string;
}

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" style="height:32px;width:32px;"><defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:#3b82f6"/><stop offset="100%" style="stop-color:#1e3a5f"/></linearGradient></defs><polygon points="100,30 165,65 165,135 100,170 35,135 35,65" fill="none" stroke="url(#g)" stroke-width="8"/><polygon points="100,50 145,75 145,125 100,150 55,125 55,75" fill="url(#g)" opacity="0.3"/><polygon points="100,70 125,85 125,115 100,130 75,115 75,85" fill="url(#g)"/></svg>`;

function baseLayout(content: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f5f5;">
  <div style="max-width:600px;margin:40px auto;background:white;border-radius:8px;overflow:hidden;">
    <div style="padding:30px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:24px;">${LOGO_SVG}<span style="font-size:14px;font-weight:700;letter-spacing:-0.02em;">mentiko</span></div>
      ${content}
    </div>
    <div style="padding:20px 30px;background:#f9f9f9;border-top:1px solid #eee;"><p style="margin:0;font-size:12px;color:#888;">Sent by Mentiko</p></div>
  </div>
</body>
</html>`;
}

function cta(label: string, url: string): string {
  return `<div style="margin:32px 0;"><a href="${url}" style="display:inline-block;padding:12px 24px;background:#3b82f6;color:white;text-decoration:none;border-radius:6px;font-weight:500;font-size:14px;">${label}</a></div>`;
}

export function renderWelcome({ name, dashboardUrl }: { name?: string; dashboardUrl: string }) {
  const greeting = name ? `Hi ${name},` : "Welcome to Mentiko!";
  return {
    subject: "Welcome to Mentiko — your workspace is ready",
    text: `${greeting}\n\nYour Mentiko workspace is ready. Start building AI agent chains, automate workflows, and deploy intelligent pipelines.\n\nGet started: ${dashboardUrl}\n\nThings to try:\n  1. Create your first chain\n  2. Browse templates\n  3. Invite your team\n\nQuestions? Reply to this email or visit support@mentiko.com.\n\nThe Mentiko team`,
    html: baseLayout(`
      <h1 style="margin:0 0 16px 0;font-size:24px;font-weight:600;color:#111;">Your workspace is ready</h1>
      <p style="margin:0 0 16px 0;font-size:15px;line-height:1.5;color:#555;">${greeting}</p>
      <p style="margin:0 0 24px 0;font-size:15px;line-height:1.5;color:#555;">
        Welcome to Mentiko. Build and orchestrate AI agent pipelines — from simple automations
        to complex multi-agent workflows.
      </p>
      ${cta("Open your dashboard", dashboardUrl)}
      <p style="margin:0 0 8px 0;font-size:14px;font-weight:500;color:#333;">Things to try first:</p>
      <ul style="margin:0 0 24px 0;padding-left:20px;font-size:14px;line-height:1.8;color:#555;">
        <li>Create your first chain in the visual editor</li>
        <li>Browse the template library for a head start</li>
        <li>Invite your team to collaborate</li>
      </ul>
      <p style="margin:0;font-size:13px;color:#777;">
        Questions? Reply to this email or contact
        <a href="mailto:support@mentiko.com" style="color:#3b82f6;">support@mentiko.com</a>.
      </p>`),
  };
}

export function renderEmailVerification({ name, verifyUrl }: { name?: string; verifyUrl: string }) {
  const greeting = name ? `Hi ${name},` : "Hi there,";
  return {
    subject: "Verify your email address",
    text: `${greeting}\n\nPlease verify your email:\n\n${verifyUrl}\n\nExpires in 24 hours.\n\nIf you didn't sign up for Mentiko, ignore this.`,
    html: baseLayout(`
      <h1 style="margin:0 0 16px 0;font-size:24px;font-weight:600;color:#111;">Verify your email</h1>
      <p style="margin:0 0 16px 0;font-size:15px;line-height:1.5;color:#555;">${greeting}</p>
      <p style="margin:0 0 24px 0;font-size:15px;line-height:1.5;color:#555;">Please verify your email address by clicking the button below:</p>
      ${cta("Verify email", verifyUrl)}
      <p style="margin:0 0 8px 0;font-size:13px;color:#777;">This link expires in 24 hours.</p>
      <p style="margin:0;font-size:13px;color:#777;">If you didn't sign up for Mentiko, ignore this email.</p>`),
  };
}

export function renderPasswordReset({ name, resetUrl }: { name?: string; resetUrl: string }) {
  const greeting = name ? `Hi ${name},` : "Hi there,";
  return {
    subject: "Reset your password",
    text: `${greeting}\n\nReset your password:\n\n${resetUrl}\n\nExpires in 1 hour.\n\nIf you didn't request this, ignore it.`,
    html: baseLayout(`
      <h1 style="margin:0 0 16px 0;font-size:24px;font-weight:600;color:#111;">Reset your password</h1>
      <p style="margin:0 0 16px 0;font-size:15px;line-height:1.5;color:#555;">${greeting}</p>
      <p style="margin:0 0 24px 0;font-size:15px;line-height:1.5;color:#555;">Click the button below to set a new password:</p>
      ${cta("Reset password", resetUrl)}
      <p style="margin:0 0 8px 0;font-size:13px;color:#777;">This link expires in 1 hour.</p>
      <p style="margin:0;font-size:13px;color:#777;">If you didn't request this, ignore it. Your password won't change.</p>`),
  };
}

export function renderEmailChange({ name, oldEmail, verifyUrl }: { name?: string; oldEmail: string; verifyUrl: string }) {
  const greeting = name ? `Hi ${name},` : "Hi there,";
  return {
    subject: "Confirm your new email address",
    text: `${greeting}\n\nYou requested to change your email from ${oldEmail}. Confirm:\n\n${verifyUrl}\n\nExpires in 24 hours.\n\nIf you didn't request this, ignore it.`,
    html: baseLayout(`
      <h1 style="margin:0 0 16px 0;font-size:24px;font-weight:600;color:#111;">Confirm your new email</h1>
      <p style="margin:0 0 16px 0;font-size:15px;line-height:1.5;color:#555;">${greeting}</p>
      <p style="margin:0 0 24px 0;font-size:15px;line-height:1.5;color:#555;">You requested to change from <strong>${oldEmail}</strong>. Confirm your new address:</p>
      ${cta("Confirm email change", verifyUrl)}
      <p style="margin:0 0 8px 0;font-size:13px;color:#777;">This link expires in 24 hours.</p>
      <p style="margin:0;font-size:13px;color:#777;">If you didn't request this, ignore it.</p>`),
  };
}

export function renderAccountDeletion({ name, confirmUrl }: { name?: string; confirmUrl?: string }) {
  const greeting = name ? `Hi ${name},` : "Hi there,";
  if (confirmUrl) {
    return {
      subject: "Confirm account deletion",
      text: `${greeting}\n\nWe received a request to delete your account. Click the link below to confirm:\n\n${confirmUrl}\n\nThis link expires in 24 hours.\n\nIf you didn't request this, ignore this email — your account is safe.`,
      html: baseLayout(`
        <h1 style="margin:0 0 16px 0;font-size:24px;font-weight:600;color:#111;">Confirm account deletion</h1>
        <p style="margin:0 0 16px 0;font-size:15px;line-height:1.5;color:#555;">${greeting}</p>
        <p style="margin:0 0 24px 0;font-size:15px;line-height:1.5;color:#555;">We received a request to permanently delete your account. Click the button below to confirm:</p>
        ${cta("Confirm deletion", confirmUrl)}
        <p style="margin:0 0 8px 0;font-size:13px;color:#777;">This link expires in 24 hours.</p>
        <p style="margin:0;font-size:13px;color:#777;">If you didn't request this, ignore this email — your account is safe.</p>`),
    };
  }
  return {
    subject: "Your account has been deleted",
    text: `${greeting}\n\nYour Mentiko account has been permanently deleted. All your data will be removed within 30 days.\n\nIf you didn't request this, contact support@mentiko.com immediately.`,
    html: baseLayout(`
      <h1 style="margin:0 0 16px 0;font-size:24px;font-weight:600;color:#111;">Account deleted</h1>
      <p style="margin:0 0 16px 0;font-size:15px;line-height:1.5;color:#555;">${greeting}</p>
      <p style="margin:0 0 24px 0;font-size:15px;line-height:1.5;color:#555;">Your Mentiko account has been permanently deleted. All associated data will be removed within 30 days.</p>
      <p style="margin:0;font-size:13px;color:#777;">If you didn't request this, contact <a href="mailto:support@mentiko.com" style="color:#3b82f6;">support@mentiko.com</a> immediately.</p>`),
  };
}
