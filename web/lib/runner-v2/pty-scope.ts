import config, { derivePtyDaemonName } from "@/lib/config";

export type RunnerV2Environment = NodeJS.ProcessEnv | Record<string, string | undefined>;

/** Pin runner-v2 PTY operations to the run's data-root/namespace/org daemon. */
export function runnerV2PtyEnv(env: RunnerV2Environment = process.env): NodeJS.ProcessEnv {
  const globalRoot = env.MENTIKO_GLOBAL_ROOT || config.globalRoot;
  const namespaceId = env.NAMESPACE_ID || config.namespaceId;
  const orgId = env.ORG_ID || config.orgId;
  return {
    ...process.env,
    ...env,
    MENTIKO_GLOBAL_ROOT: globalRoot,
    NAMESPACE_ID: namespaceId,
    ORG_ID: orgId,
    PTY_DAEMON: derivePtyDaemonName(globalRoot, namespaceId, orgId),
  };
}
