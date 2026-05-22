/**
 * @jest-environment node
 */

jest.mock("@/lib/config", () => {
  const globalRoot = "/tmp/mentiko-global";
  const join = (...parts: string[]) => parts.join("/").replace(/\/+/g, "/");

  return {
    __esModule: true,
    default: {
      globalRoot,
      codeRoot: "/repo/mentiko",
      namespaceRoot: join(globalRoot, "namespaces", "default"),
      orgRoot: join(globalRoot, "namespaces", "default"),
      projectRoot: join(globalRoot, "namespaces", "default"),
    },
    nsPath: (nsId: string, ...segments: string[]) =>
      join(globalRoot, "namespaces", nsId, ...segments),
    orgPath: (nsId: string, orgId: string, ...segments: string[]) =>
      orgId === "default"
        ? join(globalRoot, "namespaces", nsId, ...segments)
        : join(globalRoot, "namespaces", nsId, "orgs", orgId, ...segments),
  };
});

import { buildChildEnv } from "@/lib/child-env";
import {
  buildLocalAiGatewayProxyEnv,
  resolveJobRunnerRoots,
  resolveJobWorkspaceCwd,
} from "./job-runner-launch";
import { resolveInternalAuthSecret } from "@/lib/internal-api-auth";

describe("job-runner-launch", () => {
  it("resolves runner roots from the request namespace/org instead of static config", () => {
    expect(resolveJobRunnerRoots("mike", "default")).toEqual({
      namespaceRoot: "/tmp/mentiko-global/namespaces/mike",
      orgRoot: "/tmp/mentiko-global/namespaces/mike",
      projectRoot: "/tmp/mentiko-global/namespaces/mike",
    });

    expect(resolveJobRunnerRoots("mike", "engineering")).toEqual({
      namespaceRoot: "/tmp/mentiko-global/namespaces/mike",
      orgRoot: "/tmp/mentiko-global/namespaces/mike/orgs/engineering",
      projectRoot: "/tmp/mentiko-global/namespaces/mike",
    });
  });

  it("keeps the workspace cwd preference order stable", () => {
    expect(
      resolveJobWorkspaceCwd({
        workspace: "/workspace/fallback",
        workspaceId: "/workspace/id",
        workspacePath: "/workspace/path",
        workspaceCwd: "/workspace/cwd",
      }),
    ).toBe("/workspace/cwd");
  });

  it("does not inherit tenant gateway tokens into child AI process env", () => {
    const previous = {
      enabled: process.env.MENTIKO_AI_GATEWAY_ENABLED,
      url: process.env.MENTIKO_AI_GATEWAY_URL,
      tokenId: process.env.MENTIKO_AI_GATEWAY_TOKEN_ID,
      token: process.env.MENTIKO_AI_GATEWAY_TOKEN,
    };
    process.env.MENTIKO_AI_GATEWAY_ENABLED = "true";
    process.env.MENTIKO_AI_GATEWAY_URL = "https://ai.mentiko.com/v1";
    process.env.MENTIKO_AI_GATEWAY_TOKEN_ID = "tok_test";
    process.env.MENTIKO_AI_GATEWAY_TOKEN = "mtk_ai_abcdefghijklmnopqrstuvwxyz1234567890";

    try {
      const env = buildChildEnv();

      expect(env.MENTIKO_AI_GATEWAY_ENABLED).toBeUndefined();
      expect(env.MENTIKO_AI_GATEWAY_URL).toBeUndefined();
      expect(env.MENTIKO_AI_GATEWAY_TOKEN_ID).toBeUndefined();
      expect(env.MENTIKO_AI_GATEWAY_TOKEN).toBeUndefined();
    } finally {
      if (previous.enabled === undefined) delete process.env.MENTIKO_AI_GATEWAY_ENABLED;
      else process.env.MENTIKO_AI_GATEWAY_ENABLED = previous.enabled;
      if (previous.url === undefined) delete process.env.MENTIKO_AI_GATEWAY_URL;
      else process.env.MENTIKO_AI_GATEWAY_URL = previous.url;
      if (previous.tokenId === undefined) delete process.env.MENTIKO_AI_GATEWAY_TOKEN_ID;
      else process.env.MENTIKO_AI_GATEWAY_TOKEN_ID = previous.tokenId;
      if (previous.token === undefined) delete process.env.MENTIKO_AI_GATEWAY_TOKEN;
      else process.env.MENTIKO_AI_GATEWAY_TOKEN = previous.token;
    }
  });

  it("does not inherit server-level provider credentials into child env", () => {
    const previous = {
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
      anthropicAuthToken: process.env.ANTHROPIC_AUTH_TOKEN,
      anthropicBaseUrl: process.env.ANTHROPIC_BASE_URL,
      openAiApiKey: process.env.OPENAI_API_KEY,
      glmToken: process.env.GLM_TOKEN,
    };
    process.env.ANTHROPIC_API_KEY = "server-anthropic-key";
    process.env.ANTHROPIC_AUTH_TOKEN = "server-anthropic-token";
    process.env.ANTHROPIC_BASE_URL = "https://server-anthropic.example";
    process.env.OPENAI_API_KEY = "server-openai-key";
    process.env.GLM_TOKEN = "server-glm-token";

    try {
      const env = buildChildEnv();

      expect(env.ANTHROPIC_API_KEY).toBeUndefined();
      expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
      expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
      expect(env.OPENAI_API_KEY).toBeUndefined();
      expect(env.GLM_TOKEN).toBeUndefined();
    } finally {
      if (previous.anthropicApiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previous.anthropicApiKey;
      if (previous.anthropicAuthToken === undefined) delete process.env.ANTHROPIC_AUTH_TOKEN;
      else process.env.ANTHROPIC_AUTH_TOKEN = previous.anthropicAuthToken;
      if (previous.anthropicBaseUrl === undefined) delete process.env.ANTHROPIC_BASE_URL;
      else process.env.ANTHROPIC_BASE_URL = previous.anthropicBaseUrl;
      if (previous.openAiApiKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previous.openAiApiKey;
      if (previous.glmToken === undefined) delete process.env.GLM_TOKEN;
      else process.env.GLM_TOKEN = previous.glmToken;
    }
  });

  it("builds local AI proxy env without exposing the upstream gateway token", () => {
    const previous = {
      enabled: process.env.MENTIKO_AI_GATEWAY_ENABLED,
      url: process.env.MENTIKO_AI_GATEWAY_URL,
      tokenId: process.env.MENTIKO_AI_GATEWAY_TOKEN_ID,
      token: process.env.MENTIKO_AI_GATEWAY_TOKEN,
      tenantId: process.env.TENANT_ID,
      betterAuthUrl: process.env.BETTER_AUTH_URL,
      betterAuthSecret: process.env.BETTER_AUTH_SECRET,
      gatewayAllowedOrigin: process.env.MENTIKO_AI_GATEWAY_ALLOWED_ORIGIN,
      webPort: process.env.WEB_PORT,
    };
    process.env.MENTIKO_AI_GATEWAY_ENABLED = "true";
    process.env.MENTIKO_AI_GATEWAY_URL = "https://ai.mentiko.com/v1";
    process.env.MENTIKO_AI_GATEWAY_TOKEN_ID = "tok_test";
    process.env.MENTIKO_AI_GATEWAY_TOKEN = "mtk_ai_abcdefghijklmnopqrstuvwxyz1234567890";
    process.env.TENANT_ID = "550e8400-e29b-41d4-a716-446655440000";
    process.env.BETTER_AUTH_URL = "https://app.mentiko.com";
    process.env.BETTER_AUTH_SECRET = "test-better-auth-secret";
    process.env.MENTIKO_AI_GATEWAY_ALLOWED_ORIGIN = "https://ai.mentiko.com";
    process.env.WEB_PORT = "3000";

    try {
      const env = buildLocalAiGatewayProxyEnv("http://127.0.0.1:3000");

      expect(env.MENTIKO_AI_GATEWAY_LOCAL_PROXY_ENABLED).toBe("true");
      expect(env.MENTIKO_AI_GATEWAY_LOCAL_BASE_URL).toBe(
        "http://127.0.0.1:3000/api/ai-gateway/local/v1",
      );
      expect(env.MENTIKO_AI_GATEWAY_LOCAL_TOKEN).toBeTruthy();
      expect(Object.values(env)).not.toContain(process.env.MENTIKO_AI_GATEWAY_TOKEN);
      expect(env.MENTIKO_AI_GATEWAY_LOCAL_TOKEN).not.toBe(process.env.BETTER_AUTH_SECRET);
      expect(env.MENTIKO_AI_GATEWAY_LOCAL_TOKEN).toBe(
        resolveInternalAuthSecret("ai-gateway-local-proxy"),
      );
    } finally {
      if (previous.enabled === undefined) delete process.env.MENTIKO_AI_GATEWAY_ENABLED;
      else process.env.MENTIKO_AI_GATEWAY_ENABLED = previous.enabled;
      if (previous.url === undefined) delete process.env.MENTIKO_AI_GATEWAY_URL;
      else process.env.MENTIKO_AI_GATEWAY_URL = previous.url;
      if (previous.tokenId === undefined) delete process.env.MENTIKO_AI_GATEWAY_TOKEN_ID;
      else process.env.MENTIKO_AI_GATEWAY_TOKEN_ID = previous.tokenId;
      if (previous.token === undefined) delete process.env.MENTIKO_AI_GATEWAY_TOKEN;
      else process.env.MENTIKO_AI_GATEWAY_TOKEN = previous.token;
      if (previous.tenantId === undefined) delete process.env.TENANT_ID;
      else process.env.TENANT_ID = previous.tenantId;
      if (previous.betterAuthUrl === undefined) delete process.env.BETTER_AUTH_URL;
      else process.env.BETTER_AUTH_URL = previous.betterAuthUrl;
      if (previous.betterAuthSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
      else process.env.BETTER_AUTH_SECRET = previous.betterAuthSecret;
      if (previous.gatewayAllowedOrigin === undefined) delete process.env.MENTIKO_AI_GATEWAY_ALLOWED_ORIGIN;
      else process.env.MENTIKO_AI_GATEWAY_ALLOWED_ORIGIN = previous.gatewayAllowedOrigin;
      if (previous.webPort === undefined) delete process.env.WEB_PORT;
      else process.env.WEB_PORT = previous.webPort;
    }
  });
});
