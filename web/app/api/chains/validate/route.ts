import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/auth/api-auth";
import config from "@/lib/config";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { readFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

interface ValidateFunction {
  (data: unknown): boolean;
  errors?: Array<{instancePath?: string; message: string}>;
}

let validateChain: ValidateFunction | null = null;

const getValidator = (): ValidateFunction => {
  if (validateChain) return validateChain;

  const chainSchema = JSON.parse(
    readFileSync(join(config.root, "lib", "schemas", "chain.schema.json"), "utf-8")
  );

  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  validateChain = ajv.compile(chainSchema) as ValidateFunction;
  return validateChain;
};

interface ValidationError {
  code: string;
  message: string;
  agent?: string;
  fixable?: boolean;
  fixAction?: string;
}

function detectCircularDependencies(
  agents: Array<{id: string; name: string; emits?: string}>,
  branches: Record<string, string | string[] | {fan_out?: string[]}>
): ValidationError[] {
  const errors: ValidationError[] = [];
  const agentIds = new Set(agents.map((a) => a.id));

  // Build adjacency graph: agentId -> set of agentIds it triggers
  const graph: Record<string, Set<string>> = {};
  for (const agent of agents) {
    graph[agent.id] = new Set<string>();

    // Check what agents this agent's emitted event triggers
    if (agent.emits && branches[agent.emits]) {
      const target = branches[agent.emits];
      const targets: string[] = typeof target === "string"
        ? [target]
        : Array.isArray(target)
        ? target
        : target.fan_out || [];

      for (const t of targets) {
        if (agentIds.has(t)) {
          graph[agent.id].add(t);
        }
      }
    }
  }

  // Detect cycles using DFS
  const visited = new Set<string>();
  const recStack = new Set<string>();

  const dfs = (node: string, path: string[]): boolean => {
    visited.add(node);
    recStack.add(node);
    path.push(node);

    for (const neighbor of graph[node] || []) {
      if (!visited.has(neighbor)) {
        if (dfs(neighbor, path)) return true;
      } else if (recStack.has(neighbor)) {
        // Found cycle
        const cycleStart = path.indexOf(neighbor);
        const cycle = path.slice(cycleStart).concat(neighbor);
        errors.push({
          code: "CIRCULAR_DEPENDENCY",
          message: `Circular dependency detected: ${cycle.join(" -> ")}`,
          fixable: false,
        });
        return true;
      }
    }

    recStack.delete(node);
    path.pop();
    return false;
  };

  for (const agentId of agentIds) {
    if (!visited.has(agentId)) {
      dfs(agentId, []);
    }
  }

  return errors;
}

function validateAgentTriggers(agents: Array<{id: string; name: string; emits?: string; triggers?: string[]}>): ValidationError[] {
  const errors: ValidationError[] = [];
  const allEmittedEvents = new Set(agents.map((a) => a.emits).filter(Boolean));
  const branchEvents = new Set<string>();

  // Collect all events that have branches defined
  for (const agent of agents) {
    if (agent.emits) branchEvents.add(agent.emits);
  }

  // Check each agent has valid triggers
  for (const agent of agents) {
    if (!agent.triggers || agent.triggers.length === 0) {
      errors.push({
        code: "NO_TRIGGERS",
        message: `Agent "${agent.name}" (${agent.id}) has no triggers defined`,
        agent: agent.id,
        fixable: true,
        fixAction: `Add "triggers": ["manual-start"] to enable manual execution`,
      });
      continue;
    }

    // Check if at least one trigger is valid
    const hasManualStart = agent.triggers.includes("manual-start");
    const hasValidEventTrigger = agent.triggers.some((t: string) => allEmittedEvents.has(t));

    if (!hasManualStart && !hasValidEventTrigger) {
      errors.push({
        code: "NO_VALID_TRIGGER",
        message: `Agent "${agent.name}" (${agent.id}) has no valid triggers - none of its trigger events are emitted by any agent`,
        agent: agent.id,
        fixable: false,
      });
    }
  }

  // Check that there's at least one entry point
  const hasEntryPoint = agents.some((a) =>
    a.triggers?.includes("manual-start")
  );

  if (!hasEntryPoint) {
    errors.push({
      code: "NO_ENTRY_POINT",
      message: "No entry point found - add 'manual-start' trigger to at least one agent",
      fixable: true,
      fixAction: 'Add "triggers": ["manual-start"] to the first agent in your chain',
    });
  }

  return errors;
}

function validateEventFlow(
  agents: Array<{id: string; name: string; emits?: string; triggers?: string[]}>,
  branches: Record<string, string | string[] | {fan_out?: string[]; fan_in?: string; default?: string; on_error?: string; conditions?: Array<{then?: string}>}>
): { errors: ValidationError[]; warnings: ValidationError[] } {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];
  const agentIds = new Set(agents.map((a) => a.id));
  const emittedEvents = new Set(agents.map((a) => a.emits).filter(Boolean));

  for (const [eventName, target] of Object.entries(branches || {})) {
    if (!emittedEvents.has(eventName)) {
      errors.push({
        code: "DEAD_BRANCH_EVENT",
        message: `Branch key "${eventName}" does not match any agent's emitted event, so it will never run`,
        fixable: true,
        fixAction: `Rename the branch key to the event emitted by the upstream agent`,
      });
    }

    const targets: string[] = typeof target === "string"
      ? [target]
      : Array.isArray(target)
      ? target
      : [
          ...(target.fan_out || []),
          target.fan_in,
          target.default,
          target.on_error,
          ...(target.conditions || []).map((condition) => condition.then),
        ].filter((value): value is string => typeof value === "string");

    for (const t of targets) {
      if (t !== "stop" && !agentIds.has(t)) {
        errors.push({
          code: "INVALID_TARGET",
          message: `Branch for event "${eventName}" targets non-existent agent "${t}"`,
          fixable: true,
          fixAction: `Remove "${t}" from branch or create an agent with id "${t}"`,
        });
      }
    }
  }

  // Check each emitted event has a consumer or is marked terminal
  for (const agent of agents) {
    if (!agent.emits) continue;

    const hasBranch = branches?.[agent.emits] !== undefined;

    // Check if any agent listens for this event
    const hasConsumer = agents.some((a) =>
      a.triggers?.includes(agent.emits ?? "")
    );

    if (!hasBranch && !hasConsumer) {
      warnings.push({
        code: "UNCONSUMED_EVENT",
        message: `Agent "${agent.name}" emits "${agent.emits}" but no other agent listens for it - this may be intentional if it's a terminal event`,
        agent: agent.id,
        fixable: false,
      });
    }

    // Check branch targets exist
    if (hasBranch) {
      const target = branches[agent.emits];
      const targets: string[] = typeof target === "string"
        ? [target]
        : Array.isArray(target)
        ? target
        : [
            ...(target.fan_out || []),
            target.fan_in,
            target.default,
            target.on_error,
            ...(target.conditions || []).map((condition) => condition.then),
          ].filter((value): value is string => typeof value === "string");

      for (const t of targets) {
        if (t !== "stop" && !agentIds.has(t)) {
          errors.push({
            code: "INVALID_TARGET",
            message: `Branch for event "${agent.emits}" targets non-existent agent "${t}"`,
            agent: agent.id,
            fixable: true,
            fixAction: `Remove "${t}" from branch or create an agent with id "${t}"`,
          });
        }
      }
    }
  }

  return { errors, warnings };
}

