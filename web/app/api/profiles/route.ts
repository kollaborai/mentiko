import { NextRequest } from "next/server";
import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import config from "@/lib/config";
import { checkAuth } from "@/lib/api-auth";
import { Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

interface TokenCounts {
  total_input: number;
  total_output: number;
  total: number;
  by_model: Record<string, { input: number; output: number; total: number }>;
}

interface Snapshot {
  label: string;
  timestamp: string;
  epoch: number;
  memory_mb: number;
  cpu_pct: number;
}

interface ApiCall {
  model: string;
  timestamp: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  duration_ms: number;
}

interface AgentProfile {
  session: string;
  agent_id: string;
  agent_name: string;
  run_id?: string;
  started_at: string;
  start_epoch: number;
  ended_at?: string;
  end_epoch?: number;
  duration_ms?: number;
  status: string;
  error?: string;
  snapshots: Snapshot[];
  api_calls: ApiCall[];
  tokens: TokenCounts;
  memory_samples: number[];
  peak_memory_mb: number;
  cpu_samples: number[];
  avg_cpu_pct: number;
}

const PROFILES_DIR = join(config.namespaceRoot, "profiles");

function readProfiles(): AgentProfile[] {
  if (!existsSync(PROFILES_DIR)) return [];

  const profiles: AgentProfile[] = [];

  try {
    const files = readdirSync(PROFILES_DIR).filter((f) => f.endsWith(".json"));

    for (const file of files) {
      try {
        const content = readFileSync(join(PROFILES_DIR, file), "utf-8");
        const profile: AgentProfile = JSON.parse(content);
        profiles.push(profile);
      } catch {
        // skip invalid json
      }
    }
  } catch {
    // ignore errors
  }

  return profiles;
}

export const GET = withErrorHandling(async (request: NextRequest) => {
  const perm = await checkAuth(request);
  if (!perm) {
    throw new Unauthorized();
  }

  const profiles = readProfiles();

  return apiSuccess({ profiles });
});
