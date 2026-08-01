# Agent Instructions

This project uses a native SQLite task store for issue tracking.
Tasks are managed via the web UI and REST API (web/lib/task-store.ts).

## Quick Reference

```bash
# list open tasks
curl -s http://localhost:3200/api/tasks?status=open | jq .

# view task details (includes dependencies + dependents)
curl -s http://localhost:3200/api/tasks/<id> | jq .

# create task
curl -s -X POST http://localhost:3200/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"Issue title","description":"Details","issue_type":"task","priority":2}'

# update task (claim, change priority, etc.)
curl -s -X PATCH http://localhost:3200/api/tasks/<id> \
  -H "Content-Type: application/json" \
  -d '{"assignee":"agent","status":"in_progress"}'

# close task
curl -s -X POST http://localhost:3200/api/tasks/<id>/close
```

## Non-Interactive Shell Commands

**ALWAYS use non-interactive flags** with file operations to avoid hanging on confirmation prompts.

Shell commands like `cp`, `mv`, and `rm` may be aliased to include `-i` (interactive) mode on some systems, causing the agent to hang indefinitely waiting for y/n input.

**Use these forms instead:**
```bash
# Force overwrite without prompting
cp -f source dest           # NOT: cp source dest
mv -f source dest           # NOT: mv source dest
rm -f file                  # NOT: rm file

# For recursive operations
rm -rf directory            # NOT: rm -r directory
cp -rf source dest          # NOT: cp -r source dest
```

**Other commands that may prompt:**
- `scp` - use `-o BatchMode=yes` for non-interactive
- `ssh` - use `-o BatchMode=yes` to fail instead of prompting
- `apt-get` - use `-y` flag
- `brew` - use `HOMEBREW_NO_AUTO_UPDATE=1` env var

## User-Facing Docs and Updates

Before changing the in-app `/docs` or `/updates` surfaces, read
`../.agents/skills/mentiko-user-docs/SKILL.md`. It separates product
documentation from internal repository notes and prevents engineering-only
release work from becoming a user-facing update card.

## Task Management

Tasks are stored in SQLite (web/lib/task-store.ts) with full CRUD, dependencies, and comments.

### Issue Types

- `bug` - Something broken
- `feature` - New functionality
- `task` - Work item (tests, docs, refactoring)
- `epic` - Large initiative with subtasks
- `chore` - Maintenance (dependencies, tooling)

### Priorities

- `0` - Critical (security, data loss, broken builds)
- `1` - High (major features, important bugs)
- `2` - Medium (default, nice-to-have)
- `3` - Low (polish, optimization)
- `4` - Backlog (future ideas)

### Dependencies

```bash
# add dependency (task A depends on task B)
curl -s -X POST http://localhost:3200/api/tasks/deps \
  -H "Content-Type: application/json" \
  -d '{"taskId":"task-A","dependsOn":"task-B"}'

# view dependencies
curl -s http://localhost:3200/api/tasks/<id>/deps | jq .
```

### Workflow for AI Agents

1. **Check open tasks**: `GET /api/tasks?status=open`
2. **Claim your task**: `PATCH /api/tasks/<id>` with `{"assignee":"agent","status":"in_progress"}`
3. **Work on it**: Implement, test, document
4. **Discover new work?** Create linked task via `POST /api/tasks`
5. **Complete**: `POST /api/tasks/<id>/close`

### Important Rules

- Use the task store API for ALL task tracking
- Do NOT create markdown TODO lists
- Do NOT use external issue trackers
- Do NOT duplicate tracking systems

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create tasks for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update task status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
