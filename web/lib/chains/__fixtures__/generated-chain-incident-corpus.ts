/**
 * Sanitized regression corpus from the 2026-07-30/31 devv generated-chain
 * incident (see chain-contract-plan-of-record.md). These are the REAL chains
 * the v0.3.48 prose classifier (f49b8ec) falsely rejected, captured verbatim
 * from the devv run artifacts. They are the acceptance bar for the validator:
 * every fixture here except the structurally broken ones must pass
 * validateGeneratedChainDeliveryContract with zero errors.
 */


/**
 * TASK-013 run-1785485349808-6808ebb6: agents[3] verifies a CREATED CHILD task
 * is open/unassigned/admittable. The parent stays in_progress. v0.3.48 matched
 * 'task status is open' prose and rejected the save (agents[3] false positive).
 */
export const INCIDENT_TASK_013_CHILD_TASK_CHAIN = {
  "name": "infrastructure-smoke-test-designer",
  "version": "1.0.0",
  "description": "Reads infrastructure components from runtime task context, designs auto-run smoke test tasks with validation commands, and verifies the task meets acceptance criteria",
  "default_agent_profile": "claude-sonnet",
  "metadata": {
    "generated_chain_contract": {
      "version": 1,
      "mode": "operations",
      "acceptance_criteria": "Given a task is ready with auto_run enabled, when the automation poller processes it, then the task is admitted without a manual run start, a chain is generated and bound to the task, and task-to-run linkage is established via last_run_id and task_run_scope metadata"
    }
  },
  "config": {
    "session_prefix": "ist",
    "max_rounds": 1,
    "on_complete": "stop",
    "project_root": "auto"
  },
  "agents": [
    {
      "id": "infrastructure-context-analyzer",
      "name": "Infrastructure Context Analyzer",
      "role": "Reads runtime TASK_CONTEXT to extract infrastructure components, validation requirements, and workspace context",
      "triggers": [
        "manual-start"
      ],
      "emits": "context-analyzed",
      "authorities": {
        "can": [
          "read_files"
        ]
      },
      "prompt": "You are the Infrastructure Context Analyzer for auto-run smoke test task design.\n\n## Your Input\nRuntime TASK_CONTEXT is injected into your environment and contains:\n- TASK_ID: The identifier for this task\n- TASK_CONTEXT: Full task context including title, description, acceptance_criteria, notes, design, metadata\n- WORKSPACE_PATH: The absolute path to the target repository\n\n## Your Deliverable\nA normalized infrastructure analysis document that includes:\n1. Target infrastructure components extracted from task description/notes/design fields\n2. Validation requirements derived from acceptance_criteria\n3. Workspace framework detected from WORKSPACE_PATH (e.g. Rust/Cargo, Node.js/npm, Python/pip, Docker, Kubernetes)\n4. Existing test commands discovered from the workspace (package.json scripts, Makefile, Cargo.toml, pytest.ini, etc.)\n5. Critical files or endpoints that prove the infrastructure works\n\n## Your Verification\nRun targeted discovery commands in WORKSPACE_PATH:\n- For Rust: cargo read-manifest, inspect [workspace.dependencies]\n- For Node.js: cat package.json, inspect scripts and test commands\n- For Python: inspect pyproject.toml, setup.py, or pytest.ini\n- For Docker: inspect Dockerfile and docker-compose.yml\n- For Kubernetes: inspect manifests and Helm charts\n\nWrite your analysis to $ARTIFACTS_DIR/infrastructure-context.json with this structure:\n{\n  \"framework\": \"detected framework type\",\n  \"infrastructure_components\": [\"component1\", \"component2\"],\n  \"validation_requirements\": [\"requirement from acceptance criteria\"],\n  \"existing_test_commands\": [\"command1\", \"command2\"],\n  \"critical_verification_points\": [\"what to check to prove infrastructure works\"],\n  \"workspace_path\": \"WORKSPACE_PATH value\"\n}\n\nWhen the file is written and valid, emit \"context-analyzed\".\n\nDo NOT hardcode component names, absolute paths, or task IDs. Read everything from TASK_CONTEXT and WORKSPACE_PATH.",
      "deliverable": "Normalized infrastructure context document at $ARTIFACTS_DIR/infrastructure-context.json",
      "verification": "File exists and contains valid JSON with all required fields populated from runtime context"
    },
    {
      "id": "smoke-test-task-designer",
      "name": "Smoke Test Task Designer",
      "role": "Designs a smoke test task with auto_run enabled, runtime commands, and verifiable acceptance criteria",
      "triggers": [
        "context-analyzed"
      ],
      "emits": "task-designed",
      "authorities": {
        "can": [
          "read_files",
          "run_commands"
        ]
      },
      "prompt": "You are the Smoke Test Task Designer. Your job is to create a smoke test task definition that will validate infrastructure mechanics work.\n\n## Your Input\nRead $ARTIFACTS_DIR/infrastructure-context.json to understand:\n- What infrastructure components need validation\n- What validation requirements must be satisfied\n- What framework conventions exist in the workspace\n- What test commands are already available\n\nAlso read the original TASK_CONTEXT to understand the user's intent for this smoke test.\n\n## Your Deliverable\nDesign a smoke test task with these properties:\n1. **Subject**: Clear task title describing what infrastructure is being smoke-tested\n2. **Description**: What the smoke test validates and why it matters\n3. **Acceptance Criteria**: Given/when/then format, verifiable via runtime commands\n4. **Design**: How the smoke test will be executed (commands, probes, checks)\n5. **Priority**: 1 (highest for infrastructure validation)\n6. **Auto-run**: true (required for admission)\n7. **Labels**: [\"infrastructure\", \"smoke-test\", \"auto-run\"]\n\nKey Design Requirements:\n- Commands must be runnable in WORKSPACE_PATH without human interaction\n- Acceptance criteria must be checkable via automated assertions (exit codes, stdout assertions, HTTP responses, file existence)\n- Include setup, execution, and verification phases\n- Design should be reusable across different infrastructure instances\n\nWrite your task design to $ARTIFACTS_DIR/smoke-test-task-design.json with this structure:\n{\n  \"subject\": \"task title\",\n  \"description\": \"what this validates\",\n  \"acceptance_criteria\": \"Given/when/then criteria\",\n  \"design\": \"execution approach with commands\",\n  \"priority\": 1,\n  \"auto_run\": true,\n  \"labels\": [\"infrastructure\", \"smoke-test\", \"auto-run\"],\n  \"estimated_minutes\": 5,\n  \"workspace_path\": \"from infrastructure context\"\n}\n\nWhen the design is complete, emit \"task-designed\".\n\nDo NOT hardcode absolute paths or specific component names from this run. Derive everything from the infrastructure context.",
      "deliverable": "Smoke test task design document at $ARTIFACTS_DIR/smoke-test-task-design.json",
      "verification": "File exists and contains a valid task design with auto_run:true and verifiable acceptance criteria"
    },
    {
      "id": "mentiko-task-creator",
      "name": "Mentiko Task Creator",
      "role": "Creates the Mentiko task record using mentiko create_task MCP tool with runtime-derived values",
      "triggers": [
        "task-designed"
      ],
      "emits": "task-created",
      "authorities": {
        "can": [
          "read_files",
          "run_commands"
        ]
      },
      "prompt": "You are the Mentiko Task Creator. Your job is to create the smoke test task in Mentiko's task system.\n\n## Your Input\nRead $ARTIFACTS_DIR/smoke-test-task-design.json to get the task specification.\n\n## Your Process\n\n### Step 1: Read the task design\nLoad the smoke test task design and verify it has all required fields.\n\n### Step 2: Call mentiko create_task\nUse the mentiko MCP create_task tool with these parameters:\n- subject: from design.subject\n- desc: from design.description\n- acceptance_criteria: from design.acceptance_criteria\n- design: from design.design\n- priority: from design.priority\n- workspace_path: from design.workspace_path\n- labels: from design.labels\n- estimated_minutes: from design.estimated_minutes\n- issue_type: \"task\"\n\nDO NOT set owner or assignee. The automation poller will handle chain binding.\n\n### Step 3: Capture the result\nThe mentiko create_task tool will return the created task ID (e.g., TASK-XXX).\n\nWrite the task creation result to $ARTIFACTS_DIR/task-creation-result.json:\n{\n  \"task_id\": \"TASK-XXX\",\n  \"status\": \"open\",\n  \"subject\": \"created task title\",\n  \"auto_run\": true,\n  \"created_at\": \"ISO timestamp\"\n}\n\n### Step 4: Emit completion\nWhen the task is created and the result file is written, emit \"task-created\".\n\n## Important Constraints\n- Read ALL values from the task design file; do NOT hardcode any values\n- Use the exact workspace_path from the design file\n- The task must be created with auto_run implicitly enabled via the automation system\n- Do NOT set an assignee; let the poller handle it",
      "deliverable": "Created Mentiko task record with auto_run enabled",
      "verification": "$ARTIFACTS_DIR/task-creation-result.json exists with a valid task_id and the task can be queried via mentiko"
    },
    {
      "id": "final-acceptance-verifier",
      "name": "Final Acceptance Verifier",
      "role": "Independently verifies that the created task meets all acceptance criteria and is ready for auto-run admission",
      "triggers": [
        "task-created"
      ],
      "emits": "verification-complete",
      "authorities": {
        "can": [
          "read_files",
          "run_commands"
        ]
      },
      "final_verifier": true,
      "verifies_acceptance_criteria": true,
      "success_assertion": "The created task record contains a verifiable task_id, the task has auto_run enabled via the automation system, the acceptance criteria are checkable via runtime commands, and the task is in a state that the automation poller will admit without manual intervention",
      "prompt": "You are the Final Acceptance Verifier. Your job is to independently verify that the smoke test task meets all acceptance criteria for auto-run infrastructure validation.\n\n## Your Input\n- $ARTIFACTS_DIR/infrastructure-context.json: The original infrastructure analysis\n- $ARTIFACTS_DIR/smoke-test-task-design.json: The task design specification\n- $ARTIFACTS_DIR/task-creation-result.json: The task creation result with task_id\n- Runtime TASK_CONTEXT: The original task context for reference\n\n## Your Verification Process\n\n### Step 1: Verify task existence\nUse mentiko get_task with the task_id from task-creation-result.json to confirm:\n- The task exists in Mentiko's task system\n- The task status is \"open\" (ready for admission)\n- The workspace_path matches the infrastructure context\n\n### Step 2: Verify acceptance criteria are runtime-checkable\nInspect the task's acceptance_criteria field and verify:\n- Criteria use Given/when/then format\n- Each criterion can be verified via automated means (exit codes, assertions, probes)\n- No manual intervention is required\n- Verification commands are specified in the design field\n\n### Step 3: Verify infrastructure components are addressed\nCompare infrastructure_components from the context with the task's acceptance_criteria:\n- Each critical infrastructure component has a corresponding verification\n- The design field specifies how to validate each component\n- Commands are appropriate for the detected framework (Rust, Node.js, etc.)\n\n### Step 4: Verify auto-readiness\nConfirm the task is ready for the automation poller:\n- The task has all required fields populated\n- The design includes executable commands\n- No assignee is required (poller will bind the chain)\n- The task can transition to in_progress without manual intervention\n\n### Step 5: Record evidence\nWrite your verification report to $ARTIFACTS_DIR/final-verification-report.json:\n{\n  \"verification_status\": \"passed\" | \"failed\",\n  \"task_exists\": boolean,\n  \"task_id\": \"verified task ID\",\n  \"acceptance_criteria_checkable\": boolean,\n  \"infrastructure_covered\": boolean,\n  \"auto_ready\": boolean,\n  \"evidence\": [\n    \"specific evidence items checked\"\n  ],\n  \"gaps\": [\n    \"any gaps or issues found\"\n  ],\n  \"verified_at\": \"ISO timestamp\"\n}\n\n### Step 6: Emit result\n- If ALL verifications pass: emit \"verification-complete\"\n- If ANY verification fails: do NOT emit the completion event. Instead, fail with a detailed error explaining what failed and why\n\n## Critical Requirements\n- You MUST reject the result if acceptance criteria require manual intervention\n- You MUST reject the result if the task cannot be verified via runtime commands\n- You MUST reject the result if infrastructure components are not covered\n- You MUST reject the result if the task is not ready for auto admission\n\nYour role is the final quality gate. Only emit success when you have concrete evidence that all criteria are satisfied.",
      "deliverable": "Independent verification report at $ARTIFACTS_DIR/final-verification-report.json confirming the task meets all acceptance criteria",
      "verification": "mentiko get_task confirms the task exists and has the expected fields, all acceptance criteria are verifiable via runtime commands, and the report confirms auto-readiness"
    }
  ]
} as const;

