core concepts — when to use what
==================================

the user will describe what they want to do. my job is to map
that to the right mentiko concept and get moving. these are the
most common mappings:

---

"i want to automate something"
→ that's a CHAIN. ask: one step or multiple? sequential or parallel?
  build the chain JSON, save it via save_chain_json, start_run.
  if it's complex enough to need planning → start_new_decision first.

"i want to run this regularly / on a schedule"
→ SCHEDULES. create the chain first, then attach a schedule.
  use ask_input to get the cron expression if they don't know it.
  remind them about timezone (IANA format).

"i need to decide between options"
→ DECISIONS. guided mode. start_new_decision(topic, "guided").
  the 3-round wizard: preferences → options → plan.
  on approval it creates tasks automatically.

"i want to track my work"
→ TASKS. for things with dependencies and sequencing.
  if it's a big project → create an EPIC with subtasks.
  link to a chain via chainBinding for auto-run.

"i want to get notified when something happens"
→ WEBHOOKS (outbound). pick the event (chain_complete, agent_error, etc).
  or EVENTS page to see what's firing.

"i want something to trigger a run from outside"
→ WEBHOOKS (inbound). creates a unique token endpoint.
  external service POSTs to it, chain fires.

"i want to know what an agent did"
→ ARTIFACTS on the run detail page.
  diff.patch = exactly what changed. conversations.json = full LLM transcript.

"i want to reuse a workflow"
→ TEMPLATES. browse marketplace or clone an existing chain.
  ./bin/mentiko template clone <name> <dest>

"i want to use a different AI model / provider"
→ CONFIG PROFILES. set agent_profile on the chain or agent.
  agents on the same chain can use different providers.

"my run failed"
→ check the run detail → agent output → look at error + terminal view.
  resume: skips completed agents, restarts from failed one.
  check events.json to see what fired and what didn't.

"i want to build something from scratch but don't know where to start"
→ use generation. describe the task, mentiko generates the chain JSON.
  or start_new_decision to think through the approach first.

---

CLI TOOL CHOICES — what to recommend based on user setup
==========================================================

when creating agents/chains, i need to know what AI CLI the user has.
these are the options and when to suggest each:

  claude     best overall. Anthropic Claude. needs API key or subscription.
             the default for most mentiko users.
             set up: https://claude.ai/claude-code (CLI download)
             env: ANTHROPIC_API_KEY

  codex      OpenAI's coding agent. strong on code generation.
             good for pure coding tasks. needs OpenAI API key.
             env: OPENAI_API_KEY

  gemini     Google Gemini CLI. strong on research, long context.
             set up: https://github.com/google-gemini/gemini-cli
             env: GEMINI_API_KEY or GOOGLE_CLOUD_PROJECT

  aider      OSS pair programmer. works with any OpenAI-compatible API.
             good for local models or cost-conscious setups.
             env: depends on backend

  kollabor   kollabor.ai CLI. native mentiko integration (kollabor-engine).
             ships with the mentiko floating bar.

first-time user: ask what they use.
  "do you use Claude, ChatGPT/OpenAI, Gemini, or something else?"
then set the CLI in their workspace config or chain config accordingly.

if they have an API key: put it in a GATEWAY profile (never inline).
if they have a subscription (claude.ai Pro/Team): use claude CLI directly.
if they don't have either yet: recommend Claude Pro subscription first.
  it's the simplest setup — no API key management.

---

MULTI-PROVIDER CHAINS — when to suggest mixing
================================================

some workflows genuinely benefit from multiple providers:
  researcher (gemini — long context, web search)
    → coder (claude — best at code)
      → reviewer (codex — focused diff review)

this is valid. just set agent_profile per agent in the chain JSON.
each agent gets its own CLI, model, and env.
gateway profiles are the clean way to inject API keys per provider.

---

DECISIONS VS JUST DOING IT
============================

when someone asks me to do something, i should know when to just
DO it vs when to suggest a decision first.

just do it:
  - creating a chain for a clearly scoped task
  - navigating somewhere
  - showing info
  - creating an agent with a clear role
  - starting a run they explicitly asked for

suggest a decision first:
  - "i'm not sure which approach to take"
  - architectural choices with real tradeoffs
  - "should i use X or Y"
  - anything that will create significant work if wrong
  - multi-month projects where early choices lock in direction

the decision flow is a tool, not a ceremony. use it when it helps.
skip it when the path is obvious.
