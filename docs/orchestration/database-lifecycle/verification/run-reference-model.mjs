#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const packageRequire = createRequire(new URL("../../../../web/package.json", import.meta.url));
const Database = packageRequire("better-sqlite3");
const Ajv2020 = packageRequire("ajv/dist/2020").default;

const packageRoot = resolve(dirname(scriptPath), "../../../../");
const packageDir = resolve(dirname(scriptPath), "..");
const fixturePath = join(packageDir, "fixtures", "task-fulfillment-happy-path.json");
const fixtureSchemaPath = join(packageDir, "schemas", "fixture.schema.json");
const examplePath = join(packageDir, "examples", "task-fulfillment-happy-path.json");
const generationExamplePath = join(packageDir, "examples", "generation-before-tasks.json");
const decisionExamplePath = join(packageDir, "examples", "decision-authority.json");
const recordsSchemaPath = join(packageDir, "schemas", "records.schema.json");
const scenarioSuitePath = join(packageDir, "fixtures", "scenario-suite.json");
const scenarioSchemaPath = join(packageDir, "schemas", "scenario.schema.json");
const acceptanceCasesPath = join(packageDir, "contracts", "acceptance-cases.json");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function isoFor(sequence) {
  return new Date(Date.UTC(2026, 8, 6, 9, 0, sequence)).toISOString();
}

function json(value) {
  return JSON.stringify(value);
}

function parseJson(value, fallback) {
  return value ? JSON.parse(value) : fallback;
}

function assertSchema(value, schema, label) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  assert.equal(validate(value), true, `${label} failed schema validation: ${ajv.errorsText(validate.errors)}`);
}

function validateScenarioSuite(suite, scenarioSchema, acceptanceContract) {
  assert.equal(suite.schema_status, "proposed", "scenario suite must remain proposed");
  assert.equal(Array.isArray(suite.scenarios), true, "scenario suite must contain scenarios");
  const scenarioIds = new Set(suite.scenarios.map((scenario) => scenario.scenario_id));
  assert.equal(scenarioIds.size, suite.scenarios.length, "scenario IDs must be unique");
  const coveredCases = new Set();

  for (const scenario of suite.scenarios) {
    assertSchema(scenario, scenarioSchema, `scenario ${scenario.scenario_id}`);
    for (const caseId of scenario.acceptance_case_ids) coveredCases.add(caseId);
    assert.equal(scenario.actions.length, scenario.expected.transitions.length, `${scenario.scenario_id}: every action needs a transition expectation`);
    const actionIds = new Set(scenario.actions.map((action) => action.action_id));
    assert.equal(actionIds.size, scenario.actions.length, `${scenario.scenario_id}: action IDs must be unique`);
    scenario.expected.transitions.forEach((transition, index) => {
      assert.equal(transition.action_id, scenario.actions[index].action_id, `${scenario.scenario_id}: transition order mismatch`);
      if (transition.accepted === false) {
        assert.equal(Boolean(transition.rejection_code || transition.waiting_reason), true, `${scenario.scenario_id}/${transition.action_id}: rejection needs a reason`);
        assert.equal((transition.must_not || []).length > 0, true, `${scenario.scenario_id}/${transition.action_id}: rejection needs MUST-NOT effects`);
      }
    });
  }

  const contractCaseIds = acceptanceContract.cases.map((entry) => entry.id);
  assert.deepEqual([...coveredCases].sort(), [...contractCaseIds].sort(), "scenario suite must cover every stable acceptance case exactly by ID");
  for (const entry of acceptanceContract.cases) {
    for (const scenarioId of entry.scenarios) {
      assert.equal(scenarioIds.has(scenarioId), true, `${entry.id}: referenced scenario ${scenarioId} is missing`);
    }
  }
  return { scenarioCount: suite.scenarios.length, acceptanceCaseCount: contractCaseIds.length };
}