/**
 * TASK-004 attempt 1 run-1785485660879-eb22731b: validates in-run admission
 * evidence (status=in_progress, last_run_id set). No terminal requirement.
 */
export const INCIDENT_TASK_004_ATTEMPT_1 = {
  "name": "infrastructure-validation",
  "version": "1.0",
  "description": "Validates auto-run admission and chain binding from within an active run using runtime task context",
  "default_agent_profile": "claude-sonnet",
  "metadata": {
    "generated_chain_contract": {
      "version": 1,
      "mode": "operations",
      "acceptance_criteria": "Auto-run admission succeeded (task status is in_progress with last_run_id set) and chain binding is established (task metadata contains task_run_scope linking to the generated chain)"
    }
  },
  "config": {
    "session_prefix": "iv",
    "max_rounds": 1,
    "on_complete": "stop"
  },
  "agents": [
    {
      "id": "auto-run-infrastructure-inspector",
      "name": "Auto-Run Infrastructure Inspector",
      "role": "Validates that auto-run admission succeeded by reading runtime task state",
      "triggers": [
        "manual-start"
      ],
      "emits": "admission-validated",
      "deliverable": "Validation report confirming that the runtime task's status is in_progress and last_run_id is set, proving auto-run admission succeeded",
      "verification": "Query the task using mentiko get_task to confirm status='in_progress' and last_run_id exists with a valid run identifier",
      "authorities": {
        "can": [
          "read_files"
        ],
        "needs_approval": []
      },
      "prompt": "You are the Auto-Run Infrastructure Inspector. Your job is to validate that auto-run admission succeeded for the runtime task.\n\n## Runtime Context Available\nYou have access to TASK_CONTEXT containing:\n- TASK_ID: the target task identifier\n- title, description, acceptance_criteria: task specification\n- workspace_path: target workspace location\n- Any admission criteria specified for this task\n\n## Step 1: Read Task State\nUse mentiko get_task with the TASK_ID from runtime context to read the current task record.\n\n## Step 2: Validate Admission\nConfirm the following admission success indicators:\n1. task.status equals 'in_progress'\n2. task.last_run_id is set to a valid run identifier (format: run-{timestamp}-{hash})\n\nThese conditions prove that the automation poller admitted the task and launched a chain run.\n\n## Step 3: Record Evidence\nDocument the specific values you found:\n- TASK_ID: {the actual value}\n- task.status: {the actual value}\n- task.last_run_id: {the actual value}\n- Timestamp of the run ID (if parseable)\n\n## Step 4: Determine Outcome\nIf both conditions are met, emit 'admission-validated' and proceed.\nIf either condition fails, report the specific failure:\n- 'FAILED: task.status is {actual}, expected in_progress'\n- 'FAILED: last_run_id is missing/invalid'\n\nYou do NOT verify terminal run state or task completion — only that admission succeeded.\n\n## What to Emit\nEmit 'admission-validated' only when both conditions are proven.\nReport specific failures if conditions are not met."
    },
    {
      "id": "chain-binding-validator",
      "name": "Chain Binding Validator",
      "role": "Validates that chain generation succeeded and chain binding is established",
      "triggers": [
        "admission-validated"
      ],
      "emits": "infrastructure-validation-complete",
      "deliverable": "Final validation report confirming that task.metadata.task_run_scope exists and contains chain_id, proving chain generation and binding succeeded",
      "verification": "Read task.metadata using mentiko get_task to confirm task_run_scope exists and chain_id is set to a valid chain identifier",
      "final_verifier": true,
      "verifies_acceptance_criteria": true,
      "success_assertion": "Chain binding is verified: task.metadata.task_run_scope exists with chain_id field populated, confirming that chain generation succeeded and the generated chain is bound to this task",
      "authorities": {
        "can": [
          "read_files"
        ],
        "needs_approval": []
      },
      "prompt": "You are the Chain Binding Validator. Your job is to validate that chain generation succeeded and the generated chain is properly bound to the runtime task.\n\n## Runtime Context Available\nYou have access to TASK_CONTEXT containing:\n- TASK_ID: the target task identifier\n- Expected chain identifier (if specified in acceptance criteria)\n- title, description, acceptance_criteria\n- workspace_path: target workspace location\n\n## Step 1: Read Task Metadata\nUse mentiko get_task with the TASK_ID from runtime context to read the full task record, focusing on task.metadata.\n\n## Step 2: Validate Chain Binding\nConfirm the following chain generation success indicators:\n1. task.metadata.task_run_scope exists\n2. task.metadata.task_run_scope.chain_id is set to a valid chain identifier\n3. The chain_id references the expected infrastructure-validation chain (if specified in runtime criteria)\n\nThese conditions prove that chain generation completed successfully and the chain is bound to this task.\n\n## Step 3: Verify Chain Existence (Optional Confirmation)\nIf runtime acceptance criteria specify an expected chain name or identifier, use mentiko list_chains to confirm the chain exists in the current namespace.\n\n## Step 4: Record Evidence\nDocument the specific binding evidence:\n- TASK_ID: {the actual value}\n- task.metadata.task_run_scope: {the actual object structure}\n- task.metadata.task_run_scope.chain_id: {the actual value}\n- Chain existence confirmation (if verified)\n\n## Step 5: Evaluate Against Acceptance Criteria\nCompare the binding evidence against the runtime acceptance criteria:\n- If criteria require a specific chain identifier, confirm chain_id matches\n- If criteria require any valid chain binding, confirm chain_id is a non-empty string\n- Record any gaps between expected and actual state\n\n## Step 6: Final Determination\nYou are the FINAL VERIFIER. Emit 'infrastructure-validation-complete' ONLY when ALL acceptance criteria are proven:\n- Admission succeeded (validated by prior agent)\n- Chain binding exists (task_run_scope present)\n- Chain identifier is valid and matches expectations\n\nIf any criterion is not proven, reject the result with specific evidence:\n- 'FAILED: task_run_scope missing from task.metadata'\n- 'FAILED: chain_id not set in task_run_scope'\n- 'FAILED: chain_id {actual} does not match expected {expected}'\n\nYou do NOT verify terminal run state, task completion, or run outcome — only that infrastructure setup succeeded.\n\n## What to Emit\nEmit 'infrastructure-validation-complete' when all acceptance criteria are satisfied.\nReport specific failures with evidence when any criterion is not met."
    }
  ],
  "branches": {}
} as const;

