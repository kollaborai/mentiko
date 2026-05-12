export type ChainExportFormat = "json" | "markdown" | "yaml";
export type ChainImportFormat = "json" | "yaml" | "auto";

export interface ChainAgent {
  id: string;
  name: string;
  role?: string;
  triggers: string[];
  emits: string;
  timeout?: number;
  retry?: {
    max_retries?: number;
    backoff?: string;
    maxRetries?: number;
    backoffMs?: number;
    retryOn?: "error" | "timeout" | "both";
  };
  on_error?: string;
  on_timeout?: string;
}

export interface ChainBranch {
  [event: string]: string | string[] | {
    fan_out?: string[];
    fan_in?: string;
    default?: string;
    conditions?: Array<{ if: string; then: string }>;
    on_error?: string;
    wait_for?: "all" | "any" | "quorum";
    quorum?: number;
  };
}

export interface ChainConfig {
  monitor: boolean;
  max_rounds?: number;
  on_complete?: string;
}

export interface ChainData {
  id: string;
  name: string;
  description: string;
  version: string;
  config: ChainConfig;
  agents: ChainAgent[];
  branches?: ChainBranch;
}

export interface ChainExportOptions {
  includeMetadata?: boolean;
  includeVisualDiagram?: boolean;
}

export interface ChainImportResult {
  success: boolean;
  data?: ChainData;
  format?: ChainImportFormat;
  error?: string;
}

export interface DetailedValidationError {
  path: string;
  message: string;
  code: string;
  severity: "error" | "warning";
  fixable?: boolean;
  fixAction?: string;
}

export interface ChainImportPreview {
  valid: boolean;
  chain: ChainData;
  format: ChainImportFormat;
  errors: DetailedValidationError[];
  warnings: DetailedValidationError[];
  agents: number;
  hasBranches: boolean;
  hasManualStart: boolean;
}

function chainToMarkdown(chain: ChainData, options: ChainExportOptions = {}): string {
  const { includeMetadata = true, includeVisualDiagram = true } = options;
  const lines: string[] = [];

  lines.push(`# ${chain.name}`);
  lines.push("");
  if (chain.description) {
    lines.push(chain.description);
    lines.push("");
  }

  if (includeMetadata) {
    lines.push("## Metadata");
    lines.push("");
    lines.push(`| Property | Value |`);
    lines.push(`|----------|-------|`);
    lines.push(`| Version | \`${chain.version}\` |`);
    lines.push(`| Monitor | ${chain.config.monitor ? "Enabled" : "Disabled"} |`);
    if (chain.config.max_rounds) {
      lines.push(`| Max Rounds | ${chain.config.max_rounds} |`);
    }
    if (chain.config.on_complete) {
      lines.push(`| On Complete | \`${chain.config.on_complete}\` |`);
    }
    lines.push("");
  }

  lines.push("## Agents");
  lines.push("");

  chain.agents.forEach((agent, idx) => {
    lines.push(`### ${idx + 1}. ${agent.name}`);
    lines.push("");
    lines.push(`**ID:** \`${agent.id}\``);
    lines.push("");
    if (agent.role) {
      lines.push(`**Role:** ${agent.role}`);
      lines.push("");
    }
    lines.push(`**Triggers:** ${(agent.triggers || []).map((t) => `\`${t}\``).join(", ") || "none"}`);
    lines.push("");
    lines.push(`**Emits:** \`${agent.emits}\``);
    lines.push("");
    if (agent.timeout) {
      lines.push(`**Timeout:** ${agent.timeout}s`);
      lines.push("");
    }
    if (agent.retry?.max_retries) {
      lines.push(`**Retry:** ${agent.retry.max_retries}x with ${agent.retry.backoff} backoff`);
      lines.push("");
    }
    if (agent.on_error) {
      lines.push(`**On Error:** \`${agent.on_error}\``);
      lines.push("");
    }
    if (agent.on_timeout) {
      lines.push(`**On Timeout:** \`${agent.on_timeout}\``);
      lines.push("");
    }
  });

  if (chain.branches && Object.keys(chain.branches).length > 0) {
    lines.push("## Event Routing");
    lines.push("");
    lines.push("| Event | Target |");
    lines.push("|-------|--------|");
    Object.entries(chain.branches).forEach(([event, target]) => {
      const targetStr = typeof target === "string"
        ? `\`${target}\``
        : Array.isArray(target)
        ? target.map((t) => `\`${t}\``).join(", ")
        : `\`${JSON.stringify(target)}\``;
      lines.push(`| \`${event}\` | ${targetStr} |`);
    });
    lines.push("");
  }

  if (includeVisualDiagram) {
    lines.push("## Flow Diagram");
    lines.push("");
    lines.push("```mermaid");
    lines.push("graph TD");

    chain.agents.forEach((agent) => {
      const isStart = (agent.triggers || []).includes("manual-start");
      const shape = isStart ? "([`" + agent.name + "`])" : "[`" + agent.name + "`]";
      lines.push(`  ${agent.id}${shape}`);
    });

    Object.entries(chain.branches || {}).forEach(([event, target]) => {
      const fromAgent = chain.agents.find((a) => a.emits === event);
      if (fromAgent) {
        if (typeof target === "string") {
          lines.push(`  ${fromAgent.id} -->|${event}| ${target}`);
        } else if (Array.isArray(target)) {
          target.forEach((t) => {
            lines.push(`  ${fromAgent.id} -->|${event}| ${t}`);
          });
        }
      }
    });

    lines.push("```");
    lines.push("");
  }

  lines.push("## JSON Export");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify({ name: chain.name, description: chain.description, version: chain.version, config: chain.config, agents: chain.agents, branches: chain.branches }, null, 2));
  lines.push("```");

  return lines.join("\n");
}

