# User Guide

Complete guide to using the Agent Chain web interface.

---

## Getting Started

### Login

Sign in at `/login` with your user account (email/password or configured OAuth provider) to access the web UI.
On a fresh self-hosted install, start at `/signup` to create the first local account; that first user becomes the workspace owner.

![Login Screen](./images/login.png)

---

## Dashboard

The dashboard shows an overview of your chains, recent runs, and system stats.

![Dashboard](./images/dashboard.png)

**Sections:**
- **Quick Actions** - Create chain, browse templates, view runs
- **Active Chains** - Your configured chains with status
- **Recent Runs** - Latest executions with results
- **Stats** - Total chains, runs, success rate

---

## Chains

### Creating a New Chain

1. Click **Chains** -> **Create Chain** in the sidebar
2. Choose an example prompt or write your own:
   ```
   Create a research agent that searches for information,
   a writer agent that creates a blog post, and a reviewer
   agent that checks for quality. If review fails, go back to writer.
   ```
3. Configure options (optional):
   - **Workspace** - local, SSH, or Docker
   - **Webhooks** - Enable for HTTP callbacks
   - **Scheduler** - Set cron for automated runs
   - **Retry** - Configure retry behavior
4. Click **Generate Chain**
5. Review the generated chain:
   - **Visual Preview** - See agent flow diagram
   - **Edit JSON** - Modify directly
6. Click **Save Chain**

![Chain Creation](./images/chain-create.png)

### Understanding Chain Components

**Agents** are the building blocks:
- **id** - Unique identifier (e.g., `researcher`)
- **name** - Display name
- **role** - What the agent does
- **triggers** - Events that start this agent (e.g., `manual-start`, `research-complete`)
- **emits** - Event this agent produces when done (e.g., `draft-complete`)

**Config** settings:
- **cli** - Which CLI to use (`claude`, `codex`, `glm`, etc.)
- **monitor** - Enable performance monitoring
- **max_rounds** - How many times to loop through agents
- **on_complete** - What to do when done (`stop`, `notify`, `restart`)

### Editing a Chain

1. Go to **Chains** -> select your chain
2. Click **Edit** tab
3. Modify agents or config
4. Click **Save** (creates a new version automatically)

### Chain Versions

Every save creates a new version. View and restore:
1. Go to chain detail page
2. Click **Versions** tab
3. Compare versions or restore previous

---

## Running Chains

### Starting a Run

1. Go to **Chains** -> select your chain
2. Click **Run** button
3. Enter a goal/prompt:
   ```
   Research the latest developments in quantum computing
   and write a 500-word blog post for a general audience.
   ```
4. Toggle **Webhooks** if you want HTTP callbacks
5. Click **Start Chain**

### Monitoring Runs

The run page shows real-time progress:

![Run Monitor](./images/run-monitor.png)

**Tabs:**
- **Goal** - View/edit the current goal
- **Agents** - See each agent's status
  - Green = Running
  - Gray = Pending
  - Red = Error
- **Terminal** - Raw output from agent sessions
- **Events** - Timeline of all events
- **Metrics** - Performance data, token usage, timings

### Stopping a Run

Click the **Stop** button in the top-right during execution.

### Re-running

After completion, click **New Run** to start fresh with the same chain.

---

## Templates

### Browsing the Marketplace

1. Click **Templates** -> **Marketplace**
2. Filter by:
   - Search text
   - Category (development, business, research, etc.)
   - Tags (multi-agent, webhooks, parallel, etc.)
   - Source (examples vs templates)
   - Sort by (rating, name, agents used)

![Marketplace](./images/marketplace.png)

### Using a Template

1. Click on a template card
2. Review the template details and README
3. Click **Use** button
4. The template is copied to your chains

### Rating Templates

Click the stars on any template card to rate it 1-5.

### Available Template Categories

| Category | Description |
|----------|-------------|
| `general` | General purpose workflows |
| `development` | Code review, testing, CI/CD |
| `business` | Analysis, reporting, automation |
| `research` | Research, data gathering |
| `content` | Writing, editing, publishing |
| `automation` | Task automation, workflows |
| `data` | ETL, processing, analysis |

---

## Workspaces

### Local Workspace

Default option. Agents run in the current project directory.

### SSH Workspace

Run agents on a remote server:

**Configuration:**
- **Host** - server.example.com
- **User** - username
- **Path** - /path/to/project
- **Port** - 22 (default)

### Docker Workspace

Run agents inside a container:

**Configuration:**
- **Container** - container-name
- **Path** - /workspace

---

## Webhooks

Webhooks allow external systems to receive notifications about chain events.

### Enabling Webhooks

1. When creating/editing a chain, expand **Webhook Configuration**
2. Toggle **Enable Webhooks**
3. Enter your webhook URL:
   ```
   https://your-server.com/api/chain-events
   ```
4. Optional: Add a secret for signature verification
5. Select events to trigger on:
   - `chain:complete`
   - `chain:error`
   - `agent:complete`
   - `agent:error`

### Webhook Payload

```json
{
  "event": "chain:complete",
  "chainId": "my-chain",
  "runId": "run-123",
  "timestamp": "2025-02-25T10:00:00Z",
  "data": {
    "goal": "...",
    "duration": 323000,
    "status": "completed"
  }
}
```

---

## Scheduler

Automatically run chains on a schedule using cron syntax.

### Setting Up a Schedule

1. When creating a chain, expand **Scheduler Configuration**
2. Toggle **Enable Scheduler**
3. Enter cron expression:
   ```
   0 * * * *    # Every hour
   0 9 * * 1-5  # 9am weekdays
   */30 * * * * # Every 30 minutes
   ```
4. Set timezone (default: UTC)

### Cron Reference

```
* * * * *
│ │ │ │ │
│ │ │ │ └─── Day of week (0-7, Sunday = 0 or 7)
│ │ │ └───── Month (1-12)
│ │ └─────── Day of month (1-31)
│ └───────── Hour (0-23)
└─────────── Minute (0-59)
```

---

## Debugging

### Debug Mode

Run a chain with debug enabled for detailed logging:
1. Go to chain run page
2. Before starting, check your API call includes `"debug": true`
3. More detailed logs appear in terminal output

### Viewing Agent Sessions

1. During a run, go to **Terminal** tab
2. Select an agent session from the tabs
3. See raw conversation between user and agent

### Error Handling

If an agent fails:
1. The run status changes to `failed`
2. Error details appear in the agent card
3. Check the **Events** timeline for what went wrong
4. Review **Terminal** output for stack traces

---

## Tips and Best Practices

### Chain Design

1. **Start Simple** - Begin with 2-3 agents, add more as needed
2. **Clear Roles** - Each agent should have one clear responsibility
3. **Event Naming** - Use descriptive event names (`research-complete` not `done`)
4. **Review Loops** - Set `max_rounds` to prevent infinite loops
5. **Context Files** - Use `read_first` to give agents important files

### Prompt Writing

- Be specific about outputs
- Include format requirements
- Set length expectations
- Provide examples when helpful
- Define success criteria

### Performance

- Use `parallel` agents for independent tasks
- Set appropriate `timeout` values
- Enable `monitor` to track slow agents
- Consider token costs for long prompts

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Cmd/Ctrl + K` | Quick search |
| `Cmd/Ctrl + N` | New chain |
| `Cmd/Ctrl + /` | Command palette |

---

## Mobile Access

The interface is fully responsive. Use on mobile to:
- Monitor running chains
- View run results
- Check agent status
- Read notifications

---

## Notifications

The bell icon shows:
- Agent completions
- Errors
- Chain completions
- Webhook failures

Click to view full history.
