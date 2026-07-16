Decisions API Reference
=======================

REST API for the decision system. all endpoints require auth
(cookie or bearer token) and the x-namespace-id header.

base url: http://localhost:3200/api/decisions

common headers:
  Cookie: better-auth.session_token=<token>
  x-namespace-id: default
  Content-Type: application/json


Data Model
==========

see: web/lib/decisions/decision-types.ts

Decision object:
  id              string        unique identifier
  status          string        intake | researching | pending | approved
                                | in_progress | done | skipped
  prompt          string        original user input
  title           string?       ai-generated title (after research)
  priority        string?       p0-p4 (after research)
  category        string?       ai-assigned category
  source          string?       origin of the decision
  mode            string?       "classic" | "guided"
  createdAt       string        iso timestamp
  updatedAt       string        iso timestamp
  context         object?       DecisionContext (see below)
  options         Option[]      available options (after research)
  recommendation  object?       ai recommendation
  resolution      object?       selected option + task link
  retrospective   object?       post-decision review
  activeJobId     string?       running research/steering job
  retroJobId      string?       running retrospective job
  guidedFlow      object?       guided 3-round wizard state

DecisionContext:
  problem         string        what the problem is
  currentState    string        current situation
  whyProblem      string        impact/why it matters
  affectedAreas   string[]      areas affected
  constraints     string[]      known constraints
  references      string[]      reference links/docs

Option:
  id              string        unique option id
  letter          string        display letter (A, B, C...)
  name            string        short name
  description     string        full description
  pros            string[]      advantages
  cons            string[]      disadvantages
  effort          string        low | medium | high
  risk            string        low | medium | high
  estimatedTime   string?       time estimate

Recommendation:
  choiceId        string        option id being recommended
  rationale       string        why this option
  confidence      string        low | medium | high
  alternatives    string[]?     other viable options

Resolution:
  selectedOptionId  string      chosen option id
  selectedBy        string      who approved ("user")
  selectedAt        string      iso timestamp
  notes             string?     approval notes
  taskId            string?     created task id (epic if plan)
  taskIds           string[]?   all created task ids (epic + subtasks)


1. Decision CRUD
================


List Decisions
--------------
GET /api/decisions

query params:
  status      filter by status (optional)
  category    filter by category (optional)

response: { decisions: Decision[] }

  curl -s http://localhost:3200/api/decisions \
    -H "x-namespace-id: default" \
    -H "Cookie: better-auth.session_token=<token>"

  curl -s "http://localhost:3200/api/decisions?status=pending" \
    -H "x-namespace-id: default" \
    -H "Cookie: better-auth.session_token=<token>"


Get Decision
------------
GET /api/decisions/:id

response: { decision: Decision }
  404 if not found

  curl -s http://localhost:3200/api/decisions/abc123 \
    -H "x-namespace-id: default" \
    -H "Cookie: better-auth.session_token=<token>"


Create Decision
---------------
POST /api/decisions

request body:
  prompt      string    required. the decision question/problem

response: { decision: Decision }  (status 201)
  new decision starts in "intake" status

  curl -s -X POST http://localhost:3200/api/decisions \
    -H "x-namespace-id: default" \
    -H "Cookie: better-auth.session_token=<token>" \
    -H "Content-Type: application/json" \
    -d '{"prompt": "Should we migrate from REST to GraphQL?"}'


Update Decision
---------------
PATCH /api/decisions/:id

request body: any partial Decision fields

response: { decision: Decision }

  curl -s -X PATCH http://localhost:3200/api/decisions/abc123 \
    -H "x-namespace-id: default" \
    -H "Cookie: better-auth.session_token=<token>" \
    -H "Content-Type: application/json" \
    -d '{"priority": "p1", "category": "architecture"}'


Delete Decision
---------------
DELETE /api/decisions/:id

response: { success: true }

  curl -s -X DELETE http://localhost:3200/api/decisions/abc123 \
    -H "x-namespace-id: default" \
    -H "Cookie: better-auth.session_token=<token>"


2. Research
===========

POST /api/decisions/:id/research

two-phase endpoint. phase 1 starts an AI research job. phase 2
applies the completed job result to the decision. in practice,
the job callback auto-applies results (see section 7), so phase 2
is a fallback for manual polling.


Phase 1: Start Research
-----------------------
request body:
  (empty)     starts fresh research using "decision_research" template
  steering    string (optional). if present, uses "decision_steering"
              template to refine previous analysis with new direction

response: { jobId: string, status: "pending" }

