DECISION FLOW CRITIQUE
=======================
date: 2026-03-16
reviewer: opus
inputs: IA spec, product vision, UX research, decision-types.ts,
        decision-detail.tsx
verdict: ambitious design with real product insight, but several
         structural flaws that will bite hard during implementation
         and harder during adoption.


1. EDGE CASES
==============

1.1  zero or one option

the spec assumes 3-5 options everywhere. but:
  - what if the AI generates only 1 option in round 2?
    the "tinder mode" metaphor collapses. you can't compare 1 thing.
  - what if it generates 0? (AI failure, bad context, too narrow
    preferences from round 1)
  - the current Option type has no minimum count validation.
  - TailoredOption[] is an unbounded array. the spec says "exactly 4"
    but there's no enforcement in the type system or API contract.

mitigation:
  - enforce minimum 2, maximum 6 in the API response validation
  - if AI returns < 2 options, fall back to classic mode with a
    message: "not enough distinct options for guided flow"
  - if AI returns > 6, take top 6 by matchScore
  - add a Zod schema or runtime validator at the API boundary


1.2  contradictory round 1 answers

example: user picks "stability > speed" on Q1 but then picks
"ship this week > ship it right" on Q3. these directly contradict.
the preference profile will be incoherent and round 2 options
will be a mess.

the spec doesn't address contradiction detection at all.

mitigation:
  - AI prompt for preference profile generation MUST include
    contradiction handling: "if preferences conflict, note the
    tension and weight the later answer higher (recency bias)"
  - OR: detect contradictions in the UI and surface them:
    "you said stability matters most but also want to ship fast.
    which is the real priority?" (add a tiebreaker question)
  - don't silently produce garbage options from garbage preferences


1.3  changing round 1 after seeing round 2

the spec says "going back does NOT erase forward progress" and
"round 2 options regenerate only if round 1 answers changed."

this creates a dangerous state:
  - user completes round 1, gets round 2 options
  - goes back, changes 2 answers in round 1
  - round 2 now needs regeneration (another AI call, 10-30s wait)
  - but the user already saw old options and formed opinions
  - the new options might be completely different
  - their mental model is now corrupted

mitigation:
  - when going back to round 1 after round 2 is generated,
    show a clear warning: "changing preferences will regenerate
    your options. your current options will be replaced."
  - consider keeping old options visible as "previous options"
    so the user can see what changed
  - or: don't allow going back to round 1 after round 2 starts.
    instead offer "start over" as the only backward path.
    simpler state machine, clearer mental model.


1.4  very long text in cards

tradeoff cards have "1-2 line description" per the spec.
but AI-generated text is unpredictable. what happens when:
  - option name is 80 characters?
  - description is 4 sentences?
  - pros list has 12 items?

the current Option type has no max lengths. AI will happily
generate walls of text.

mitigation:
  - truncate with "..." in the card view, full text on expand
  - add max character counts to the AI generation prompt:
    name: 50 chars, description: 150 chars, pros/cons: max 6 each
  - validate at the API boundary, not the UI
  - for round 1 questions: label max 30 chars, description max 80


1.5  plan generation failure or timeout

round 3 creates an ExecutionPlan with tasks and dependencies.
this is the most complex AI generation in the flow.

what if:
  - the plan takes 60+ seconds? (user already waited for round 1
    and round 2 generations. patience is gone by round 3)
  - the plan has circular dependencies?
  - the plan creates 40 tasks for a simple decision?
  - task creation fails partway through?
    (partial task creation = broken dependency tree)

mitigation:
  - cap plan at 15 tasks max in the AI prompt
  - validate dependency graph for cycles before showing to user
  - task creation must be transactional: all or nothing.
    generate all task store inserts, validate, then execute.
    if any fails, roll back all.
  - show estimated wait time based on previous generation times
  - consider streaming the plan as it generates rather than
    blocking until complete


1.6  simple yes/no decisions forced through 3 rounds

