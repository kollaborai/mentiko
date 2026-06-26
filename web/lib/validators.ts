import { validateScheduleTarget } from "./schedules/schedule-targets";
import type { ScheduleTarget, ScheduleTrigger } from "./types";
import { isSafeCronExpression } from "./schedules/cron-validation";

// validation result type
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// helper: collect errors
function collect(errors: string[], field: string, msg: string): void {
  errors.push(`${field}: ${msg}`);
}

// helper: check required string
function requiredString(value: unknown, field: string, errors: string[]): void {
  if (!value || typeof value !== "string" || !value.trim()) {
    collect(errors, field, "required and must be non-empty");
  }
}

// helper: check optional string
function optionalString(value: unknown, field: string, errors: string[]): void {
  if (value !== undefined && value !== null && typeof value !== "string") {
    collect(errors, field, "must be a string");
  }
}

// helper: check number range
function numberRange(
  value: unknown,
  field: string,
  errors: string[],
  min?: number,
  max?: number
): void {
  if (value !== undefined && value !== null) {
    if (typeof value !== "number") {
      collect(errors, field, "must be a number");
    } else if (min !== undefined && value < min) {
      collect(errors, field, `must be at least ${min}`);
    } else if (max !== undefined && value > max) {
      collect(errors, field, `must be at most ${max}`);
    }
  }
}

function agentTimeout(value: unknown, field: string, errors: string[]): void {
  if (value === undefined || value === null) return;

  if (typeof value !== "number" || !Number.isFinite(value)) {
    collect(errors, field, "must be a finite number");
    return;
  }

  if (value !== -1 && value < 0) {
    collect(errors, field, "must be -1 or at least 0");
  }
}

function optionalStrictString(value: unknown, field: string, errors: string[]): void {
  if (value !== undefined && typeof value !== "string") {
    collect(errors, field, "must be a string");
  }
}

function validateRetryConfig(value: unknown, field: string, errors: string[]): void {
  if (value === undefined) return;

  if (typeof value !== "object" || value === null) {
    collect(errors, field, "must be an object");
    return;
  }

  const retry = value as Record<string, unknown>;
  numberRange(retry.max_retries, `${field}.max_retries`, errors, 0);
  numberRange(retry.initial_delay, `${field}.initial_delay`, errors, 0);
  numberRange(retry.max_delay, `${field}.max_delay`, errors, 0);
  numberRange(retry.backoff_multiplier, `${field}.backoff_multiplier`, errors, 0);

  if (retry.backoff !== undefined) {
    const valid = ["fixed", "exponential", "linear"];
    if (!valid.includes(retry.backoff as string)) {
      collect(errors, `${field}.backoff`, `must be one of: ${valid.join(", ")}`);
    }
  }
}

function collectBranchTargets(target: unknown): string[] {
  if (typeof target === "string") return [target];
  if (Array.isArray(target)) return target.filter((item): item is string => typeof item === "string");
  if (!target || typeof target !== "object") return [];

  const branch = target as Record<string, unknown>;
  const targets: string[] = [];
  if (Array.isArray(branch.fan_out)) {
    targets.push(...branch.fan_out.filter((item): item is string => typeof item === "string"));
  }
  if (typeof branch.fan_in === "string") targets.push(branch.fan_in);
  if (typeof branch.default === "string") targets.push(branch.default);
  if (typeof branch.on_error === "string") targets.push(branch.on_error);
  if (Array.isArray(branch.conditions)) {
    for (const condition of branch.conditions) {
      if (condition && typeof condition === "object" && !Array.isArray(condition)) {
        const thenTarget = (condition as Record<string, unknown>).then;
        if (typeof thenTarget === "string") targets.push(thenTarget);
      }
    }
  }
  return targets;
}

function isTerminalBranchTarget(target: string): boolean {
  return target === "stop";
}

