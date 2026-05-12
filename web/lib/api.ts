// mentiko api client
// typed fetch wrappers for all backend endpoints

import type {
  Chain,
  ChainEvent,
  Run,
  AgentSession,
  RunMetadata,
  Template,
  BatchRequest,
  BatchStatus,
} from "./types";
import { syncQueue } from "./sync-queue";
import { unwrapApiData } from "./api-client";

const API_BASE = "/api";

// generic error class
export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, message: string, body: unknown = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

// wrapper for fetch with error handling and offline support
async function fetchJson<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const url = `${API_BASE}${path}`;
  const isMutating = options?.method && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(options.method);
  const isOnline = typeof window !== 'undefined' && navigator.onLine;

  // queue mutating requests when offline
  if (!isOnline && isMutating) {
    syncQueue.add({
      url,
      method: options.method || 'POST',
      headers: options.headers as Record<string, string> | undefined,
      body: options.body as string | undefined,
      maxRetries: 3,
    });
    throw new ApiError(0, 'offline - request queued for sync');
  }

  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    throw new ApiError(
      res.status,
      data?.error || res.statusText || "request failed",
      data
    );
  }

  return unwrapApiData<T>(data);
}

// stream response helper
async function fetchStream(
  path: string,
  onMessage: (data: string) => void,
  onError?: (error: Error) => void
): Promise<() => void> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url);

  if (!res.ok) {
    throw new ApiError(res.status, res.statusText);
  }

  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error("no response body");
  }

  const decoder = new TextDecoder();
  let cancelled = false;

  (async () => {
    try {
      while (!cancelled) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        onMessage(chunk);
      }
    } catch (err) {
      if (!cancelled && onError) {
        onError(err as Error);
      }
    }
  })();

  return () => {
    cancelled = true;
    reader.cancel();
  };
}

