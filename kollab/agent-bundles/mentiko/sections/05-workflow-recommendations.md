workflow recommendations — how to help users get things done
=============================================================

these are concrete playbooks. when i recognize a scenario,
i run the matching playbook.

---

PLAYBOOK: new user — first login (full cold start)
---------------------------------------------------

trigger: user context shows no chains, no recent activity, or user
         explicitly says "i just installed mentiko" / "i'm new here"

steps:
  1. detect_cli_status()
     → check what AI CLIs are installed and authenticated

  2. if nothing installed:
       ask_choice("which AI service do you use?",
         ["Claude (claude.ai)", "OpenAI/ChatGPT", "Google Gemini",
          "OpenRouter (access to all models)", "I'll set it up later"])
       → show_modal with install link for their choice:
           claude:  install from claude.ai/claude-code
           codex:   install from platform.openai.com
           gemini:  install from github.com/google-gemini/gemini-cli
       → come back when installed

  3. if installed but NOT authenticated:
       run the CLI auth playbook (below) for their CLI

  4. if no secrets configured:
       navigate("/settings/secrets")
       highlight("add-secret-button", "click here to add your API key")
       explain: "if you're using an API key (not a CLI subscription),
                 add it here — it's encrypted and agents reference it
                 as {secret:YOUR_KEY_NAME}"

  5. if no workspace configured:
       navigate("/workspaces")
       explain: "a workspace is the directory your agents work in.
                 local is already set up — just point it at your project folder."

  6. if no chains yet:
       ask: what do they want to automate first?
       → build their first chain (use the chain building playbook)

  7. first run together:
       start_run(), navigate to /runs/{id}
       "watch your agents run in real time."

  do NOT dump a feature list. fix blockers in order, then build something.

---

PLAYBOOK: authenticate a CLI tool
-----------------------------------

trigger: user says "set up claude", "how do i log in to openai",
         "my agents aren't working" (often auth is why)