function chainToYaml(chain: ChainData): string {
  const lines: string[] = [];

  lines.push(`name: ${chain.name}`);
  lines.push(`description: ${chain.description}`);
  lines.push(`version: ${chain.version}`);
  lines.push("");
  lines.push("config:");
  lines.push(`  monitor: ${chain.config.monitor}`);
  if (chain.config.max_rounds) {
    lines.push(`  max_rounds: ${chain.config.max_rounds}`);
  }
  if (chain.config.on_complete) {
    lines.push(`  on_complete: ${chain.config.on_complete}`);
  }
  lines.push("");
  lines.push("agents:");

  chain.agents.forEach((agent) => {
    lines.push(`  - id: ${agent.id}`);
    lines.push(`    name: ${agent.name}`);
    if (agent.role) {
      lines.push(`    role: ${agent.role.replace(/\n/g, " ")}`);
    }
    if ((agent.triggers || []).length > 0) {
      lines.push(`    triggers: [${(agent.triggers || []).map((t) => `"${t}"`).join(", ")}]`);
    }
    lines.push(`    emits: ${agent.emits}`);
    if (agent.timeout) {
      lines.push(`    timeout: ${agent.timeout}`);
    }
    if (agent.retry?.max_retries) {
      lines.push(`    retry:`);
      lines.push(`      max_retries: ${agent.retry.max_retries}`);
      lines.push(`      backoff: ${agent.retry.backoff}`);
    }
    if (agent.on_error) {
      lines.push(`    on_error: ${agent.on_error}`);
    }
    if (agent.on_timeout) {
      lines.push(`    on_timeout: ${agent.on_timeout}`);
    }
  });

  if (chain.branches && Object.keys(chain.branches).length > 0) {
    lines.push("");
    lines.push("branches:");
    Object.entries(chain.branches).forEach(([event, target]) => {
      lines.push(`  "${event}": ${JSON.stringify(target)}`);
    });
  }

  return lines.join("\n");
}

export function exportChain(chain: ChainData, format: ChainExportFormat = "json", options: ChainExportOptions = {}): string {
  switch (format) {
    case "markdown":
      return chainToMarkdown(chain, options);
    case "yaml":
      return chainToYaml(chain);
    case "json":
    default:
      return JSON.stringify(chain, null, 2);
  }
}