// chains api
export const chainsApi = {
  // list all chains
  list: (): Promise<{ chains: Chain[]; namespaceId: string }> =>
    fetchJson("/chains/list"),

  // get single chain by id
  get: (id: string): Promise<{ chain: Chain; path: string }> =>
    fetchJson(`/chains/${encodeURIComponent(id)}`),

  // run a chain
  run: (params: {
    chain: Chain;
    userPrompt?: string;
    debug?: boolean;
  }): Promise<{
    success: boolean;
    runId: string;
    chainId: string;
    output: string;
  }> =>
    fetchJson("/chains/run", {
      method: "POST",
      body: JSON.stringify({
        chain: params.chain,
        userPrompt: params.userPrompt,
        debug: params.debug,
      }),
    }),

  // save chain
  save: (params: {
    chain: Chain;
    name: string;
    createVersion?: boolean;
  }): Promise<{ success: boolean; path: string; version: string }> =>
    fetchJson("/chains/save", {
      method: "POST",
      body: JSON.stringify(params),
    }),

  // validate chain
  validate: (params: {
    chain: Chain;
    projectRoot?: string;
  }): Promise<{
    valid: boolean;
    errors: Array<{
      code: string;
      message: string;
      agent?: string;
      fixable?: boolean;
      fixAction?: string;
    }>;
    warnings: Array<{
      code: string;
      message: string;
      agent?: string;
      fixable?: boolean;
      fixAction?: string;
    }>;
  }> =>
    fetchJson("/chains/validate", {
      method: "POST",
      body: JSON.stringify(params),
    }),

  // import chain
  import: (params: {
    chain: Chain;
    name?: string;
  }): Promise<{ success: boolean; path: string; chain: Chain }> =>
    fetchJson("/chains/import", {
      method: "POST",
      body: JSON.stringify(params),
    }),

  // get chain status
  status: (id: string, options?: { expand?: boolean }): Promise<{ chain: Chain }> => {
    const params = new URLSearchParams({ id });
    if (options?.expand) params.set("expand", "true");
    return fetchJson(`/chains/status?${params.toString()}`);
  },

  // chain versions
  versions: (id: string): Promise<{
    versions: Array<{
      version: string;
      timestamp: number;
      path: string;
      size: number;
    }>;
  }> =>
    fetchJson(`/chains/${encodeURIComponent(id)}/versions`),

  // get specific version
  getVersion: (id: string, version: string): Promise<{ chain: Chain }> =>
    fetchJson(`/chains/${encodeURIComponent(id)}/versions/${version}`),

  // diff versions
  diffVersions: (id: string, from: string, to: string): Promise<{
    diff: string;
  }> =>
    fetchJson(`/chains/${encodeURIComponent(id)}/versions/diff?from=${from}&to=${to}`),

  // restore version
  restoreVersion: (id: string, version: string): Promise<{
    success: boolean;
    path: string;
  }> =>
    fetchJson(`/chains/${encodeURIComponent(id)}/versions/restore`, {
      method: "POST",
      body: JSON.stringify({ version }),
    }),

  // breakpoints
  getBreakpoints: (id: string): Promise<{
    breakpoints: Array<{
      agentId: string;
      enabled: boolean;
      condition?: string;
    }>;
  }> =>
    fetchJson(`/chains/${encodeURIComponent(id)}/breakpoints`),

  setBreakpoints: (id: string, breakpoints: Array<{
    agentId: string;
    enabled: boolean;
    condition?: string;
  }>): Promise<{ success: boolean }> =>
    fetchJson(`/chains/${encodeURIComponent(id)}/breakpoints`, {
      method: "POST",
      body: JSON.stringify({ breakpoints }),
    }),

  // debug state
  getDebugState: (id: string, runId: string): Promise<{
    state: Record<string, unknown>;
  }> =>
    fetchJson(`/chains/${encodeURIComponent(id)}/debug/state?runId=${runId}`),

  // batch run
  runBatch: (params: BatchRequest): Promise<{
    success: boolean;
    batchId: string;
    mode: string;
    chains: number;
    status: string;
  }> =>
    fetchJson("/chains/run-batch", {
      method: "POST",
      body: JSON.stringify(params),
    }),

  // get batch status
  getBatchStatus: (batchId: string): Promise<BatchStatus> =>
    fetchJson(`/chains/run-batch?id=${batchId}`),

  // list all batches
  listBatches: (): Promise<{ batches: BatchStatus[] }> =>
    fetchJson("/chains/run-batch"),

  // cancel batch
  cancelBatch: (batchId: string): Promise<{ success: boolean; cancelled: number }> =>
    fetchJson(`/chains/run-batch?id=${batchId}`, {
      method: "DELETE",
    }),
};

// agents api
export const agentsApi = {
  // list all running agents
  list: (): Promise<{
    agents: Array<{
      session: string;
      name: string;
      pid: number | null;
      createdAt: string | null;
      status: string;
    }>;
  }> =>
    fetchJson("/agents"),

  // get agent session output
  getOutput: (session: string): Promise<{
    output: string;
    session: string;
  }> =>
    fetchJson(`/agents/${encodeURIComponent(session)}/output`),

  // delete agent session
  deleteSession: (session: string): Promise<{
    success: boolean;
    session: string;
  }> =>
    fetchJson(`/agents/${encodeURIComponent(session)}`, {
      method: "DELETE",
    }),

  // send message to agent
  sendMessage: (session: string, message: string): Promise<{
    success: boolean;
  }> =>
    fetchJson(`/agents/${encodeURIComponent(session)}/message`, {
      method: "POST",
      body: JSON.stringify({ message }),
    }),
};