side effects:
  - decision.status set to "researching"
  - decision.activeJobId set to job id
  - spawns the detached typed job worker (lib/runner-job-worker.js)

  curl -s -X POST http://localhost:3200/api/decisions/abc123/research \
    -H "x-namespace-id: default" \
    -H "Cookie: better-auth.session_token=<token>"

  curl -s -X POST http://localhost:3200/api/decisions/abc123/research \
    -H "x-namespace-id: default" \
    -H "Cookie: better-auth.session_token=<token>" \
    -H "Content-Type: application/json" \
    -d '{"steering": "Focus more on performance implications"}'


Phase 2: Apply Research Result
------------------------------
request body:
  jobId       string    required. the completed job id

response: { decision: Decision }  (updated with research results)

the job result is expected to contain:
  title, priority, category, context, options, recommendation

side effects:
  - decision.status set to "pending"
  - decision.activeJobId cleared
  - options, recommendation, context populated from job result

  curl -s -X POST http://localhost:3200/api/decisions/abc123/research \
    -H "x-namespace-id: default" \
    -H "Cookie: better-auth.session_token=<token>" \
    -H "Content-Type: application/json" \
    -d '{"jobId": "job-1710000000000-abc1234"}'

errors:
  404   job not found
  400   job not complete yet
  500   job failed (returns job.error)


3. Resolve (Approve)
=====================

POST /api/decisions/:id/resolve

approves a decision by selecting an option, then creates tasks
(native sqlite) from the selection. if the guided flow produced an
execution plan (round 3), creates an epic with subtasks and
dependencies. otherwise creates a single task.

prerequisites: decision.status must be "pending"

request body:
  selectedOptionId    string    required. which option to approve
  notes               string?   optional approval notes

response: {
  decision: Decision,   (status now "approved")
  taskId: string,       (epic/task id)
  taskIds: string[]     (all created task ids, if plan produced subtasks)
}

task creation behavior:
  without guided plan:
    - creates single task
    - title: "<decision title>: <option name>"
    - description includes problem + approach
    - notes include context, alternatives considered, ai recommendation

  with guided plan (guidedFlow.round3.plan exists):
    - creates epic (parent task) with plan summary
    - creates subtask per plan task, parented to epic
    - wires up plan dependencies via task store API
    - response.taskIds contains [epicId, ...subtaskIds]

  curl -s -X POST http://localhost:3200/api/decisions/abc123/resolve \
    -H "x-namespace-id: default" \
    -H "Cookie: better-auth.session_token=<token>" \
    -H "Content-Type: application/json" \
    -d '{"selectedOptionId": "opt-1", "notes": "Going with option A per team consensus"}'

errors:
  404   decision or option not found
  400   decision not in "pending" status


4. Retrospective
=================

POST /api/decisions/:id/retrospective

two-phase endpoint (same pattern as research). generates a
post-mortem review of a resolved decision.

prerequisites: decision must have a resolution


Phase 1: Start Retrospective
-----------------------------
request body: (empty)

response: { jobId: string, status: "pending" }

side effects:
  - decision.retroJobId set to job id
  - spawns the detached typed job worker (lib/runner-job-worker.js)

  curl -s -X POST http://localhost:3200/api/decisions/abc123/retrospective \
    -H "x-namespace-id: default" \
    -H "Cookie: better-auth.session_token=<token>"


Phase 2: Apply Retrospective Result
------------------------------------
request body:
  jobId       string    required. the completed job id

response: { decision: Decision }

the job result is expected to contain:
  summary, outcome, lessonsLearned[]

side effects:
  - decision.status set to "done"
  - decision.retrospective populated
  - decision.retroJobId cleared

  curl -s -X POST http://localhost:3200/api/decisions/abc123/retrospective \
    -H "x-namespace-id: default" \
    -H "Cookie: better-auth.session_token=<token>" \
    -H "Content-Type: application/json" \
    -d '{"jobId": "job-1710000000000-xyz5678"}'

errors:
  400   decision has no resolution to review


5. Guided Flow
===============

the guided flow is a 3-round wizard for structured decision-making.
it replaces the classic research flow with an interactive process:

  round 1: tradeoff questions (generate, answer, build preference profile)
  round 2: tailored options (generated based on preferences)
  round 3: execution plan (generated for the selected option)

all guided endpoints are two-phase (trigger job, then apply result).
the job callback auto-applies results, so phase 2 is a fallback.


5a. Generate Questions (Round 1)
---------------------------------
POST /api/decisions/:id/guided/questions

Phase 1: Start generation
  request body: (empty)
  response: { jobId: string, status: "pending" }

  side effects:
    - decision.mode set to "guided"
    - guidedFlow initialized if not present
    - guidedFlow.round1.generationJobId set
    - guidedFlow.startedAt set

