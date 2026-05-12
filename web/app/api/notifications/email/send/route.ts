import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/rbac-auth";
import { BadRequest, InternalServerError } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

// NOTE: this is a legacy notification stub. For production email with quota,
// suppression lists, bounce handling, and circuit breakers, use /api/email/send
// (web/app/api/email/send/route.ts) instead. This route gate-checks the same
// "manage_chains" permission — anyone below that role cannot relay email here.

export const dynamic = "force-dynamic";

interface EmailRequest {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  type?: "agent_complete" | "agent_error" | "chain_complete" | "chain_failed" | "webhook_failed";
}

// simple email sending function
// in production, use resend, sendgrid, aws ses, or similar
async function sendEmail({ to, subject, html, text }: EmailRequest): Promise<boolean> {
  // check if email service is configured
  const apiKey = process.env.RESEND_API_KEY || process.env.SENDGRID_API_KEY;

  if (!apiKey) {
    console.warn("email service not configured");
    return false;
  }

  try {
    // using resend (https://resend.com)
    if (process.env.RESEND_API_KEY) {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: process.env.EMAIL_FROM || "notifications@agentchain.dev",
          to,
          subject,
          html: html || text,
        }),
      });

      return response.ok;
    }

    // using sendgrid
    if (process.env.SENDGRID_API_KEY) {
      const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.SENDGRID_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: to }] }],
          from: { email: process.env.EMAIL_FROM || "notifications@agentchain.dev" },
          subject,
          content: [
            { type: "text/html", value: html || "" },
            { type: "text/plain", value: text || "" },
          ].filter((c) => c.value),
        }),
      });

      return response.ok;
    }

    return false;
  } catch (error) {
    console.error("failed to send email:", error);
    return false;
  }
}

function getEmailTemplate(type: string, data: Record<string, unknown>): { subject: string; html: string } {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  const templates: Record<string, (d: Record<string, unknown>) => { subject: string; html: string }> = {
    agent_complete: (d) => ({
      subject: `Agent Complete: ${String(d.agentName || "Agent")}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #10b981;">Agent Completed</h2>
          <p>Agent <strong>${String(d.agentName || "Agent")}</strong> has completed successfully.</p>
          ${d.chainName ? `<p>Chain: ${String(d.chainName)}</p>` : ""}
          <p>Duration: ${String(d.duration || "N/A")}</p>
          <a href="${baseUrl}/chains/${String(d.chainId || "")}" style="display: inline-block; padding: 10px 20px; background: #10b981; color: white; text-decoration: none; border-radius: 5px;">View Details</a>
        </div>
      `,
    }),
    agent_error: (d) => ({
      subject: `Agent Error: ${String(d.agentName || "Agent")}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #ef4444;">Agent Error</h2>
          <p>Agent <strong>${String(d.agentName || "Agent")}</strong> has encountered an error.</p>
          ${d.error ? `<p style="color: #ef4444;">Error: ${String(d.error)}</p>` : ""}
          ${d.chainName ? `<p>Chain: ${String(d.chainName)}</p>` : ""}
          <a href="${baseUrl}/chains/${String(d.chainId || "")}" style="display: inline-block; padding: 10px 20px; background: #ef4444; color: white; text-decoration: none; border-radius: 5px;">View Details</a>
        </div>
      `,
    }),
    chain_complete: (d) => ({
      subject: `Chain Complete: ${String(d.chainName || "Chain")}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #10b981;">Chain Completed</h2>
          <p>Chain <strong>${String(d.chainName || "Chain")}</strong> has completed successfully.</p>
          <p>Duration: ${String(d.duration || "N/A")}</p>
          <a href="${baseUrl}/chains/${String(d.chainId || "")}" style="display: inline-block; padding: 10px 20px; background: #10b981; color: white; text-decoration: none; border-radius: 5px;">View Results</a>
        </div>
      `,
    }),
    chain_failed: (d) => ({
      subject: `Chain Failed: ${String(d.chainName || "Chain")}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #ef4444;">Chain Failed</h2>
          <p>Chain <strong>${String(d.chainName || "Chain")}</strong> has failed.</p>
          ${d.error ? `<p style="color: #ef4444;">Error: ${String(d.error)}</p>` : ""}
          <a href="${baseUrl}/chains/${String(d.chainId || "")}" style="display: inline-block; padding: 10px 20px; background: #ef4444; color: white; text-decoration: none; border-radius: 5px;">View Details</a>
        </div>
      `,
    }),
    webhook_failed: (d) => ({
      subject: `Webhook Delivery Failed`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #f97316;">Webhook Failed</h2>
          <p>Failed to deliver webhook to <strong>${String(d.url || "unknown endpoint")}</strong></p>
          ${d.httpCode ? `<p>HTTP Code: ${String(d.httpCode)}</p>` : ""}
          ${d.eventType ? `<p>Event: ${String(d.eventType)}</p>` : ""}
          <a href="${baseUrl}/notifications" style="display: inline-block; padding: 10px 20px; background: #f97316; color: white; text-decoration: none; border-radius: 5px;">View Notifications</a>
        </div>
      `,
    }),
  };

  return templates[type]?.(data) || {
    subject: "Notification",
    html: `<p>${JSON.stringify(data)}</p>`,
  };
}

export const POST = withErrorHandling(async (request: NextRequest) => {
  const perm = await requirePermission(request, "manage_chains");
  if (perm) return perm;
  const body: EmailRequest = await request.json();

  if (!body.to) {
    throw new BadRequest("recipient email is required", { field: "to" });
  }

  // use template if type is provided
  let subject = body.subject;
  let html = body.html;
  const text = body.text;

  if (body.type && !html) {
    const template = getEmailTemplate(body.type, body as unknown as Record<string, unknown>);
    subject = template.subject;
    html = template.html;
  }

  const sent = await sendEmail({
    to: body.to,
    subject: subject || "Notification",
    html,
    text,
  });

  if (!sent) {
    throw new InternalServerError("failed to send email");
  }

  return apiSuccess({ sent: true });
});
