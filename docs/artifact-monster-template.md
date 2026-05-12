# Monster-Level Artifact Definitions

Artifact definitions are markdown files with YAML frontmatter that describe what
an agent produces or consumes. "Monster level" means the definition is complete
enough that any agent, validator, or UI component can work with it without
guessing — schema, validation rules, related artifacts, and a realistic example
body are all present.

---

## What "monster level" means

A standard artifact has: id, name, format, category, tags, description.

A monster artifact adds:
  - schema: full JSON Schema for the artifact's data structure
  - validation_rules: specific, enforceable rules beyond what schema expresses
  - related_artifacts: IDs of artifacts that complement this one
  - body: a complete, realistic example — not placeholders, actual data

The body is the most important part. It should look like something a real
Claude agent actually wrote. If you paste the body into a document and it
reads like real output, it's monster level. If it has {PLACEHOLDERS}
everywhere, it's not.

---

## Complete YAML frontmatter schema

```yaml
---
id: {kebab-case-id}
name: {Human Readable Name}
format: json|markdown|patch|text|csv|code
category: {category}
  # cli      shell commands, scripts, build tools, CI/CD
  # web      frontend, HTTP, APIs, browsers
  # api      backend services, REST/GraphQL endpoints
  # analysis code analysis, audits, assessments
  # security vulnerabilities, threat modeling, pen testing
  # data     schemas, migrations, pipelines, ETL
  # business proposals, reports, plans, strategy
  # devops   deployments, infra, containers, monitoring
tags: [tag1, tag2, tag3]
description: >
  1-2 sentence description. What does this artifact contain.
  Who produces it and when.
author: mentiko
version: 1.0
schema:
  type: object
  properties:
    field_name:
      type: string|number|boolean|array|object|integer
      description: what this field means
      enum: [val1, val2]         # optional: constrained values
      minimum: 0                 # optional: numeric bounds
      maximum: 255
      items:                     # optional: for arrays
        type: object
        properties:
          sub_field:
            type: string
  required:
    - field_name
    - other_required_field
validation_rules:
  - rule written as a plain assertion (e.g. "exit_code must be 0-255")
  - "level must be one of: debug, info, warn, error"
  - "if success is true, exit_code must be 0"
  - "files array must not be empty if total_files > 0"
related_artifacts:
  - other-artifact-id
  - another-artifact-id
---
```

---

## Example monster artifact: code-changes

```markdown
---
id: code-changes
name: Code Changes
format: json
category: cli
tags: [git, diff, files, code]
description: >
  Files changed by a coding agent during a task. Includes per-file
  action, line counts, and a unified diff preview. Produced after any
  agent that modifies files on disk.
author: mentiko
version: 1.0
schema:
  type: object
  properties:
    summary:
      type: string
      description: one-sentence description of what changed and why
    total_files:
      type: integer
      description: total number of files touched
      minimum: 0
    files_changed:
      type: array
      description: per-file change records
      items:
        type: object
        properties:
          path:
            type: string
            description: file path relative to repo root
          action:
            type: string
            enum: [added, modified, deleted, renamed]
            description: type of change
          lines_added:
            type: integer
            minimum: 0
          lines_removed:
            type: integer
            minimum: 0
        required: [path, action, lines_added, lines_removed]
    diff_preview:
      type: string
      description: unified diff of the first 100 changed lines
  required: [summary, total_files, files_changed, diff_preview]
validation_rules:
  - total_files must equal length of files_changed array
  - lines_added and lines_removed must be >= 0
  - action must be one of added, modified, deleted, renamed
  - path must be relative (no leading slash)
related_artifacts:
  - test-results
  - build-output
  - git-diff
---

```json
{
  "summary": "Refactored auth middleware to use JWT verification helper, removing 40 lines of duplicated decode logic",
  "total_files": 3,
  "files_changed": [
    {
      "path": "lib/middleware/auth.ts",
      "action": "modified",
      "lines_added": 12,
      "lines_removed": 47
    },
    {
      "path": "lib/jwt.ts",
      "action": "added",
      "lines_added": 38,
      "lines_removed": 0
    },
    {
      "path": "tests/middleware/auth.test.ts",
      "action": "modified",
      "lines_added": 24,
      "lines_removed": 8
    }
  ],
  "diff_preview": "diff --git a/lib/middleware/auth.ts b/lib/middleware/auth.ts\nindex 8f3a2c1..4d7e9b2 100644\n--- a/lib/middleware/auth.ts\n+++ b/lib/middleware/auth.ts\n@@ -1,52 +1,17 @@\n-import jwt from 'jsonwebtoken';\n-\n-export function authMiddleware(req, res, next) {\n-  const token = req.headers.authorization?.split(' ')[1];\n-  if (!token) return res.status(401).json({ error: 'No token' });\n-  try {\n-    const decoded = jwt.verify(token, process.env.JWT_SECRET);\n-    req.user = decoded;\n-    next();\n-  } catch (err) {\n-    return res.status(401).json({ error: 'Invalid token' });\n-  }\n-}\n+import { verifyJwt } from '../jwt';\n+\n+export function authMiddleware(req, res, next) {\n+  const result = verifyJwt(req.headers.authorization);\n+  if (!result.ok) return res.status(401).json({ error: result.error });\n+  req.user = result.payload;\n+  next();\n+}"
}
```
```

---

## Quality checklist

use this to evaluate any artifact definition:

  schema:
    ☑ schema field is present and is valid JSON Schema
    ☑ all top-level fields have type + description
    ☑ required array lists mandatory fields
    ☑ arrays have items with typed sub-fields
    ☑ enum used for constrained string fields

  validation_rules:
    ☑ at least 2 rules present
    ☑ rules are specific (not vague like "must be valid")
    ☑ rules cover cross-field constraints (if X then Y)
    ☑ rules cover range constraints (min/max, non-empty)

  related_artifacts:
    ☑ at least 1 related artifact listed (or [] if truly standalone)
    ☑ IDs match real artifact files

  body:
    ☑ no {PLACEHOLDER} variables — real-looking data
    ☑ realistic file paths, values, messages
    ☑ could be mistaken for actual agent output
    ☑ shows the complete structure, not just one field

  overall:
    ☑ format matches what the body shows (json body -> format: json)
    ☑ category reflects CLI/devops/analysis context accurately
    ☑ description tells you WHO produces it and WHEN
