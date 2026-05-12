import { NextRequest } from "next/server";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import config from "@/lib/config";
import { getNamespaceConfig } from "@/lib/namespace-config";
import { checkAuth } from "@/lib/api-auth";
import { enforceGuestWrites } from "@/lib/middleware";
import { BadRequest, Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

interface ChainAgent {
  id?: string;
  name?: string;
  role?: string;
  prompt?: string;
  triggers?: string[];
  emits?: string;
}

interface ChainData {
  name: string;
  description?: string;
  version?: string;
  agents?: ChainAgent[];
  config?: {
    cli?: string;
    executor?: string;
    monitor?: boolean;
    max_rounds?: number;
    on_complete?: string;
  };
}

interface ChainCustomization {
  variables?: Record<string, string>;   // {VAR_NAME} -> replacement value
  agentProfile?: string;                // profile id to inject as default_agent_profile
  cli?: string;                         // override chain.config.cli
  executor?: string;                    // override chain.config.executor
}

// system placeholders that are resolved at runtime (not user-configurable)
const SYSTEM_VARS = new Set(["TASK", "GOAL", "CHAIN_NAME", "DATE", "TIMESTAMP", "RUN_ID"]);

/** extract {VARIABLE} placeholders from all agent prompts in the chain */
function extractVariables(chain: ChainData): string[] {
  const found = new Set<string>();
  const pattern = /\{([A-Z][A-Z0-9_]*)\}/g;

  function scan(text: string | undefined) {
    if (!text) return;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      if (!SYSTEM_VARS.has(m[1])) found.add(m[1]);
    }
  }

  for (const agent of chain.agents || []) {
    scan((agent as Record<string, unknown>).prompt as string | undefined);
    scan((agent as Record<string, unknown>).role as string | undefined);
  }
  scan(chain.description);

  return [...found].sort();
}

/** apply customizations to a chain before saving */
function applyCustomizations(chain: ChainData, custom: ChainCustomization): ChainData {
  let result = JSON.parse(JSON.stringify(chain)) as ChainData;

  // apply variable substitutions to all text fields
  if (custom.variables && Object.keys(custom.variables).length > 0) {
    const text = JSON.stringify(result);
    const substituted = text.replace(/\{([A-Z][A-Z0-9_]*)\}/g, (match, varName) => {
      return (custom.variables?.[varName]) ?? match;
    });
    result = JSON.parse(substituted) as ChainData;
  }

  // apply agent profile
  if (custom.agentProfile) {
    (result as unknown as Record<string, unknown>).default_agent_profile = custom.agentProfile;
  }

  // apply cli/executor override
  if (custom.cli || custom.executor) {
    result.config = result.config || {};
    if (custom.cli) result.config.cli = custom.cli;
    if (custom.executor) result.config.executor = custom.executor;
  }

  return result;
}

async function fetchChainFromUrl(url: string): Promise<ChainData> {
  const response = await fetch(url, {
    headers: { "User-Agent": "mentiko/1.0" },
  });
  if (!response.ok) {
    throw new BadRequest(`Failed to fetch URL: ${response.statusText}`, { url });
  }
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new BadRequest("Invalid JSON from URL", { url });
  }
}

function validateChain(chain: ChainData): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!chain?.name) errors.push("chain.name is required");
  if (!chain?.agents || !Array.isArray(chain.agents)) {
    errors.push("chain.agents must be an array");
  }
  return { valid: errors.length === 0, errors };
}

function saveChain(chain: ChainData, chainsDir: string) {
  if (!chain.name) {
    throw new BadRequest("chain.name is required", { field: "name" });
  }

  if (!chain.agents || !Array.isArray(chain.agents)) {
    throw new BadRequest("chain.agents must be an array", { field: "agents" });
  }

  let safeId = chain.name.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  // Check for duplicate chain name
  const existingChainPath = join(chainsDir, `${safeId}`, "chain.json");
  if (existsSync(existingChainPath)) {
    // Generate unique name by appending timestamp
    const timestamp = Date.now().toString(36);
    safeId = `${safeId}-${timestamp}`;
  }

  const chainDir = join(chainsDir, safeId);
  const chainPath = join(chainDir, "chain.json");

  mkdirSync(chainDir, { recursive: true });
  writeFileSync(chainPath, JSON.stringify(chain, null, 2));

  const uiChain = {
    id: safeId,
    name: chain.name,
    description: chain.description || "",
    version: chain.version || "1.0",
    agentCount: chain.agents?.length || 0,
    cli: chain.config?.cli || config.cliBin,
    monitor: chain.config?.monitor ?? true,
    maxRounds: chain.config?.max_rounds,
    onComplete: chain.config?.on_complete,
    agents: (chain.agents || []).map((a: ChainAgent) => ({
      id: a.id || "",
      name: a.name || "",
      role: a.role || "",
      triggers: a.triggers || [],
      emits: a.emits || "",
    })),
  };

  return { chain: uiChain, path: chainPath, id: safeId };
}

export const POST = withErrorHandling(async (request: NextRequest) => {
  const namespaceConfig = await getNamespaceConfig(request);

  const blockResult = await enforceGuestWrites(request);
  if (blockResult?.blocked) return blockResult.response;

  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const body = await request.json();
  let chain: ChainData | null = body.chain ?? null;

  if (body.url) {
    chain = await fetchChainFromUrl(body.url);
  }

  if (!chain) {
    throw new BadRequest("chain or url required", { field: "chain" });
  }

  // analyze mode: return requirements without saving
  if (body.analyze) {
    const vars = extractVariables(chain);
    return apiSuccess({
      analyze: true,
      variables: vars,
      hasVariables: vars.length > 0,
      chainName: chain.name,
      agentCount: chain.agents?.length || 0,
    });
  }

  // apply customizations before validation/save
  if (body.customizations) {
    chain = applyCustomizations(chain, body.customizations as ChainCustomization);
  }

  const validation = validateChain(chain);
  if (!validation.valid) {
    throw new BadRequest(validation.errors.join(", "), { errors: validation.errors });
  }

  const result = saveChain(chain, namespaceConfig.chainsDir);
  return apiSuccess(result);
});
