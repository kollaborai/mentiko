writing effective agents
===============================================================================

how to write agent specs and prompts that actually work.

the art of the prompt
------------------------------------------------------------
your agent is only as good as its prompt.
ai agents are literal-minded and need explicit instructions.

good prompt traits:
  - specific and unambiguous
  - step-by-step instructions
  - clear completion criteria
  - explicit output format
  - error handling guidance

bad prompt traits:
  - vague goals ("do something cool")
  - open-ended ("think about this")
  - no completion signal
  - ambiguous file paths

prompt structure
------------------------------------------------------------
use this formula for reliable agents:

```json
{
  "prompt": "You are {ROLE}.\n\nTask: {TASK}\n\nSteps:\n1. {first step}\n2. {second step}\n3. {third step}\n\nOutput:\n- Write results to {path}\n- Emit event: {event}\n- Output AGENT_COMPLETE when done"
}
```

example - effective research agent:

```json
{
  "id": "researcher",
  "name": "Researcher",
  "role": "Research and compile information",
  "triggers": ["manual-start"],
  "emits": "research-complete",
  "prompt": "You are a Research Agent. Your task is to: {TASK}\n\nProcess:\n1. Read any relevant files in the project\n2. Search for and gather information on the topic\n3. Organize findings into clear themes\n4. Cite sources where applicable\n5. Write findings to workspace/research/findings.md\n\nFormat for findings.md:\n# Topic: {topic}\n\n## Summary\n[Brief 2-3 sentence summary]\n\n## Key Findings\n- [Finding 1]\n- [Finding 2]\n- [Finding 3]\n\n## Sources\n- [Source with URL]\n\nWhen findings.md is complete:\n1. Write event file to agents/events/ with:\n   event: research-complete\n   source: researcher\n   data: findings written to workspace/research/findings.md\n2. Output the exact text: AGENT_COMPLETE"
}
```

breaking down complex tasks
------------------------------------------------------------
if a task is too complex, the ai will wander.

break it down:

instead of:
```json
{
  "prompt": "Build a full web application with authentication"
}
```

use:
```json
{
  "prompt": "You are implementing authentication.\n\n1. Review existing code structure\n2. Create auth service at src/services/auth.ts\n3. Implement login function:\n   - accepts email/password\n   - validates credentials\n   - returns session token\n4. Write tests to tests/auth.test.ts\n5. Output AGENT_COMPLETE when tests pass"
}
```

file handling patterns
---------------------------------------------------------------
be explicit about file operations.

reading files:
```json
{
  "prompt": "1. Read workspace/input.md completely\n2. Identify the main points\n3. ..."
}
```

writing files:
```json
{
  "prompt": "1. Process the data\n2. Write results to workspace/output.json\n3. Format as valid JSON\n4. Include these fields: ..."
}
```

appending to files:
```json
{
  "prompt": "1. Read workspace/log.md\n2. Append your entry to the end\n3. Preserve existing format"
}
```

completion patterns
------------------------------------------------------------
every agent must signal completion.

two required steps:

1. write event file:
```json
{
  "prompt": "Write an event file at agents/events/researcher-complete.event with:\nevent: research-complete\nsource: researcher\ntimestamp: [current ISO timestamp]\nprocessed: false\ndata: research findings written to workspace/research/findings.md"
}
```

2. output completion signal:
```json
{
  "prompt": "After writing the event file, output exactly:\nAGENT_COMPLETE"
}
```

the event emission can be simplified:
```json
{
  "prompt": "When done, write your event file (event: research-complete) to agents/events/ and output AGENT_COMPLETE."
}
```

context and knowledge
------------------------------------------------------------
give the agent context up front.

using read_first:
```json
{
  "context": {
    "read_first": [
      "docs/spec.md",
      "workspace/requirements.md",
      "src/api.ts"
    ]
  },
  "prompt": "You have already read the spec, requirements, and api file.\n\nBased on these, implement the feature..."
}
```

embedding context in prompt:
```json
{
  "prompt": "Context:\n- Project: E-commerce backend\n- Stack: Node.js, TypeScript, Express\n- Pattern: MVC architecture\n\nYour task: Add product search endpoint\n\n1. Read src/routes/products.ts\n2. Add GET /search endpoint\n3. Query by product name\n4. Return JSON array of results"
}
```

error handling
------------------------------------------------------------
tell the agent what to do when things go wrong.

```json
{
  "prompt": "If you encounter an error:\n1. Log the error to workspace/error.log\n2. Include timestamp and details\n3. Emit event: build-error\n4. Output AGENT_COMPLETE\n\nOtherwise, on success:\n1. Write results to workspace/output.md\n2. Emit event: build-complete\n3. Output AGENT_COMPLETE"
}
```

conditional logic
------------------------------------------------------------
agents can make decisions and emit different events.

```json
{
  "id": "tester",
  "name": "Tester",
  "triggers": ["build-complete"],
  "prompt": "You are a Tester. Run tests and report results.\n\n1. Run npm test\n2. Check exit code\n3. Review output\n\nWrite results to workspace/test-results.md\n\nIf all tests pass:\n  Emit event: tests-passed\n\nIf any tests fail:\n  Emit event: tests-failed\n\nIn the event data, include the pass/fail count.\n\nOutput AGENT_COMPLETE when done."
}
```

iterative improvement
------------------------------------------------------------
for review loops, tell the agent what to expect.

