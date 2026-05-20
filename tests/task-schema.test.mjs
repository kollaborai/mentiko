#!/usr/bin/env node
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const Ajv = require("../web/node_modules/ajv");

const schema = JSON.parse(readFileSync(join(process.cwd(), "lib/schemas/task.schema.json"), "utf8"));
const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(schema);

function assertValid(name, value) {
  assert.equal(validate(value), true, `${name} should be valid: ${ajv.errorsText(validate.errors)}`);
}

function assertInvalid(name, value, expectedText) {
  assert.equal(validate(value), false, `${name} should be invalid`);
  assert.match(ajv.errorsText(validate.errors), expectedText, `${name} should fail with ${expectedText}`);
}

const baseTask = {
  title: "Add task generation validation",
  type: "task",
  priority: 2,
  acceptance_criteria: "Given malformed generated output, when the job completes, then it fails before task creation",
};

assertValid("plain task", baseTask);

assertValid("epic with described subtasks", {
  ...baseTask,
  type: "epic",
  subtasks: [
    {
      title: "Validate generated task JSON",
      description: "Fail missing required fields before job completion.",
      type: "task",
      priority: 2,
    },
  ],
});

assertInvalid("non-epic parent with subtasks", {
  ...baseTask,
  type: "feature",
  subtasks: [
    {
      title: "Invalid child",
      description: "This should force the parent to be an epic.",
      type: "task",
      priority: 2,
    },
  ],
}, /epic|const|must be equal/i);

assertInvalid("subtask without description", {
  ...baseTask,
  type: "epic",
  subtasks: [
    {
      title: "Missing description",
      type: "task",
      priority: 2,
    },
  ],
}, /description/i);

console.log("task schema tests passed");
