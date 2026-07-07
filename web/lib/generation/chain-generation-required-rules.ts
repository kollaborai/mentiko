export const CHAIN_GENERATION_RUNTIME_PROOF_RULE = `
DYNAMIC_PORT_RUNTIME_PROOF (required): Never assume port 3000 for generated app verification. Pick a free port at verification time, bind the target app explicitly to 127.0.0.1 on that port, capture the PID and working directory for the process you started, and verify target-specific content from this workspace. Do not treat an already-listening port as proof. Do not use broad kills such as pkill -f "next dev"; stop only the PID you started.`;

export function withRequiredChainGenerationRules(templateContent: string): string {
  return templateContent.includes("DYNAMIC_PORT_RUNTIME_PROOF")
    ? templateContent
    : `${templateContent.trim()}\n\n${CHAIN_GENERATION_RUNTIME_PROOF_RULE.trim()}`;
}