// runs api
export const runsApi = {
  // list all runs
  list: (params?: {
    chain?: string;
    limit?: number;
  }): Promise<{ runs: Run[] }> => {
    const searchParams = new URLSearchParams();
    if (params?.chain) searchParams.set("chain", params.chain);
    if (params?.limit) searchParams.set("limit", params.limit.toString());
    const query = searchParams.toString();
    return fetchJson(`/runs${query ? `?${query}` : ""}`);
  },

  // get single run
  get: (id: string): Promise<{
    run: Run & { agents: Array<AgentSession & {
      emits?: string;
      started?: string;
      completed?: string;
    }> };
  }> =>
    fetchJson(`/runs/${id}`),

  // compare runs
  compare: (runIds: string[]): Promise<{
    runs: RunMetadata[];
    comparison: Array<{
      metric: string;
      values: Array<{ runId: string; value: number | string }>;
    }>;
  }> =>
    fetchJson("/runs/compare", {
      method: "POST",
      body: JSON.stringify({ runIds }),
    }),
};

// events api
export const eventsApi = {
  // list events
  list: (params?: {
    dir?: string;
  }): Promise<{ events: ChainEvent[] }> => {
    const searchParams = new URLSearchParams();
    if (params?.dir) searchParams.set("dir", params.dir);
    const query = searchParams.toString();
    return fetchJson(`/events${query ? `?${query}` : ""}`);
  },

  // stream events
  stream: (
    onEvent: (event: ChainEvent) => void,
    onError?: (error: Error) => void
  ): Promise<() => void> =>
    fetchStream("/events/stream", (chunk) => {
      const lines = chunk.split("\n");
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const data = JSON.parse(line.slice(6));
            onEvent(data);
          } catch {
            // ignore parse errors
          }
        }
      }
    }, onError),
};

// schedules api
export const schedulesApi = {
  // list all schedules
  list: (): Promise<{
    schedules: Array<{
      chainId: string;
      chainName: string;
      schedule: string;
      timezone: string;
      enabled: boolean;
      lastRun: string | null;
      nextRun: string | null;
    }>;
  }> =>
    fetchJson("/schedules"),

  // enable/disable schedule
  setEnabled: (chainId: string, enabled: boolean): Promise<{
    success: boolean;
    enabled: boolean;
  }> =>
    fetchJson("/schedules", {
      method: "PUT",
      body: JSON.stringify({ chainId, enabled }),
    }),

  // update schedule expression
  update: (params: {
    chainId: string;
    schedule?: string;
    timezone?: string;
  }): Promise<{
    success: boolean;
    schedule: string | null;
    timezone: string;
    nextRun: string | null;
  }> =>
    fetchJson("/schedules", {
      method: "PATCH",
      body: JSON.stringify(params),
    }),

  // trigger scheduled chain now
  trigger: (chainId: string): Promise<{
    success: boolean;
    message: string;
    pid: number;
  }> =>
    fetchJson("/schedules", {
      method: "POST",
      body: JSON.stringify({ chainId }),
    }),
};

// templates api
export const templatesApi = {
  // list all templates
  list: (): Promise<{ templates: Template[] }> =>
    fetchJson("/templates/list"),

  // get template readme
  getReadme: (id: string): Promise<{ readme: string }> =>
    fetchJson(`/templates/${encodeURIComponent(id)}/readme`),

  // use template (copy as new chain)
  use: (id: string, name: string): Promise<{
    success: boolean;
    chain: Chain;
    path: string;
  }> =>
    fetchJson(`/templates/${encodeURIComponent(id)}/use`, {
      method: "POST",
      body: JSON.stringify({ name }),
    }),

  // rate template
  rate: (id: string, rating: number): Promise<{
    success: boolean;
    average: number;
    count: number;
  }> =>
    fetchJson(`/templates/${encodeURIComponent(id)}/rate`, {
      method: "POST",
      body: JSON.stringify({ rating }),
    }),

  // get template chain config
  getChain: (id: string): Promise<{ chain: Chain }> =>
    fetchJson(`/templates/${encodeURIComponent(id)}/chain`),
};

// convenience: re-export everything as default
const api = {
  chains: chainsApi,
  agents: agentsApi,
  runs: runsApi,
  events: eventsApi,
  schedules: schedulesApi,
  templates: templatesApi,
};
export default api;
