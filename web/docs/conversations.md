# Conversations

AI session history across workspaces.

---

## Overview

The Conversations section provides a complete history of all AI sessions (Claude, Codex, Kollabor, Aider) across your workspaces. View past conversations, read message exchanges, inspect tool calls, and steer active sessions in real-time.

**Key capabilities:**
- Browse conversation history by project directory
- View full message transcripts with tool calls
- Rename conversations for easy identification
- Send messages to active sessions (steering)
- Resume completed conversations
- Filter by workspace/project path

---

## Conversation List

The left sidebar shows all conversations filtered by project directory.

**Sorting:**
Conversations are sorted by:
1. Last modified time (bucketed to hour)
2. Message count (descending)

**Status indicators:**
- Green dot - Active/live session
- Violet accent - Claude
- Sky blue accent - Codex
- Amber accent - Kollabor
- Rose accent - Aider

**Per-conversation details:**
- Slug (custom title, double-click to rename)
- First message preview
- Agent role badge
- Message count
- Last modified time (relative)

---

## Viewing Conversations

Click any conversation to open the detail panel.

### Message Types

The message viewer renders four types of messages:

**User messages:**
- Profile circle icon
- Timestamp
- Message text (truncated to 500 chars)

**Assistant messages:**
- CPU icon
- Timestamp
- Full response text

**Tool use calls:**
- Gear icon (amber)
- Tool name
- Tool input (formatted based on tool type)

**Tool results:**
- Gray background card
- Result text (capped at 2000 chars)
- Only shown when "Results" toggle is enabled

### Detail Panel Controls

**Results toggle** - Show/hide tool result messages

**Scroll toggle** - Enable auto-scroll to latest message

**Session composer** - Send messages to active sessions or resume completed ones

---

## Steering Active Sessions

Send messages to running AI sessions without leaving the Conversations page.

**Auto-detection:**
The SessionComposer automatically detects the target session based on:
- Conversation ID matching
- Slug matching
- Agent role matching

**To steer an active session:**

1. Select a conversation with a green "live" indicator
2. The composer shows "active session" status
3. Type your message and press Enter
4. Message is sent to the live PTY session immediately

**Example:**
```
You're running a chain with a Claude agent. The agent is stuck on a task.
Navigate to /conversations, find the session, and send:

"skip this step and move to the next agent"
```

---

## Resuming Completed Conversations

Resume completed conversations to continue work.

**Auto-resume workflow:**

1. Select a conversation (no live indicator)
2. The composer shows "no active session"
3. Type a message and submit
4. System spawns a new PTY session with `claude --resume [id]`
5. Your message is queued and sent once the session starts

**Example:**
```
You completed a coding session yesterday but want to continue.
Navigate to /conversations, find the session, and send:

"continue where we left off. what was the last task?"
```

---

## Searching and Filtering

Filter conversations by project directory.

**To search:**

1. Enter project path in the search input (defaults to current workspace)
2. Click **Search** or press Enter
3. Conversation list updates to show matching sessions

**Example paths:**
```
$MENTIKO_CODE_ROOT
~/projects/api-service
~/projects/client-website
```

---

## Renaming Conversations

Give conversations meaningful names for easier identification.

**To rename:**

1. Double-click the conversation slug in the sidebar
2. Edit the inline input field
3. Press Enter to save, Escape to cancel
4. Slug is updated in the conversation JSONL file

**Example:**
Rename `claude-abc123` to `fix-auth-bug` for quick reference.

---

## Examples

### Resume a Claude Coding Session

**Scenario:** You were debugging an auth issue yesterday. The session completed but you want to continue.

**Steps:**

1. Navigate to `/conversations`
2. Find the session (look for "auth" in the preview)
3. Double-click to rename it: `auth-fix-session`
4. Click to open the detail panel
5. In the SessionComposer, type:
   ```
   show me the current state of the auth flow. what's broken?
   ```
6. Submit - the system spawns a new PTY session with `claude --resume`
7. Continue working from where you left off

### Steer an Active Kollabor Session

