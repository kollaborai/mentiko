DECISION FLOW - INFORMATION ARCHITECTURE SPEC
===============================================
date: 2026-03-16
status: design spec (feeds into UI designer agent)
inputs: UX research, competitive analysis, product vision (tinder-mode flow)
scope: decision detail panel redesign + guided flow + reusable skill

existing code:
  web/lib/decision-types.ts              data model
  web/lib/decision-storage.ts            filesystem persistence
  web/components/decision/decision-detail.tsx   current 970-line panel
  web/components/decision/option-cards.tsx      comparison table + cards
  web/components/decision/intake-dialog.tsx     new decision dialog
  web/app/decisions/page.tsx             list-detail page
  web/app/api/decisions/                 REST endpoints


TABLE OF CONTENTS
=================
  1. data model extensions
  2. screen states by lifecycle
  3. the guided flow (3 rounds)
  4. dashboard mode (tabs)
  5. briefing mode (card carousel)
  6. the reusable skill
  7. information hierarchy per state
  8. component inventory
  9. API surface changes
  10. keyboard + navigation


1. DATA MODEL EXTENSIONS
========================

extend Decision type (web/lib/decision-types.ts):

  // new fields on Decision
  guidedFlow?: GuidedFlow;
  mode?: "classic" | "guided";    // default "guided" for new, "classic" for old

  interface GuidedFlow {
    currentRound: 0 | 1 | 2 | 3;          // 0 = not started
    round1: Round1State;
    round2: Round2State;
    round3: Round3State;
    startedAt?: string;
    completedAt?: string;
  }

  interface Round1State {
    status: "pending" | "in_progress" | "complete" | "skipped";
    questions: TradeoffQuestion[];
    answers: TradeoffAnswer[];
    preferenceProfile?: PreferenceProfile;
    generationJobId?: string;
  }

  interface TradeoffQuestion {
    id: string;
    text: string;                          // the question framing
    optionA: { label: string; value: string; icon?: string };
    optionB: { label: string; value: string; icon?: string };
    category: string;                      // groups questions by theme
    weight: number;                        // 0-1, how much this matters
  }

  interface TradeoffAnswer {
    questionId: string;
    choice: "a" | "b" | "skip";
    answeredAt: string;
  }

  interface PreferenceProfile {
    preferences: Record<string, string>;   // category -> preferred value
    constraints: string[];                 // inferred from strong preferences
    summary: string;                       // AI-generated 1-2 sentence summary
  }

  interface Round2State {
    status: "pending" | "generating" | "ready" | "complete";
    tailoredOptions: TailoredOption[];
    selectedOptionId?: string;
    customizations?: string[];             // user notes / mix requests
    generationJobId?: string;
  }

  interface TailoredOption {
    id: string;
    letter: string;                        // A, B, C, D
    name: string;
    description: string;
    preview?: OptionPreview;               // optional visual preview
    matchScore: number;                    // 0-100, how well it matches round 1
    pros: string[];
    cons: string[];
    effort: "low" | "medium" | "high";
    risk: "low" | "medium" | "high";
    estimatedTime?: string;
  }

  interface OptionPreview {
    type: "image" | "component" | "code";
    content: string;                       // URL, component name, or code snippet
  }

  interface Round3State {
    status: "pending" | "generating" | "ready" | "complete";
    plan?: ExecutionPlan;
    generationJobId?: string;
  }

  interface ExecutionPlan {
    summary: string;
    tasks: PlanTask[];
    totalEstimate?: string;
    dependencies: PlanDependency[];
  }

  interface PlanTask {
    id: string;
    title: string;
    description: string;
    subtasks: string[];
    estimate?: string;
    assignee?: string;
    priority: number;                      // 0-4
    phase: number;                         // execution order group
  }

  interface PlanDependency {
    from: string;                          // task id
    to: string;                            // task id
  }

backward compatibility:
  - decisions without guidedFlow field render in "classic" mode
  - classic mode = current dashboard/tab layout (no guided flow)
  - new decisions default to mode: "guided"
  - user can switch from guided -> classic at any time (escape hatch)


2. SCREEN STATES BY LIFECYCLE
=============================

the decision detail panel renders differently per status.
this section defines what the user sees at each stage.


2.1  NEW / INTAKE (status: "intake")
-------------------------------------

trigger: user submits via IntakeDialog
what happens: auto-fires research job (existing behavior)
what the user sees:

  +--------------------------------------------------+
  | [title]                              [skip] [x]  |
  | intake                                           |
  +--------------------------------------------------+
  |                                                  |
  |  (centered, minimal)                             |
  |                                                  |
  |  "analyzing your decision..."                    |
  |  [wave spinner]                                  |
  |  brief explanation: "gathering context,          |
  |  identifying tradeoffs, preparing questions"     |
  |                                                  |
  +--------------------------------------------------+