not every decision needs a wizard. "should we upgrade node 18
to 20?" is a yes/no. forcing the user through 5-8 binary questions
and 4 generated options and a task tree is absurd.

the spec has skipRound1 and skipRound3 in the reusable skill API
but doesn't specify how the decision system uses these. there's
no "complexity detection" to auto-route simple decisions.

mitigation:
  - add a complexity score to the research output (simple/moderate/complex)
  - simple decisions (1-2 options, low blast radius): skip straight
    to dashboard mode with approve/reject
  - moderate decisions: skip round 1, go straight to round 2
  - complex decisions: full 3-round flow
  - let the user override: "I want the full flow" button on simple
    decisions, "skip to dashboard" on complex ones


2. UX PROBLEMS
===============

2.1  tinder metaphor in enterprise context

calling it "tinder mode" in the spec is fine. calling it that
in the UI would be a career-ending move for whoever pitches
this to an enterprise buyer.

more importantly: tinder works because the items are visually
rich (photos) and the stakes are low (swipe again). technical
tradeoffs are:
  - text-heavy (not visual)
  - high-stakes (wrong choice = wasted sprint)
  - nuanced (not binary)

the swipe gesture itself is fine. the metaphor is wrong.

mitigation:
  - never use "tinder" in user-facing copy. call it
    "quick preference quiz" or "tradeoff explorer"
  - the UI pattern (binary cards, one at a time) is actually
    good. just don't tie it to dating app branding.
  - consider adding a confidence slider instead of pure binary:
    "lean A / strongly A / lean B / strongly B"
    (this addresses point 2.3 below too)


2.2  power user friction

the spec acknowledges this: "slower for power users who want to
jump around." the escape hatch is [skip to dashboard].

but the DEFAULT experience for new decisions is guided mode.
a user who has made 50 decisions and knows the system will be
annoyed by being put through a wizard every time.

mitigation:
  - add a user preference: "default new decisions to guided/classic"
  - if user has skipped guided mode 3+ times, auto-default to classic
  - keyboard shortcut 'd' to instantly switch to dashboard on any
    new decision
  - never force the wizard. it should feel like an optional helper,
    not a gate.


2.3  binary choices create false dichotomies

"speed vs stability" is not binary. real engineering tradeoffs
are spectrums. the question framing forces artificial extremes.

"which matters MORE" is a relative question, but the UI presents
it as absolute. user thinks "both matter" and gets frustrated
with the forced choice.

the spec has a "skip" option, but skipping isn't the same as
"both" or "it depends."

mitigation:
  - add a 5-point scale instead of binary:
    strongly A / lean A / equal / lean B / strongly B
  - the weight field in TradeoffQuestion already exists (0-1).
    use the user's position on the scale as the weight.
  - keep the simple card UI but add a slider or 5 buttons
    instead of just two cards + skip.
  - this gives much richer preference data for round 2.

counterargument: the whole point of binary is reduced cognitive
load. a 5-point scale reintroduces analysis paralysis.

resolution: offer binary as default with a "more nuance" toggle
that reveals the 5-point scale. power users toggle it once,
it remembers their preference.


2.4  bad AI-generated preference questions

the entire round 1 depends on AI generating good binary
questions. if the questions are:
  - too abstract ("innovation vs tradition")
  - too similar ("fast delivery vs quick shipping")
  - irrelevant to the actual decision
  - confusingly worded

then round 1 is useless and round 2 options will be random.

the spec has no quality gate on generated questions.

mitigation:
  - add a "these questions don't make sense" button
  - clicking it triggers regeneration with modified prompt:
    "the previous questions were too abstract/similar/irrelevant.
    generate questions closer to the specific technical tradeoffs."
  - include 2-3 example question sets in the AI prompt as
    few-shot examples of good questions
  - post-generation validation: check no two questions share
    >70% of the same words (catch duplicates)


2.5  non-technical stakeholders