/**
 * TASK-004 attempt 2 run-1785485742902-12bd1fa8: success_assertion says
 * 'chain generation completed (task_run_scope exists)' -- lifecycle TERMS in
 * evidence prose, no lifecycle requirement. v0.3.48 flagged 'completed'.
 */
export const INCIDENT_TASK_004_ATTEMPT_2 = {
  "name": "infrastructure-validation",
  "version": "1.0.0",
  "description": "Reusable operations-mode chain for validating auto-run admission, chain generation, and linkage from within an active run",
  "default_agent_profile": "claude-sonnet",
  "metadata": {
    "generated_chain_contract": {
      "version": 1,
      "mode": "operations",
      "acceptance_criteria": "Auto-run admission succeeded (task in_progress with last_run_id), chain generation completed (task_run_scope exists), and chain binding is established"
    }
  },
  "config": {
    "max_rounds": 1,
    "session_prefix": "iv",
    "on_complete": "stop",
    "project_root": "auto"
  },
  "agents": [
    {
      "id": "auto-run-infrastructure-inspector",
      "name": "Auto-Run Infrastructure Inspector",
      "role": "Validates that auto-run admission succeeded by reading runtime task context and confirming task state",
      "triggers": [
        "manual-start"
      ],
      "emits": "admission-validated",
      "deliverable": "Validation report confirming auto-run admission succeeded (task.status = in_progress and last_run_id is set)",
      "verification": "Re-read task via mentiko get_task to confirm status = in_progress and last_run_id exists",
      "authorities": {
        "can": [
          "read_files",
          "run_commands"
        ]
      },
      "prompt": "You are the Auto-Run Infrastructure Inspector. Your job is to validate that auto-run admission succeeded by reading the runtime task context and confirming the task state.\n\n## Runtime Context Available\nYou have access to TASK_CONTEXT which contains:\n- TASK_ID: the task identifier to validate\n- title: task title\n- description: task description\n- acceptance_criteria: task acceptance criteria\n- workspace_path: workspace directory path\n\n## Step 1: Read Task State\nUse mentiko get_task with the TASK_ID from runtime context to read the current task record.\n\n## Step 2: Validate Auto-Run Admission\nConfirm that auto-run admission succeeded by verifying:\n1. task.status = 'in_progress'\n2. task.last_run_id is set and non-null\n\n## Step 3: Report Findings\nReport your findings:\n- If both conditions are met: state 'Auto-run admission validated: task is in_progress with last_run_id set' and emit 'admission-validated'\n- If either condition fails: report the specific failure (which condition failed and the actual values observed) and do NOT emit the success event\n\nYour validation reads concrete runtime state, not embedded literals. Use the TASK_ID provided at runtime.",
      "timeout": 120,
      "retry": {
        "max_retries": 1,
        "backoff": "fixed",
        "initial_delay": 5
      }
    },
    {
      "id": "chain-binding-validator",
      "name": "Chain Binding Validator",
      "role": "Validates that chain generation succeeded by proving task_run_scope exists and chain binding is established",
      "triggers": [
        "admission-validated"
      ],
      "emits": "validation-complete",
      "deliverable": "Validation report confirming chain generation succeeded (task_run_scope exists and chain binding is established)",
      "verification": "Re-read task metadata to confirm task_run_scope exists and chain_id is set",
      "final_verifier": true,
      "verifies_acceptance_criteria": true,
      "success_assertion": "Auto-run admission succeeded (task in_progress with last_run_id), chain generation completed (task_run_scope exists), and chain binding is established (metadata.chain_id exists)",
      "authorities": {
        "can": [
          "read_files",
          "run_commands"
        ]
      },
      "prompt": "You are the Chain Binding Validator. Your job is to validate that chain generation succeeded and the chain binding is properly established.\n\n## Runtime Context Available\nYou have access to TASK_CONTEXT which contains:\n- TASK_ID: the task identifier to validate\n- Expected chain identifier (derived from runtime context)\n- Acceptance criteria for chain binding success\n\n## Step 1: Read Task Metadata\nUse mentiko get_task with the TASK_ID from runtime context to read the full task record, including metadata.\n\n## Step 2: Validate Chain Generation\nConfirm that chain generation succeeded by verifying:\n1. task.metadata.task_run_scope exists and is non-null\n2. task.metadata.chain_id exists and is non-null\n3. The chain_id corresponds to the expected infrastructure-validation chain (from runtime context)\n\n## Step 3: Evaluate Acceptance Criteria\nCompare your findings against the acceptance criteria from runtime TASK_CONTEXT:\n- Auto-run admission succeeded: confirmed by Agent 1 (task in_progress with last_run_id)\n- Chain generation completed: confirmed by task_run_scope existence\n- Chain binding established: confirmed by chain_id existence\n\n## Step 4: Final Decision\n- If all validations pass: report success with evidence listing each validated condition, assert the acceptance criteria are satisfied, and emit 'validation-complete'\n- If any validation fails: report the specific failure (which condition failed and actual values observed), state the acceptance criteria are NOT satisfied, and do NOT emit the success event\n\nYou validate linkage and binding from within the active run. You do NOT verify terminal run or task state — that reconciliation is verified externally.",
      "timeout": 120,
      "retry": {
        "max_retries": 1,
        "backoff": "fixed",
        "initial_delay": 5
      }
    }
  ]
} as const;