function validateContextFiles(
  agents: Array<{id: string; name: string; context?: {read_first?: string[]; workspace?: string}; spec?: string}>,
  projectRoot: string
): { errors: ValidationError[]; warnings: ValidationError[] } {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  for (const agent of agents) {
    if (!agent.context) continue;

    const { read_first, workspace } = agent.context;

    if (read_first && Array.isArray(read_first)) {
      for (const filePath of read_first) {
        if (!filePath || filePath.startsWith("http")) continue; // skip URLs

        const fullPath = resolve(projectRoot, filePath);
        if (!existsSync(fullPath)) {
          warnings.push({
            code: "MISSING_CONTEXT_FILE",
            message: `Context file for agent "${agent.name}" does not exist: ${filePath}`,
            agent: agent.id,
            fixable: false,
          });
        }
      }
    }

    if (workspace && !workspace.startsWith("http")) {
      const fullPath = resolve(projectRoot, workspace);
      // Check if directory exists, warn if not (might be created at runtime)
      if (!existsSync(fullPath)) {
        warnings.push({
          code: "MISSING_WORKSPACE",
          message: `Workspace directory for agent "${agent.name}" does not exist: ${workspace}`,
          agent: agent.id,
          fixable: false,
        });
      }
    }

    // Check spec file if defined
    if (agent.spec && !agent.spec.startsWith("http")) {
      const fullPath = resolve(projectRoot, agent.spec);
      if (!existsSync(fullPath)) {
        errors.push({
          code: "MISSING_SPEC_FILE",
          message: `Spec file for agent "${agent.name}" does not exist: ${agent.spec}`,
          agent: agent.id,
          fixable: true,
          fixAction: `Create the spec file at ${agent.spec} or remove the spec field`,
        });
      }
    }
  }

  return { errors, warnings };
}

export const POST = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const { chain, projectRoot } = await request.json();

  if (!chain) {
    return apiSuccess({
      valid: false,
      errors: [{ code: "NO_CHAIN", message: "No chain provided" }],
      warnings: [],
    });
  }

  const allErrors: ValidationError[] = [];
  const allWarnings: ValidationError[] = [];

  // Step 1: JSON Schema validation
  const validator = getValidator();
  const schemaValid = validator(chain);

  if (!schemaValid) {
    if (validator.errors) {
      for (const err of validator.errors) {
        const path = err.instancePath || "root";
        allErrors.push({
          code: "SCHEMA_ERROR",
          message: `${path}: ${err.message}`,
        });
      }
    }
  }

  // If schema invalid, return early - deeper checks need valid structure
  if (!schemaValid) {
    return apiSuccess({
      valid: false,
      errors: allErrors,
      warnings: [],
    });
  }

  // Step 2: Check agent triggers
  const triggerErrors = validateAgentTriggers(chain.agents || []);
  allErrors.push(...triggerErrors);

  // Step 3: Detect circular dependencies
  const circularErrors = detectCircularDependencies(
    chain.agents || [],
    chain.branches || {}
  );
  allErrors.push(...circularErrors);

  // Step 4: Validate event flow
  const { errors: eventErrors, warnings: eventWarnings } = validateEventFlow(
    chain.agents || [],
    chain.branches || {}
  );
  allErrors.push(...eventErrors);
  allWarnings.push(...eventWarnings);

  // Step 5: Validate context files
  const effectiveProjectRoot = projectRoot
    || chain.config?.project_root
    || config.root;

  if (effectiveProjectRoot && effectiveProjectRoot !== "auto") {
    const { errors: ctxErrors, warnings: ctxWarnings } = validateContextFiles(
      chain.agents || [],
      effectiveProjectRoot
    );
    allErrors.push(...ctxErrors);
    allWarnings.push(...ctxWarnings);
  }

  return apiSuccess({
    valid: allErrors.length === 0,
    errors: allErrors,
    warnings: allWarnings,
  });
});