function createDatabase(tempRoot, namespace) {
  const dataRoot = join(tempRoot, "namespaces", namespace.id, "data");
  const artifactRoot = join(tempRoot, "namespaces", namespace.id, "runs");
  mkdirSync(dataRoot, { recursive: true });
  mkdirSync(artifactRoot, { recursive: true });

  const db = new Database(join(dataRoot, "tasks.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 250");
  db.pragma("synchronous = FULL");
  db.exec(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      acceptance_criteria_revision INTEGER NOT NULL,
      active_workflow_id TEXT,
      version INTEGER NOT NULL
    );
    CREATE TABLE workflow_instances (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      subject_task_id TEXT NOT NULL,
      definition_version TEXT NOT NULL,
      definition_digest TEXT NOT NULL,
      authority_epoch INTEGER NOT NULL,
      input_revision INTEGER NOT NULL,
      execution_retry_budget INTEGER NOT NULL,
      execution_retries_used INTEGER NOT NULL
    );
    CREATE TABLE workflow_steps (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      step_key TEXT NOT NULL,
      kind TEXT NOT NULL,
      actor_policy TEXT NOT NULL,
      status TEXT NOT NULL,
      waiting_reason TEXT,
      trigger_kind TEXT NOT NULL,
      current_run_id TEXT,
      result_revision INTEGER NOT NULL,
      chain_id TEXT,
      chain_version INTEGER,
      chain_digest TEXT
    );
    CREATE TABLE runs (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      workflow_id TEXT NOT NULL,
      step_id TEXT NOT NULL,
      attempt_number INTEGER NOT NULL,
      status TEXT NOT NULL,
      status_reason TEXT,
      chain_id TEXT,
      chain_version INTEGER,
      chain_digest TEXT,
      accepted_result_revision INTEGER
    );
    CREATE TABLE agent_attempts (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      phase TEXT NOT NULL,
      process_pid INTEGER,
      pty_session_id TEXT,
      instruction_ledger TEXT NOT NULL,
      transitions TEXT NOT NULL
    );
    CREATE TABLE lifecycle_events (
      event_id TEXT PRIMARY KEY,
      sequence INTEGER NOT NULL UNIQUE,
      org_id TEXT NOT NULL,
      type TEXT NOT NULL,
      workflow_id TEXT,
      step_id TEXT,
      run_id TEXT,
      attempt_id TEXT,
      source_event_id TEXT UNIQUE,
      causation_id TEXT,
      payload TEXT NOT NULL,
      validation_outcome TEXT NOT NULL
    );
    CREATE TABLE lifecycle_commands (
      command_id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      action_key TEXT NOT NULL,
      kind TEXT NOT NULL,
      target_identities TEXT NOT NULL,
      idempotency_key TEXT UNIQUE,
      principal TEXT NOT NULL,
      scope TEXT NOT NULL,
      authority_epoch INTEGER NOT NULL,
      status TEXT NOT NULL,
      available_at TEXT NOT NULL,
      delivery_count INTEGER NOT NULL,
      lease_owner TEXT,
      lease_generation INTEGER NOT NULL,
      lease_expires_at TEXT,
      payload TEXT NOT NULL,
      result_ref TEXT,
      waiting_reason TEXT
    );
    CREATE TABLE artifact_refs (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      attempt_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      storage_path TEXT NOT NULL,
      digest TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      schema_version TEXT NOT NULL,
      validation_result TEXT NOT NULL
    );
    CREATE TABLE execution_reservations (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      attempt_id TEXT NOT NULL,
      capacity_domain TEXT NOT NULL,
      queue_order INTEGER NOT NULL,
      status TEXT NOT NULL,
      owner TEXT NOT NULL,
      generation INTEGER NOT NULL,
      release_evidence TEXT
    );
  `);

  return { db, dataRoot, artifactRoot };
}

const ALLOWED_ATTEMPT_TRANSITIONS = {
  created: ["queued", "lease_acquired", "startup_failed", "human_action_required", "stuck", "released"],
  queued: ["lease_acquired", "startup_failed", "human_action_required", "released"],
  lease_acquired: ["pty_allocated", "startup_failed", "human_action_required", "released"],
  pty_allocated: ["process_spawned", "startup_failed", "human_action_required", "released"],
  process_spawned: ["ready_for_instructions", "startup_failed", "human_action_required", "stuck", "released"],
  ready_for_instructions: ["instructions_submitted", "startup_failed", "human_action_required", "stuck", "released"],
  instructions_submitted: ["completed", "completion_failed", "startup_failed", "human_action_required", "stuck", "released"],
  completed: ["human_action_required", "released"],
  completion_failed: ["released"],
  startup_failed: ["released"],
  human_action_required: ["released"],
  stuck: ["completed", "released"],
  released: [],
};

class ReferenceLifecycle {
  constructor(fixture, tempRoot) {
    this.fixture = fixture;
    this.namespace = fixture.namespace;
    this.sequence = 0;
    this.artifactRoot = join(tempRoot, "namespaces", fixture.namespace.id, "runs");
    const database = createDatabase(tempRoot, fixture.namespace);
    this.db = database.db;
    this.dataRoot = database.dataRoot;
  }

  close() {
    this.db.close();
  }

  tableCount(table) {
    return this.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
  }

  stateSummary() {
    const rows = (table, key, value) => Object.fromEntries(
      this.db.prepare(`SELECT ${key}, ${value} FROM ${table}`).all().map((row) => [row[key], row[value]]),
    );
    return {
      task_statuses: rows("tasks", "id", "status"),
      workflow_statuses: rows("workflow_instances", "id", "status"),
      step_statuses: rows("workflow_steps", "id", "status"),
      run_statuses: rows("runs", "id", "status"),
      attempt_phases: rows("agent_attempts", "id", "phase"),
      command_statuses: rows("lifecycle_commands", "command_id", "status"),
      reservation_statuses: rows("execution_reservations", "id", "status"),
      artifact_digests: rows("artifact_refs", "id", "digest"),
      run_count: this.tableCount("runs"),
      agent_attempt_count: this.tableCount("agent_attempts"),
    };
  }

  apply(action) {
    const transaction = this.db.transaction(() => this.#apply(action));
    return transaction();
  }

  #nextEventId() {
    const max = this.db.prepare("SELECT COALESCE(MAX(sequence), 0) AS sequence FROM lifecycle_events").get().sequence;
    this.sequence = Math.max(this.sequence, max) + 1;
    return { eventId: `evt-fixture-${String(this.sequence).padStart(3, "0")}`, sequence: this.sequence };
  }

  #emit(type, action, input = {}) {
    const { eventId, sequence } = this.#nextEventId();
    this.db.prepare(`
      INSERT INTO lifecycle_events
        (event_id, sequence, org_id, type, workflow_id, step_id, run_id, attempt_id, source_event_id, causation_id, payload, validation_outcome)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      eventId,
      sequence,
      this.namespace.org_id,
      type,
      input.workflow_id || null,
      input.step_id || null,
      input.run_id || null,
      input.attempt_id || null,
      input.source_event_id || null,
      action.action_id,
      json({ action_id: action.action_id, ...input }),
      "accepted",
    );
    return eventId;
  }

  #receipt(action, commandId, result, targetIdentities = {}) {
    const principal = action.principal || { type: "unknown", id: "unknown" };
    this.db.prepare(`
      INSERT INTO lifecycle_commands
        (command_id, org_id, action_key, kind, target_identities, idempotency_key, principal, scope, authority_epoch, status, available_at, delivery_count, lease_generation, payload)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, 1, 1, ?)
    `).run(
      commandId,
      this.namespace.org_id,
      `request:${action.action_id}`,
      "request_receipt",
      json(targetIdentities),
      action.idempotency_key,
      json(principal),
      principal.scope || "lifecycle.request",
      1,
      isoFor(this.sequence + 1),
      json({ result }),
    );
    return commandId;
  }

  #findReceipt(idempotencyKey) {
    if (!idempotencyKey) return undefined;
    const row = this.db.prepare("SELECT payload FROM lifecycle_commands WHERE idempotency_key = ?").get(idempotencyKey);
    return row ? { ...parseJson(row.payload, {}).result, duplicate: true } : undefined;
  }

  #insertCommand(input) {
    const existing = this.db.prepare("SELECT command_id FROM lifecycle_commands WHERE command_id = ?").get(input.command_id);
    if (existing) return existing.command_id;
    this.db.prepare(`
      INSERT INTO lifecycle_commands
        (command_id, org_id, action_key, kind, target_identities, idempotency_key, principal, scope, authority_epoch, status, available_at, delivery_count, lease_generation, payload)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)
    `).run(
      input.command_id,
      this.namespace.org_id,
      input.action_key,
      input.kind,
      json(input.target_identities || {}),
      input.idempotency_key || null,
      json(input.principal || { type: "system", id: "transition-service" }),
      input.scope || "lifecycle.dispatch",
      input.authority_epoch || 1,
      input.status || "queued",
      input.available_at || isoFor(this.sequence + 1),
      json(input.payload || {}),
    );
    return input.command_id;
  }

  #result(action, eventTypes = [], commandIds = [], createdIds = [], extra = {}) {
    return { accepted: true, actionId: action.action_id, eventTypes, commandIds, createdIds, ...extra };
  }

  #reject(action, rejectionCode, mustNot, waitingReason) {
    return {
      accepted: false,
      actionId: action.action_id,
      eventTypes: [],
      commandIds: [],
      createdIds: [],
      rejection_code: rejectionCode,
      ...(waitingReason ? { waiting_reason: waitingReason } : {}),
      must_not: mustNot,
    };
  }

  #assertScope(row, action, field = "org_id") {
    if (row && row[field] !== this.namespace.org_id) {
      return this.#reject(action, "scope_mismatch", ["state_change", "event", "command"]);
    }
    return undefined;
  }

  #apply(action) {
    const duplicate = this.#findReceipt(action.idempotency_key);
    if (duplicate) return duplicate;

    switch (action.kind) {
      case "create_task": return this.#createTask(action);
      case "select_chain": return this.#selectChain(action);
      case "claim_command": return this.#claimCommand(action);
      case "agent_progress": return this.#agentProgress(action);
      case "complete_run": return this.#completeRun(action);
      case "accept_outcome": return this.#acceptOutcome(action);
      default: throw new Error(`unsupported reference-model action: ${action.kind}`);
    }
  }

  #createTask(action) {
    const input = action.input;
    const task = input.task;
    const workflow = input.workflow;
    this.db.prepare(`
      INSERT INTO tasks (id, org_id, workspace_id, title, status, acceptance_criteria_revision, active_workflow_id, version)
      VALUES (?, ?, ?, ?, 'open', ?, ?, 1)
    `).run(task.id, task.org_id, task.workspace_id, task.title, task.acceptance_criteria_revision, workflow.id);
    this.db.prepare(`
      INSERT INTO workflow_instances
        (id, org_id, kind, status, subject_task_id, definition_version, definition_digest, authority_epoch, input_revision, execution_retry_budget, execution_retries_used)
      VALUES (?, ?, ?, 'waiting', ?, ?, ?, ?, 1, ?, 0)
    `).run(
      workflow.id,
      workflow.org_id || task.org_id,
      workflow.kind,
      task.id,
      workflow.definition_version,
      workflow.definition_digest,
      workflow.authority_epoch,
      workflow.execution_retry_budget,
    );
    for (const step of input.steps) {
      this.db.prepare(`
        INSERT INTO workflow_steps
          (id, workflow_id, step_key, kind, actor_policy, status, waiting_reason, trigger_kind, result_revision)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'manual', 0)
      `).run(
        step.id,
        workflow.id,
        step.step_key,
        step.kind,
        step.actor_policy,
        step.status,
        step.waiting_reason || null,
      );
    }
    const eventTypes = [
      this.#emit("task.created", action, { workflow_id: workflow.id }),
      this.#emit("workflow.created", action, { workflow_id: workflow.id }),
    ];
    const result = this.#result(
      action,
      ["task.created", "workflow.created"],
      [input.receipt_command_id],
      [task.id, workflow.id, ...input.steps.map((step) => step.id)],
      { eventIds: eventTypes },
    );
    this.#receipt(action, input.receipt_command_id, result, { task_id: task.id, workflow_id: workflow.id });
    return result;
  }

  #selectChain(action) {
    const input = action.input;
    const step = this.db.prepare("SELECT * FROM workflow_steps WHERE id = ?").get(input.selection_step_id);
    const executeStep = this.db.prepare("SELECT * FROM workflow_steps WHERE id = ?").get(input.execute_step_id);
    if (!step || !executeStep || step.workflow_id !== input.workflow_id || step.status !== "waiting") {
      return this.#reject(action, "selection_not_available", ["chain_binding", "command"]);
    }
    if (action.principal?.type === "ai_advisor") {
      return this.#reject(action, "advisor_has_no_selection_authority", ["chain_binding", "command"]);
    }
    if (action.principal?.type === "ai_decider" && action.principal?.authorized !== true) {
      return this.#reject(action, "delegated_authority_missing", ["chain_binding", "command"]);
    }
    const chain = input.chain;
    this.db.prepare(`
      UPDATE workflow_steps
      SET status = 'succeeded', waiting_reason = NULL, chain_id = ?, chain_version = ?, chain_digest = ?, result_revision = 1
      WHERE id = ?
    `).run(chain.id, chain.version, chain.digest, step.id);
    this.db.prepare(`
      UPDATE workflow_steps
      SET status = 'ready', chain_id = ?, chain_version = ?, chain_digest = ?
      WHERE id = ?
    `).run(chain.id, chain.version, chain.digest, executeStep.id);
    this.db.prepare("UPDATE workflow_instances SET status = 'running' WHERE id = ?").run(input.workflow_id);
    const receiptCommandId = input.receipt_command_id;
    const executeCommandId = "cmd-execute-task-001";
    const executeCommand = this.#insertCommand({
      command_id: executeCommandId,
      action_key: `execute:${input.workflow_id}:${executeStep.id}:visit-1`,
      kind: "execute_chain",
      target_identities: { workflow_id: input.workflow_id, step_id: executeStep.id },
      principal: { type: "system", id: "transition-service" },
      scope: "lifecycle.dispatch",
      payload: { workflow_id: input.workflow_id, step_id: executeStep.id, chain },
    });
    this.#emit("chain.selected", action, { workflow_id: input.workflow_id, step_id: step.id });
    this.#emit("step.ready", action, { workflow_id: input.workflow_id, step_id: executeStep.id });
    const result = this.#result(action, ["chain.selected", "step.ready"], [receiptCommandId, executeCommand], [], { selection_mode: input.selection_mode });
    this.#receipt(action, receiptCommandId, result, { workflow_id: input.workflow_id, step_id: step.id });
    return result;
  }

  #claimCommand(action) {
    const input = action.input;
    const command = this.db.prepare("SELECT * FROM lifecycle_commands WHERE command_id = ?").get(input.command_id);
    if (!command) return this.#reject(action, "command_not_found", ["lease", "run", "agent_attempt"]);
    if (command.status !== "queued" || input.lease_generation !== command.lease_generation + 1) {
      return this.#reject(action, "stale_or_conflicting_lease", ["run", "agent_attempt", "capacity_release"]);
    }
    const target = parseJson(command.target_identities, {});
    const run = input.run;
    const attempt = input.attempt;
    const reservation = input.reservation;
    this.db.prepare(`
      UPDATE lifecycle_commands
      SET status = 'leased', delivery_count = delivery_count + 1, lease_owner = ?, lease_generation = ?, lease_expires_at = ?
      WHERE command_id = ? AND status = 'queued' AND lease_generation = ?
    `).run(input.owner, input.lease_generation, input.lease_expires_at, input.command_id, input.lease_generation - 1);
    this.db.prepare(`
      INSERT INTO runs (id, org_id, workflow_id, step_id, attempt_number, status, chain_id, chain_version, chain_digest)
      VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)
    `).run(
      run.id,
      this.namespace.org_id,
      target.workflow_id,
      target.step_id,
      run.attempt_number,
      target.chain_id || null,
      target.chain_version || null,
      target.chain_digest || null,
    );
    this.db.prepare(`
      INSERT INTO agent_attempts (id, run_id, agent_id, phase, instruction_ledger, transitions)
      VALUES (?, ?, ?, 'created', '[]', '[]')
    `).run(attempt.id, run.id, attempt.agent_id);
    this.db.prepare(`
      INSERT INTO execution_reservations (id, org_id, run_id, attempt_id, capacity_domain, queue_order, status, owner, generation)
      VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(reservation.id, this.namespace.org_id, run.id, attempt.id, reservation.capacity_domain, reservation.queue_order, input.owner, 1);
    this.db.prepare("UPDATE workflow_steps SET status = 'running', current_run_id = ? WHERE id = ?").run(run.id, target.step_id);
    this.#emit("command.leased", action, { workflow_id: target.workflow_id, step_id: target.step_id, run_id: run.id });
    this.#emit("run.reserved", action, { workflow_id: target.workflow_id, step_id: target.step_id, run_id: run.id, attempt_id: attempt.id });
    this.#emit("agent_attempt.created", action, { workflow_id: target.workflow_id, step_id: target.step_id, run_id: run.id, attempt_id: attempt.id });
    return this.#result(action, ["command.leased", "run.reserved", "agent_attempt.created"], [input.command_id], [run.id, attempt.id, reservation.id]);
  }

  #agentProgress(action) {
    const input = action.input;
    const existingEvent = this.db.prepare("SELECT event_id FROM lifecycle_events WHERE source_event_id = ?").get(input.source_event_id);
    if (existingEvent) return { accepted: true, actionId: action.action_id, eventTypes: [], commandIds: [], createdIds: [], duplicate: true };
    const attempt = this.db.prepare("SELECT * FROM agent_attempts WHERE id = ?").get(input.attempt_id);
    if (!attempt) return this.#reject(action, "attempt_not_found", ["phase_change", "instruction"]);
    if (!(ALLOWED_ATTEMPT_TRANSITIONS[attempt.phase] || []).includes(input.to)) {
      return this.#reject(action, "invalid_attempt_transition", ["phase_change", "run_completion"]);
    }
    const transitions = parseJson(attempt.transitions, []);
    transitions.push({ from: attempt.phase, to: input.to, at: isoFor(this.sequence + 1) });
    const instructionLedger = parseJson(attempt.instruction_ledger, []);
    if (input.to === "instructions_submitted") instructionLedger.push(input.instruction);
    this.db.prepare(`
      UPDATE agent_attempts
      SET phase = ?, process_pid = COALESCE(?, process_pid), pty_session_id = COALESCE(?, pty_session_id), instruction_ledger = ?, transitions = ?
      WHERE id = ?
    `).run(input.to, input.process_pid || null, input.pty_session_id || null, json(instructionLedger), json(transitions), input.attempt_id);
    const run = this.db.prepare("SELECT * FROM runs WHERE id = (SELECT run_id FROM agent_attempts WHERE id = ?)").get(input.attempt_id);
    if (input.to === "lease_acquired") this.db.prepare("UPDATE runs SET status = 'running' WHERE id = ?").run(run.id);
    const eventTypes = ["agent_attempt.phase_changed"];
    this.#emit("agent_attempt.phase_changed", action, { run_id: run.id, attempt_id: input.attempt_id, source_event_id: input.source_event_id, to: input.to });
    if (input.to === "instructions_submitted") {
      eventTypes.push("instruction.intent.recorded");
      this.#emit("instruction.intent.recorded", action, { run_id: run.id, attempt_id: input.attempt_id, source_event_id: `${input.source_event_id}:instruction` });
    }
    return this.#result(action, eventTypes);
  }

  #completeRun(action) {
    const input = action.input;
    const duplicateEvent = this.db.prepare("SELECT event_id FROM lifecycle_events WHERE source_event_id = ?").get(input.source_event_id);
    if (duplicateEvent) return { accepted: true, actionId: action.action_id, eventTypes: [], commandIds: [], createdIds: [], duplicate: true };
    const attempt = this.db.prepare("SELECT * FROM agent_attempts WHERE id = ?").get(input.attempt_id);
    const run = this.db.prepare("SELECT * FROM runs WHERE id = ?").get(input.run_id);
    if (!attempt || !run || attempt.run_id !== run.id || attempt.phase !== "completed") {
      return this.#reject(action, "completion_identity_or_phase_invalid", ["artifact_ref", "run_completion", "summary_command"]);
    }
    const artifact = input.artifact;
    const targetPath = resolve(this.artifactRoot, artifact.relative_path);
    if (!targetPath.startsWith(`${resolve(this.artifactRoot)}${process.platform === "win32" ? "\\" : "/"}`)) {
      return this.#reject(action, "artifact_path_outside_authorized_root", ["artifact_ref", "run_completion"]);
    }
    const digest = `sha256:${createHash("sha256").update(artifact.content).digest("hex")}`;
    if (digest !== artifact.digest) return this.#reject(action, "artifact_digest_mismatch", ["artifact_ref", "run_completion", "summary_command"]);
    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, artifact.content, "utf8");
    this.db.prepare(`
      INSERT INTO artifact_refs
        (id, org_id, run_id, attempt_id, kind, storage_path, digest, size_bytes, schema_version, validation_result)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'accepted')
    `).run(artifact.id, this.namespace.org_id, run.id, attempt.id, artifact.kind, artifact.relative_path, artifact.digest, Buffer.byteLength(artifact.content), artifact.schema_version);
    this.db.prepare("UPDATE runs SET status = 'completed', accepted_result_revision = ?, status_reason = 'accepted_artifact' WHERE id = ?").run(input.accepted_result_revision, run.id);
    this.db.prepare("UPDATE workflow_steps SET status = 'succeeded', result_revision = ?, waiting_reason = NULL WHERE id = ?").run(input.accepted_result_revision, input.execute_step_id);
    this.db.prepare("UPDATE workflow_steps SET status = 'ready' WHERE id = ?").run(input.summary_step_id);
    this.db.prepare("UPDATE lifecycle_commands SET status = 'completed', result_ref = ? WHERE command_id = ?").run(artifact.id, input.command_id);
    this.db.prepare("UPDATE execution_reservations SET status = 'released', release_evidence = ? WHERE run_id = ? AND attempt_id = ?").run(json({ event: "run.completed", artifact_id: artifact.id }), run.id, attempt.id);
    const summaryCommandId = this.#insertCommand({
      command_id: input.summary_command_id,
      action_key: `summary:${run.id}:revision-${input.accepted_result_revision}`,
      kind: "summarize_outcome",
      target_identities: { workflow_id: run.workflow_id, step_id: input.summary_step_id, source_run_id: run.id },
      principal: { type: "system", id: "transition-service" },
      scope: "lifecycle.summary",
      payload: { source_run_id: run.id, artifact_id: artifact.id, accepted_result_revision: input.accepted_result_revision },
    });
    this.#emit("artifact.accepted", action, { workflow_id: run.workflow_id, step_id: run.step_id, run_id: run.id, attempt_id: attempt.id, source_event_id: input.source_event_id });
    this.#emit("run.completed", action, { workflow_id: run.workflow_id, step_id: run.step_id, run_id: run.id, attempt_id: attempt.id });
    this.#emit("step.completed", action, { workflow_id: run.workflow_id, step_id: run.step_id, run_id: run.id });
    return this.#result(action, ["artifact.accepted", "run.completed", "step.completed"], [input.command_id, summaryCommandId], [artifact.id]);
  }

  #acceptOutcome(action) {
    const input = action.input;
    const workflow = this.db.prepare("SELECT * FROM workflow_instances WHERE id = ?").get(input.workflow_id);
    const task = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(input.task_id);
    const summaryCommand = this.db.prepare("SELECT * FROM lifecycle_commands WHERE command_id = ?").get(input.summary_command_id);
    const artifact = this.db.prepare("SELECT * FROM artifact_refs WHERE id = ?").get(input.artifact_id);
    if (!workflow || !task || !summaryCommand || summaryCommand.status !== "queued" || !artifact) {
      return this.#reject(action, "outcome_context_missing_or_already_consumed", ["task.closed", "workflow.completed", "external_action"]);
    }
    if (artifact.run_id !== input.source_run_id || artifact.id !== input.artifact_id || task.acceptance_criteria_revision !== input.acceptance_criteria_revision) {
      return this.#reject(action, "outcome_revision_or_source_mismatch", ["task.closed", "workflow.completed", "external_action"]);
    }
    if (input.verdict !== "close") return this.#reject(action, "reference_fixture_only_supports_close", ["task.closed", "workflow.completed"]);
    this.db.prepare("UPDATE workflow_steps SET status = 'succeeded', result_revision = ? WHERE id = ?").run(input.accepted_result_revision, input.summary_step_id);
    this.db.prepare("UPDATE workflow_steps SET status = 'succeeded', result_revision = ? WHERE id = ?").run(input.accepted_result_revision, input.finalize_step_id);
    this.db.prepare("UPDATE tasks SET status = 'closed', version = version + 1 WHERE id = ?").run(task.id);
    this.db.prepare("UPDATE workflow_instances SET status = 'completed' WHERE id = ?").run(workflow.id);
    this.db.prepare("UPDATE lifecycle_commands SET status = 'completed', result_ref = ? WHERE command_id = ?").run(input.artifact_id, input.summary_command_id);
    const result = this.#result(action, ["outcome.accepted", "task.closed", "workflow.completed"], [input.summary_command_id, input.receipt_command_id]);
    this.#emit("outcome.accepted", action, { workflow_id: workflow.id, step_id: input.summary_step_id, run_id: input.source_run_id });
    this.#emit("task.closed", action, { workflow_id: workflow.id, step_id: input.finalize_step_id });
    this.#emit("workflow.completed", action, { workflow_id: workflow.id });
    this.#receipt(action, input.receipt_command_id, result, { workflow_id: workflow.id, task_id: task.id });
    return result;
  }
}

function assertTransition(actual, expected) {
  assert.equal(actual.accepted, expected.accepted, `${expected.action_id}: acceptance mismatch`);
  assert.deepEqual(actual.eventTypes, expected.event_types || [], `${expected.action_id}: event types mismatch`);
  if (expected.command_ids) assert.deepEqual(actual.commandIds, expected.command_ids, `${expected.action_id}: command ids mismatch`);
  if (expected.created_ids) assert.deepEqual(actual.createdIds, expected.created_ids, `${expected.action_id}: created ids mismatch`);
  if (expected.rejection_code) assert.equal(actual.rejection_code, expected.rejection_code, `${expected.action_id}: rejection mismatch`);
}

function assertMustNot(model, actual, expected, actionId) {
  for (const token of expected.must_not || []) {
    if (token === "run" || token === "agent_attempt" || token === "second_run" || token === "second_attempt") {
      assert.equal(model.tableCount(token === "agent_attempt" || token === "second_attempt" ? "agent_attempts" : "runs"), token.startsWith("second") ? 1 : 0, `${actionId}: unexpected ${token}`);
    } else if (token === "instruction_submission") {
      assert.equal(actual.eventTypes.includes("instruction.intent.recorded"), false, `${actionId}: instruction submitted too early`);
    } else if (token === "duplicate_instruction") {
      const count = model.db.prepare("SELECT instruction_ledger FROM agent_attempts WHERE id = 'attempt-fixture-001'").get();
      assert.equal(parseJson(count?.instruction_ledger, []).length, 1, `${actionId}: duplicate instruction`);
    } else if (token === "task.closed") {
      assert.equal(actual.eventTypes.includes("task.closed"), false, `${actionId}: task closed before outcome`);
    } else if (token === "second_task" || token === "second_dependency" || token === "second_external_action") {
      assert.equal(model.tableCount("tasks"), 1, `${actionId}: duplicate task-side effect`);
    }
  }
}

function runFixture(fixture) {
  const tempRoot = mkdtempSync(join(tmpdir(), "mentiko-database-lifecycle-"));
  const model = new ReferenceLifecycle(fixture, tempRoot);
  const actualTransitions = [];
  try {
    assert.equal(model.db.pragma("journal_mode", { simple: true }), "wal", "fixture must use WAL");
    assert.equal(model.db.pragma("foreign_keys", { simple: true }), 1, "fixture must enforce foreign keys");
    assert.equal(model.db.pragma("synchronous", { simple: true }), 2, "fixture must use synchronous=FULL");
    assert.equal(model.tableCount("runs"), 0, "initial task creation must start without a run");
    assert.equal(model.tableCount("agent_attempts"), 0, "initial task creation must start without an AgentAttempt");

    for (const [index, action] of fixture.actions.entries()) {
      const actual = model.apply(action);
      const expected = fixture.expected.transitions[index];
      assert.equal(expected.action_id, action.action_id, `transition ${index} is out of order`);
      assertTransition(actual, expected);
      assertMustNot(model, actual, expected, action.action_id);
      actualTransitions.push(actual);
    }

    assert.deepEqual(model.stateSummary(), fixture.expected.final_state, "final reference-model state mismatch");
    const artifact = fixture.actions.find((action) => action.kind === "complete_run").input.artifact;
    const artifactPath = join(model.artifactRoot, artifact.relative_path);
    assert.equal(readFileSync(artifactPath, "utf8"), artifact.content, "artifact bytes changed");
    assert.equal(relative(model.artifactRoot, artifactPath).startsWith(".."), false, "artifact escaped temporary root");
    return { tempRoot, actualTransitions, finalState: model.stateSummary() };
  } finally {
    model.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function main() {
  const fixture = readJson(fixturePath);
  const fixtureSchema = readJson(fixtureSchemaPath);
  const example = readJson(examplePath);
  const generationExample = readJson(generationExamplePath);
  const decisionExample = readJson(decisionExamplePath);
  const recordsSchema = readJson(recordsSchemaPath);
  const scenarioSuite = readJson(scenarioSuitePath);
  const scenarioSchema = readJson(scenarioSchemaPath);
  const acceptanceContract = readJson(acceptanceCasesPath);
  assertSchema(fixture, fixtureSchema, "task-fulfillment-happy-path.json");
  assertSchema(example, recordsSchema, "examples/task-fulfillment-happy-path.json");
  assertSchema(generationExample, recordsSchema, "examples/generation-before-tasks.json");
  assertSchema(decisionExample, recordsSchema, "examples/decision-authority.json");
  const suiteSummary = validateScenarioSuite(scenarioSuite, scenarioSchema, acceptanceContract);
  assert.equal(fixture.actions.length, fixture.expected.transitions.length, "every action needs one expected transition");
  const result = runFixture(fixture);
  console.log(JSON.stringify({
    status: "passed",
    fixture: fixture.fixture_id,
    package: packageRoot,
    transitions: result.actualTransitions.length,
    scenarios: suiteSummary.scenarioCount,
    acceptance_cases: suiteSummary.acceptanceCaseCount,
    final_state: result.finalState,
    isolation: "temporary namespace SQLite database and artifact root removed",
    proof_boundary: "reference model and fixture consistency only; production runtime not migrated",
  }, null, 2));
}

main();