/**
 * TASK-004 attempt 3 run-1785485826452-ea9365bc: compliance language 'without
 * requiring terminal state' -- the Goodhart loop: retry guidance taught the
 * model to disclaim, the matcher read the disclaimer as the violation.
 */
export const INCIDENT_TASK_004_ATTEMPT_3 = {
  "name": "infrastructure-validation",
  "version": "1.0.0",
  "description": "Operations-mode infrastructure validation chain that verifies auto-run admission, chain generation, and task-to-run linkage from within an active run. All agents read target identifiers and acceptance criteria from runtime TASK_CONTEXT.",
  "default_agent_profile": "claude-sonnet",
  "metadata": {
    "generated_chain_contract": {
      "version": 1,
      "mode": "operations",
      "acceptance_criteria": "Chain validation confirms runtime task identifier, expected chain identifier, and linkage evidence (task.status=in_progress, last_run_id set, task.metadata.task_run_scope exists, chain binding established) without requiring terminal state verification."
    }
  },
  "config": {
    "session_prefix": "iv",
    "max_rounds": 1,
    "monitor": true,
    "monitor_interval": 60,
    "project_root": "auto",
    "on_complete": "stop"
  },
  "agents": [
    {
      "id": "auto-run-infrastructure-inspector",
      "name": "Auto-Run Infrastructure Inspector",
      "role": "Validates that auto-run admission succeeded by confirming the runtime task transitioned to in_progress status and has an active run identifier.",
      "triggers": [
        "manual-start"
      ],
      "emits": "admission-validated",
      "authorities": {
        "can": [
          "read_files",
          "run_commands"
        ],
        "needs_approval": []
      },
      "deliverable": "Admission validation report confirming task.status=in_progress and last_run_id is set for the runtime task identifier.",
      "verification": "Re-run mentiko get_task {TASK_ID} to confirm task.status equals 'in_progress' and last_run_id field contains a non-empty run identifier.",
      "timeout": 180,
      "prompt": "You are the Auto-Run Infrastructure Inspector. Your job is to validate that auto-run admission succeeded for the runtime task.\n\n## Runtime Context Available\nYou receive these runtime values automatically:\n- TASK_ID: The target task identifier to validate\n- TASK_CONTEXT: Full task record including status, metadata, last_run_id, and workspace path\n- title: Task title from runtime context\n- description: Task description from runtime context\n- acceptance_criteria: Task acceptance criteria from runtime context\n- workspace_path: Workspace identity from runtime context\n\n## Your Validation Steps\n\n### Step 1: Read Runtime Task Context\nUse mentiko get_task with TASK_ID to read the current task state. This gives you authoritative runtime data.\n\n### Step 2: Validate Auto-Run Admission Succeeded\nConfirm these admission success indicators:\n1. task.status equals 'in_progress' (proves auto-run poller admitted the task)\n2. last_run_id field contains a non-empty run identifier (proves a run was created and linked)\n\nBoth conditions must be true. If either is false, admission did not succeed.\n\n### Step 3: Record Evidence\nDocument the exact values you found:\n- task.status value\n- last_run_id value (or confirmation it is null/empty)\n- Timestamp of your validation\n\n### Step 4: Emit Success or Failure\nIf both conditions are true:\n- Emit the 'admission-validated' event\n- Your deliverable is complete: admission validation report confirming success\n\nIf either condition is false:\n- Do NOT emit success\n- Report the specific failure (which condition failed and what value you found)\n- The chain must stop here\n\n## Important Constraints\n- You MUST read the runtime TASK_ID from context, not hardcode any task identifier\n- You validate ONLY that admission succeeded (task moved to in_progress, last_run_id set)\n- You do NOT validate terminal state, run completion, or task closure\n- External reconciliation happens after this chain finishes\n\n## Deliverable\nA validation report confirming auto-run admission succeeded (or failed, with specific evidence).",
      "context": {
        "read_first": []
      }
    },
    {
      "id": "chain-binding-validator",
      "name": "Chain Binding Validator",
      "role": "Validates that chain generation succeeded and task-to-run linkage is established by confirming metadata.task_run_scope exists and chain binding is present.",
      "triggers": [
        "admission-validated"
      ],
      "emits": "validation-complete",
      "authorities": {
        "can": [
          "read_files",
          "run_commands"
        ],
        "needs_approval": []
      },
      "deliverable": "Chain binding validation report confirming task.metadata.task_run_scope exists, chain binding is established, and linkage evidence is present.",
      "verification": "Re-run mentiko get_task {TASK_ID} to confirm task.metadata.task_run_scope exists and chain_id metadata field contains a valid chain identifier.",
      "final_verifier": true,
      "verifies_acceptance_criteria": true,
      "success_assertion": "Infrastructure validation proves the runtime task has (1) task.status=in_progress, (2) last_run_id set, (3) task.metadata.task_run_scope exists, and (4) chain binding established—all verified from within the active run without requiring terminal state.",
      "timeout": 180,
      "prompt": "You are the Chain Binding Validator. Your job is to validate that chain generation succeeded and task-to-run linkage is established.\n\n## Runtime Context Available\nYou receive these runtime values automatically:\n- TASK_ID: The target task identifier to validate\n- TASK_CONTEXT: Full task record including status, metadata, last_run_id, and workspace path\n- title: Task title from runtime context\n- description: Task description from runtime context\n- acceptance_criteria: Task acceptance criteria from runtime context\n- workspace_path: Workspace identity from runtime context\n\n## Your Validation Steps\n\n### Step 1: Read Runtime Task Context\nUse mentiko get_task with TASK_ID to read the current task state. This gives you authoritative runtime data.\n\n### Step 2: Validate Chain Generation Succeeded\nConfirm these generation success indicators:\n1. task.metadata.task_run_scope exists and contains a non-empty value (proves run scope was set)\n2. task.metadata.chain_id exists and contains a non-empty chain identifier (proves chain binding)\n3. last_run_id from Step 1 is still set (redundant confirmation of linkage)\n\nAll three conditions must be true. If any is false, chain generation did not fully succeed.\n\n### Step 3: Verify Against Acceptance Criteria\nRead the runtime acceptance_criteria from TASK_CONTEXT. Confirm your validation proves:\n- Runtime task identifier is confirmed (TASK_ID exists and is readable)\n- Expected chain identifier is bound (task.metadata.chain_id matches expected pattern)\n- Linkage evidence is present (task_run_scope, last_run_id, and chain_id all exist)\n\n### Step 4: Record Evidence\nDocument the exact values you found:\n- task.metadata.task_run_scope value\n- task.metadata.chain_id value\n- last_run_id value\n- How each criterion was proven\n\n### Step 5: Final Decision and Emit\nAs the final verifier:\n- If all conditions are true and all acceptance criteria are proven: emit 'validation-complete'\n- If any condition is false or criteria are not proven: DO NOT emit success\n- Report the specific gap with evidence\n\nYour success_assertion is: \"Infrastructure validation proves the runtime task has (1) task.status=in_progress, (2) last_run_id set, (3) task.metadata.task_run_scope exists, and (4) chain binding established—all verified from within the active run without requiring terminal state.\"\n\n## Important Constraints\n- You MUST read the runtime TASK_ID from context, not hardcode any task identifier\n- You validate ONLY that generation succeeded and linkage exists\n- You do NOT validate terminal run state, run completion status, or task closure\n- External reconciliation happens after this chain finishes\n- As the final verifier, your validation report must cite concrete evidence for every claim\n\n## Deliverable\nA validation report confirming chain binding succeeded (or failed, with specific evidence).",
      "context": {
        "read_first": []
      }
    }
  ],
  "branches": {},
  "routing": {}
} as const;