export function downloadChain(chain: ChainData, format: ChainExportFormat = "json", options: ChainExportOptions = {}): void {
  const content = exportChain(chain, format, options);
  const mimeTypes: Record<ChainExportFormat, string> = {
    json: "application/json",
    markdown: "text/markdown",
    yaml: "text/yaml",
  };
  const extensions: Record<ChainExportFormat, string> = {
    json: ".chain.json",
    markdown: ".md",
    yaml: ".yaml",
  };

  const blob = new Blob([content], { type: mimeTypes[format] });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${chain.id}${extensions[format]}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function parseYamlToChain(yaml: string): ChainData {
  const lines = yaml.split("\n");
  const chain: ChainData = {
    id: "",
    name: "",
    description: "",
    version: "1.0",
    config: { monitor: true },
    agents: [],
  };

  let currentAgent: Partial<ChainAgent> | null = null;
  let inAgents = false;
  let inBranches = false;
  let inConfig = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const indent = line.match(/^\s*/)?.[0].length || 0;
    const colonIdx = trimmed.indexOf(":");

    if (indent === 0) {
      currentAgent = null;
      inAgents = false;
      inBranches = false;
      inConfig = false;

      if (colonIdx > 0) {
        const key = trimmed.slice(0, colonIdx).trim();
        const value = trimmed.slice(colonIdx + 1).trim();

        switch (key) {
          case "name":
            chain.name = value.replace(/^["']|["']$/g, "");
            break;
          case "description":
            chain.description = value.replace(/^["']|["']$/g, "");
            break;
          case "version":
            chain.version = value.replace(/^["']|["']$/g, "");
            break;
          case "agents":
            inAgents = true;
            break;
          case "branches":
            inBranches = true;
            chain.branches = {};
            break;
          case "config":
            inConfig = true;
            break;
        }
      }
    } else if (inConfig && colonIdx > 0) {
      const key = trimmed.slice(0, colonIdx).trim();
      const value = trimmed.slice(colonIdx + 1).trim();

      switch (key) {
        case "monitor":
          chain.config.monitor = value === "true";
          break;
        case "max_rounds":
          chain.config.max_rounds = parseInt(value, 10);
          break;
        case "on_complete":
          chain.config.on_complete = value.replace(/^["']|["']$/g, "");
          break;
      }
    } else if (inAgents && trimmed.startsWith("- ")) {
      if (currentAgent) {
        chain.agents.push(currentAgent as ChainAgent);
      }
      currentAgent = {};
    } else if (inAgents && currentAgent !== null && colonIdx > 0) {
      const key = trimmed.slice(0, colonIdx).trim();
      const value = trimmed.slice(colonIdx + 1).trim();

      switch (key) {
        case "id":
          currentAgent.id = value.replace(/^["']|["']$/g, "");
          break;
        case "name":
          currentAgent.name = value.replace(/^["']|["']$/g, "");
          break;
        case "role":
          currentAgent.role = value.replace(/^["']|["']$/g, "");
          break;
        case "emits":
          currentAgent.emits = value.replace(/^["']|["']$/g, "");
          break;
        case "timeout":
          currentAgent.timeout = parseInt(value, 10);
          break;
        case "triggers":
          const arrayMatch = value.match(/^\[(.*)\]$/);
          if (arrayMatch) {
            currentAgent.triggers = arrayMatch[1]
              .split(",")
              .map((t) => t.trim().replace(/^["']|["']$/g, ""))
              .filter(Boolean);
          }
          break;
      }
    } else if (inBranches && colonIdx > 0) {
      const key = trimmed.slice(0, colonIdx).trim().replace(/^["']|["']$/g, "");
      const value = trimmed.slice(colonIdx + 1).trim();

      if (!chain.branches) chain.branches = {};
      chain.branches[key] = value.replace(/^["']|["']$/g, "");
    }
  }

  if (currentAgent) {
    chain.agents.push(currentAgent as ChainAgent);
  }

  if (!chain.id || chain.id.trim() === "") {
    if (!chain.name || chain.name.trim() === "") {
      throw new Error("Chain must have a name");
    }
    chain.id = chain.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    if (chain.id === "") {
      chain.id = `unnamed-${Date.now().toString(36)}`;
    }
  }

  return chain;
}

export function importChainFromString(text: string, _filename = "import"): ChainData {
  const trimmed = text.trim();
  let data: ChainData;

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      data = JSON.parse(text);
    } catch (err) {
      throw new Error("Invalid JSON: " + (err as Error).message);
    }
  } else if (trimmed.includes("name:") && trimmed.includes("agents:")) {
    data = parseYamlToChain(text);
  } else {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("Unsupported format. Please use JSON or YAML.");
    }
  }

  if (!data.name || !data.agents || !Array.isArray(data.agents)) {
    throw new Error("Invalid chain format: missing name or agents array");
  }

  return data;
}

export async function importChainFromUrl(url: string): Promise<ChainData> {
  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.toLowerCase();

    // SSRF protection: reject internal/private IPs
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname.startsWith("192.168.") ||
      hostname.startsWith("10.") ||
      hostname.startsWith("172.16.") ||
      hostname.startsWith("::1") ||
      hostname.startsWith("[::")
    ) {
      throw new Error("Private URLs are not allowed for security reasons");
    }

    // Add timeout to prevent hanging
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 seconds

    const response = await fetch(url, {
      headers: { "User-Agent": "mentiko/1.0" },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.statusText}`);
    }

    // Add file size limit (1MB max)
    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength) > 1024 * 1024) {
      throw new Error("File too large. Maximum size is 1MB.");
    }

    const text = await response.text();
    if (text.length > 1024 * 1024) {
      throw new Error("File too large. Maximum size is 1MB.");
    }

    return importChainFromString(text, url);
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error("Invalid URL");
  }
}

export async function importChainFromClipboard(): Promise<ChainData> {
  if (!navigator.clipboard || !navigator.clipboard.readText) {
    throw new Error("Clipboard API not available. Please use paste input.");
  }
  const text = await navigator.clipboard.readText();
  return importChainFromString(text, "clipboard");
}

export function importChainFromJson(text: string): ChainData {
  return importChainFromString(text, "json");
}

export function validateChain(chain: Partial<ChainData>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!chain.name) {
    errors.push("Chain name is required");
  }
  if (!chain.agents || chain.agents.length === 0) {
    errors.push("At least one agent is required");
  } else {
    chain.agents.forEach((agent, idx) => {
      if (!agent.id) {
        errors.push(`Agent at index ${idx} is missing an ID`);
      }
      if (!agent.name) {
        errors.push(`Agent ${agent.id || idx} is missing a name`);
      }
      if (!agent.emits) {
        errors.push(`Agent ${agent.id || idx} must define an event to emit`);
      }
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function createChainPreview(chain: ChainData, format: ChainImportFormat): ChainImportPreview {
  const errors: DetailedValidationError[] = [];
  const warnings: DetailedValidationError[] = [];

  if (!chain.name) {
    errors.push({ path: "name", message: "Chain name is required", code: "MISSING_NAME", severity: "error" });
  }

  if (!chain.agents || chain.agents.length === 0) {
    errors.push({ path: "agents", message: "At least one agent is required", code: "NO_AGENTS", severity: "error" });
  }

  const agentIds = new Set<string>();
  const emittedEvents = new Set<string>();
  let hasManualStart = false;

  chain.agents?.forEach((agent, idx) => {
    if (!agent.id) {
      errors.push({
        path: `agents[${idx}]`,
        message: `Agent at index ${idx} is missing an ID`,
        code: "MISSING_AGENT_ID",
        severity: "error",
        fixable: true,
        fixAction: "Add a unique id to the agent",
      });
    } else {
      if (agentIds.has(agent.id)) {
        errors.push({
          path: `agents[${idx}].id`,
          message: `Duplicate agent ID: ${agent.id}`,
          code: "DUPLICATE_AGENT_ID",
          severity: "error",
        });
      }
      agentIds.add(agent.id);
    }

    if (!agent.name) {
      errors.push({
        path: `agents[${idx}].name`,
        message: `Agent ${agent.id || idx} is missing a name`,
        code: "MISSING_AGENT_NAME",
        severity: "error",
      });
    }

    if (!agent.emits) {
      errors.push({
        path: `agents[${idx}].emits`,
        message: `Agent ${agent.id || idx} must define an event to emit`,
        code: "MISSING_EMITS",
        severity: "error",
        fixable: true,
        fixAction: "Add an emits property with the event name",
      });
    } else {
      emittedEvents.add(agent.emits);
    }

    if (!agent.triggers || agent.triggers.length === 0) {
      warnings.push({
        path: `agents[${idx}].triggers`,
        message: `Agent "${agent.name}" has no triggers defined`,
        code: "NO_TRIGGERS",
        severity: "warning",
        fixable: true,
        fixAction: 'Add "triggers": ["manual-start"] to enable manual execution',
      });
    } else if (agent.triggers.includes("manual-start")) {
      hasManualStart = true;
    }

    agent.triggers?.forEach((trigger) => {
      if (trigger !== "manual-start" && !emittedEvents.has(trigger)) {
        const hasEmitter = chain.agents?.some((a) => a.emits === trigger);
        if (!hasEmitter) {
          warnings.push({
            path: `agents[${idx}].triggers`,
            message: `Agent "${agent.name}" triggers on "${trigger}" but no agent emits this event`,
            code: "UNKNOWN_TRIGGER",
            severity: "warning",
          });
        }
      }
    });
  });

  if (!hasManualStart) {
    errors.push({
      path: "agents",
      message: "No entry point found - add 'manual-start' trigger to at least one agent",
      code: "NO_ENTRY_POINT",
      severity: "error",
      fixable: true,
      fixAction: 'Add "triggers": ["manual-start"] to the first agent in your chain',
    });
  }

  const hasBranches = Boolean(chain.branches && Object.keys(chain.branches).length > 0);

  return {
    valid: errors.filter((e) => e.severity === "error").length === 0,
    chain,
    format,
    errors,
    warnings,
    agents: chain.agents?.length || 0,
    hasBranches,
    hasManualStart,
  };
}

export function generateChainId(name: string): string {
  return name.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