```json
{
  "id": "author",
  "name": "Content Author",
  "triggers": ["manual-start", "needs-revision"],
  "prompt": "You are a Content Author. You create content.\n\nThis may be your first pass or a revision round.\n\nIf this is a revision (triggered by needs-revision):\n1. Read workspace/review/feedback.md\n2. Address each point of feedback\n3. Update workspace/draft/content.md\n\nIf this is first pass:\n1. Read the brief\n2. Create initial draft at workspace/draft/content.md\n\nWhen complete, emit event: draft-complete\nOutput AGENT_COMPLETE"
}
```

spec file format vs chain.json
---------------------------------------------------------------
markdown spec files (.agent.md) offer more structure.

when to use specs:
  - complex multi-step processes
  - when you need clear documentation
  - teams sharing agent definitions

when to use chain.json prompts:
  - simple single-purpose agents
  - quick prototyping
  - chain is straightforward

spec file example:
```yaml
name: Code Reviewer
role: Review code changes and provide feedback
session-prefix: reviewer
department: engineering

triggers:
  - event: pr-opened

authorities:
  can:
    - read source code
    - write to workspace/reviews/
    - access git history
  needs-approval:
    - submit reviews to external systems

context:
  read-first:
    - workspace/pr-description.md
    - workspace/diff.patch

playbooks:
  1-analyze-changes:
    - read the pr description
    - read the diff patch
    - identify files changed
    - note the scope of changes

  2-review-code-quality:
    - check for common issues:
      - security vulnerabilities
      - performance concerns
      - code style violations
    - note any bugs or logic errors
    - verify tests are included

  3-generate-feedback:
    - write review to workspace/reviews/feedback.md
    - structure:
      # PR Review
      ## Summary
      [brief overview]
      ## Issues Found
      - [issue 1]
      - [issue 2]
      ## Approval
      APPROVED or CHANGES_REQUESTED

  4-emit-decision:
    - if approved: emit "pr-approved"
    - if changes needed: emit "changes-requested"
    - write event file to agents/events/
    - output AGENT_COMPLETE

success-metrics:
  - feedback.md exists with clear verdict
  - all issues are actionable
  - event emitted correctly
```

prompt anti-patterns
---------------------------------------------------------------
avoid these common mistakes:

1. too vague:
   "do some research"
   → "research the following topic and compile 5 key findings"

2. no output path:
   "write your findings"
   → "write findings to workspace/research/findings.md"

3. missing completion:
   "analyze the code"
   → "analyze, write to workspace/analysis.md, emit event, output AGENT_COMPLETE"

4. unclear event:
   "emit an event"
   → "emit event: analysis-complete with data: results in workspace/analysis.md"

5. contradictory instructions:
   "be thorough but quick"
   → "be thorough. aim for completeness over speed."

testing your prompts
---------------------------------------------------------------
before relying on an agent in a chain:

1. test manually:
```bash
mentiko launch agents/specs/my-agent.agent.md --monitor
```

2. check outputs:
```bash
cat workspace/output.md
cat agents/events/*.event
```

3. verify event:
```bash
mentiko events --unprocessed
```

4. iterate on prompt based on results

common prompt issues and fixes:

issue: agent writes to wrong path
  fix: be explicit about full path

issue: agent doesn't complete
  fix: add explicit AGENT_COMPLETE instruction

issue: event never fires
  fix: check event name spelling, verify file written to agents/events/

issue: agent loops forever
  fix: add clear stopping condition, set max_rounds

agent personas
---------------------------------------------------------------
giving an agent a persona improves focus.

examples:

researcher persona:
```json
{
  "prompt": "You are a meticulous Research Analyst with 20 years experience.\n\nYour methods:\n- Verify all claims with sources\n- Organize findings thematically\n- Distinguish between facts and opinions\n- Note confidence levels for uncertain claims\n\nYour task: {TASK}\n\n..."
}
```

code reviewer persona:
```json
{
  "prompt": "You are a Senior Engineer conducting code review.\n\nYour standards:\n- Security: no vulnerabilities\n- Performance: O(n) or better where possible\n- Readability: clear names, good comments\n- Testing: edge cases covered\n\nYour task: Review the code at {path}\n\n..."
}
```

writer persona:
```json
{
  "prompt": "You are a Professional Technical Writer.\n\nYour style:\n- Active voice\n- Short sentences\n- Clear headings\n- Examples for complex concepts\n- Summary at the end\n\nYour task: {TASK}\n\n..."
}
```

template prompts
---------------------------------------------------------------
research agent:
```json
{
  "prompt": "You are a Researcher. Task: {TASK}\n\n1. Gather information on the topic\n2. Verify sources and claims\n3. Organize findings thematically\n4. Write to {output_path}\n\nWhen complete, emit event: research-complete and output AGENT_COMPLETE."
}
```

writer agent:
```json
{
  "prompt": "You are a Writer. Task: Create content about {topic}.\n\n1. Read research from {input_path}\n2. Structure content with clear headings\n3. Write in engaging, clear prose\n4. Write to {output_path}\n\nWhen complete, emit event: draft-complete and output AGENT_COMPLETE."
}
```

reviewer agent:
```json
{
  "prompt": "You are a Reviewer. Task: Review the content at {input_path}.\n\n1. Read thoroughly\n2. Check for accuracy, completeness, clarity\n3. Write feedback to {output_path}\n4. End with exactly one line:\n   VERDICT: approved\n   VERDICT: needs-revision\n\nEmit corresponding event and output AGENT_COMPLETE."
}
```

integrator agent:
```json
{
  "prompt": "You are an Integrator. Task: Combine inputs into final output.\n\n1. Read all files from {input_dir}\n2. Synthesize into coherent whole\n3. Resolve any conflicts\n4. Write to {output_path}\n\nWhen complete, emit event: integration-complete and output AGENT_COMPLETE."
}
```

next: event-system.md