Phase 2: Apply questions
  request body: { jobId: string }
  response: { decision: Decision, questions: TradeoffQuestion[] }

  side effects:
    - guidedFlow.currentRound set to 1
    - guidedFlow.round1.status set to "in_progress"
    - guidedFlow.round1.questions populated

TradeoffQuestion shape:
  id          string    unique question id
  text        string    the question text
  optionA     object    { label: string, value: string, icon?: string }
  optionB     object    { label: string, value: string, icon?: string }
  category    string    question category
  weight      number    importance weight

  curl -s -X POST http://localhost:3200/api/decisions/abc123/guided/questions \
    -H "x-namespace-id: default" \
    -H "Cookie: better-auth.session_token=<token>"


5b. Answer Question (Round 1)
-------------------------------
POST /api/decisions/:id/guided/answer

saves a single tradeoff answer. does NOT spawn a job. synchronous.

request body:
  questionId    string              required
  choice        "a" | "b" | "skip"  required

response: {
  decision: Decision,
  allAnswered: boolean,       true when all questions answered
  answersCount: number,       current answer count
  totalQuestions: number      total question count
}

behavior:
  - if question already answered, overwrites previous answer
  - when allAnswered becomes true:
    - guidedFlow.round1.status set to "complete"
    - guidedFlow.round1.preferenceProfile built from answers
      (maps each category to the chosen value)

  curl -s -X POST http://localhost:3200/api/decisions/abc123/guided/answer \
    -H "x-namespace-id: default" \
    -H "Cookie: better-auth.session_token=<token>" \
    -H "Content-Type: application/json" \
    -d '{"questionId": "q1", "choice": "a"}'

errors:
  400   questionId and choice required
  400   no guided flow initialized


5c. Generate Options (Round 2)
-------------------------------
POST /api/decisions/:id/guided/options

generates tailored options based on the preference profile from
round 1. should be called after all questions are answered.

Phase 1: Start generation
  request body: (empty) or { preferences: Record<string, string> }
  response: { jobId: string, status: "pending" }

  side effects:
    - guidedFlow.round2.status set to "generating"
    - guidedFlow.round2.generationJobId set
    - prompt built from decision context + preference summary + constraints

Phase 2: Apply options
  request body: { jobId: string }
  response: { decision: Decision, options: TailoredOption[] }

  side effects:
    - guidedFlow.currentRound set to 2
    - guidedFlow.round2.status set to "ready"
    - guidedFlow.round2.tailoredOptions populated
    - decision.options updated (standard Option[] without matchScore)
    - decision.recommendation updated

TailoredOption shape (extends Option):
  matchScore    number    0-100 how well option matches preferences
  matchLabel    string?   human-readable match description
  preview       object?   { type: "image"|"component"|"code", content: string }

  curl -s -X POST http://localhost:3200/api/decisions/abc123/guided/options \
    -H "x-namespace-id: default" \
    -H "Cookie: better-auth.session_token=<token>"

errors:
  400   no guided flow initialized


5d. Generate Plan (Round 3)
----------------------------
POST /api/decisions/:id/guided/plan

generates an execution plan for the selected option. the selected
option can be passed in the request body or read from
guidedFlow.round2.selectedOptionId.

Phase 1: Start generation
  request body:
    selectedOptionId    string?   option id (optional, uses stored selection)
  response: { jobId: string, status: "pending" }

  side effects:
    - guidedFlow.round2.selectedOptionId updated (if passed)
    - guidedFlow.round3.status set to "generating"
    - guidedFlow.round3.generationJobId set

Phase 2: Apply plan
  request body: { jobId: string }
  response: { decision: Decision, plan: ExecutionPlan }

  side effects:
    - guidedFlow.currentRound set to 3
    - guidedFlow.round3.status set to "ready"
    - guidedFlow.round3.plan populated

ExecutionPlan shape:
  summary         string            plan overview
  totalEstimate   string?           total time estimate
  tasks           PlanTask[]        ordered task list
  dependencies    PlanDependency[]  task dependency edges

PlanTask shape:
  id              string    plan-local task id
  title           string    task title
  description     string    what to do
  subtasks        string[]  checklist items
  estimate        string?   time estimate
  assignee        string?   suggested assignee
  priority        number    0-4
  phase           number    execution phase number

PlanDependency shape:
  from            string    plan task id (blocker)
  to              string    plan task id (blocked)

  curl -s -X POST http://localhost:3200/api/decisions/abc123/guided/plan \
    -H "x-namespace-id: default" \
    -H "Cookie: better-auth.session_token=<token>" \
    -H "Content-Type: application/json" \
    -d '{"selectedOptionId": "opt-1"}'

errors:
  400   no guided flow initialized
  400   no option selected (neither in body nor stored)