/**
 * TASK-002 run-1785448093359-302d05c2 chain (materialized): the final verifier
 * REQUIRES its own linked task/run to already be terminal + reconciled -- the
 * original, genuinely invalid pattern. Kept as the contract-v2 design corpus.
 * In v0.3.49 it passes acceptance (prose no longer blocks); prompt rules and
 * the Track B typed contract own this invariant.
 */
export const INCIDENT_TASK_002_CIRCULAR_CHAIN = {
  "name": "autorun-pipeline-validator",
  "version": "1.0.0",
  "description": "Validates the Mentiko auto-run pipeline from task admission through chain execution to task reconciliation. Every agent reads typed runtime task context and validates the auto-run behavior end-to-end.",
  "default_agent_profile": "claude-sonnet",
  "metadata": {
    "generated_chain_contract": {
      "version": 1,
      "mode": "operations",
      "acceptance_criteria": "For a task with auto-run enabled, the automation poller admits the task without manual start, executes the assigned chain to a terminal state, and stores sufficient evidence in the task record to identify the linked run and its outcome"
    }
  },
  "config": {
    "session_prefix": "arv",
    "max_rounds": 1,
    "on_complete": "stop",
    "monitor": true,
    "monitor_interval": 60
  },
  "agents": [
    {
      "id": "auto-run-admission-inspector",
      "name": "Auto-Run Admission Inspector",
      "role": "Validates that the runtime task meets auto-run admission criteria and would be admitted by the automation poller",
      "version": "1.0.0",
      "prompt": "You are the Auto-Run Admission Inspector. Your job is to validate that the runtime task qualifies for automatic execution by Mentiko's automation poller.\n\nREAD FIRST:\n- Read TASK_ID from runtime context\n- Read the full TASK_CONTEXT from runtime context\n- Read the task record including: metadata, status, assignee, labels, and acceptance_criteria fields\n\nVALIDATION STEPS:\n1. Confirm the task status is 'open' (not already in_progress or closed)\n2. Verify the assignee field contains a chain identifier (not a human user ID)\n3. Check that the task has defined acceptance_criteria (non-empty string or structured given/when/then)\n4. Confirm the task metadata or labels indicate auto-run enablement (auto_run: true, automation:enabled, or equivalent)\n5. Verify the workspace path is accessible and valid\n\nEVIDENCE TO COLLECT:\n- Task identifier and current status\n- Assignee chain ID\n- Auto-run enablement marker location and value\n- Workspace accessibility check result\n\nDELIVERABLE:\nA structured admission report stating whether the task qualifies for auto-run admission, with specific evidence for each criterion.\n\nVERIFICATION:\nRe-read the task record and confirm every admission criterion is documented with source file, field name, and observed value.\n\nEMIT:\nEmit 'admission-validated' only if the task meets all auto-run admission criteria. If any criterion fails, report the specific gap and do not emit success.",
      "triggers": [
        "manual-start"
      ],
      "emits": "admission-validated",
      "authorities": {
        "can": [
          "read_files"
        ]
      },
      "deliverable": "A structured admission report documenting whether the runtime task qualifies for auto-run admission with evidence for each criterion",
      "verification": "Re-read the task record and confirm each admission criterion is documented with field name and observed value"
    },
    {
      "id": "chain-execution-validator",
      "name": "Chain Execution Validator",
      "role": "Validates that the auto-admitted task's assigned chain can execute and reach a terminal state",
      "version": "1.0.0",
      "prompt": "You are the Chain Execution Validator. Your job is to validate that the chain assigned to the runtime task can execute and reach a terminal state.\n\nREAD FIRST:\n- Read TASK_ID from runtime context\n- Read the assignee chain ID from the task record\n- Read the chain definition from the Mentiko chain registry\n- Read the workspace path from runtime context\n\nVALIDATION STEPS:\n1. Resolve the chain ID to a concrete chain definition\n2. Verify the chain definition is valid JSON matching the mentiko schema\n3. Confirm the chain declares at least one agent\n4. Verify the chain config has a finite max_rounds or termination condition\n5. Check that every agent in the chain has a valid trigger or starts on chain-start\n6. Confirm the chain has a completion path (on_complete, or agents emit terminal events)\n7. Verify the chain's required authorities are available in the execution environment\n\nRUNTIME CONTEXT TO USE:\n- Target chain ID: read from task.assignee at runtime (do not hardcode)\n- Workspace path: read from TASK_CONTEXT.workspace_path at runtime\n- Project root: resolve from workspace path, not an absolute path\n\nEVIDENCE TO COLLECT:\n- Chain ID resolved from task assignee\n- Chain definition file location and schema validity\n- Agent count and trigger wiring validation result\n- Termination condition existence and type\n- Required authorities and their availability status\n\nDELIVERABLE:\nA chain execution readiness report confirming the assigned chain can terminate, with documented evidence for each validation step.\n\nVERIFICATION:\nLoad the chain definition and walk its agent graph to confirm every agent has a trigger path to completion.\n\nEMIT:\nEmit 'execution-validated' only if the assigned chain is valid and can reach a terminal state. Report structural gaps without emitting success.",
      "triggers": [
        "admission-validated"
      ],
      "emits": "execution-validated",
      "authorities": {
        "can": [
          "read_files",
          "run_commands"
        ]
      },
      "deliverable": "A chain execution readiness report confirming the assigned chain can reach a terminal state with documented validation evidence",
      "verification": "Load the chain definition and walk its agent graph to confirm every agent has a trigger path to completion"
    },
    {
      "id": "task-reconciliation-verifier",
      "name": "Task Reconciliation Verifier",
      "role": "Independently verifies that the task record contains sufficient evidence to identify the linked chain run and its outcome",
      "version": "1.0.0",
      "prompt": "You are the Task Reconciliation Verifier. Your job is to independently verify that the task record contains sufficient evidence to identify the linked chain run and its outcome.\n\nREAD FIRST:\n- Read TASK_ID from runtime context\n- Read the full task record from Mentiko task storage\n- Read all metadata fields on the task\n- If present, read last_run_id and run-related fields\n\nEVIDENCE REQUIREMENTS TO VALIDATE:\n1. RUN IDENTIFIER: Task must contain a run_id, last_run_id, or metadata field identifying the specific chain run execution\n2. RUN STATE: Task must contain the run's terminal state (completed, failed, error) in status, last_run_status, or metadata\n3. OUTCOME ASSERTION: Task must contain an outcome, result, or conclusion indicating whether the run succeeded\n4. EVIDENCE TRACE: Task must contain field paths or artifact locations linking to run outputs (e.g., metadata.run_output_path, last_run_artifacts)\n5. TEMPORAL CORRELATION: Task must contain timestamps correlating task update with run completion (updated_at, closed_at, or metadata timestamps)\n\nFAIL-CLOSED BEHAVIOR:\nThis verification is an acceptance gate. You MUST reject if any of the 5 evidence requirements are not satisfied. A prose claim, a plan, or a completed session is not evidence. The task record must contain structured data identifying the run and outcome.\n\nEVIDENCE TO COLLECT:\nFor each requirement, document:\n- The field name where evidence is found\n- The field value and data type\n- The file path or API endpoint where the task record is stored\n- Whether the field is optional or required in the schema\n\nDELIVERABLE:\nAn evidence-backed reconciliation verdict. State exactly which of the 5 evidence requirements are satisfied and which are missing, with field-level citations.\n\nVERIFICATION:\nRe-read the task record from storage and confirm each cited field exists and contains the claimed value. Reject if any field is missing or null.\n\nEMIT:\nEmit 'reconciliation-verified' only if ALL 5 evidence requirements are satisfied with concrete field-level citations. If any requirement is unproven, report the gap explicitly and do not emit success.",
      "triggers": [
        "execution-validated"
      ],
      "emits": "reconciliation-verified",
      "authorities": {
        "can": [
          "read_files",
          "run_commands"
        ]
      },
      "deliverable": "An evidence-backed reconciliation verdict stating which of the 5 evidence requirements are satisfied with field-level citations",
      "verification": "Re-read the task record and confirm each cited field exists and contains the claimed value",
      "final_verifier": true,
      "verifies_acceptance_criteria": true,
      "success_assertion": "The task record contains sufficient structured evidence to identify the linked chain run (run_id, last_run_id, or equivalent), its terminal state, outcome assertion, evidence trace to outputs, and temporal correlation between task update and run completion"
    }
  ]
} as const;
