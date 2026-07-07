#!/usr/bin/env tsx
/**
 * One-off: trigger the real decision-gate creation path for TASK-188
 * (Runtime verification parent) by reproducing the production
 * create_decision_gate + block_on_decision effect pair from
 * web/lib/orchestration/task-lifecycle-service.ts.
 *
 * Usage:
 *   npx tsx web/scripts/create-decision-gate-task188.ts
 */

import { createTaskDecision } from "../lib/tasks/task-decision-link";
import { taskAddDep } from "../lib/tasks/task-store";

async function main() {
  const result = await createTaskDecision({
    namespaceId: "default",
    orgId: "default",
    prompt: "Decide next step for TASK-188 runtime verification",
    source: "manual-verification",
    parentTaskId: "TASK-188",
  });

  taskAddDep("default", "TASK-188", result.task.id, "default");

  console.log(
    JSON.stringify({
      decisionId: result.decision.id,
      decisionTaskId: result.task.id,
      parentTaskId: "TASK-188",
    })
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