6. Guided Flow State Machine
==============================

round transitions:
  (create decision)
    status: intake, guidedFlow: null

  POST /guided/questions (start)
    mode: "guided"
    guidedFlow.currentRound: 0
    round1.status: pending, round1.generationJobId: <id>

  (job completes via callback)
    guidedFlow.currentRound: 1
    round1.status: in_progress, round1.questions: [...]

  POST /guided/answer (repeat per question)
    round1.answers grows
    when all answered: round1.status: complete
                       round1.preferenceProfile: {...}

  POST /guided/options (start)
    round2.status: generating, round2.generationJobId: <id>

  (job completes via callback)
    guidedFlow.currentRound: 2
    round2.status: ready, round2.tailoredOptions: [...]

  (user selects option in UI)
    round2.selectedOptionId: <id>

  POST /guided/plan (start)
    round3.status: generating, round3.generationJobId: <id>

  (job completes via callback)
    guidedFlow.currentRound: 3
    round3.status: ready, round3.plan: {...}

  POST /resolve
    status: approved
    creates epic + subtasks from plan


7. Job Lifecycle
=================

all async AI generation (research, retrospective, guided rounds)
follows the same pattern:

  1. API endpoint creates a job via createJob()
     - job stored as a validated JSON record in the namespace jobs dir
       (job-store.ts resolves nsPath(nsId, "jobs"); it collapses onto the
       project root only in the default namespace)
     - job.status = "pending"
     - job.decisionId links back to the decision

  2. API spawns the detached typed job worker (lib/runner-job-worker.js,
     compiled from web/lib/runner-v2/job-worker.ts)
     - runs as child_process.spawn with detached: true
     - inherits env vars for namespace/org/project resolution
     - receives JOB_CALLBACK_URL and JOB_CALLBACK_SECRET

  3. the job worker executes the AI prompt
     - reads job from disk, sets status to "running"
     - pipes prompt through CLI (claude)
     - extracts JSON result from AI output

  4. the job worker calls JOB_CALLBACK_URL on completion
     - POST /api/jobs/:id/complete
     - body: { status: "complete", result: {...} } or
             { status: "failed", error: "..." }

  5. callback endpoint (/api/jobs/:id/complete) auto-applies:
     - updates job status on disk
     - if job.decisionId is set, auto-applies result to decision
     - research/steering: sets title, context, options, recommendation,
       status -> "pending", clears activeJobId
     - retrospective: sets retrospective, status -> "done",
       clears retroJobId
     - guided_questions: populates round1.questions,
       round1.status -> "in_progress"
     - guided_options: populates round2.tailoredOptions,
       round2.status -> "ready", updates decision.options
     - guided_plan: populates round3.plan,
       round3.status -> "ready"
     - on failure: clears the generationJobId pointer so UI
       knows the job is no longer running

  stale detection:
    jobs running > 5 minutes are auto-marked as failed when read.
    this prevents zombie jobs from blocking the UI indefinitely.

  polling fallback:
    the phase 2 endpoints (POST with { jobId }) exist as a manual
    fallback. in normal operation the callback handles everything
    automatically. the UI polls GET /api/decisions/:id to see
    updated state.


Job Types
---------
  decision_research          fresh research from user prompt
  decision_steering          refine previous analysis with new direction
  decision_retrospective     post-decision review
  decision_guided_questions  generate tradeoff questions
  decision_guided_options    generate tailored options from preferences
  decision_guided_plan       generate execution plan for selected option


8. Error Handling
==================

all endpoints return errors in the shape:
  { error: string }

common status codes:
  400   bad request (missing field, wrong status, no guided flow)
  401   unauthorized (missing/invalid auth)
  404   decision or job not found
  500   internal error (job failure, storage error)

job failure propagation:
  when a job fails, the callback clears the relevant jobId pointer
  on the decision. the phase 2 apply endpoints also check for job
  failure and return the error message with status 500.


9. Templates Used
==================

research endpoints use generation templates resolved from the
org's template storage. these are the template slugs:

  decision_research           initial research prompt
  decision_steering           re-research with new direction
  decision_retrospective      retrospective generation
  decision_guided_questions   tradeoff question generation
  decision_guided_options     tailored option generation
  decision_guided_plan        execution plan generation

templates support variable substitution:
  {USER_PROMPT}              original decision prompt
  {PREVIOUS_ANALYSIS}        compiled context from prior research
  {STEERING_INPUT}           user's steering direction
  {DECISION_CONTEXT}         compiled decision context string
  {USER_PREFERENCES}         preference profile from round 1
  {CONSTRAINTS}              decision constraints
  {SELECTED_OPTION}          full selected option description
