import { NextRequest } from "next/server";
import { execSync } from "child_process";
import { Unauthorized, BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { checkAuth } from "@/lib/auth/api-auth";

export const dynamic = "force-dynamic";

interface TestRequest {
  integration: "github" | "teams" | "slack" | "email";
  chain?: string;
  config?: Record<string, string>;
}

export const POST = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const { integration, config: integrationConfig }: TestRequest = await request.json();

  if (!integration) {
    throw new BadRequest("integration type required", { field: "integration" });
  }

  let result: { success: boolean; message: string; details?: string };

  switch (integration) {
    case "github":
      result = await testGitHub(integrationConfig);
      break;
    case "teams":
      result = await testTeams(integrationConfig);
      break;
    case "slack":
      result = await testSlack(integrationConfig);
      break;
    case "email":
      result = await testEmail(integrationConfig);
      break;
    default:
      throw new BadRequest("unknown integration type", { field: "integration" });
  }

  return apiSuccess(result);
});

async function testGitHub(cfg?: Record<string, string>) {
  const token = cfg?.token || process.env.GITHUB_TOKEN;
  const owner = cfg?.owner || process.env.GITHUB_OWNER;
  const repo = cfg?.repo || process.env.GITHUB_REPO;

  if (!token || !owner || !repo) {
    return {
      success: false,
      message: "missing github credentials",
      details: "need: token, owner, repo"
    };
  }

  try {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
      method: "POST",
      headers: {
        "Authorization": `token ${token}`,
        "Accept": "application/vnd.github.v3+json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        title: "[mentiko] test issue",
        body: "This is a test issue from mentiko integration test. You can delete this.",
        labels: ["test", "mentiko"]
      })
    });

    if (response.ok) {
      const data = await response.json();
      return {
        success: true,
        message: "test issue created",
        details: data.html_url
      };
    } else {
      const data = await response.json().catch(() => ({}));
      return {
        success: false,
        message: data.message || "github api error",
        details: response.statusText
      };
    }
  } catch (error: unknown) {
    return {
      success: false,
      message: "request failed",
      details: error instanceof Error ? error.message : String(error)
    };
  }
}

async function testTeams(cfg?: Record<string, string>) {
  const webhook = cfg?.webhook_url || process.env.TEAMS_WEBHOOK_URL;

  if (!webhook) {
    return {
      success: false,
      message: "missing teams webhook url",
      details: "set webhook_url or TEAMS_WEBHOOK_URL env"
    };
  }

  try {
    const payload = {
      type: "message",
      attachments: [{
        contentType: "application/vnd.microsoft.card.adaptive",
        content: {
          type: "AdaptiveCard",
          body: [{
            type: "TextBlock",
            text: "mentiko test notification"
          }]
        }
      }]
    };

    const response = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (response.ok || response.status === 200) {
      return {
        success: true,
        message: "notification sent"
      };
    } else {
      return {
        success: false,
        message: "teams webhook error",
        details: response.statusText
      };
    }
  } catch (error: unknown) {
    return {
      success: false,
      message: "request failed",
      details: error instanceof Error ? error.message : String(error)
    };
  }
}

async function testSlack(cfg?: Record<string, string>) {
  const webhook = cfg?.webhook_url || process.env.SLACK_WEBHOOK_URL;

  if (!webhook) {
    return {
      success: false,
      message: "missing slack webhook url",
      details: "set webhook_url or SLACK_WEBHOOK_URL env"
    };
  }

  try {
    const payload = {
      text: "mentiko test notification"
    };

    const response = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const text = await response.text();

    if (text === "ok" || response.ok) {
      return {
        success: true,
        message: "notification sent"
      };
    } else {
      return {
        success: false,
        message: "slack webhook error",
        details: text || response.statusText
      };
    }
  } catch (error: unknown) {
    return {
      success: false,
      message: "request failed",
      details: error instanceof Error ? error.message : String(error)
    };
  }
}

async function testEmail(cfg?: Record<string, string>) {
  const to = cfg?.to || process.env.CHAIN_EMAIL_TO;

  if (!to) {
    return {
      success: false,
      message: "missing email recipient",
      details: "set to or CHAIN_EMAIL_TO env"
    };
  }

  // check if mailer exists
  try {
    execSync("which sendmail");
    return {
      success: true,
      message: "sendmail available",
      details: `would send to: ${to}`
    };
  } catch {
    try {
      execSync("which mail");
      return {
        success: true,
        message: "mail command available",
        details: `would send to: ${to}`
      };
    } catch {
      return {
        success: false,
        message: "no mailer found",
        details: "install sendmail or mail"
      };
    }
  }
}