information visible: 2 items (title, status message)
duration: typically 10-30 seconds
auto-transitions to: researching (immediately), then pending


2.2  RESEARCHING (status: "researching")
-----------------------------------------

trigger: research job started
what the user sees: same as intake but spinner text updates

  "researching options..."
  "comparing tradeoffs..."
  "building recommendation..."

these are cosmetic (not real-time job status). the job
polls every 2s and transitions to pending when complete.

information visible: 2 items (title, progress message)


2.3  PENDING (status: "pending", mode: "guided")
--------------------------------------------------

trigger: research job completes, decision has options + context
this is the PRIMARY state. most time is spent here.

for NEW decisions (mode: "guided"), the panel shows:

  +--------------------------------------------------+
  | [title]                   [dashboard] [skip] [x] |
  | pending  p2  architecture                        |
  +--------------------------------------------------+
  |                                                  |
  | GUIDED DECISION FLOW                             |
  |                                                  |
  | round indicator:                                 |
  |   (1) preferences  ->  (2) options  ->  (3) plan |
  |   [active]              [locked]        [locked] |
  |                                                  |
  | (round 1 content renders here - see section 3)   |
  |                                                  |
  +--------------------------------------------------+

the "dashboard" button in the header switches to classic
tab view (section 4) for users who want direct access
to the raw research data.


2.4  PENDING (status: "pending", mode: "classic")
---------------------------------------------------

for OLD decisions or users who toggled to classic view:

  +--------------------------------------------------+
  | [title]                   [guided] [refine] [x]  |
  | pending  p2  architecture                        |
  +--------------------------------------------------+
  | VERDICT CARD (sticky)                            |
  | "Option B: Inline Migration"                     |
  | high confidence | low risk | small change        |
  +--------------------------------------------------+
  | [Overview]  [Options]  [Context]  [History]      |
  +--------------------------------------------------+
  |                                                  |
  | (active tab content scrolls)                     |
  |                                                  |
  +--------------------------------------------------+
  | [add notes]                     [Approve]        |
  +--------------------------------------------------+

see section 4 for full tab breakdown.


2.5  APPROVED / IN_PROGRESS / DONE
------------------------------------

read-only. no guided flow. dashboard mode only.

  +--------------------------------------------------+
  | [title]                   [open task] [retro] [x] |
  | approved  p2  architecture                       |
  +--------------------------------------------------+
  | VERDICT CARD (shows selected option, not rec)    |
  | "Option B: Inline Migration"                     |
  | approved by: user | 2026-03-16 14:32             |
  +--------------------------------------------------+
  | [Overview]  [Options]  [Context]  [History]      |
  +--------------------------------------------------+
  |                                                  |
  | (tab content - history tab visible now)          |
  |                                                  |
  +--------------------------------------------------+


2.6  SKIPPED
-------------

minimal. shows title, skipped status, and the original prompt.

  +--------------------------------------------------+
  | [title]                              [delete] [x] |
  | skipped                                          |
  +--------------------------------------------------+
  |                                                  |
  | "this decision was skipped"                      |
  | original prompt text                             |
  |                                                  |
  | [reopen]                                         |
  |                                                  |
  +--------------------------------------------------+


3. THE GUIDED FLOW (3 ROUNDS)
=============================

the guided flow is the PRIMARY experience for new decisions.
it replaces the current "show everything at once" approach.


3.1  ROUND INDICATOR (always visible during guided flow)
---------------------------------------------------------

a horizontal step indicator at the top of the guided flow area.

  (1) preferences    ->    (2) options    ->    (3) plan
  [active/complete]        [locked/active]      [locked/active]

states per step:
  locked:   grayed out, not clickable, shows lock icon
  active:   highlighted, shows step content below
  complete: shows check, clickable (user can go back and redo)

the indicator is compact: one line, 3 labeled circles with
connecting lines. similar to a checkout stepper.

additional controls on the indicator line:
  [start over] - resets all rounds (confirmation required)
  [skip to dashboard] - switches to classic mode

progress persists. if user leaves and comes back, they resume
at the current round. decision JSON is updated after each answer.


3.2  ROUND 1: PREFERENCE GATHERING ("tinder mode")
----------------------------------------------------

purpose: reduce a complex decision to simple binary choices.
output: a preference profile that shapes round 2 options.

trigger: user clicks "start" on the guided flow (or auto-starts
if decision just transitioned to pending).