the spec mentions "stakeholder briefings" (section 5) but the
round 1 questions are deeply technical ("backward compatible
vs fresh start"). a PM or CEO going through round 1 will be
lost.

mitigation:
  - AI question generation should take a "role" parameter:
    technical, product, executive
  - executive questions: "cost vs speed", "risk vs reward",
    "invest now vs defer"
  - technical questions: "migration strategy", "architecture pattern"
  - product questions: "user impact", "feature scope"
  - the multi-stakeholder voting feature (listed as future in
    the vision doc) should have per-role question sets


3. TECHNICAL RISKS
===================

3.1  3 AI round-trips = cumulative latency

realistic timing:
  round 1 question generation:  10-30 seconds
  round 1 profile generation:   5-10 seconds
  round 2 option generation:    15-30 seconds
  round 3 plan generation:      15-45 seconds

total AI wait time: 45-115 seconds across the flow.
plus the initial research job: 15-30 seconds.

total: 60-145 seconds of waiting for a single decision.

that is painful. the user came here to make a decision, not
watch spinners.

mitigation:
  - pipeline the generations: start round 2 generation as soon
    as round 1 is 80% complete (predict likely preferences from
    partial answers)
  - cache round 1 questions per decision category. if this is
    an "architecture" decision, reuse the same question template
    with minor customization. (eliminates one AI call entirely)
  - use streaming for round 2/3 generation so the user sees
    options/tasks appearing incrementally
  - show useful content during waits: "while we generate your
    options, here's what we know so far..." (show research summary)


3.2  API token cost per decision

each AI call is a separate LLM invocation. rough cost estimate
(claude sonnet, ~$3/1M input, ~$15/1M output):

  research:           ~2K input, ~1K output = ~$0.02
  round 1 questions:  ~3K input, ~500 output = ~$0.02
  round 1 profile:    ~2K input, ~300 output = ~$0.01
  round 2 options:    ~4K input, ~2K output = ~$0.04
  round 3 plan:       ~5K input, ~2K output = ~$0.05
  custom mix (if used): ~4K input, ~1K output = ~$0.03

total per decision: ~$0.14-0.17 (guided flow)
vs current: ~$0.02 (research only)

that's a 7-8x cost increase per decision. for a team making
20 decisions/week, that's ~$3/week vs ~$0.40/week. not a
crisis, but also not nothing at scale.

if users regenerate options or redo rounds: multiply by 1.5-2x.

mitigation:
  - cache aggressively. same decision context + same preferences
    should return cached options, not re-generate.
  - use cheaper models for round 1 (preference questions don't
    need sonnet-level intelligence, haiku is fine)
  - rate limit: max 3 regenerations per round per decision
  - show token cost in settings for transparency


3.3  AI pipeline down = total feature loss

the guided flow is 100% dependent on AI generation at every step.
if the AI pipeline is down (API key expired, rate limit, network):
  - round 1 can't generate questions
  - round 2 can't generate options
  - round 3 can't generate plan

there is no manual fallback in the guided flow.

mitigation:
  - if AI is unavailable, auto-switch to classic mode
  - surface clear error: "AI generation unavailable. switched to
    manual mode. you can create options and plans directly."
  - classic mode should allow manual option creation (it doesn't
    currently - options are always AI-generated)
  - add a "manual option" form: name, description, pros, cons,
    effort, risk. no AI needed.


3.4  state management complexity

the GuidedFlow interface has 3 nested state objects, each with
their own status field, plus arrays of questions, answers, options,
tasks, and dependencies.

state transitions:
  round 1: pending -> in_progress -> complete
  round 2: pending -> generating -> ready -> complete
  round 3: pending -> generating -> ready -> complete

that's a 3-dimensional state machine. each round can go
backward. the user can switch to classic mode and back.
progress persists across sessions.

this will be a bug farm. state corruption scenarios:
  - user is in round 2, refreshes page, round 1 data is there
    but round 2 is in "generating" (job died)
  - user starts guided flow, switches to classic, approves there.
    guidedFlow state is now orphaned (complete but unused)
  - two browser tabs open on same decision, both in round 1.
    one submits answer, the other is stale.

mitigation:
  - add a state machine validator that runs on every decision load.
    if state is inconsistent, repair it (e.g., "generating" with
    no active job -> reset to "pending")
  - use optimistic locking on the decision JSON (version counter).
    PATCH fails if version doesn't match.
  - keep the guided flow state as flat as possible. don't nest
    3 levels deep. consider a single array of "steps" with a
    currentStep index.


3.5  backward compatibility

the spec says:
  "decisions without guidedFlow field render in classic mode"

this is correct but incomplete. what about:
  - decisions created mid-migration? (new code, old data format)
  - decisions where guidedFlow exists but is partially complete?
    (user upgraded, started guided flow, then downgraded)
  - the mode field is optional. what's the default if undefined?
    spec says "guided" for new, "classic" for old. but how does
    the code distinguish "new" from "old" if mode is undefined?

mitigation:
  - mode should default based on presence of guidedFlow field:
    if guidedFlow exists -> "guided"
    if guidedFlow doesn't exist -> "classic"
  - don't rely on the mode field alone. derive it.
  - add a migration script that sets mode: "classic" on all
    existing decisions (one-time, run during deploy)


4. MISSING PIECES
==================

4.1  data migration

the spec mentions backward compatibility but no migration path.
existing decisions have: options[], recommendation, context.
new decisions add: guidedFlow, mode.

questions:
  - do we need to backfill existing decisions? (no, spec says classic)
  - what about decisions currently in "pending" status? they'll
    suddenly get a guided flow button. is that confusing?
  - the guidedFlow field adds significant JSON size. for decisions
    with 9 questions, 4 options, and 8 tasks, the JSON could be
    5-10KB per decision. filesystem storage handles this fine but
    it's worth noting.

mitigation:
  - migration script: set mode: "classic" on all existing decisions
  - don't show the "guided" button on existing pending decisions
    unless the user explicitly opts in
  - document the JSON size increase in the spec


4.2  analytics

the spec doesn't mention any analytics. how do you know if
the guided flow is working?

you need to track:
  - guided flow completion rate (what % finish all 3 rounds?)
  - round 1 drop-off (which question do people abandon at?)
  - round 2 selection pattern (do people always pick the top match?)
  - classic mode switch rate (how many bail to dashboard?)
  - time-to-decision (guided vs classic)
  - decision quality (retro scores for guided vs classic)
  - question skip rate (are binary choices too forced?)
  - regeneration rate (how often do people redo a round?)

mitigation:
  - add timestamps to every state transition in guidedFlow
  - add a decisionAnalytics field or separate analytics table
  - track: flowStarted, flowCompleted, flowAbandoned,
    classicSwitchCount, roundRedoCount, timePerRound


4.3  accessibility

the spec mentions keyboard navigation (good) but nothing about:
  - screen reader announcements for round transitions
  - aria labels on the tradeoff cards
  - focus management when switching between rounds
  - reduced motion preferences (the card slide animations)
  - color contrast on the match score percentages
  - the progress bar needs aria-valuenow/aria-valuemax

the swipe gesture (future mobile) needs a non-gesture alternative.

mitigation:
  - add aria-live="polite" on the question area for round changes
  - add role="radiogroup" on the tradeoff card pair
  - add aria-label on progress segments
  - respect prefers-reduced-motion for animations
  - test with VoiceOver before shipping


4.4  stale decisions

a decision generated 2 weeks ago has context about the codebase
state at that time. if the codebase changed significantly:
  - round 1 questions may reference outdated architecture
  - round 2 options may suggest approaches that no longer apply
  - round 3 plan may reference files that were deleted

the spec has no staleness detection.

mitigation:
  - add a "context age" indicator: "research from 14 days ago"
  - if context is > 7 days old, show a warning: "this analysis
    may be outdated. consider refreshing research."
  - the "refine" button already exists. make it more prominent
    on stale decisions.
  - track lastResearchedAt timestamp on the decision


4.5  i18n

all AI-generated text is English. the spec doesn't mention
language support. binary question cards, option descriptions,
plan tasks - all generated in English.

mitigation:
  - add a language parameter to all generation API endpoints
  - pass user locale from the browser
  - this is a future concern, not a blocker, but the API should
    be designed to accept it from day 1


5. SCOPE CONCERNS
==================

5.1  too ambitious for a single feature

the spec describes:
  - data model extensions (7 new interfaces)
  - 3 modes (guided, dashboard, briefing)
  - 8 new API endpoints
  - 16 new components
  - keyboard shortcuts for 4 different modes
  - a reusable skill system
  - multi-stakeholder voting (future)

estimated at 30-40 hours across 11 parallel agents.

this is a full product, not a feature. the risk is building
all of it and finding out that users just want a better
version of the current scroll view.

mitigation:
  - the spec already has a good implementation priority (phases 1-6).
    but phases should be release gates, not just build order.
  - ship phase 1 (dashboard tabs) to users. measure. learn.
  - then ship phase 2 (round 1 tinder mode). measure. learn.
  - DO NOT build phases 3-6 until phases 1-2 prove their value.
  - the reusable skill (phase 6) should be the LAST thing built,
    not designed upfront. extract the pattern after it's proven
    in the first use case.


5.2  MVP definition

the real MVP is:
  phase 1: dashboard mode (tabs + verdict card + approval bar)

this alone solves 80% of the UX problems identified in the
research doc. the current panel is a wall of text. tabs fix that.
the verdict card fixes "where's the recommendation?" the
approval bar fixes "where's the approve button?"

the guided flow (phases 2-4) is the differentiator but also
the risk. it could be amazing or it could be annoying.

the briefing mode (phase 5) is a nice-to-have that could easily
be cut. it serves a narrow use case (stakeholder presentations)
that could be solved with a PDF export.

the reusable skill (phase 6) is premature abstraction. you have
exactly one use case. don't generalize yet.

mitigation:
  - ship phase 1 as v1.0
  - ship phases 2-4 as v1.1 (behind a feature flag)
  - cut phase 5 entirely (or defer to v2)
  - defer phase 6 until you have a second use case


5.3  the reusable skill is over-engineered

the GuidedFlowProps interface has 13 props, 3 async callbacks,
optional state management, 3 skip flags, and customizable labels.
this is designed for hypothetical use cases (onboarding wizard,
feature configuration, design selection) that don't exist yet.

YAGNI. you ain't gonna need it.

the spec lists 4 usage examples. 3 of them are fictional.
the only real one is decisions.

mitigation:
  - build the guided flow as decision-specific components first
  - don't export GuidedFlowShell or GuidedFlowProps until you
    have a second consumer
  - when you do generalize, extract the interface from the
    working implementation, don't design it upfront


6. COMPETITIVE WEAKNESSES
==========================

6.1  Linear/Notion expectations

users coming from Linear expect:
  - instant load (no AI generation wait)
  - keyboard-first navigation
  - dense information display
  - custom fields and views

the guided flow is the opposite of instant. 3 rounds of AI
generation is the opposite of "I'll just look at the data."

Linear users will hit [skip to dashboard] immediately and never
come back to guided mode.

mitigation:
  - dashboard mode (classic) MUST be excellent on its own.
    it can't be a second-class citizen to guided mode.
  - the spec does treat them as peers (good). but the
    implementation priority puts dashboard first (phase 1)
    and guided flow second (phases 2-4). this ordering is
    correct and shouldn't change.


6.2  gimmick perception

a tinder-style swipe UX in a developer tool risks feeling
gimmicky. "we made Tinder for architecture decisions" is a
funny pitch deck slide but a risky product bet.

if the questions are bad (see 2.4), the matchScore feels
arbitrary (see 6.3), or the plan is generic (see 1.5), the
entire flow feels like a toy.

the UX needs to earn trust through quality, not novelty.

mitigation:
  - the binary card UI is fine. the swipe gesture is fine.
    just don't lean into the dating app metaphor in marketing.
  - quality of AI output is everything. invest in prompt
    engineering and few-shot examples more than UI polish.
  - show the reasoning: why did option A get 96% match?
    what preferences drove that score? transparency builds trust.


6.3  matchScore credibility

matchScore (0-100) implies precision that doesn't exist.
the AI is generating a number based on vibes. a 96% vs 84%
distinction is meaningless but the UI presents it like a
scientific measurement.

users will either:
  - trust the number blindly (rubber-stamping the top option)
  - distrust the number entirely (ignoring it)

neither outcome is good.

mitigation:
  - use qualitative labels instead of percentages:
    "strong match" / "good match" / "partial match" / "weak match"
  - or: show a bar chart of which preferences each option satisfies,
    so the score is decomposable and explainable
  - "96% match" -> "matches 7 of 8 preferences (misses: timeline)"
  - this turns an opaque number into transparent reasoning


6.4  flow speed vs team velocity

3 rounds with AI generation between each = minimum 3-5 minutes
per decision if the user is fast and the AI is responsive.

fast-moving teams (startup pace, daily deploys) make 5-10
technical decisions per day. 3-5 minutes each = 15-50 minutes
per day in decision wizards.

those teams will reject this immediately.

mitigation:
  - the escape hatch to classic mode is critical. it must be
    one click, zero friction.
  - consider "express mode": skip round 1 entirely, show 4 options
    immediately (without preference tailoring), let user pick.
    round 3 is optional. total time: 30 seconds.
  - batch decisions: let users queue 5 decisions and go through
    round 1 for all of them at once, then see all round 2 options
    grouped. (this is ambitious but solves the throughput problem)


7. THINGS THE SPEC GETS RIGHT
===============================

to be fair, this isn't all problems. the spec gets several
things very right:

  - the UX research is solid. pyramid principle, miller's law,
    SCQA framework, progressive disclosure. this is a well-
    researched design, not a random idea.

  - dashboard mode (tabs + verdict card) is a genuinely good
    improvement over the current wall of text. shipping just
    this would be a win.

  - the implementation priority is correct. dashboard first,
    guided flow second, briefing last, skill extraction last-last.

  - backward compatibility is handled well. old decisions stay
    in classic mode. no forced migration.

  - the keyboard navigation spec is thorough. most UX specs
    forget keyboard users entirely.

  - the "skip to dashboard" escape hatch exists at every round.
    this shows awareness that the wizard might not work for
    everyone.

  - saving progress to decision JSON (not a separate state store)
    keeps the architecture simple. one source of truth.


8. SUMMARY OF RECOMMENDATIONS
===============================

do now (before implementation):
  ☐ add complexity detection to auto-route simple decisions
  ☐ add contradiction handling to round 1 profile generation
  ☐ replace matchScore percentages with qualitative labels
  ☐ add max length constraints to AI generation prompts
  ☐ add state machine validator for guidedFlow consistency
  ☐ design analytics events for every flow transition
  ☐ add a "these questions suck" regeneration button

do during implementation:
  ☐ transactional task creation in round 3 (all or nothing)
  ☐ cycle detection in dependency graph
  ☐ optimistic locking on decision JSON updates
  ☐ aria labels and screen reader announcements
  ☐ staleness indicator on old research data

cut or defer:
  ☐ briefing mode (phase 5) - defer to v2
  ☐ reusable skill extraction (phase 6) - defer until 2nd use case
  ☐ multi-stakeholder voting - defer to v3
  ☐ visual previews (OptionPreview) - defer, text is fine for v1
  ☐ swipe gestures on mobile - defer, click/tap is fine

reconsider:
  ☐ pure binary choices vs 5-point scale (test both)
  ☐ "tinder" naming (never user-facing, maybe not even internal)
  ☐ going back to round 1 after round 2 (consider "start over" only)
  ☐ default mode for new decisions (guided vs user preference)
  ☐ 4 fixed options in round 2 (what if 3 is better? or 5?)