function validateChainBranches(
  branches: unknown,
  agents: Array<Record<string, unknown>>,
  errors: string[]
): void {
  if (branches === undefined) return;
  if (!branches || typeof branches !== "object" || Array.isArray(branches)) {
    collect(errors, "branches", "must be an object");
    return;
  }

  const agentIds = new Set(
    agents
      .map((agent) => (typeof agent.id === "string" ? agent.id : typeof agent.$ref === "string" ? agent.$ref : ""))
      .filter(Boolean)
  );
  const emittedEvents = new Set(
    agents
      .map((agent) => (typeof agent.emits === "string" ? agent.emits : ""))
      .filter(Boolean)
  );

  for (const [eventName, target] of Object.entries(branches as Record<string, unknown>)) {
    if (emittedEvents.size > 0 && !emittedEvents.has(eventName)) {
      collect(errors, `branches.${eventName}`, "must match an event emitted by an agent");
    }

    for (const targetId of collectBranchTargets(target)) {
      if (!isTerminalBranchTarget(targetId) && !agentIds.has(targetId)) {
        collect(errors, `branches.${eventName}`, `targets missing agent id: ${targetId}`);
      }
    }
  }
}

// helper: check url format
function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

// helper: check cron expression (basic validation)
function isValidCron(cron: string): boolean {
  return isSafeCronExpression(cron);
}

// helper: check timezone
function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value);
}

// validate chain config
export function validateChainConfig(config: unknown): ValidationResult {
  const errors: string[] = [];

  if (!config || typeof config !== "object") {
    return { valid: false, errors: ["config: must be an object"] };
  }

  const c = config as Record<string, unknown>;

  // monitor: boolean if present
  if (c.monitor !== undefined && typeof c.monitor !== "boolean") {
    collect(errors, "monitor", "must be boolean");
  }

  // monitor_interval: positive number if present
  numberRange(c.monitor_interval, "monitor_interval", errors, 1);

  // max_rounds: positive number if present
  numberRange(c.max_rounds, "max_rounds", errors, 1);

  // on_complete: enum if present
  if (c.on_complete !== undefined) {
    const value = c.on_complete as string;
    const validValues = ["stop", "notify", "webhook"];
    const isValid = validValues.includes(value) || value.startsWith("chain:");
    if (!isValid) {
      collect(errors, "on_complete", `must be one of: stop, notify, webhook, or chain:<name>`);
    }
  }

  return { valid: errors.length === 0, errors };
}

// validate chain agent
export function validateAgent(agent: unknown): ValidationResult {
  const errors: string[] = [];

  if (!agent || typeof agent !== "object") {
    return { valid: false, errors: ["agent: must be an object"] };
  }

  const a = agent as Record<string, unknown>;

  // id: required
  requiredString(a.id, "id", errors);

  // name: required
  requiredString(a.name, "name", errors);

  // triggers: required array of strings
  if (!a.triggers || !Array.isArray(a.triggers)) {
    collect(errors, "triggers", "required and must be an array");
  } else if (a.triggers.length === 0) {
    collect(errors, "triggers", "must have at least one trigger");
  } else {
    a.triggers.forEach((t, i) => {
      if (typeof t !== "string") {
        collect(errors, `triggers[${i}]`, "must be a string");
      }
    });
  }

  // emits: required string
  requiredString(a.emits, "emits", errors);

  // timeout: 0 = no timeout, -1 = use chain default
  agentTimeout(a.timeout, "timeout", errors);

  validateRetryConfig(a.retry, "retry", errors);
  optionalStrictString(a.agent_profile, "agent_profile", errors);
  optionalStrictString(a.on_error, "on_error", errors);
  optionalStrictString(a.on_timeout, "on_timeout", errors);

  return { valid: errors.length === 0, errors };
}

