peer-manager flow
=================

setup
-----
- spawn 2 PTY sessions (debbie, max)
- each gets its own shell (zsh), own env file, own claude CLI
- BETTER_AUTH_SECRET loaded from web/.env.local for secret decryption
- manager process sits in the middle, invisible to both


session architecture
--------------------

  debbie (session 1)          manager (invisible)         max (session 2)
  project manager             relay + cleanup             UX/UI expert
       |                           |                          |
       |<-- prompt1 --------------|                          |
       |                           |                          |
       |--- responds ------------->|                          |
       |                           |--- debbie's response --->|
       |                           |                          |
       |                           |<--- max responds --------|
       |<-- max's response --------|                          |
       |                           |                          |
       |--- responds ------------->|                          |
       |                           |--- debbie's response --->|
       |                           |                          |
       (ping-pong continues until both say DONE)


what each agent sees
--------------------

debbie's session:
  1. claude CLI boots
  2. receives prompt1 (looks like a human typed it)
  3. she responds
  4. receives max's cleaned response (looks like a human typed it)
  5. she responds again
  6. repeat

max's session:
  1. claude CLI boots
  2. option A: receives prompt2 (separate starting context)
  3. option B: receives nothing until debbie's first response arrives
  4. he responds
  5. receives debbie's cleaned response
  6. repeat


prompt options
--------------

CURRENT (two prompts):

  prompt1 (sent to debbie):
    "So I've been looking at the onboarding flow and honestly it
    needs a lot of work. When new users sign up they're just dropped
    into the app with no guidance. I want to redesign the whole
    welcome experience. What do you think the ideal first-time
    experience should look like? I'm thinking workspace setup,
    understanding chains and agents, getting to that first aha
    moment. What are your thoughts?"

  prompt2 (sent to max):
    "Yeah I've actually been thinking about this too. The current
    /welcome page is pretty bare bones. I have some ideas about
    progressive disclosure and guided setup flows. Let me think
    about the user journey from signup to first successful chain
    run. What specific pain points have you been hearing from users?"

  problem: prompt2 is weird. max gets a message that sounds like
  someone already talking to him, but nobody has. and debbie's
  response hasn't reached him yet.


OPTION A: two independent prompts (give both context separately)

  prompt1 (sent to debbie):
    "I've been looking at the onboarding flow for mentiko and it
    needs a redesign. New users get dropped into the app with no
    guidance after signup. What should the ideal first-time
    experience look like? Think about workspace setup, understanding
    chains and agents, and getting to a first successful chain run."

  prompt2 (sent to max):
    "I need your help thinking through the onboarding redesign for
    mentiko. The current /welcome page is bare bones. New users
    don't understand workspaces, chains, or agents. What would a
    great first-time user experience look like to get them
    productive fast?"

  flow:
    1. send prompt1 to debbie, prompt2 to max (parallel)
    2. wait for debbie to respond
    3. capture + clean debbie's response
    4. send to max (he already has context from prompt2)
    5. wait for max to respond
    6. capture + clean, send to debbie
    7. ping-pong

  pro: both agents start thinking about the problem immediately
  con: they might repeat each other's points in round 1


OPTION B: single prompt, debbie leads

  prompt1 (sent to debbie only):
    "I've been looking at the onboarding flow for mentiko and it
    needs a redesign. New users get dropped into the app with no
    guidance after signup. What should the ideal first-time
    experience look like? Think about workspace setup, understanding
    chains and agents, and getting to a first successful chain run."

  prompt2: NONE (max gets nothing until debbie responds)

  flow:
    1. send prompt1 to debbie
    2. wait for debbie to respond
    3. capture + clean debbie's response
    4. send debbie's response to max (his FIRST input)
    5. max responds to what debbie said
    6. capture + clean, send to debbie
    7. ping-pong

  pro: conversation is natural from the start -- max's first
       message IS a response to debbie. no awkward parallel start.
  con: max sits idle during debbie's first turn


OPTION C: manager frames it as a meeting

  prompt1 (sent to debbie):
    "We need to redesign the onboarding flow for mentiko. The
    current /welcome page is bare bones -- new users get dropped
    in with no guidance. I want to think through what the ideal
    first-time experience should look like. Workspace setup,
    understanding chains and agents, getting to that first aha
    moment. Let me know your initial thoughts and then we can
    go back and forth on it."

  prompt2 (sent to max, after debbie responds):
    [debbie's cleaned response]

  same as option B but prompt1 is framed as collaborative.
  "let me know your thoughts and then we can go back and forth"
  sets the expectation that there will be a conversation.


cleanup (haiku relay)
---------------------

the manager captures raw terminal output and sends it through
haiku to:
  1. strip terminal UI (status bars, token counts, escape codes)
  2. extract ONLY the most recent response
  3. rewrite to first person (no "peer 1 said")
  4. detect status: DONE / CONTINUE / ESCALATE

the cleaned message is what gets sent to the other session.
neither agent ever sees terminal artifacts from the other.


escalation
----------

triggers:
  - STATUS:ESCALATE (agents arguing in circles)
  - 5 consecutive CONTINUEs with no progress (stall)
  - max rounds hit

action:
  - POST to /api/links/runs/{runId}/escalate (formerly /api/swarm/{session}/escalate, now deprecated)
  - sends to telegram webhook
  - blocks until human replies via reply.txt file
  - injects human guidance into both sessions


bugs fixed this session
-----------------------

1. shared env file: build_profile_command called once, reused
   for both peers. peer-1 deletes the temp file, peer-2 fails.
   fix: call build_profile_command twice.

2. bash instead of zsh: sessions spawned with explicit "bash"
   which doesn't have user's PATH or aliases.
   fix: spawn with default shell (no command arg).

3. BETTER_AUTH_SECRET not available: secrets-resolve.mjs can't
   decrypt vault secrets without this env var. bash scripts
   don't have it. fix: load from web/.env.local.

4. CLI boot timing: wait_for_cli returned too early (detected
   first screen change but input prompt wasn't ready yet).
   fix: after detecting change, wait_for_stable before sending.
