import { readFileSync } from "node:fs";
import { buildLocalAiGatewayProxyEnv } from "@/lib/ai-gateway/local-proxy-env";
import { resolveInternalAuthSecret } from "@/lib/auth/internal-api-auth";
import { mintSessionToken } from "@/lib/auth/session-token";
import { getProfile } from "@/lib/agents/agent-profile-storage";
import { getSecretsEnvVars, resolveProfileEnvVars, secretReferenceName } from "@/lib/secrets/secrets-store";
import type { RoutedLaunchJob } from "@/lib/runner-v2/launch-job";

/**
 * A configured credential input (profile, secret reference) that cannot be
 * reconstructed. Distinct class so callers can distinguish a fail-closed
 * configuration gap from an incidental I/O error in the reason they surface.
 */
export class UnresolvedResumeCredentialError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "UnresolvedResumeCredentialError";
  }
}

/**
 * Worker-side credential reconstruction for an accepted resume launch job
 * (issue #142 round 2).
 *
 * The persisted job environment deliberately carries only nonsecret identity
 * (namespace/org/run roots, capacity settings, PTY daemon socket). Before any
 * PTY effect, the trusted worker reconstructs the scoped session token and the
 * profile/secrets the route had at acceptance, from namespace, org, run and the
 * chain snapshot's nonsecret profile reference — never from persisted values.
 * Token and secret values exist only in the returned in-memory env and are
 * never written back to the job or run record.
 *
 * Any failure throws with a sanitized, actionable reason; the caller must
 * record it as an explicit blocked launch, never start different or
 * unauthenticated work and never requeue silently.
 */
export async function reconstructResumeLaunchEnvironment(
  job: RoutedLaunchJob,
  dependencies: { mintSessionToken?: typeof mintSessionToken } = {},
): Promise<Record<string, string>> {
  const nsId = job.environment.NAMESPACE_ID;
  const orgId = job.environment.ORG_ID;
  if (!nsId || !orgId) {
    throw new Error(
      `resume launch job ${job.id} persists no NAMESPACE_ID/ORG_ID identity; `
      + "cannot reconstruct scoped credentials for run "
      + `${job.runId}. Re-resume the run from the route so a canonical job is recorded.`,
    );
  }

  const env: Record<string, string> = {
    ...getSecretsEnvVars(nsId, orgId),
    BETTER_AUTH_SECRET: resolveInternalAuthSecret("chain-resume"),
  };

  // Profile env vars come from the chain snapshot's nonsecret profile
  // reference, exactly as the route resolved it at acceptance. Fail CLOSED
  // (issue #142 round 3): a referenced profile that is missing, or a
  // {secret:NAME} reference that does not resolve, blocks the launch — the
  // worker never proceeds without the configured provider environment.
  let profileId: string | undefined;
  try {
    const chain = JSON.parse(readFileSync(job.chainPath, "utf8")) as {
      default_agent_profile?: string;
      config?: { default_agent_profile?: string };
    };
    profileId = chain.default_agent_profile || chain.config?.default_agent_profile;
    if (profileId) {
      const profile = getProfile(nsId, orgId, profileId);
      if (!profile) {
        throw new UnresolvedResumeCredentialError(
          `agent profile ${profileId} referenced by ${job.chainPath} is missing; `
          + `recreate the profile before resuming run ${job.runId}`,
        );
      }
      if (profile.env) {
        const resolved = resolveProfileEnvVars(nsId, orgId, profile.env);
        const unresolved = Object.entries(resolved)
          .filter(([, value]) => secretReferenceName(value) !== null)
          .map(([key]) => key);
        if (unresolved.length > 0) {
          throw new UnresolvedResumeCredentialError(
            `secret reference(s) ${unresolved.join(", ")} of agent profile ${profileId} `
            + `could not be resolved from the secrets store for run ${job.runId}`,
          );
        }
        Object.assign(env, resolved);
      }
    }
  } catch (error) {
    if (error instanceof UnresolvedResumeCredentialError) throw error;
    throw new Error(
      `resume launch job ${job.id} could not resolve its agent profile from `
      + `${job.chainPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const webUrl = job.environment.MENTIKO_WEB_URL;
  if (webUrl) {
    Object.assign(env, buildLocalAiGatewayProxyEnv(webUrl));
    env.MENTIKO_WEB_URL = webUrl;
  }

  // Scoped session identity for the resumed agent's first ops call — same
  // convention as the route's internal-caller path: headless "cli" identity,
  // jti chain-<runId>, ops:* scope. Minted fresh here; never persisted.
  const sessionId = `chain-${job.runId}`;
  env.MENTIKO_SESSION_ID = sessionId;
  env.MENTIKO_SESSION_TOKEN = await (dependencies.mintSessionToken || mintSessionToken)({
    sub: "cli",
    jti: sessionId,
    ns: nsId,
    org: orgId,
    scopes: ["ops:*"],
  });
  return env;
}