// validate full chain
export function validateChain(chain: unknown): ValidationResult {
  const errors: string[] = [];

  if (!chain || typeof chain !== "object") {
    return { valid: false, errors: ["chain: must be an object"] };
  }

  const c = chain as Record<string, unknown>;

  // name: required
  requiredString(c.name, "name", errors);

  // description: required string
  requiredString(c.description, "description", errors);

  // version: must match semver
  if (!c.version || typeof c.version !== "string") {
    collect(errors, "version", "required and must be a string");
  } else if (!/^\d+\.\d+\.\d+$/.test(c.version)) {
    collect(errors, "version", "must be in semver format (e.g., 1.0.0)");
  }

  // config: validate
  if (!c.config) {
    collect(errors, "config", "required");
  } else {
    const configResult = validateChainConfig(c.config);
    errors.push(...configResult.errors);
  }

  // agents: required array
  if (!c.agents || !Array.isArray(c.agents)) {
    collect(errors, "agents", "required and must be an array");
  } else if (c.agents.length === 0) {
    collect(errors, "agents", "must have at least one agent");
  } else {
    c.agents.forEach((agent, i) => {
      // $ref agents reference an agent in the registry; their id/name/triggers/emits
      // resolve at runtime (chain-runner.sh resolves refs, and /api/chains/save already
      // treats $ref agents specially). A non-empty $ref string is valid on its own —
      // don't demand the inline fields, or generated/ref-based chains can never be saved.
      if (agent && typeof agent === "object" && "$ref" in agent) {
        const refAgent = agent as {
          $ref?: unknown;
          id?: unknown;
          name?: unknown;
          role?: unknown;
          prompt?: unknown;
          triggers?: unknown;
          emits?: unknown;
          timeout?: unknown;
          agent_profile?: unknown;
          retry?: unknown;
          on_error?: unknown;
          on_timeout?: unknown;
        };
        const ref = refAgent.$ref;
        if (typeof ref !== "string" || ref.trim() === "") {
          collect(errors, `agents[${i}].$ref`, "must be a non-empty string");
        }
        if (refAgent.id !== undefined && typeof refAgent.id !== "string") {
          collect(errors, `agents[${i}].id`, "must be a string");
        }
        if (refAgent.name !== undefined && typeof refAgent.name !== "string") {
          collect(errors, `agents[${i}].name`, "must be a string");
        }
        if (refAgent.role !== undefined && typeof refAgent.role !== "string") {
          collect(errors, `agents[${i}].role`, "must be a string");
        }
        if (refAgent.prompt !== undefined && typeof refAgent.prompt !== "string") {
          collect(errors, `agents[${i}].prompt`, "must be a string");
        }
        if (refAgent.triggers !== undefined) {
          if (!Array.isArray(refAgent.triggers)) {
            collect(errors, `agents[${i}].triggers`, "must be an array");
          } else if (!refAgent.triggers.every((t) => typeof t === "string")) {
            collect(errors, `agents[${i}].triggers`, "must contain only strings");
          }
        }
        if (refAgent.emits !== undefined && typeof refAgent.emits !== "string") {
          collect(errors, `agents[${i}].emits`, "must be a string");
        }
        if (refAgent.timeout !== undefined) {
          const timeout = Number(refAgent.timeout);
          if (Number.isNaN(timeout) || (timeout < 0 && timeout !== -1)) {
            collect(errors, `agents[${i}].timeout`, "must be -1 or at least 0");
          }
        }
        optionalStrictString(refAgent.agent_profile, `agents[${i}].agent_profile`, errors);
        validateRetryConfig(refAgent.retry, `agents[${i}].retry`, errors);
        optionalStrictString(refAgent.on_error, `agents[${i}].on_error`, errors);
        optionalStrictString(refAgent.on_timeout, `agents[${i}].on_timeout`, errors);
        return;
      }
      const agentResult = validateAgent(agent);
      if (!agentResult.valid) {
        agentResult.errors.forEach(e => errors.push(`agents[${i}].${e}`));
      }
    });

    // check for duplicate ids
    const ids = new Set<string>();
    (c.agents as Array<{ id?: string }>).forEach((agent) => {
      if (agent.id) {
        if (ids.has(agent.id)) {
          collect(errors, "agents", `duplicate agent id: ${agent.id}`);
        }
        ids.add(agent.id);
      }
    });

    validateChainBranches(c.branches, c.agents as Array<Record<string, unknown>>, errors);
  }

  return { valid: errors.length === 0, errors };
}

