# User Guide

Complete guide to using the Agent Chain web interface.

---

## Getting Started

### Login

Sign in at `/login` with your user account (email/password or configured OAuth provider) to access the web UI.
On a fresh self-hosted install, start at `/signup` to create the first local account; that first user becomes the workspace owner.

![Login Screen](./images/login.png)

### Floating bar setting

The Mentiko assistant bar can be enabled or hidden from **Settings -> Mentiko Agent**.
This control is authenticated-only. The saved preference is kept in the browser
under the active install-and-user scope, so anonymous runtime state and two
authenticated users do not inherit each other's enabled, YOLO, or first-run
choice values. A missing enabled key defaults to on; unreadable or malformed
storage fails closed and shows a Retry action.

YOLO mode is on by default in a scope with no saved YOLO preference. It lets
the assistant run tools without asking for approval each time. A new scope skips
the first-message mode-choice prompt; turn YOLO off here if you want approval
before each tool run. That explicit opt-out is saved in the active scope and
stays off after reload. A different authenticated scope does not inherit it.

The deployment setting `NEXT_PUBLIC_KOLLABOR_BAR=0` remains authoritative. When
it is off, the settings card stays visible but the switch is disabled and says
that the deployment has disabled the bar; the saved preference is retained for
when the deployment enables it again. The dashboard opener and UI-control grant
surface are unavailable while either the deployment or user setting is off.

You can adjust the wide-screen bar width in the same settings page. The value
is saved under the active preference scope, accepts `240` through `720` CSS
pixels, and remains responsive on narrow viewports by clamping to
`100vw - 2rem`. Deployment operators can seed the default with
`NEXT_PUBLIC_KOLLABOR_BAR_WIDTH`; a saved user value takes precedence.

The **Chat backdrop and shape** card groups its controls into **Backdrop** and
**Chat surface** accordions, both collapsed by default. Expand **Backdrop** to
control visibility, blur, dimness, horizontal and vertical reach, and edge
softness. Expand **Chat surface** to tune transcript height, corner radius, and
shadow strength. These values are scoped like the enablement preference and
apply live. Turning the backdrop off is useful when the page behind the chat
must remain fully readable.

The same card includes three appearance presets: **Minimal** keeps the page
clear with a light chat surface, **Balanced** restores the default look, and
**Focused** increases the backdrop and gives the transcript more room. Presets
change appearance only; floating-bar width remains an independent setting.

Hiding the bar stops local streaming, prompts, MCP effects, reconnect timers,
and new engine work. It does not delete the transcript or stored session id.
Existing external UI-control grants are suspended locally, not revoked; an
unexpired grant may resume when the same session is re-enabled. A pending or
unconfirmed stop keeps session reuse blocked and can prevent the bar from
restarting. The setting offers **Retry stopping** only when it has a safe retry
path; an unidentified in-flight session cannot be resolved safely from the
browser, so it remains blocked until its state can be confirmed. Closing the
browser or logging out while offline cannot guarantee delivery of a stop
request.

Settings opened inside an embedded panel synchronizes through the top-level
document and waits for an acknowledgement. A standalone `?surface=panel`
document mounts no bar runtime. Separate browser tabs are intentionally
refresh-consistent rather than live-synchronized; refresh loads the current
stored preference. Cancellation may still affect another tab sharing the same
engine session.

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