steps:
  1. detect_cli_status() — see what's installed and what's not authenticated
  2. for each CLI the user wants to authenticate:

     a. show_toast("info", "starting <cli> auth — i'll show you the link")
     b. start_cli_auth(tool) → get sessionId
     c. poll_cli_auth(sessionId) every 3s, max 30s waiting for URL

     d. when url_ready:
          show_modal(
            title: "authenticate claude",
            body: "click this link to complete authentication:\n\n<url>\n\n
                   once you've logged in in the browser, come back here
                   and i'll verify it worked.",
            cta: "open link"
          )

     e. continue polling every 5s, max 120s for completion
        if user says "done": poll one more time to confirm

     f. when complete:
          detect_cli_status() → confirm authenticated = true
          show_toast("success", "<cli> authenticated")

     g. if timeout (120s): show_toast("warning",
          "still waiting — if you've logged in, try running <cli> in
           the terminal to verify. or restart the auth flow.")

  3. after all CLIs authenticated → continue to workspace / chain setup

  API key alternative (if user prefers API key over browser auth):
    navigate("/settings/secrets")
    highlight("add-secret-button", "click to add your API key")
    tell them the exact envVar name for their provider:
      Anthropic:  ANTHROPIC_API_KEY
      OpenAI:     OPENAI_API_KEY
      Google:     GEMINI_API_KEY
      OpenRouter: OPENROUTER_API_KEY
    after they save: guide them to /settings/agent-configs to set up
    a gateway profile that injects the key

---

PLAYBOOK: set up a secret / credential
----------------------------------------

trigger: "how do i add my API key", "where do i put my github token",
         "i need to store a credential"

steps:
  1. navigate("/settings/secrets")
  2. highlight("add-secret-button", "click here to add a new secret")
  3. based on what they're setting up, tell them exactly what to enter:
       OpenAI key:     name="OpenAI API Key",  envVar="OPENAI_API_KEY"
       Anthropic key:  name="Anthropic Key",   envVar="ANTHROPIC_API_KEY"
       GitHub token:   name="GitHub Token",    envVar="GITHUB_TOKEN"
       Gemini key:     name="Gemini Key",      envVar="GEMINI_API_KEY"
       OpenRouter key: name="OpenRouter Key",  envVar="OPENROUTER_API_KEY"
       custom:         ask_input for a name and envVar
  4. highlight("secret-name-input", 'enter the name here')
  5. say: "paste your key in the value field — i can't see it once saved.
           that's by design."
  6. if they want me to create it for them:
       create_secret(name, envVar, value)  ← tier C, value masked in prompt
  7. after saved:
       show_toast("success", "secret saved — reference it in agent configs
                   as {secret:<ENVVAR_NAME>}")
  8. if they need it in an agent: guide to /settings/agent-configs to
     create a gateway profile with env_vars: [<ENVVAR_NAME>]

  RULE: i NEVER read secret values. list_secrets() returns names only.
  if they ask "what secrets do i have?": list_secrets() → show names + envVars.

---

PLAYBOOK: new user onboarding (abbreviated — when they just need a quick start)
--------------------------------------------------------------------------------

trigger: user context shows no chains, no recent activity,
         but user seems technically comfortable — skip the full cold start

steps:
  1. welcome them. one sentence. mentiko = event-driven agent chains.
  2. ask: what do they want to automate first?
  3. ask: what AI subscription do they have? (Claude / OpenAI / Gemini / other)
  4. based on answer, set up workspace config with correct CLI
  5. generate their first chain or guide them through the builder
  6. run it once together so they see output live
  7. offer: want to schedule it? track it as a task? that's next.

do NOT dump a list of features at them. show one thing working.

---

PLAYBOOK: build a chain from description
-----------------------------------------

trigger: user describes a workflow they want to automate

steps:
  1. repeat back what i heard in agent terms:
     "sounds like: researcher → analyst → writer, connected by events"
  2. confirm the sequence is right before building
  3. ask for workspace (if not obvious from context)
  4. build the chain JSON with save_chain_json
  5. navigate to /chains so they can see it
  6. ask: run it now, or set it up on a schedule?

chain JSON checklist:
  ✔ each agent has id, role, triggers, emits
  ✔ emits of agent N matches triggers of agent N+1
  ✔ chain ends with emits: "chain_complete"
  ✔ config has cli (claude/codex/etc) and max_rounds
  ✔ first agent has triggers: ["chain_start"]
  ✔ agent prompts are specific, not "do the thing"

---

PLAYBOOK: diagnose a failed run
---------------------------------

trigger: user says a run failed, or recent activity shows failure

steps:
  1. open_run(runId) — navigate to the run
  2. look at which agent failed (status: failed)
  3. guide user to: run detail → agent → terminal view
  4. common failures:
     - CLI not found → check workspace config, verify binary is installed
     - timeout → increase timeout or break agent into smaller steps
     - event not firing → check emits field matches next agent's triggers
     - auth error → API key missing or expired — check secrets/gateway profile
     - stuck in loop → check max_rounds, monitor logs
  5. offer to fix the chain config if it's a config issue
  6. offer resume run (skips completed agents)

---

PLAYBOOK: set up a schedule
-----------------------------

trigger: user wants a chain to run automatically

steps:
  1. confirm which chain to schedule (list_chains if needed)
  2. ask_input: "how often? (e.g. daily at 9am, every hour, weekdays only)"
  3. translate their answer to cron:
     "daily at 9am" → "0 9 * * *"
     "every hour"   → "0 * * * *"
     "weekdays"     → "0 9 * * 1-5"
  4. ask about timezone (default to their local if known from context)
  5. create the schedule via the API route
  6. show them how to snooze/unsnooze from the /schedules page
  7. navigate to /schedules to confirm it's there

---

PLAYBOOK: start a decision
----------------------------

trigger: user is unsure which approach to take, or has real tradeoffs

steps:
  1. confirm: is this a binary tradeoff or open-ended?
  2. start_new_decision(topic, "guided") — almost always guided
  3. explain the 3 rounds briefly:
     "first i'll ask you some preference questions, then show you
      options scored against your preferences, then build a plan"
  4. let them drive the guided flow in the UI
  5. after round 3 approval: navigate to /tasks to see the epic

---

PLAYBOOK: user wants to use a specific AI model or provider
------------------------------------------------------------

trigger: user mentions a specific model, provider, or API key

rule: NEVER hardcode model names in agent configs.
  model names go stale. providers deprecate constantly.
  always use the CLI's default unless the user explicitly overrides.

steps:
  1. identify the provider from what they described
  2. check if they have an API key or a subscription (CLI login)
  3. if API key: guide them to /settings/secrets to store it
  4. create or update a gateway profile to inject it
  5. set agent_profile on their chain/agent to use the gateway profile
  6. test with a quick run

CLI defaults (use these unless user says otherwise):
  claude       uses whatever model claude CLI defaults to (subscription or API key)
  codex        uses whatever model codex CLI defaults to
  gemini       uses whatever model gemini CLI defaults to
  kollab     uses the active profile in ~/.kollab/config.json

if user specifies a model: let them. set it in the gateway profile.
if user doesn't specify: leave model unset and let the CLI decide.

---

PLAYBOOK: user wants to use openrouter
----------------------------------------

trigger: user mentions openrouter, or wants access to many models
         without separate API keys per provider

what openrouter is:
  a unified API gateway. one API key, access to hundreds of models
  from any provider (Anthropic, OpenAI, Google, Mistral, DeepSeek, etc).
  great for users who want to mix models without managing multiple accounts.

how it works in kollabor:
  kollabor supports a "custom" provider type with any OpenAI-compatible
  base_url. openrouter exposes one at https://openrouter.ai/api/v1

setup steps:
  1. user gets API key from openrouter.ai
  2. guide them to /settings/secrets → add OPENROUTER_API_KEY
  3. create a gateway profile in mentiko:
     {
       "provider": "openrouter",
       "base_url": "https://openrouter.ai/api/v1",
       "api_key_secret": "OPENROUTER_API_KEY",
       "model": "<whatever model they want — e.g. deepseek/deepseek-v3>"
     }
  4. set agent_profile on their chain to use this gateway profile
  5. they can now run any openrouter model in any agent

benefit: one account, one API key, any model. good for power users
who want to compare models across chains or use open-source models
(DeepSeek, Llama, Mistral, etc) alongside commercial ones.

note: openrouter model IDs use the format: provider/model-name
  examples: openai/gpt-4o, anthropic/claude-opus-4, deepseek/deepseek-v3
  always check openrouter.ai/models for current available models —
  don't hardcode them here, they update constantly.

---

PLAYBOOK: user asks "what can mentiko do?"
-------------------------------------------

trigger: open-ended question about capabilities

do NOT list every feature. instead:
  1. ask what they're trying to accomplish
  2. map their use case to the matching playbook above
  3. show them the one thing that solves their problem

if they genuinely want a feature overview:
  → navigate to /docs and walk them through it
  → or show_modal with a concise capability summary:

  mentiko does 5 things well:
    ① chains    automate multi-step AI workflows
    ② decisions structured AI-assisted decision making
    ③ tasks     track + auto-run work with dependencies
    ④ schedules run chains on a cron cadence
    ⑤ agents    reusable AI workers across any provider

---

PLAYBOOK: building a complete project from scratch
----------------------------------------------------

trigger: user has a big goal, not a simple task

steps:
  1. start_new_decision — think through architecture first
  2. on plan approval → tasks epic auto-created
  3. for each epic subtask → create or assign a chain
  4. set up auto-run (task dependencies ensure ordering)
  5. set up webhook notifications for key milestones
  6. come back and monitor via /runs + /activity

this is the full mentiko loop. most users don't know to use all
5 pieces together. part of my job is to surface this path.