// validate schedule
export function validateSchedule(schedule: unknown): ValidationResult {
  const errors: string[] = [];

  if (!schedule || typeof schedule !== "object") {
    return { valid: false, errors: ["schedule: must be an object"] };
  }

  const s = schedule as Record<string, unknown>;

  // id: required
  requiredString(s.id, "id", errors);

  // target-based schedules do not need legacy chain fields.
  if (s.target !== undefined) {
    for (const error of validateScheduleTarget(s.target as ScheduleTarget)) {
      errors.push(error);
    }
  } else {
    requiredString(s.chainId, "chainId", errors);
  }

  const trigger = s.trigger as ScheduleTrigger | undefined;
  const isCronTrigger = !trigger || trigger.type === "cron";

  if (isCronTrigger) {
    const cron = typeof s.cron === "string" ? s.cron : trigger?.type === "cron" ? trigger.cron : undefined;
    const timezone = typeof s.timezone === "string" ? s.timezone : trigger?.type === "cron" ? trigger.timezone : undefined;

    // cron: required and valid
    if (!cron || typeof cron !== "string") {
      collect(errors, "cron", "required and must be a string");
    } else if (!isValidCron(cron)) {
      collect(errors, "cron", "invalid cron expression (5-6 parts required)");
    }

    // timezone: required and valid
    if (!timezone || typeof timezone !== "string") {
      collect(errors, "timezone", "required and must be a string");
    } else if (!isValidTimezone(timezone)) {
      collect(errors, "timezone", "invalid timezone (e.g., 'America/New_York')");
    }
  } else if (trigger.type === "file") {
    if (!trigger.directory?.trim()) collect(errors, "trigger.directory", "required for file triggers");
    else if (!isAbsolutePath(trigger.directory)) collect(errors, "trigger.directory", "must be an absolute path");
    if (!trigger.glob?.trim()) collect(errors, "trigger.glob", "required for file triggers");
    if (!Array.isArray(trigger.events) || trigger.events.length === 0) {
      collect(errors, "trigger.events", "must include at least one file event");
    }
  } else if (trigger.type === "interval") {
    if (!Number.isFinite(trigger.everyMs) || trigger.everyMs < 1000) {
      collect(errors, "trigger.everyMs", "must be at least 1000");
    }
  }

  // enabled: boolean if present
  if (s.enabled !== undefined && typeof s.enabled !== "boolean") {
    collect(errors, "enabled", "must be boolean");
  }

  return { valid: errors.length === 0, errors };
}

// validate webhook config
export function validateWebhookConfig(webhook: unknown): ValidationResult {
  const errors: string[] = [];

  if (!webhook || typeof webhook !== "object") {
    return { valid: false, errors: ["webhook: must be an object"] };
  }

  const w = webhook as Record<string, unknown>;

  // id: required (for individual webhooks)
  requiredString(w.id, "id", errors);

  // url: required and valid url
  if (!w.url || typeof w.url !== "string") {
    collect(errors, "url", "required and must be a string");
  } else if (!isValidUrl(w.url)) {
    collect(errors, "url", "invalid url format");
  }

  // events: required array
  if (!w.events || !Array.isArray(w.events)) {
    collect(errors, "events", "required and must be an array");
  } else if (w.events.length === 0) {
    collect(errors, "events", "must have at least one event");
  } else {
    (w.events as unknown[]).forEach((e, idx) => {
      if (typeof e !== "string") {
        collect(errors, `events[${idx}]`, "must be a string");
      }
    });
  }

  // enabled: boolean if present
  if (w.enabled !== undefined && typeof w.enabled !== "boolean") {
    collect(errors, "enabled", "must be boolean");
  }

  // secret: string if present
  optionalString(w.secret, "secret", errors);

  // retry config: validate if present
  if (w.retry_config !== undefined) {
    if (typeof w.retry_config !== "object" || w.retry_config === null) {
      collect(errors, "retry_config", "must be an object");
    } else {
      const r = w.retry_config as Record<string, unknown>;
      numberRange(r.max_attempts, "retry_config.max_attempts", errors, 1, 10);
      numberRange(r.initial_delay, "retry_config.initial_delay", errors, 0);
      numberRange(r.max_delay, "retry_config.max_delay", errors, 0);
    }
  }

  return { valid: errors.length === 0, errors };
}

// validate chain's webhook config (embedded in chain.config.webhooks)
export function validateChainWebhooks(webhooks: unknown): ValidationResult {
  const errors: string[] = [];

  if (!webhooks || typeof webhooks !== "object") {
    return { valid: false, errors: ["webhooks: must be an object"] };
  }

  const w = webhooks as Record<string, unknown>;

  // enabled: boolean
  if (w.enabled !== undefined && typeof w.enabled !== "boolean") {
    collect(errors, "enabled", "must be boolean");
  }

  // urls: array if present
  if (w.urls !== undefined) {
    if (!Array.isArray(w.urls)) {
      collect(errors, "urls", "must be an array");
    } else {
      w.urls.forEach((url, i) => {
        if (typeof url !== "string") {
          collect(errors, `urls[${i}]`, "must be a string");
        } else if (!isValidUrl(url)) {
          collect(errors, `urls[${i}]`, "invalid url format");
        }
      });
    }
  }

  // events: array if present
  if (w.events !== undefined) {
    if (!Array.isArray(w.events)) {
      collect(errors, "events", "must be an array");
    } else if (w.events.length === 0) {
      collect(errors, "events", "must have at least one event");
    }
  }

  return { valid: errors.length === 0, errors };
}