**Scenario:** A Kollabor agent is running in a chain but going off-track.

**Steps:**

1. Navigate to `/conversations`
2. Find the live Kollabor session (green dot, amber accent)
3. Click to open the detail panel
4. Review recent messages to understand the context
5. In the SessionComposer, type:
   ```
   stop. you're overcomplicating this. just do X and Y.
   ```
6. Submit - the message is sent to the live session immediately
7. Watch the agent respond in real-time

---

## Technical Details

### Conversation Storage

Conversations are stored as JSONL files:
- Location: `~/.claude/projects/{encoded-cwd}/{id}.jsonl`
- Format: One JSON object per line
- Content: Messages with type, timestamp, content fields

### Message Structure

```json
{
  "type": "user" | "assistant" | "tool_use" | "tool_result",
  "timestamp": "2026-03-16T10:30:00Z",
  "message": {
    "content": "..." | [...]
  }
}
```

**Content formats:**
- String for simple text messages
- Array of content blocks for tool calls:
  - `{ type: "text", text: "..." }`
  - `{ type: "tool_use", name: "Read", input: {...}, id: "..." }`
  - `{ type: "tool_result", content: "...", id: "..." }`

### API Endpoints

**List conversations:**
```http
GET /api/conversations?cwd=/path/to/project&limit=50&countAll=true
```

**Get conversation messages:**
```http
GET /api/conversations/{id}?cwd=/path/to/project&mode=tail&tail=100
```

**Update conversation slug:**
```http
PUT /api/conversations/{id}?cwd=/path/to/project
Content-Type: application/json

{
  "slug": "new-title"
}
```

**Delete conversation:**
```http
DELETE /api/conversations/{id}?cwd=/path/to/project
```

**Steer/resume session:**
```http
POST /api/conversations/{id}/steer
Content-Type: application/json

{
  "message": "continue where we left off",
  "cwd": "/path/to/project"
}
```

---

## Troubleshooting

### Conversation not appearing

**Cause:** Wrong project directory in search filter

**Solution:**
1. Check the search input shows the correct workspace path
2. Click **Search** to refresh
3. Verify the conversation exists: `ls ~/.claude/projects/{encoded-cwd}/`

### Messages not loading

**Cause:** JSONL file corrupted or deleted

**Solution:**
1. Check file exists: `ls -la ~/.claude/projects/{encoded-cwd}/{id}.jsonl`
2. Verify file format: `head -5 ~/.claude/projects/{encoded-cwd}/{id}.jsonl`
3. If corrupted, restore from backup if available

### Steering not working

**Cause:** Session died or PTY manager not running

**Solution:**
1. Check session status: `./bin/p list`
2. If no live sessions, use resume instead
3. Verify PTY manager daemon: `ps aux | grep pty-manager`

### Rename not saving

**Cause:** File permissions or disk full

**Solution:**
1. Check write permissions: `ls -la ~/.claude/projects/{encoded-cwd}/`
2. Verify disk space: `df -h`
3. Check file not locked by another process

---

## Tips and Best Practices

**Rename early:**
Give conversations meaningful names right after creation for easy identification later.

**Use consistent slugs:**
Follow a naming convention like `feature-bug-fix` or `project-task-name` for easier searching.

**Check live status before steering:**
Look for the green "live" indicator. If not present, your message will trigger a resume instead.

**Review tool calls:**
Enable the "Results" toggle to see what tools the agent used and their outputs.

**Archive old conversations:**
Delete completed conversations you no longer need to keep the list manageable.

**Use search for large projects:**
If you have many conversations, filter by project directory to reduce clutter.

---

## Keyboard Shortcuts

When viewing a conversation:

- `Escape` - Cancel edit (when renaming)
- `Enter` - Save rename (when editing in input field)
- `Cmd/Ctrl + K` - Quick search (not yet implemented)

---

## Related Documentation

- [Runs](./runs.md) - Active chain execution monitoring
- [Workspace Settings](./settings/workspace.md) - Configure workspace paths
- [Session Composer](../components/ui/session-composer.tsx) - Component reference
