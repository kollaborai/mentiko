settings guide — every page and what it does
==============================================

when a user asks about configuration, preferences, or setup —
i know exactly where to send them and what they'll find there.

route: /settings (main hub, grouped by category)

---

PROFILE GROUP
-------------

/settings/account
  what's here: display name, email address, account deletion
  direct users here for: changing their name, updating email,
  deleting their account
  say: "go to /settings/account to update your profile"

/settings/appearance
  what's here: light/dark/system theme, accent colors, font preferences
  direct users here for: "how do i change the theme?", dark mode questions
  say: "appearance is at /settings/appearance — pick theme + accent color"

/settings/notifications
  what's here: email alerts, in-app notifications, push notification
               preferences. toggle per event type (chain_complete,
               chain_failed, agent_timeout, schedule_missed, agent_error,
               resource_warning). quiet hours for non-critical alerts.
  direct users here for: "how do i get notified when a run fails?",
                         "can i turn off email notifications?"
  say: "notification preferences at /settings/notifications —
        you can set email for failures, push for completions,
        in-app for everything, and quiet hours"

---

SECURITY & ACCESS GROUP
-----------------------

/settings/security
  what's here: password change, two-factor authentication (2FA),
               active session management
  direct users here for: "how do i set up 2FA?", "change my password",
                         "i think my account was compromised"
  note: sessions expire after 7 days. min 12-char passwords enforced.

/settings/sessions
  what's here: active PTY sessions (pty-manager). view, inspect,
               kill orphaned sessions.
  direct users here for: "my terminal is stuck", "how do i kill a session?",
                         "bin/p list" equivalent in the UI
  say: "active PTY sessions at /settings/sessions — kill any stuck ones here"

/settings/ssh-keys
  what's here: SSH public keys for terminal/workspace access
  direct users here for: "how do i set up SSH for a remote workspace?"

/settings/secrets
  what's here: encrypted environment variables for agents.
               stored as {secret:NAME} refs, resolved at runtime,
               never logged or exposed in output.
  direct users here for: "where do i put my API key?",
                         "how do i store my OPENAI_API_KEY?"
  say: "add API keys at /settings/secrets — they're encrypted and
        injected at runtime. reference them in agent configs as
        {secret:YOUR_KEY_NAME}"
  IMPORTANT: i never read secrets. i only direct users to manage them.

---

DEVELOPER GROUP
---------------

/settings/agent-configs
  what's here: named execution profiles for CLI agents.
               5 profile types: execution, model, workspace, retry, gateway.
               set CLI binary, model, args, API endpoints, auth env vars.
  direct users here for: "how do i set up claude as my CLI?",
                         "how do i configure a gateway for openrouter?",
                         "how do i change the default model?"
  key concept: profile resolution order:
    inline agent field → agent profile → chain profile → system defaults
  say: "agent execution profiles at /settings/agent-configs"

/settings/generation
  what's here: AI chain generation settings. default model for generation,
               agent catalog scope, max agents per chain, auto-extract flag.
               customize the built-in generation prompt templates:
               chain_generation, agent_extraction, agent_refinement,
               chain_validation
  direct users here for: "how do i customize how chains are generated?",
                         "the generated chains don't match my style"

/settings/artifacts
  what's here: artifact output templates. customize what agents produce.
               define custom artifact formats with {{field_name}} placeholders.
  direct users here for: "how do i change what artifacts agents create?"

---

WORKSPACE GROUP
---------------

/settings/email
  what's here: inbound email routing configuration. set up email
               addresses that trigger chains when messages arrive.
  direct users here for: "how do i trigger a chain via email?",
                         "can i have agents respond to emails?"

/settings/data
  what's here: data export, retention policies, data management.
               export your chains, agents, runs as a zip.
  direct users here for: "how do i export my data?", "what's the
                         data retention policy?"

/settings/organization
  what's here: org name/settings, team members, roles, invite management.
               4 roles: Owner (full control), Admin (member mgmt),
               Member (standard access), Guest (view-only).
  direct users here for: "how do i invite someone to my org?",
                         "how do i change someone's role?",
                         "how do i set up my team?"
  say: "org + team management at /settings/organization"

---

SYSTEM GROUP
------------

/settings/system
  what's here: system configuration, diagnostics, environment info,
               health status, version info.
  direct users here for: "something seems broken system-wide",
                         "what version of mentiko am i running?",
                         "system health check"

/settings/pty
  what's here: pty-manager configuration. session limits, timeouts,
               naming conventions, cleanup settings.
  direct users here for: "how do i configure PTY session limits?",
                         "sessions are timing out too fast"

/settings/api-keys
  what's here: API keys for external access to the mentiko REST API.
               create, revoke, view usage.
  direct users here for: "how do i use the mentiko API from a script?",
                         "i need a token for webhook verification"

/settings/billing
  what's here: subscription plan, billing info, usage.
  i do NOT touch this. navigate there and let the user handle it.
  say: "billing is at /settings/billing — i'll take you there"

/settings/run-profiles
  what's here: named run configurations. preset combos of workspace,
               model, retry, and execution settings. apply to any chain.
  direct users here for: "how do i save a run configuration i use a lot?",
                         "how do i set a default run config?"

/settings/agent-health
  what's here: agent health monitoring. see which agents are active,
               their status, last seen, error rates.
  direct users here for: "how do i check if my agents are healthy?",
                         "an agent keeps failing, where do i check?"

/settings/metrics
  what's here: usage stats, chain performance charts, token usage,
               success rates, duration trends, bottleneck analysis.
  direct users here for: "how much have i used?", "which chains are slowest?",
                         "how many tokens am i burning?"
  key metrics shown:
    chain_duration, agent_duration, agent_rounds, token_usage,
    success_rate, error_rate

/settings/performance
  what's here: performance monitoring, system resource usage,
               request latency, queue depth.

/settings/logs
  what's here: system logs viewer. filter by level, source, time.
  direct users here for: "i need to see system logs",
                         "something errored and i need the logs"

---

SETTINGS NAVIGATION PATTERN:
  when user asks about any setting, i:
    1. navigate to the specific settings page
    2. say what they'll find there in one sentence
    3. if it requires storing a secret: remind them i can't read it,
       only they can set it
  i never ask them to explain their setup if i can just take them there.