how questions are generated:
  - AI analyzes the decision context, options, and constraints
  - generates 5-9 binary tradeoff questions (miller's law)
  - each question isolates ONE dimension of the decision
  - questions ordered from broad/strategic to narrow/tactical

example questions for "should we migrate to postgres?":
  1. "speed vs stability" -> which matters more right now?
  2. "minimal change vs clean architecture" -> preference?
  3. "ship this week vs ship it right" -> timeline pressure?
  4. "team familiarity vs best tool" -> tech choice driver?
  5. "backward compatible vs fresh start" -> migration style?

question generation is an AI job (same pipeline as research).
new API: POST /api/decisions/{id}/guided/round1/generate

the UI for each question:

  +--------------------------------------------------+
  |                                                  |
  |  question 3 of 7                                 |
  |                                                  |
  |  "what matters more for this change?"            |
  |                                                  |
  |  +-------------------+  +-------------------+   |
  |  |                   |  |                   |   |
  |  |  minimal change   |  |  clean arch       |   |
  |  |                   |  |                   |   |
  |  |  keep existing    |  |  proper solution  |   |
  |  |  patterns, less   |  |  even if it means |   |
  |  |  disruption       |  |  more rework      |   |
  |  |                   |  |                   |   |
  |  |    [A]            |  |            [B]    |   |
  |  +-------------------+  +-------------------+   |
  |                                                  |
  |  [skip this question]                            |
  |                                                  |
  |  progress: ===-------  3/7                       |
  |                                                  |
  +--------------------------------------------------+

card layout:
  - two cards side by side (50/50 width on desktop)
  - stacked on mobile (full width each)
  - each card: label (bold), 1-2 line description, letter badge
  - bg-card with hover:bg-accent
  - selected card: bg-accent with subtle left border accent

interaction:
  - click card A or card B to answer
  - keyboard: left arrow = A, right arrow = B, down = skip
  - swipe on mobile: left = A, right = B (future enhancement)
  - answering auto-advances to next question (300ms delay for feedback)
  - "skip" records the answer as neutral (no preference)

animation between questions:
  - new question slides in from the right
  - answered question slides out to the left
  - minimal, fast (200ms), not decorative

progress bar:
  - thin bar below the question area
  - filled segments = answered, empty = remaining
  - shows "3 of 7" text

back navigation:
  - clicking the progress bar on a completed segment goes back
  - user can change previous answers
  - no penalty for changing answers

completion:
  - after last question, brief "building your profile..." state
  - AI generates PreferenceProfile from answers
  - profile shown as a summary card:

    +--------------------------------------------------+
    |  your preferences:                               |
    |                                                  |
    |  "you value stability over speed, prefer         |
    |   minimal disruption, and want backward          |
    |   compatibility. timeline is flexible."          |
    |                                                  |
    |  key preferences:                                |
    |    stability > speed                             |
    |    minimal change > clean arch                   |
    |    backward compat > fresh start                 |
    |                                                  |
    |  [continue to options]    [redo preferences]     |
    +--------------------------------------------------+

data persistence:
  - each answer saved immediately to decision.guidedFlow.round1.answers
  - PATCH /api/decisions/{id} with updated guidedFlow
  - user can close browser and resume later
  - preference profile saved to round1.preferenceProfile


3.3  ROUND 2: TAILORED OPTIONS
-------------------------------

purpose: present 4 options specifically tailored to round 1 preferences.
output: a selected option (or custom mix).

trigger: user completes round 1 and clicks "continue to options"

generation:
  - AI takes: original decision context + research + round 1 preferences
  - generates exactly 4 options, each with matchScore (0-100)
  - options ranked by matchScore descending
  - new API: POST /api/decisions/{id}/guided/round2/generate
  - generation is a job (same pipeline as research)
  - shows "generating tailored options..." with spinner while waiting

the UI for option presentation:

  +--------------------------------------------------+
  |  your options (tailored to your preferences)     |
  |                                                  |
  |  +---------------------------------------------+ |
  |  | A  Incremental Migration         96% match  | |
  |  |    migrate one table at a time,             | |
  |  |    dual-write during transition             | |
  |  |    effort: low | risk: low | 1 week         | |
  |  |    [select]                      [details]  | |
  |  +---------------------------------------------+ |
  |                                                  |
  |  +---------------------------------------------+ |
  |  | B  Shadow Database               84% match  | |
  |  |    run postgres in parallel,                | |
  |  |    compare results, switch when ready       | |
  |  |    effort: medium | risk: low | 2 weeks     | |
  |  |    [select]                      [details]  | |
  |  +---------------------------------------------+ |
  |                                                  |
  |  (C and D follow same pattern)                   |
  |                                                  |
  |  [compare all]                                   |
  +--------------------------------------------------+

layout:
  - vertical stack of 4 option cards
  - each card: letter badge, name, 1-line description, match %, signals
  - match % shown as a small bar + number (right-aligned)
  - signals row: effort, risk, estimated time (same pills as current)
  - two actions per card: [select] and [details]

selecting an option:
  - click [select] -> card gets selected state (bg-accent, bold border)
  - only one option selected at a time
  - keyboard: 1/2/3/4 to select, enter to confirm

details expansion:
  - click [details] -> card expands to show:
    - full description (2-3 sentences)
    - pros list
    - cons list
    - optional: visual preview (if OptionPreview exists)
  - only one card expanded at a time (accordion)
  - keyboard: space to toggle details on focused card

compare mode:
  - click [compare all] -> shows the comparison table
  - same table format as current option-cards.tsx
  - columns: option, effort, risk, compatibility, performance, match %
  - this is the existing comparison table with matchScore added

visual previews (when available):
  - rendered inside the expanded card details
  - type: "image" -> <img> tag with the URL
  - type: "component" -> rendered component from library
  - type: "code" -> syntax-highlighted code block
  - previews are optional, AI includes them when relevant

mix/customize:
  - below the option cards, a text input:
    "want to mix elements from multiple options?"
    [textarea: describe what you want to combine]
    [generate custom option]
  - this triggers a new generation with mix instructions
  - adds a 5th option "E: Custom" to the list
  - expensive operation, clearly labeled as such

confirmation:
  - after selecting, show confirmation:
    "you selected: Option A - Incremental Migration"
    [continue to plan]  [change selection]  [customize]


3.4  ROUND 3: PLAN GENERATION
-------------------------------

purpose: create a concrete execution plan with tasks.
output: a task tree ready to be created as tasks (native sqlite).

trigger: user selects option in round 2 and clicks "continue to plan"

generation:
  - AI takes: decision context + round 1 preferences + round 2 selection
  - generates ExecutionPlan with tasks, subtasks, dependencies
  - new API: POST /api/decisions/{id}/guided/round3/generate
  - shows "building your plan..." with spinner

the UI for plan presentation:

  +--------------------------------------------------+
  |  execution plan                                  |
  |  based on: Option A - Incremental Migration      |
  +--------------------------------------------------+
  |                                                  |
  |  summary:                                        |
  |  "migrate to postgres incrementally over 5 days, |
  |   one table at a time, with dual-write safety."  |
  |                                                  |
  |  total estimate: 5 days | 8 tasks | 3 phases     |
  |                                                  |
  +--------------------------------------------------+
  |  phase 1: setup                        ~1 day    |
  |    [x] configure postgres instance               |
  |    [x] set up dual-write proxy                   |
  |    [x] create migration scripts                  |
  |                                                  |
  |  phase 2: migration                    ~3 days   |
  |    [x] migrate users table                       |
  |        -> depends on: setup                      |
  |    [x] migrate sessions table                    |
  |        -> depends on: users table                |
  |    [x] migrate decisions table                   |
  |        -> depends on: users table                |
  |                                                  |
  |  phase 3: cutover                      ~1 day    |
  |    [x] switch read traffic                       |
  |        -> depends on: all migrations             |
  |    [x] decommission sqlite                       |
  |        -> depends on: switch traffic             |
  +--------------------------------------------------+
  |                                                  |
  | [approve + create tasks]  [edit plan]  [redo]    |
  |                                                  |
  +--------------------------------------------------+

layout:
  - summary block at top (2-3 sentences)
  - signal row: total estimate, task count, phase count
  - task tree grouped by phase
  - each task: checkbox (cosmetic), title, optional dependency line
  - subtasks indented under parent task
  - phases separated by headers with phase estimate

task editing:
  - click any task to edit its title inline
  - click [x] next to a task to remove it
  - drag to reorder within a phase (future)
  - [add task] button at the bottom of each phase
  - edits update the plan in decision JSON, not task store yet

[edit plan] opens a textarea with the plan as structured text.
user can make bulk changes, then AI regenerates the task tree.

approval action:
  - [approve + create tasks] is the PRIMARY action
  - creates tasks via task-store.ts (existing resolve flow)
  - sets up dependencies via task-store.ts
  - transitions decision to "approved"
  - links tasks back to decision via resolution.taskId (first task id)
  - shows confirmation: "8 tasks created. opening task board..."

[redo] goes back to round 2 option selection.
user can also click round 1 or round 2 in the step indicator
to go back to any point.


3.5  NAVIGATION BETWEEN ROUNDS
--------------------------------

forward:
  round 1 complete -> "continue to options" button
  round 2 complete -> "continue to plan" button
  round 3 complete -> "approve + create tasks" button

backward:
  click any completed step in the round indicator
  or: [back] button at bottom-left of each round
  going back does NOT erase forward progress
  round 2 options regenerate only if round 1 answers changed

skip:
  [skip to dashboard] available at every round
  switches to classic tab mode with whatever data exists
  user can come back to guided flow later

redo:
  [start over] in the round indicator (confirmation dialog)
  clears all guided flow data, restarts from round 1
  [redo round] available at the end of each round
  re-runs only that round's generation

resume:
  if user navigates away mid-flow:
    - data persisted in decision JSON
    - on return, guided flow resumes at currentRound
    - answered questions in round 1 are pre-filled
    - selected option in round 2 is pre-selected


4. DASHBOARD MODE (TABS)
=========================

the dashboard mode is for:
  - repeat visitors reviewing a decided decision
  - users who switched from guided mode
  - old decisions (mode: "classic")

layout from UX research section 6:

  +--------------------------------------------------+
  | header (title, badges, actions)                  |
  +--------------------------------------------------+
  | verdict card (sticky)                            |
  +--------------------------------------------------+
  | [Overview]  [Options]  [Context]  [History]      |
  +--------------------------------------------------+
  | (tab content)                                    |
  +--------------------------------------------------+
  | approval bar (sticky, pending only)              |
  +--------------------------------------------------+


4.1  HEADER
------------

  left: title (text-base font-medium)
  left row 2: status badge, priority badge, category badge, date

  right actions (context-dependent):
    pending:    [approve] [refine] [guided] [skip] [delete]
    approved:   [open task] [retro] [delete]
    done:       [open task] [delete]
    skipped:    [reopen] [delete]

[guided] button only appears on pending decisions that have
guidedFlow data. switches back to the 3-round view.


4.2  VERDICT CARD
------------------

always visible (sticky below header, above tabs).
the "headline" from the inverted pyramid.

pending state:
  +--------------------------------------------------+
  | "Option B: Inline Migration"                     |
  | high confidence | low risk | small change        |
  | "recommended because it preserves backward       |
  |  compatibility while achieving the migration     |
  |  goal with minimal disruption."                  |
  +--------------------------------------------------+

approved state:
  +--------------------------------------------------+
  | "Option B: Inline Migration"     [approved]      |
  | approved by user | 2026-03-16                    |
  | linked task: mentiko-42                          |
  +--------------------------------------------------+

researching state:
  +--------------------------------------------------+
  | "analyzing..."                                   |
  | [wave spinner]                                   |
  +--------------------------------------------------+

no data yet:
  verdict card is hidden entirely (intake, early researching)

content:
  - recommended option name (text-sm font-semibold)
  - 3 signal chips: confidence, risk, change size
  - 1-2 line rationale (text-sm text-foreground/70)
  - on approved: who approved, when, linked task

implementation:
  - new component: VerdictCard
  - extracts data from decision.recommendation + selected option
  - reuses existing SignalCard for the 3 chips
  - background: bg-muted, rounded-md, px-4 py-3


4.3  TAB: OVERVIEW (default tab)
---------------------------------

the SCQA narrative. tells the story of the decision.

content (in order):
  1. problem statement (context.problem || prompt)
     formatted as a paragraph, not a label/value pair
  2. impact statement (context.whyProblem)
     "this matters because..."
  3. recommendation rationale (recommendation.rationale)
     "we recommend [option] because..."
  4. before/after diff card
     two-column: "before" (context.currentState) / "after" (option.description)
  5. constraints (as compact chips, not a list)

items visible: 5 (within miller's limit)

what's NOT here:
  - option details (that's the options tab)
  - affected files (that's the context tab)
  - resolution/retro (that's the history tab)
  - the comparison table


4.4  TAB: OPTIONS
------------------

the comparison and evaluation view.

content:
  1. comparison table (existing option-cards.tsx table view)
     - columns: option, change size, risk, compatibility, performance, recommended
     - add: matchScore column if guided flow was used
     - add: winner-per-dimension highlighting (bold + subtle accent on best cell)
  2. option detail cards (existing option-cards.tsx card view)
     - expand/collapse per option
     - recommended option has subtle "recommended" badge
     - selected option (if resolved) has "selected" badge
  3. "did your preferences generate these?" link to round 1 summary
     (only if guided flow was used)

items visible: depends on option count (3-5 typically, within limit)

reuses: option-cards.tsx as-is, wrapped in the tab


4.5  TAB: CONTEXT
-------------------

the technical deep dive. this is tier 3 information.

content:
  1. decision brief (original prompt)
  2. current state (context.currentState)
  3. affected areas (as chips)
  4. affected files (as mono chips)
  5. all references (as a list, mono text)
  6. full technical detail (existing CollapsibleSection content)

items visible per section: 3-7 (each sub-area is its own chunk)

reuses:
  - SummaryTextRow, SummaryListRow for label/value pairs
  - existing inferAffectedFiles / extractNonFileReferences logic


4.6  TAB: HISTORY
------------------

only visible when decision is approved/in_progress/done.
hidden for pending/intake/researching.

content:
  1. resolution details
     - selected option name
     - selected by + date
     - approval notes (if any)
  2. linked task (clickable link to /tasks?task=X)
  3. guided flow summary (if used)
     - round 1: preference profile summary
     - round 2: match score breakdown
     - round 3: plan creation timestamp
  4. retrospective (if generated)
     - summary, outcome, lessons learned
     - completed date
  5. [generate retro] button if retro not yet generated

items visible: 3-5


4.7  APPROVAL BAR (sticky bottom, pending only)
-------------------------------------------------

only renders when decision.status === "pending".
always visible at the bottom, above the scroll.

  +--------------------------------------------------+
  |  [add notes]              [Skip]  [Approve Bn]  |
  +--------------------------------------------------+

[add notes] toggles a textarea that slides up from the bar.
the textarea is for approval notes that travel with the task.

[approve] is the primary action (RaisedButton, blue).
disabled until an option is selected.
shows which option: "Approve B" where B is the letter.

[skip] is a secondary action.

keyboard:
  enter -> approve (if option selected)
  escape -> close notes

when guided flow reaches round 3, the approval bar changes to:
  [approve + create tasks]
this is the same action as round 3 completion.


5. BRIEFING MODE (CARD CAROUSEL)
==================================

a presentation-style view for stakeholder briefings.
accessed via a [briefing] button in the dashboard header.

entry point: header action button, only on pending/approved decisions
exit point: escape key or [x] button returns to dashboard

the briefing is a full-panel card carousel. one card at a time.
no scrolling. just paging.

card sequence:
  card 1: THE QUESTION
    - decision title (large)
    - problem statement (medium)
    - "this decision needs your input"
    - category + priority badges

  card 2: THE SITUATION
    - context.currentState (the before)
    - context.whyProblem (why it matters)
    - affected areas as visual chips

  card 3: THE OPTIONS (summary)
    - mini comparison table (3-4 key columns only)
    - all options on one card
    - recommended option highlighted

  card 4: THE RECOMMENDATION
    - recommended option name (large)
    - confidence + key signals
    - 2-3 sentence rationale
    - before/after diff

  card 5: THE ASK
    - "approve option B?"
    - [approve] [view details] [reject / request changes]

layout per card:
  +--------------------------------------------------+
  |  card title                          3/5  [x]    |
  |                                                  |
  |  (card content, centered,                        |
  |   large typography,                              |
  |   maximum 4-5 information items)                 |
  |                                                  |
  |                                                  |
  |                                                  |
  |  [<]                                       [>]   |
  |                          o o O o o               |
  +--------------------------------------------------+

navigation:
  - left/right arrow keys
  - click left/right edge buttons
  - swipe on mobile (future)
  - progress dots at bottom (o = inactive, O = active)
  - click a dot to jump to that card

styling:
  - cards fill the detail panel area
  - bg-card, rounded-md
  - larger typography than dashboard (text-lg for titles)
  - generous padding (p-6 or p-8)
  - no scroll within a card (content must fit)
  - transition: slide left/right (200ms, ease-out)


6. THE REUSABLE SKILL
=======================

the 3-round guided flow should be extractable as a reusable
pattern. any screen that needs to collect preferences, generate
options, and create plans can use the same components.


6.1  ABSTRACTION
-----------------

the skill needs 3 things from the host screen:
  1. a context object (what is being decided)
  2. a generation backend (how to create questions/options/plans)
  3. a completion callback (what to do when flow finishes)


6.2  COMPONENT API
-------------------

  interface GuidedFlowProps {
    // context
    title: string;
    description: string;
    context: Record<string, unknown>;     // passed to AI for generation

    // generation
    onGenerateQuestions: (ctx: Record<string, unknown>) =>
      Promise<TradeoffQuestion[]>;
    onGenerateOptions: (ctx: Record<string, unknown>, preferences: PreferenceProfile) =>
      Promise<TailoredOption[]>;
    onGeneratePlan: (ctx: Record<string, unknown>, preferences: PreferenceProfile, selectedOption: TailoredOption) =>
      Promise<ExecutionPlan>;

    // persistence (optional - host manages state if provided)
    state?: GuidedFlow;
    onStateChange?: (state: GuidedFlow) => void;

    // completion
    onComplete: (result: GuidedFlowResult) => void;
    onCancel: () => void;

    // customization
    round1Label?: string;                 // default: "preferences"
    round2Label?: string;                 // default: "options"
    round3Label?: string;                 // default: "plan"
    skipRound1?: boolean;                 // jump straight to options
    skipRound3?: boolean;                 // stop after option selection
  }

  interface GuidedFlowResult {
    preferences: PreferenceProfile;
    selectedOption: TailoredOption;
    plan?: ExecutionPlan;
    customizations?: string[];
  }


6.3  SUB-COMPONENTS (exported individually)
--------------------------------------------

  GuidedFlowShell         - round indicator + content area
  Round1Tinder            - binary question cards + progress
  Round2Options           - tailored option cards + compare
  Round3Plan              - task tree + approval
  RoundIndicator          - the 3-step horizontal indicator
  TradeoffCard            - single A/B question card
  TailoredOptionCard      - single option in round 2
  PlanTaskTree            - phase-grouped task list

each sub-component is usable independently.
a host could use only Round1Tinder for a preference quiz
without rounds 2 and 3.


6.4  USAGE EXAMPLES
---------------------

decision detail (this feature):
  <GuidedFlowShell>
    onGenerateQuestions = POST /api/decisions/{id}/guided/round1/generate
    onGenerateOptions = POST /api/decisions/{id}/guided/round2/generate
    onGeneratePlan = POST /api/decisions/{id}/guided/round3/generate
    onComplete = POST /api/decisions/{id}/resolve (creates tasks)

onboarding wizard:
  <GuidedFlowShell skipRound3>
    context = { user profile, team size, use case }
    round1 = "what kind of agents do you need?"
    round2 = "here are 4 starter templates"
    onComplete = create workspace + install template

feature configuration:
  <GuidedFlowShell skipRound1>
    context = { feature name, current config }
    round2 = "here are 4 configuration presets"
    round3 = "here's the migration plan"
    onComplete = apply config + create migration tasks

design selection (multi-stakeholder):
  <GuidedFlowShell>
    context = { design brief, brand guidelines }
    round1 = "what design direction?" (each stakeholder does this)
    round2 = "here are 4 design options with previews"
    onComplete = collect votes, AI tiebreaker


7. INFORMATION HIERARCHY PER STATE
====================================

what the user sees first, second, third at each stage.
"always visible" = sticky or persistent across interactions.
"on demand" = behind a tab, click, or expansion.


7.1  GUIDED FLOW (pending, mode: "guided")
--------------------------------------------

always visible:
  - decision title
  - round indicator (which step they're on)
  - current round content

first seen:
  - round 1: the current question (one at a time)
  - round 2: option A (highest match score)
  - round 3: plan summary + total estimate

second seen:
  - round 1: progress bar (how many questions left)
  - round 2: remaining options (B, C, D)
  - round 3: phase breakdown

on demand:
  - round 2: full comparison table ([compare all])
  - round 2: pros/cons per option ([details])
  - round 3: subtask details (expand task)
  - at any round: [skip to dashboard] for raw data


7.2  DASHBOARD (pending, mode: "classic")
-------------------------------------------

always visible:
  - decision title + metadata (header)
  - verdict card (recommendation + 3 signals)
  - approval bar (bottom sticky)

first seen:
  - overview tab: problem, impact, rationale (the SCQA story)

second seen (one tab click):
  - options tab: comparison table + option cards
  - context tab: affected areas, files, references

on demand (two interactions):
  - expanded pros/cons per option
  - full technical detail
  - approval notes textarea


7.3  RESOLVED (approved/done)
-------------------------------

always visible:
  - decision title + resolved status
  - verdict card (selected option + approval info)

first seen:
  - overview tab: the story of what was decided

second seen:
  - history tab: resolution details, linked task, retro

on demand:
  - options tab: what other options were considered
  - context tab: technical detail


8. COMPONENT INVENTORY
=======================

new components to create:

  web/components/decision/
    verdict-card.tsx              sticky recommendation summary
    overview-tab.tsx             SCQA narrative view
    options-tab.tsx              wraps option-cards.tsx
    context-tab.tsx              technical deep dive
    history-tab.tsx              resolution + retro
    approval-bar.tsx             sticky bottom bar
    briefing-view.tsx            card carousel shell
    briefing-card.tsx            single briefing card

  web/components/guided-flow/   (reusable skill)
    guided-flow-shell.tsx        orchestrator + round indicator
    round-indicator.tsx          3-step horizontal stepper
    round1-tinder.tsx            binary question view
    tradeoff-card.tsx            single A/B question
    round2-options.tsx           tailored options view
    tailored-option-card.tsx     single option card
    round3-plan.tsx              plan + task tree view
    plan-task-tree.tsx           phase-grouped task list

existing components to reuse (NOT rewrite):
  option-cards.tsx               comparison table + detail cards
  intake-dialog.tsx              new decision dialog
  CollapsibleSection             accordion wrapper
  SignalCard                     metric chip
  SummaryTextRow / SummaryListRow  label/value pairs
  statusBadge / priorityBadge   status indicators
  WorkflowSidebarItem            sidebar list rows
  PageHeader                     page header
  RaisedButton                   primary actions
  WaveSpinner                    loading states

components to DEPRECATE after migration:
  - the monolithic decision-detail.tsx (replaced by orchestrator + tabs + sub-components)
  - inline CollapsibleSection definition (extract to shared or reuse existing)


9. API SURFACE CHANGES
=======================

new endpoints:

  POST /api/decisions/{id}/guided/round1/generate
    body: {} (uses decision context)
    returns: { jobId, questions?: TradeoffQuestion[] }
    job completes -> questions saved to decision.guidedFlow.round1

  POST /api/decisions/{id}/guided/round1/answer
    body: { questionId, choice: "a" | "b" | "skip" }
    returns: { decision } (updated with answer)

  POST /api/decisions/{id}/guided/round1/complete
    body: {} (triggers preference profile generation)
    returns: { jobId, preferenceProfile?: PreferenceProfile }

  POST /api/decisions/{id}/guided/round2/generate
    body: { preferences: PreferenceProfile }
    returns: { jobId, options?: TailoredOption[] }

  POST /api/decisions/{id}/guided/round2/select
    body: { optionId, customizations?: string[] }
    returns: { decision }

  POST /api/decisions/{id}/guided/round2/mix
    body: { instructions: string }
    returns: { jobId } (generates custom option)

  POST /api/decisions/{id}/guided/round3/generate
    body: { optionId }
    returns: { jobId, plan?: ExecutionPlan }

  POST /api/decisions/{id}/guided/round3/edit
    body: { plan: ExecutionPlan }
    returns: { decision }

existing endpoints (no changes needed):
  POST /api/decisions/{id}/resolve    still creates tasks + approves
  POST /api/decisions/{id}/research   still runs AI research
  PATCH /api/decisions/{id}           still updates any field
  GET /api/decisions/{id}             returns full decision with guidedFlow

the resolve endpoint will be enhanced to accept an ExecutionPlan
from round 3 and create multiple linked tasks with dependencies,
rather than a single task.


10. KEYBOARD + NAVIGATION
==========================

global (any mode):
  escape          close dialog / exit briefing / close notes

guided flow - round 1:
  left arrow      select option A
  right arrow     select option B
  down arrow      skip question
  backspace       go to previous question

guided flow - round 2:
  1/2/3/4         select option by number
  space           toggle details on focused option
  enter           confirm selection
  c               open compare view
  backspace       go back to round 1

guided flow - round 3:
  enter           approve + create tasks
  e               edit plan
  backspace       go back to round 2

dashboard mode:
  1/2/3/4         switch tabs (overview/options/context/history)
  up/down arrows  cycle selected option (existing behavior)
  enter           approve (existing behavior)
  n               toggle notes
  b               open briefing mode
  g               switch to guided mode

briefing mode:
  left/right      previous/next card
  escape          exit briefing -> dashboard
  1-5             jump to card number
  enter           approve (on card 5)


IMPLEMENTATION PRIORITY
========================

phase 1: dashboard mode (tabs + verdict card + approval bar)
  effort: 4-6 hours
  why first: improves existing experience without new data model
  no API changes needed
  reuses all existing components

phase 2: guided flow round 1 (tinder mode)
  effort: 6-8 hours
  requires: data model extension + 1 new API endpoint
  the fun part, the differentiator

phase 3: guided flow round 2 (tailored options)
  effort: 4-6 hours
  requires: 1 new API endpoint + generation template
  builds on round 1 output

phase 4: guided flow round 3 (plan generation)
  effort: 6-8 hours
  requires: 1 new API endpoint + enhanced resolve
  the payoff - connects decisions to tasks

phase 5: briefing mode (card carousel)
  effort: 3-4 hours
  pure frontend, no API changes
  nice-to-have for stakeholder presentations

phase 6: reusable skill extraction
  effort: 4-6 hours
  refactor guided flow into shared components
  enable other screens to use the pattern

total: ~30-40 hours, good for 5-8 parallel agents across phases

parallel agent plan:
  phase 1: 3 agents (verdict-card + tabs + approval-bar)
  phase 2: 2 agents (round1 UI + round1 API/generation)
  phase 3: 2 agents (round2 UI + round2 API/generation)
  phase 4: 2 agents (round3 UI + round3 API/enhanced resolve)
  phase 5: 1 agent (briefing carousel)
  phase 6: 1 agent (extract + generalize)
