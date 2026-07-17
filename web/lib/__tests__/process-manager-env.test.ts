import { readFileSync } from "fs";
import { join } from "path";
import {
  applyDevelopmentEnvLayers,
  buildManagedProcessEnv,
  MANAGED_PROCESS_ENV_WHITELIST,
  PLATFORM_PROCESS_ENV_WHITELIST,
} from "../process-manager-env";

describe("process manager environment", () => {
  it("keeps explicit supervisor env while allowing web local settings to override root dev settings", () => {
    const target = { MENTIKO_GLOBAL_ROOT: "/operator-root", PORT: "3200" } as unknown as NodeJS.ProcessEnv;

    applyDevelopmentEnvLayers(target, [
      { MENTIKO_GLOBAL_ROOT: "/repo-root", WEBHOOK_STATE_DIR: "/repo-webhooks", PORT: "3000" },
      { WEBHOOK_STATE_DIR: "/web-local-webhooks", PORT: "3100" },
    ]);

    expect(target.MENTIKO_GLOBAL_ROOT).toBe("/operator-root");
    expect(target.PORT).toBe("3200");
    expect(target.WEBHOOK_STATE_DIR).toBe("/web-local-webhooks");
  });

  it("passes pty manager override variables to managed child processes", () => {
    expect(MANAGED_PROCESS_ENV_WHITELIST).toContain("PTY_MGR_BIN");
    expect(MANAGED_PROCESS_ENV_WHITELIST).toContain("MENTIKO_PTY_MGR_BIN");
    expect(MANAGED_PROCESS_ENV_WHITELIST).toContain("PTY_DAEMON");
  });

  it("loads root and web-local env files before spawning managed dev children", () => {
    const source = readFileSync(join(process.cwd(), "lib/process-manager.ts"), "utf8");

    expect(source).toContain("path.join(cwd, '..', '.env')");
    expect(source).toContain("path.join(cwd, '.env.local')");
    expect(source).toContain("applyDevelopmentEnvLayers(process.env, layers)");
  });

  it("passes tenant transactional email variables to managed child processes", () => {
    expect(MANAGED_PROCESS_ENV_WHITELIST).toContain("SMTP_HOST");
    expect(MANAGED_PROCESS_ENV_WHITELIST).toContain("SMTP_PORT");
    expect(MANAGED_PROCESS_ENV_WHITELIST).toContain("SMTP_FROM");
    expect(MANAGED_PROCESS_ENV_WHITELIST).toContain("SMTP_USER");
    expect(MANAGED_PROCESS_ENV_WHITELIST).toContain("SMTP_PASS");
    expect(MANAGED_PROCESS_ENV_WHITELIST).toContain("RESEND_API_KEY");
    expect(MANAGED_PROCESS_ENV_WHITELIST).toContain("EMAIL_FROM");
  });

  it("passes tenant AI gateway variables only to managed Next.js", () => {
    const sourceEnv = {
      TENANT_ID: "tenant-1",
      MENTIKO_AI_GATEWAY_ENABLED: "true",
      MENTIKO_AI_GATEWAY_URL: "https://ai.mentiko.com/v1",
      MENTIKO_AI_GATEWAY_ALLOWED_ORIGIN: "https://ai.mentiko.com",
      MENTIKO_AI_GATEWAY_TOKEN_ID: "tok_test",
      MENTIKO_AI_GATEWAY_TOKEN: "secret-gateway-token",
    };

    const platformEnv = buildManagedProcessEnv({ name: "platform", env: {} }, sourceEnv);
    const workerEnv = buildManagedProcessEnv({ name: "worker", env: {} }, sourceEnv);

    expect(MANAGED_PROCESS_ENV_WHITELIST).toContain("TENANT_ID");
    expect(PLATFORM_PROCESS_ENV_WHITELIST).toContain("MENTIKO_AI_GATEWAY_TOKEN");
    expect(MANAGED_PROCESS_ENV_WHITELIST).not.toContain("MENTIKO_AI_GATEWAY_TOKEN");

    expect(platformEnv.TENANT_ID).toBe("tenant-1");
    expect(platformEnv.MENTIKO_AI_GATEWAY_ENABLED).toBe("true");
    expect(platformEnv.MENTIKO_AI_GATEWAY_URL).toBe("https://ai.mentiko.com/v1");
    expect(platformEnv.MENTIKO_AI_GATEWAY_ALLOWED_ORIGIN).toBe("https://ai.mentiko.com");
    expect(platformEnv.MENTIKO_AI_GATEWAY_TOKEN_ID).toBe("tok_test");
    expect(platformEnv.MENTIKO_AI_GATEWAY_TOKEN).toBe("secret-gateway-token");

    expect(workerEnv.TENANT_ID).toBe("tenant-1");
    expect(workerEnv.MENTIKO_AI_GATEWAY_ENABLED).toBeUndefined();
    expect(workerEnv.MENTIKO_AI_GATEWAY_URL).toBeUndefined();
    expect(workerEnv.MENTIKO_AI_GATEWAY_ALLOWED_ORIGIN).toBeUndefined();
    expect(workerEnv.MENTIKO_AI_GATEWAY_TOKEN_ID).toBeUndefined();
    expect(workerEnv.MENTIKO_AI_GATEWAY_TOKEN).toBeUndefined();
  });
});
