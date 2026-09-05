---
title: "New-user first-run setup and onboarding"
status: "SPEC — VERSION 11 (RESOLVES THIRTEEN GAPS LEFT OPEN BY V10)"
current_version: 11
final_version: 11
version_count: 11
review_agents: 5
change_summary: >
  Replace the current four-step welcome wizard with one resumable, server-verified
  Setup Center that makes the chain provider, active default profile, floating
  input bar, GitHub connection, first workspace, readiness proof, and first chain
  run visible and actionable in one panel. Version 10 added the five review
  corrections: a shorter novice path with input-bar setup outside the critical
  path, an explicit safe sample-run contract, durable atomic operations and
  idempotency, strict GitHub credential and filesystem boundaries, fail-closed
  readiness, scoped authorization, and executable accessibility/sibling gates.
  Version 11 resolves thirteen gaps a post-v10 review found still open despite
  the "final" label: the GitHub App self-hosted registration reality, the
  primary interactive-CLI auth contract, authority-level (not prompt-level)
  sample non-mutation plus migration off the existing three-agent sample, the
  relationship between provider-step and preflight readiness, the ignored
  advisor default, the broken step numbering, a single canonical status
  vocabulary, a concrete deadline policy, the input-bar backend source, the
  Mentiko executor semantics for "local", record and in-flight-user migration,
  a stale-revision failure category with matching telemetry, and the single-org
  trust-boundary scoping of the authorization model.
version_history:
  - version: 1
    summary: "Defined the failure invariant: a configured CLI is not ready until its persisted runtime default is verified."
  - version: 2
    summary: "Made one canonical, resumable Setup Center the source of onboarding truth."
  - version: 3
    summary: "Defined explicit provider selection, authentication, profile recommendation, and default activation."
  - version: 4
    summary: "Added real readiness and first-run proof instead of treating setup or process launch as success."
  - version: 5
    summary: "Added floating input bar setup as a separate, optional capability with honest availability states."
  - version: 6
    summary: "Added GitHub connection, repository browsing, branch selection, and first-workspace creation."
  - version: 7
    summary: "Unified the panel interaction model, copy, responsive behavior, and clickable state cards."
  - version: 8
    summary: "Added security, authorization, failure recovery, accessibility, telemetry, and rollout constraints."
  - version: 9
    summary: "Added implementation seams, proposed contracts, acceptance tests, sibling-surface sweep, and review checklist."
  - version: 10
    summary: "Final after five independent reviews; closes sample-run, optional-step, atomicity, idempotency, security, scope, accessibility, and sibling-surface gaps."
  - version: 11
    summary: "Resolves thirteen gaps left open by v10: GitHub App self-hosted registration, interactive-CLI auth contract, authority-level sample non-mutation and old-sample migration, provider-vs-preflight readiness, the advisor default, step numbering, one canonical status vocabulary, deadline policy, input-bar backend source, Mentiko 'local' executor semantics, record/in-flight migration, a stale-revision failure code plus telemetry, and single-org authorization scoping."
---

# New-user first-run setup and onboarding

Status: version 11. Version 10 was labeled "final after five independent
reviews"; a subsequent review found thirteen gaps still open (five substantive,
eight internal-consistency). Version 11 resolves all thirteen — the substantive
ones as normative decisions in the Version 11 resolutions section near the end
of this document, the consistency ones as in-place corrections to the sections
they affect.

This is a product and implementation specification for the first session in
Mentiko. It covers the welcome route, the embedded welcome panel, provider CLI
setup, the active default agent profile, the floating input bar, GitHub access,
first-workspace selection, readiness proof, and the first real chain run.

The deliverable is the spec only. It does not authorize implementation,
deployment, commit, push, or changes to unrelated work.

Review result: all five requested independent reviewers returned a blocking
review of Version 9. Version 10 accepts the material findings and turns them
into normative requirements and tests. Reviewer identities, roles, and
accepted changes are recorded in the Version 10 review log near the end of this
document.

## Executive decision

Build one canonical Setup Center. Render the same state machine at
 /welcome and inside FloatingWelcomePanel. The dashboard checklist and the
 floating input bar may launch or mirror the Setup Center, but neither may
 maintain a second onboarding truth model.

The user-visible promise is:

> Choose the tool you want to use, connect a project, and watch your first
> chain run.

The user must never have to know that Agent Configs exists in order to make a
provider the default. A provider save is incomplete until the selected profile
is persisted, marked as the default where the user asked for that, read back
from the server, and proven capable of starting and answering through the real
runner.

## The invariant

"Ready" is not one badge. Two distinct terminal claims exist, and each facts
subset below gates a different one (see Version 11 resolution G4 for the full
disambiguation):

- Provider Ready — the Step 1 provider card may show Ready only when facts 1–6
  hold. This is proven once, by one readiness run.
- All Set — the onboarding as a whole may show All Set only when facts 1–8 hold,
  i.e. Provider Ready plus a completed first (sample) chain run.

The Step 3 preflight does not start a second provider readiness run: it reuses
and re-displays the fact-6 proof already bound to the selected profile, and adds
only the fact-7/-8 checks. A green preflight is a read of persisted proof, never
a re-run that could mask a regression.

The onboarding UI may show either claim only when its required facts are all
true in the server's current scope:

1. A selected provider CLI is installed or otherwise available to the runtime.
2. Its auth path has completed successfully.
3. A concrete profile ID is selected.
4. That exact profile ID is the persisted agent default (isDefault) for new
   chains, or is attached explicitly to the first chain. This governs the agent
   default only; the separate advisor default (isAdvisorDefault) is handled by
   Version 11 resolution G5 and never substitutes for it.
5. The profile's effective environment and credential references resolve without
   exposing secret values.
6. A real readiness run has started, passed the applicable readiness policy, and
   produced one bounded answer.
7. A workspace exists and is authorized for that user and organization when the
   selected run needs a workspace.
8. The first chain run was started with the same resolved profile and workspace
   that the UI shows.

Local storage can remember where the user was. It cannot decide whether the
system is ready.

## Success bar

A first-time user who knows only “I want to use Codex on this project” can do
the following without visiting Agent Configs, reading CLI documentation, or
editing a file:

- choose Codex, Claude Code, or another supported CLI;
- complete the auth path for that CLI;
- see the exact profile and model that will run;
- make that profile the default with a visible, explicit action;
- set up or skip the floating input bar;
- connect GitHub or choose a local/empty project;
- browse repositories instead of copying a raw URL;
- select a repository and branch and create a workspace;
- run a real readiness test;
- run a sample chain in the same panel;
- understand what failed and what to click next;
- leave and return later without losing the server-verified progress.

Target time to first successful sample run: 10 minutes for a prepared machine.
The UI must not imply that provider installation, GitHub OAuth approval, or a
large repository clone can complete in a fixed number of seconds.

## Scope

In scope:

- The canonical onboarding state machine and persistence.
- Provider detection, authentication, profile selection, default activation,
  and real readiness proof.
- Floating input bar setup and its availability states.
- GitHub account/repository access and first-workspace selection.
- Local folder, new project, ZIP, and manual Git fallback paths.
- Inline readiness and sample-run progress.
- Responsive and accessible behavior at 390 px, 820 px, and desktop widths.
- The dashboard Getting Started mirror and every launch link into the flow.
- Security, authorization, telemetry, test cases, rollout, and rollback.

Out of scope:

- Replacing the provider CLIs or their auth systems.
- Redesigning the entire Agent Configs editor.
- Full GitHub issue/PR automation in onboarding.
- Automatically pushing code to GitHub.
- Making the floating input bar a prerequisite when the install does not expose
  that capability.
- Changing provider catalog semantics without the catalog/bundle regeneration
  and parity checks required by the platform instructions.
- A local Docker image build or a deployment.

## Current reality audit

The following is grounded in the current Mentiko checkout. These are the
producers and consumers the implementation must reconcile.

### Current welcome flow

- WelcomeWizard currently has four steps: welcome, cli-setup, project-setup,
  and done in
  web/components/onboarding/welcome-wizard.tsx:62-279.
- The wizard hydrates its current step and configured tool list from
  user-scoped localStorage, then separately preloads CLI detection.
- On mount it fire-and-forgets install-bundle for every detected CLI in
  web/components/onboarding/welcome-wizard.tsx:102-134.
- handleConfigureTool only updates local wizard state. Its comment assumes the
  bundle install will promote the first profile to default.
- CliSetupStep calls install-bundle again after auth, then silently swallows
  failures in web/components/onboarding/steps/cli-setup-step.tsx:197-228.
- The current picker presents provider choices, but it does not show the
  persisted default profile, wait for server confirmation, or run a real
  readiness proof.

### Why the default bug exists

- install-bundle computes hasDefault before syncing the bundle and promotes a
  profile only when installed.length is greater than zero in
  web/app/api/agent-profiles/install-bundle/route.ts:78-137.
- An already-present bundle profile is reported as skipped or synced, so a new
  user can have profiles but still have no default and receive no promotion.
- The promotion target is the first installed profile, not a user-selected
  profile or a catalog-declared onboarding recommendation.
- The current catalog contains Codex profiles where codex-default has readiness
  disabled while codex-terra and codex-fast have readiness enabled. Array order
  is therefore not a safe onboarding decision.
- findDefaultProfile returns the first persisted profile with isDefault in
  web/lib/agents/agent-profile-storage.ts:244-247. A missing default is a
  runtime condition, not merely a cosmetic badge.
- The direct PATCH profile route already exposes an isDefault seam, but the
  onboarding flow does not own or verify it.

### Current readiness and run seams

- Agent Configs can launch the existing readiness test through
  web/app/api/agent-profiles/[id]/test-session/route.ts:53-122.
- The readiness chain explicitly names the profile, uses the real chain runner,
  limits the probe to one bounded answer, and says not to modify files in
  web/app/api/agent-profiles/[id]/test-session/route.ts:16-51.
- That endpoint returns a started run, not a completed proof. The onboarding
  UI must poll the run status and inspect the terminal result before showing
  Ready.
- startChainRun resolves the requested profile, chain default, workspace
  default, and persisted profiles in
  web/lib/runs/chain-run-service.ts:320-754. The onboarding contract must pass
  the exact profile ID explicitly and record the resolved ID in run metadata.
- classifyCliReadiness can return ready, unknown, no_ready_signal, or a
  failure status depending on the profile policy in
  web/lib/runner-v2/readiness-policy.ts:77-125. Unknown and no_ready_signal
  cannot be rendered as green success in the new flow.
- resolveRunAgentProfile prioritizes a workspace default ahead of the
  namespace default and then falls back to profiles[0] in
  web/lib/agents/run-agent-profile.ts:13-35. That fallback can hide a missing
  or wrong default, so the first onboarding run must send and verify an
  explicit profile ID.
- The existing sample helper still navigates to /chains/{id}/run and then
  falls back to /chains in web/lib/onboarding/seed-sample-chain.ts:34-36,
  95-112. The Setup Center needs a canonical inline sample-run operation,
  not a guessed deep link whose route or state may be stale.
- The current sample template grants read, command, and artifact-write
  authorities in web/lib/onboarding/sample-chain-template.ts:118-154. The
  onboarding sample must have an explicit non-mutating contract and a
  non-empty default goal before it is presented as a safe first action.
- apiSuccess wraps responses as success, data, and requestId in
  web/lib/api-response.ts:42-49. New routes must preserve this envelope.

### Current project and GitHub seams

- ProjectSetupStep offers Git URL, local folder, new project, and ZIP choices
  in web/components/onboarding/steps/project-setup-step.tsx:33-157.
- GitCloneSetup accepts a raw URL and uses terminal auth or a token path. There
  is no GitHub account connection or repository browser in the current wizard.
- integrations/save writes a sanitized namespace-level integrations config but
  does not store a token in web/app/api/integrations/save/route.ts:11-52.
- integrations/github/test validates a supplied token and optional repository
  access, but it does not persist a connection or list repositories in
  web/app/api/integrations/github/test/route.ts:8-72.
- fs/git-clone accepts caller-supplied URLs and has a token path that must be
  tightened for onboarding; onboarding must keep credentials server-side and
  must not put them in clone URLs visible to the browser, process arguments,
  or logs.
- The workspaces route accepts a browser-supplied local path and may run git
  init in web/app/api/workspaces/route.ts:38-98. The new GitHub import path
  must use a server-owned, user- or organization-scoped destination with
  realpath, symlink, host, and protocol checks before any filesystem or git
  side effect.
- WorkspaceProvider loads workspaces and chooses a selected workspace. The
  Setup Center must wait for workspace creation to be persisted before moving
  to the run proof.

### Current persistence and duplicated truth

- onboarding-storage scopes its localStorage key by user ID, while the
  workspace context uses the global key mentiko-workspace. Browser state is
  therefore useful for draft recovery but cannot be the authority for a
  default, connection, workspace, readiness result, or completed run.
- The Setup Center, dashboard GettingStarted checklist, Agent Configs, and
  FloatingKollaborBar currently expose overlapping setup entry points. The
  implementation must converge them on one server-backed state machine and
  preserve the old routes only as safe mirrors or recovery destinations.

### Current floating input bar

- FloatingKollaborBar is rendered by the app shell on non-standalone routes and
  is feature-gated. /welcome is a standalone path, so the bar is not currently
  part of the welcome screen.
- The bar can show a setup link that routes to /settings/agent-configs, but that
  is a dead-end for a new user who is still in onboarding.
- The bar has a separate connection/session lifecycle and must not be
  conflated with the selected chain provider CLI.
- The new flow must state when the bar is available, unavailable on this
  install, connecting, connected, or failed. An unavailable optional feature
  is not a failed onboarding state.

### Current dashboard duplication

GettingStarted has six checks, including Configure an AI provider and Visit
Agent Configs as separate steps, in
web/components/dashboard/getting-started.tsx:28-264.

That checklist currently mixes localStorage CLI-auth state, profile existence,
workspace existence, chain existence, and run existence. It can tell a user to
visit Agent Configs even when the actual onboarding goal is simply “choose and
prove the default provider.” The new checklist must derive from the same
server-backed onboarding state and open the exact Setup Center step that needs
attention.

## Research receipts and product patterns

These sources were checked online on 2026-08-26. The conclusions below are
design inferences from their documented flows, not claims that Mentiko should
copy their visual language.

### Vercel: import and configure in one project flow

Vercel documents a flow that starts from one New Project action, presents
repositories the connected Git account can access, allows a repository or
template, then exposes project configuration before the final deploy:

- https://vercel.com/docs/git
- https://vercel.com/docs/projects/managing-projects

Takeaway: connect the source account first, show the user a browsable resource
list, keep the final configuration in the same creation flow, and make the
primary action unambiguous.

### Replit: multiple import sources with a guided GitHub path

Replit documents a dedicated import surface with a provider picker, GitHub
connection, repository selection, and an Import action. It also provides a
simple URL shortcut for public repositories and a ZIP fallback:

- https://docs.replit.com/build/import-from-providers

Takeaway: keep the happy path visual and guided while preserving an advanced
URL path for users who already know exactly what they are doing.

### GitHub Codespaces: resource creation as visible milestones

GitHub documents creation as a sequence of VM/storage assignment, repository
clone, connection, and post-creation setup. It distinguishes the default path
from advanced machine or branch options:

- https://docs.github.com/en/codespaces/developing-in-a-codespace/creating-a-codespace-for-a-repository?tool=vscode
- https://docs.github.com/en/codespaces/quickstart?apiVersion=2022-11-28

Takeaway: expose progress as concrete milestones, keep advanced choices behind
an optional disclosure, and do not claim completion when the environment is
only allocated or the repository clone has only started.

### GitHub Copilot app: connect a project before promising core value

GitHub's Copilot app quickstart asks the user to choose a model provider when
needed, then select a recent repository, local folder, or repository URL. It
also states that a connected project unlocks the core workflow:

- https://docs.github.com/en/copilot/get-started/quickstart-copilot-app

Takeaway: explain why the project connection matters, offer recent choices,
and make a local or manual fallback available without forcing every user
through the same integration.

### Claude Code and Cursor: first useful action beats settings tours

Anthropic's Claude Code setup docs sequence installation, authentication, and
starting in a project. Cursor's quickstart sequences sign-in, picking a folder,
asking the agent to explain the codebase, making a small edit, and reviewing
the result:

- https://docs.anthropic.com/en/docs/claude-code/getting-started
- https://docs.cursor.com/en/get-started/quickstart

Takeaway: the first session should end in a visible useful result. Setup
instructions belong immediately next to the action they unblock; users should
not be sent on a settings scavenger hunt.

### GitHub authorization: choose narrow access and name it

GitHub states that GitHub Apps are generally preferred to OAuth apps because
they support fine-grained permissions, repository selection, and short-lived
tokens. GitHub also documents that an app installation and user authorization
are separate concepts:

- https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/differences-between-github-apps-and-oauth-apps
- https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app
- https://docs.github.com/en/enterprise-cloud@latest/apps/using-github-apps/authorizing-github-apps

Takeaway: “Sign in with GitHub” and “give Mentiko access to repositories” are
different user decisions. The UI must name the resource access, request the
minimum needed for pull/push, show the connected account, and provide a
disconnect path.

### Linear: orient the user before asking for administration

Linear's start guide presents a high-level walkthrough and demo before
workspace administration, and describes a workspace as the home for the team's
work:

- https://linear.app/docs/start-guide
- https://linear.app/docs/workspaces

Takeaway: lead with a clear mental model and a small guided first result; do
not make a new user learn the product's internal settings taxonomy first.

### Research-to-decision matrix

The research is only useful if it changes an implementation decision:

- Vercel's connected-account repository list becomes the GitHub repository
  browser, with recent repositories first, a selected row, and one
  “Use This Project” action. Test: a user can select a repository without
  typing a URL.
- Replit's guided provider/import split becomes the project chooser:
  GitHub and example project are first-class novice paths; raw URLs, ZIP, SSH,
  and monorepo controls are under More Ways. Test: the novice path has no raw
  URL or branch field before selection.
- Codespaces' concrete creation milestones become the workspace operation
  phases: preparing, cloning, checking out, registering, and ready. Test:
  reload during any phase resumes or reattaches without a duplicate workspace.
- Copilot's “connect a project to unlock the core workflow” becomes the
  plain-language explanation before workspace selection. Test: the user sees
  where agents run and what the project unlocks before cloning.
- Claude Code and Cursor's first useful action becomes the success bar:
  readiness is not the finish line; the sample result is. Test: “All Set” is
  impossible before a completed sample run.
- GitHub's App/OAuth distinction becomes separate account and repository
  access states, least-privilege capability labels, and a revocable connection.
  Test: GitHub sign-in alone never populates private repositories.
- Linear's orientation-before-administration pattern becomes a short welcome
  promise and inline repair path instead of an Agent Configs tour. Test: a
  novice can finish without opening settings.

## UX north star: the 10-year-old test

The experience passes the test when a child who can read but does not know what
an agent profile, workspace, OAuth scope, or CLI is can answer these questions
from the current screen:

- What am I doing?
- Why is Mentiko asking?
- Which button do I press?
- What happens next?
- How do I know it worked?
- What can I do if it did not work?

Rules:

- One primary action per panel state.
- Use “tool” or “AI tool” before introducing “CLI.”
- Use “Use this for my first run” before “Set as default profile.”
- Show the selected tool, exact profile name, model, project, and run status in
  plain language.
- Never make a green check depend on a value that only exists in localStorage.
- Every failure state has one plain-language diagnosis and one primary repair
  action.
- Every visible card is either clickable or visibly informational. An arrow
  icon is not decoration if the card looks actionable.
- “Skip for now” is always available for optional input-bar and GitHub setup,
  but the resulting not-ready state explains what the user will not be able to
  do yet.
- Preserve context when opening advanced setup. Return the user to the same
  step with the selected choice intact.
- Do not use unexplained lower-case labels or mixed names such as “Claude API
  Key” when the product name is Claude Code.

## Canonical information architecture

### One component, two entry surfaces

Create one SetupCenter component backed by one hook/store and one server state
endpoint:

- Standalone route: /welcome.
- Embedded surface: FloatingWelcomePanel.

The component accepts a surface context for layout and return behavior, not a
different business state. The same server state must render the same statuses,
labels, profile ID, workspace ID, and next action on both surfaces.

The panel layout:

- Header: “Let’s get your first chain running.”
- Subhead: “This takes a few minutes. You can come back anytime.”
- Progress: five required-or-optional milestones with a visible current step.
- Main content: one step at a time, with back and next controls.
- Footer: “Save and exit” or close, with resume behavior.
- On the proof step: inline run monitor and output, not an automatic redirect.

The required first-value path is:

1. Choose your AI tool.
2. Connect your project.
3. Check that everything works.
4. Run your first chain.

GitHub account connection and repository selection are substeps of Connect
your project. Set up the input bar is an optional side quest shown in the same
Setup Center, after the first successful chain by default. It can be opened
earlier from the panel, but it is never a prerequisite for readiness or first
value, and skipped optional work never lowers required progress.

### The step rail is a control, not a decoration

Each milestone displays one of:

- Not started — button opens the step.
- In progress — button resumes the step.
- Needs attention — button opens the failed or incomplete action.
- Ready — button opens a review of the persisted result.
- Skipped — button explains the capability left unused and offers setup.
- Not available — feature is not exposed on this install; never block on it.

Completed milestones are clickable. Clicking one opens its summary and gives
the user an Edit or Recheck action. Do not make the user restart the wizard to
change a provider or project.

## Detailed user journey

### Step 0: welcome

Copy:

- Heading: “Let’s get your first chain running.”
- Body: “Choose the AI tool you want to use, connect a project, and watch
  Mentiko run a small chain.”
- Primary button: “Get Started.”
- Secondary action: “I’ll explore first.”

“I’ll explore first” leaves the state resumable and routes to the dashboard.
It must not clear setup progress or imply that the system is ready.

If the server already has partial state, replace the primary action with
“Continue Setup” and show the next unmet milestone in one sentence.

### Step 1: choose and activate the AI tool

#### Provider picker

Show detected tools first, then supported tools, then an advanced custom path.
Each card contains:

- Product name and executable name.
- Detected status: “Found on this machine,” “Not found,” or “Checking.”
- Auth status: “Signed in,” “Needs sign-in,” “API key needed,” or “Unknown.”
- A plain description of what the tool is for.
- One action: “Use [Tool]” or “Set up [Tool].”
- A visible “Recommended for your first run” badge only when the catalog
  declares that recommendation.

Do not equate “binary found” with “ready.” Detection is a hint that chooses
the shortest auth path.

For a tool that is not found, show the supported installation command or
external docs only as an advanced action. If the environment cannot install
software from the web, explain that the user must install it and provide a
“Check again” button.

#### Authentication view

Use provider-specific auth adapters, but keep the shell consistent:

1. Explain what will happen in one sentence.
2. Show the detected version and current auth status.
3. Offer the recommended auth method first.
4. Keep provider API-key entry in the existing secret form or an equivalent
   server-owned vault capture. The browser receives only a secret reference
   after save.
5. Never display or log the secret after save.
6. Show an explicit “Use this for my first run” control, selected by default
   when there is no current default.
7. Save, install/sync, activate, and verify in one awaited operation.

Example Codex copy:

- Heading: “Set up Codex.”
- Body: “Mentiko will use Codex to run the agents in your first chain.”
- Auth button: “Sign in to Codex.”
- Default control: “Use Codex for my first run.”
- Primary action after auth: “Save and Check Codex.”

If the user already has a default profile, say:

> Your current default is [profile name]. Use Codex for this setup?

Offer “Keep current default” and “Switch to Codex.” Never switch an existing
default without that explicit choice.

#### Default activation contract

The user-facing meaning of “Use for my first run” is:

- Select one concrete profile ID.
- If the user chose to switch or no default exists, persist that profile with
  isDefault true and clear the previous default atomically.
- If the user chose to keep the current default, keep it and attach the
  selected provider explicitly to the first chain only if the user asks.
- Read back the profile list or exact profile endpoint.
- Show “Default for new chains” only when the server read-back confirms the
  exact profile ID has isDefault true.
- Return the effective profile ID in the API response and save it in the
  onboarding state.

Installing or syncing a bundle is not default activation. A skipped existing
profile can still be explicitly made the default.

#### Activation transaction and recovery

Bundle sync, credential binding, default activation, and read-back are one
durable operation, not four unrelated browser requests. The operation records
the initiating user/namespace/org, idempotency key, request fingerprint,
current phase, revision, and safe terminal result.

The profile store must provide a single per-scope activation operation that:

1. locks or transactionally serializes the profile scope;
2. validates the selected profile still belongs to that scope;
3. syncs only declared catalog fields;
4. atomically writes exactly one default, or preserves the current default
   when the intent is Keep;
5. recovers from a crash without leaving a half-written profile file;
6. reads back the selected profile and the complete default set;
7. returns the same result for an idempotent replay.

If the existing file-backed store remains the implementation, use a
crash-safe temporary write plus flush/rename and a recovery rule; sequential
“clear every old file, then write the new file” is not sufficient. The
read-model invariant is exactly zero or one default only where zero is an
explicitly allowed pre-setup state; the provider completion operation must
not return verified success with zero or multiple defaults.

#### Recommended profile selection

The provider catalog must declare onboarding metadata instead of relying on
array order:

- onboardingRecommended: boolean or an explicit profile ID.
- readiness enabled and a usable ready signal.
- display name and model label.
- auth mode and credential binding requirements.
- supported runtime platforms.

If a provider has no profile with a verifiable readiness path, the UI must say
“This tool can be configured, but Mentiko cannot prove it is ready here” and
offer an advanced continue path that remains visibly unverified. It cannot
show the normal green Ready state.

For Codex specifically, the implementation must resolve the current mismatch
between the first catalog entry's disabled readiness and the readiness-enabled
Terra/Luna profiles before marking the default as verified. The spec does not
mandate a model; it mandates a catalog-declared recommendation and a passing
proof.

#### Success state

Show a compact proof card:

- “Codex is ready.”
- “Default for new chains: [exact profile display name].”
- Model label.
- Auth method, without secret values.
- “Recheck.”
- “Change tool.”

Do not advance automatically while an operation is in flight. The primary
button is disabled with a progress label, and any failed suboperation remains
visible.

### Step 2: connect a project

The project step begins with a source chooser:

- GitHub — “Browse repositories you can access.” Recommended when connected.
- Local folder — “Use a folder already on this machine.”
- New project — “Start with an empty project.”
- Upload ZIP — “Bring in a ZIP file.”
- Other Git URL — “Paste a URL.” Advanced fallback.

The chooser explains:

> Your agents need a project folder when a chain reads or changes files.

#### GitHub account connection

The UI must distinguish:

- Mentiko account sign-in with GitHub, which identifies the user; and
- GitHub repository access, which authorizes project browsing and clone/push
  operations.

Preferred path:

1. Click “Connect GitHub.”
2. Open the GitHub authorization or GitHub App installation flow.
3. Name the access requested in plain language:
   “Read the repositories you choose so Mentiko can clone a project. Write
   access is only needed if you later publish or push changes.”
4. Prefer a GitHub App installation with selected repositories and minimum
   permissions.
5. Return to the Setup Center and read the connection from the server.
6. Show the connected account avatar/login and a “Manage access” or
   “Disconnect” action.

Fallback:

- Do not add a raw PAT field to the beginner browser flow. Prefer
  GitHub App/OAuth; for self-hosted installations without that path, guide the
  user through the existing app terminal's gh auth login or an administrator-
  managed server-side secret capture.
- After terminal/server capture, the browser sees only a connection ID and
  safe capability summary.
- Show scope and expiration expectations before authorization.
- Never store a raw token in localStorage, URL parameters, browser requests
  after connection, browser logs, integration config JSON, clone URLs, process
  arguments, run metadata, or analytics.

If a future deployment requires a browser PAT capture, it is a separate
security-reviewed flow with one-time TLS submission directly into the vault;
it is not part of this onboarding contract and must not be reused by clone or
test endpoints.

The initial onboarding pull path requires repository metadata and contents read
access. Push is a separate, explicit action and should request write access
only when the user chooses “Publish to GitHub.”

#### Repository browser

After connection, show a real repository browser:

- Search field with a plain placeholder: “Search your repositories.”
- Recent repositories first.
- Owner or organization filter.
- Public/private visibility badge.
- Language and last-updated metadata when available.
- Empty state: “No repositories found. Try another search or use a Git URL.”
- Pagination or cursor loading; never load an unbounded repository list.
- Refresh button and a clear expired-access repair state.

Each repository row is a button with a selected state. The row must expose the
full name, not only an icon or truncated name. A selected row reveals:

- Default branch.
- Branch picker, with the default branch preselected.
- Optional destination workspace name.
- Optional monorepo root path, revealed only when needed.
- Primary action: “Use this project.”

If the user has not connected GitHub, the repository browser is replaced by
“Connect GitHub to browse your projects,” with local and manual alternatives
still visible.

#### Workspace creation

After “Use this project”:

1. Validate the repository and selected branch server-side.
2. Issue a server-owned, user/org-bound destination operation; do not accept an
   arbitrary browser path as workspace membership.
3. Show the safe destination name and execution host before starting the clone.
4. Start the clone through a server-side credential helper, never a URL or
   process argument containing a token.
5. Stream or poll concrete milestones: preparing, downloading, checking out,
   creating workspace, ready.
6. Create the workspace record only after the path and project metadata are
   valid and persisted.
7. Read the workspace back and show its ID/name/path summary, host, branch,
   and safe path label.

The server must canonicalize the destination with realpath and symlink checks,
enforce allowed roots, reject home/code-root escapes and cross-scope targets,
and block localhost/private-network/arbitrary SSH clone targets in the
GitHub-backed path. A generic Git URL fallback must use an explicit host and
protocol allowlist plus SSRF/private-address protection.

A clone failure must not create a false Ready workspace. The user gets:

- “Try again.”
- “Choose another branch.”
- “Use a different project.”
- “Use a local folder or URL instead.”

Do not show raw tokens, command lines containing tokens, or stack traces.

#### Local and fallback paths

Local, new, ZIP, and Other Git URL paths reuse the existing project components
where possible, but the same contract applies:

- persisted workspace record;
- authorized path;
- visible method and project summary;
- no success until the server confirms creation;
- return to the Setup Center with the result.

### Optional side quest: set up the floating input bar

This step is intentionally separate from the chain provider:

- Chain provider: the CLI/profile used by chain agents.
- Floating input bar: the chat-like Mentiko/Kollab interaction surface and its
  connection/session state.

The card must say which one is being configured.

The card is shown in the same Setup Center, but the novice path places it after
the first successful sample run. It is not required progress and it never
blocks provider setup, project setup, readiness, or first value.

Available path:

1. Explain: “The input bar lets you ask Mentiko for help from any page.”
2. Show the backend/profile it will use, if known, and label the execution
   surface separately from the chain provider.
3. Show the permission mode choice in plain language:
   “Ask before changes” versus “Let it work automatically.”
4. Use a test connection that proves the bar can connect and send one bounded
   harmless prompt.
5. Show a live miniature input field or a “Try the input bar” button.
6. Mark the card ready only when the connection/session proof completes.

The input bar is optional. Primary actions:

- “Set Up Input Bar.”
- “Skip for Now.”
- “Try It.”
- “Fix Connection.”

Unavailable path:

- If the feature flag or install does not expose the bar, show
  “Input Bar Is Not Available on This Install.”
- Explain that the chain setup can continue.
- Mark the card Not available, not failed.
- Do not route the user to a settings page that cannot fix it.

The bar setup must not silently select the chain provider profile as its
backend. If it needs a separate Mentiko/Kollab profile, show that distinction.

### Step 3: check that everything works

(Numbered Step 3 in the required path. The optional input-bar side quest above
is intentionally unnumbered: it is not part of the required first-value
sequence. The required path is exactly Step 0 welcome, then Steps 1–4.)

This is the shared proof panel for both readiness and first-run setup.

Show a preflight checklist:

- AI tool: exact CLI and version.
- Default profile: exact profile ID/display name and model.
- Auth: passed, without secrets.
- Project: exact workspace name, execution host, branch, and safe path label.
- Input bar: connected, skipped, or unavailable.
- Runner: available.

For a sample run, a persisted authorized workspace is required. If no
workspace exists, the primary action is “Choose a Project,” not Run Readiness.
The panel must say whether “local” means the browser-connected machine, the
Mentiko host, or another executor. It must show the approval mode and what the
sample can create before any command starts.

Every row is clickable:

- Passed row opens its summary and Recheck.
- Failed row opens its repair action.
- Skipped row opens the optional setup.
- Unknown row opens the reason, never a fake green check.

Primary action:

- “Run Readiness Check.”

The readiness check must use the exact profile selected for onboarding and the
selected workspace when the profile/chain requires it. It must:

- start through the real chain runner;
- use a bounded, non-mutating readiness chain;
- carry metadata identifying source=onboarding, profileId, workspaceId, and
  setupVersion;
- poll the run until a terminal state or an explicit timeout;
- inspect the readiness policy result and one answer;
- retain a run ID and human-readable result;
- show the actual output in the panel.

State labels:

- Checking — run has started and is being observed.
- Ready — run completed, readiness passed, and one answer was received.
- Needs Attention — auth/profile/workspace/readiness failed.
- Timed Out — no terminal proof in the allowed window.
- Unverified — the provider has no enabled readiness signal or the proof could
  not be completed; this is not Ready.

The panel must not mark success on:

- a successful bundle install;
- a 200 response from the start endpoint;
- a detected executable;
- a process that started but never answered;
- readiness disabled under a fail-closed policy;
- a localStorage flag.

### Step 4: run the first chain

After readiness passes, show two choices:

- “Run a Sample Chain” — recommended.
- “Open Chain Builder” — for a user who wants to create their own chain.

#### Sample chain contract

The sample is a product-owned, versioned chain with a non-empty default goal.
The default goal is:

> Read the project name and return one short sentence describing what it
> contains. Do not modify files, run long tasks, or create artifacts.

The sample template must not require the user to type a goal, and it must not
depend on a missing {TASK} substitution. Its success contract is one bounded
text answer, a terminal completed run, and zero file writes. If a future sample
needs to create an artifact, the UI must show the exact path, content type,
approval mode, and confirmation action before launch; that is a different
explicit sample version.

The onboarding sample endpoint owns the canonical seed/start flow. It must not
redirect to a guessed /chains/{id}/run URL or assume a route that no longer
exists. Existing seed-and-open callers must either call this endpoint or
explicitly use the current run surface.

The sample path:

1. Create or locate the versioned sample chain.
2. Send the non-empty default goal and show the selected provider, profile,
   model, execution host, and workspace before launch.
3. Start the sample run with explicit agentProfileId and workspaceId.
4. Keep the user in the same Setup Center panel.
5. Show live stages, current agent, elapsed time, queue state, and bounded
   output.
6. Show the terminal result and run ID.
7. Offer “Open Full Run,” “Run Again,” “Change Provider,” and
   “Open Workspace.”

After success, show an optional “Publish This Workspace to GitHub” action only
when the workspace has a GitHub connection and the user has write permission.
It opens a review of changed files, target repository, branch, visibility, and
the exact push action. It never pushes automatically and never uses the
readiness test as a write test.

If the sample run fails, keep the output and show the smallest repair action:

- provider/auth repair;
- default/profile repair;
- workspace/permission repair;
- runner/session repair;
- retry.

Do not send a new user to an empty /runs screen with no explanation. Full run
navigation is an explicit secondary action after the inline result exists.

If the user opens Chain Builder, prefill the chain's default profile with the
verified onboarding profile or make the choice visible before run. The first
chain must not silently fall back to an unrelated Agent Configs default. If the
workspace default differs, the first-run summary must show the difference and
require an explicit choice.

## State model

### Server-backed state

Persist a logical onboarding record scoped to the authenticated user,
namespace, and organization. The storage adapter may follow the existing
filesystem conventions, but the contract is:

- id: stable onboarding record ID;
- userId, namespaceId, orgId: server-derived scope tuple;
- schemaVersion;
- setupVersion;
- stateRevision;
- currentStep;
- selectedCli;
- selectedProfileId;
- selectedProfileDisplayName;
- selectedProfileModel;
- defaultIntent: use_selected, keep_current, or explicit_chain_only;
- defaultVerified: boolean;
- defaultVerifiedAt;
- advisorDefaultProfileId: the profile that is the persisted isAdvisorDefault,
  or null. Distinct from the agent default; see Version 11 resolution G5;
- advisorDefaultVerified: boolean;
- authMethod: interactive_cli, provider_api_key, or oauth_app — records which
  auth path completed so verification and copy pick the right contract; see
  Version 11 resolution G2;
- authState;
- inputBarBackend: the profile/backend the input bar will use, or null when the
  install does not expose the bar; never the chain-provider profile unless the
  user explicitly selects it. See Version 11 resolution G9;
- inputBarState;
- githubConnectionState;
- githubAccountLogin;
- githubConnectionId;
- selectedRepository;
- selectedBranch;
- workspaceId;
- workspaceName;
- workspaceOperationId;
- readinessRunId;
- readinessOperationId;
- readinessState;
- sampleChainId;
- sampleRunId;
- sampleOperationId;
- sampleRunState;
- inputBarOperationId;
- activeOperationId;
- lastError with safe error code/message;
- updatedAt.

Secrets and access tokens are references only. They never belong in this
record.

### Record and in-flight migration

Two migrations are in scope and were unaddressed before Version 11 (resolution
G11):

- Record schema: schemaVersion governs the record shape and setupVersion the
  onboarding flow the record was created under. A read of a record whose
  schemaVersion is older than the current reader upgrades it forward with
  additive defaults and never fails closed on a missing field; a record whose
  setupVersion is older is re-derived against live server truth (default,
  workspace, readiness, run) rather than trusted verbatim, because a flow change
  can invalidate a previously "verified" step. A record newer than the reader is
  treated as read-only and the client is told to reload.
- In-flight old-wizard users: the pre-Version-2 wizard kept progress only in
  user-scoped localStorage and wrote no server record. Such a user has no
  server-verified progress to migrate; on first load of the new Setup Center
  their state is re-derived from live server truth (existing profiles, default,
  workspaces, runs) and the old localStorage keys are cleared only after that
  read. Their place-in-wizard is intentionally not carried over — server truth,
  not a stale draft, decides the next unmet milestone.

### Derived status

Derive display status from live server state plus the record. The record is a
pointer to the last action, not permission to claim success.

Examples:

- selectedProfileId exists but GET profile says isDefault false:
  Needs Attention, “Make this the default.”
- authState says passed but the profile env reference no longer resolves:
  Needs Attention, “Reconnect credentials.”
- workspaceId exists but the workspace is gone or inaccessible:
  Needs Attention, “Choose a project.”
- readinessRunId exists but the run is still running:
  Checking.
- readinessRunId is terminal failed:
  Needs Attention with the safe failure category.
- input bar flag is false:
  Not available.

### Browser persistence

LocalStorage may contain only:

- current panel open/dismissed state;
- current step draft;
- non-sensitive search/filter terms;
- a resume hint.

It must not be used for:

- default profile truth;
- CLI auth truth;
- GitHub connection truth;
- workspace truth;
- readiness truth;
- completion truth.

Clear or migrate old wizard keys only after the server-backed state has been
read. Do not erase another user, organization, or namespace's draft.

### Durable operation model

Every side-effecting onboarding action needs a durable operation record. A
browser request is a command to start or resume work, not the work itself.

The record contains:

- operationId;
- operationType: provider, github-connect, repository-list, workspace-import,
  input-bar-check, readiness, or sample-run;
- userId, namespaceId, orgId, and actor role snapshot;
- idempotencyKey and requestFingerprint;
- phase and status;
- stateRevision;
- resource IDs and safe progress metadata;
- createdAt, updatedAt, deadlineAt, and terminalAt;
- safe error code/message and result reference.

Required operation behavior:

- A same-key, same-fingerprint retry returns or resumes the existing
  operation; it does not start a duplicate PTY, clone, workspace, readiness
  run, or sample run.
- The same key with a different fingerprint returns a stable conflict.
- An in-flight operation returns its operation ID and current phase.
- Unknown outcome after a timeout is reconciled from the durable resource
  before a retry is allowed.
- A stale browser writer cannot overwrite newer state. Use a server revision
  or compare-and-swap update and force the stale client to reload.
- Legal phase transitions are enforced server-side, including failed,
  cancelled, timed_out, and recovered states.

Provider completion phases are auth, bundle_sync, profile_activation,
readback, and ready. Project phases are prepare, clone_or_extract, validate,
register, and ready. Readiness and sample phases are start, queued, running,
terminal, and reconciled.

Default activation and workspace registration require per-scope
serialization. If a file-backed store remains in use, writes must be
crash-safe and recoverable. A server restart or browser close must leave enough
information to resume or reattach without guessing.

### Run queue and deadline contract

The onboarding monitor uses the same authoritative admission and queue as the
real runner. It must not invent a second capacity count.

- Queue position, owner, deadline, cancellation state, and run ID are durable.
- queued, running, completed, failed, timed_out, cancelled, and recovered are
  distinct states.
- The deadline source is explicit and server-owned.
- A queued readiness or sample run can be cancelled or retried by operation ID.
- On API/runner restart, orphaned operations are reconciled from run records;
  capacity is not leaked and a retry cannot create a duplicate.
- The UI may render the existing internal pending status as “Waiting,” but it
  must preserve the distinction from failed.

## Proposed API contracts

These names are proposed seams. The implementation may reuse existing routes
when the resulting contract and atomicity are identical.

### GET /api/onboarding/state

Returns the scoped state plus derived statuses and one nextAction:

~~~json
{
  "success": true,
  "data": {
    "schemaVersion": 1,
    "setupVersion": 10,
    "nextAction": "provider",
    "provider": {
      "selectedCli": "codex",
      "selectedProfileId": null,
      "defaultVerified": false,
      "status": "needs_attention"
    },
    "inputBar": { "status": "not_started", "available": true },
    "github": { "status": "not_connected", "account": null },
    "workspace": { "status": "not_started", "id": null },
    "readiness": { "status": "not_started", "runId": null },
    "sampleRun": { "status": "not_started", "runId": null }
  },
  "requestId": "..."
}
~~~

### POST /api/onboarding/provider/complete

Input:

- provider/tool ID;
- auth method and provider-safe credential reference. Raw GitHub PATs are
  explicitly not accepted by this contract; provider API keys may be captured
  only by the provider's existing server-owned secret form;
- preferred profile ID, if the user selected one;
- makeDefault boolean;
- idempotency key;
- setup version.

Server behavior:

1. Authenticate and resolve namespace/org.
2. Validate provider catalog entry.
3. Install or sync the bundle idempotently.
4. Resolve the requested or catalog-declared recommended profile.
5. Persist credential references using the provider adapter.
6. If makeDefault is true, atomically set exactly that profile default.
7. Read back the profile and effective environment metadata.
8. Persist and return an operation ID, exact effective profile ID, default
   status, safe auth status, and next required action.

Response must distinguish:

- bundleInstalled;
- bundleAlreadyPresent;
- profileSynced;
- defaultChanged;
- defaultVerified;
- readinessAvailable;
- operationId;
- operationStatus and phase;
- errorCode.

It may return an in-progress operation response, but it must never return
verified success while an asynchronous install/default operation is still
running. A retry with the same idempotency key resumes or returns the same
operation.

The existing install-bundle route can implement this internally, but its
current first-installed-only behavior is not sufficient.

### POST /api/onboarding/provider/readiness

Input:

- profileId;
- workspaceId when required;
- idempotency key;
- setup version.

Server behavior:

- verify the profile belongs to the current scope;
- verify the workspace belongs to the current scope;
- start the existing readiness chain with explicit profile and workspace;
- write onboarding metadata;
- return operationId, runId, a poll URL, and the server deadline;
- never accept a browser-supplied arbitrary filesystem path without the
  existing allowed-root validation.

The UI separately polls the existing run status/output APIs until a terminal
proof. A start response is not a pass response.

The onboarding readiness operation is unconditionally fail-closed: a disabled,
missing, or non-matching readiness signal can be Unverified or Needs Attention,
never Ready. The terminal proof must bind the run to the requested profile,
workspace, setup version, and source metadata.

### POST /api/integrations/github/connect and callback

The connect start endpoint creates a single-use connection operation and an
expiring server-owned OAuth/App state record containing:

- state nonce or signed state;
- session hash;
- userId, namespaceId, orgId, and intended action;
- allowlisted return path;
- PKCE verifier/challenge where the provider flow supports it;
- expiration and consumed-at fields.

The callback validates all of those bindings, the GitHub account, installation,
repository selection, and granted capabilities before storing a connection
reference. Replay, tampering, wrong session/scope, expiry, and altered return
paths fail closed. The browser receives only operation status and safe
connection metadata.

### GET /api/integrations/github/connection

Returns:

- status;
- account login/avatar/name;
- connection type;
- granted capability summary;
- selected repository scope if the provider supports it;
- expiration or reauthorization state;
- safe repair action.

It never returns a raw token.

### GET /api/integrations/github/repositories

Parameters:

- query;
- owner;
- visibility;
- cursor;
- limit with a server maximum.

Returns only repositories visible through the current connection, with
full_name, owner, visibility, default_branch, language, updated_at, and
permission summary needed for the chosen action.

### POST /api/onboarding/workspace/from-github

Input:

- full repository name from the server-listed set;
- selected branch;
- destination workspace name;
- optional monorepo root;
- idempotency key.

Server behavior:

- revalidate repository access and branch;
- issue or resume a server-owned, user/org-bound destination target;
- clone through an ephemeral server-side credential helper or equivalent;
  credentials must not appear in the URL, argv, environment exposed to an
  unrelated process, Git config, logs, browser request after connection, or
  run metadata;
- sanitize all errors;
- canonicalize and validate the destination with realpath/symlink checks;
- persist workspace only after clone/path validation and registration;
- return operationId, workspace ID, name, safe path label, execution host,
  repository, branch, and status.

The operation has durable prepare, clone_or_extract, validate, register, and
ready phases. A timeout after any side effect is reconciled or safely cleaned
up before a retry. It never accepts browser-supplied workspace membership,
arbitrary target paths, or arbitrary clone hosts.

### POST /api/onboarding/input-bar/check

Runs one bounded, harmless connection check using the bar's own backend
configuration. It returns connected, unavailable, or a safe failure category.
It must not send a user message to an external provider without the user
initiating the test.

### POST /api/onboarding/sample-run

Input:

- sample chain ID or seed request;
- explicit profileId;
- explicit workspaceId;
- idempotency key;
- setup version.

The server records both the requested and effective profile IDs in run
metadata. If the resolved profile differs, the response is a visible error,
not silent fallback.

### API safety and idempotency

- All routes use the existing response envelope.
- All mutation routes require authenticated scope checks.
- All clone and workspace routes revalidate paths, repository access, branch,
  target host, and destination scope.
- All long operations accept an idempotency key and return the existing result
  for a same-fingerprint retry. The durable ledger stores operation scope,
  request fingerprint, in-flight/terminal result, TTL, and unknown-outcome
  recovery. Reusing a key with a different request returns a stable conflict.
- Concurrent default activation must leave one and only one profile default.
- Concurrent bundle installs must not create duplicate profiles or overwrite
  user-edited fields unexpectedly.
- Concurrent workspace/import/sample requests must not create duplicate
  resources or orphaned partial directories.
- The GitHub-backed onboarding path allows only server-listed repositories and
  approved clone protocols/hosts; generic Git fallback adds explicit
  allowlists and SSRF/private-address protection.
- Error codes are stable and safe for UI mapping; raw provider output is
  server-side diagnostic data only.

## Run-resolution rules

The first-run flow must make profile resolution explicit:

1. Explicit profile ID supplied by onboarding wins only if it exists in the
   current scope and is usable.
2. A chain-specific profile wins when the user explicitly selected one in the
   chain builder.
3. The verified onboarding default wins when no chain-specific profile exists.
4. A workspace default never silently overrides the verified onboarding
   profile. It may win only after the user explicitly selects it and the
   summary names the override.
5. A missing, inaccessible, or unusable profile is a blocking failure with
   repair action.
6. No silent fallback to the first catalog profile or first profile in a
   workspace.

For onboarding specifically, the first readiness and sample requests always
send the verified profile ID and workspace ID explicitly. The generic resolver
must expose the effective source so sibling paths cannot hide a fallback.

Before the sample run, display the result of this resolution. After launch,
write the effective profile ID and source into run metadata and show it in the
inline result.

## Visual and interaction requirements

### Desktop

- Centered Setup Center with enough width for provider/repository metadata.
- Strong primary action at the lower right.
- Step rail remains visible.
- Progress and status are readable without hover.
- No giant empty hero section; the actionable setup card is the visual focus.

### 820 px

- Keep the rail and content readable without horizontal scrolling.
- Collapse secondary metadata before shrinking the primary action.
- Keep repository search and branch selection visible.
- Keep the footer action sticky within the panel.

### 390 px

- Use a full-height sheet or page layout, not a cramped modal.
- One column, one primary action, visible back/close controls.
- Sticky bottom action with safe-area padding.
- Provider and repository cards are full-width buttons.
- Avoid nested scrolling where possible; if needed, label the scroll region.
- Errors appear next to the action that repairs them.
- Never rely on hover, color alone, or tiny icon-only controls.

### Accessibility

- Use semantic buttons and links; no clickable divs.
- Step status uses text plus icon, not color alone.
- The embedded shell is role="dialog" with aria-modal="true", a labelled
  heading, a focus trap, and return focus to the launcher.
- The standalone route has an equivalent labelled main landmark and step
  semantics.
- The current step has aria-current="step"; completed step controls expose
  their status and action text.
- Focus moves to the new step heading after transition.
- Escape and backdrop dismissal close only when no OAuth, clone, readiness, or
  sample operation is in flight. During an operation, close means “run in the
  background and resume later” or requires an explicit confirmation; it must
  not discard work.
- Keyboard users can move through provider cards, repo rows, branch picker,
  and footer actions in a logical order.
- One polite live region announces long-operation milestones and terminal run
  results; errors use an alert region.
- Form fields have labels, examples, validation, and error association.
- OAuth return and failed provider auth restore focus to the relevant action.
- Touch targets are usable without hover; no required action is hidden behind
  hover-only controls.
- Meet the repo's existing accessibility lint and test conventions.

## Copy system

Use Title Case for visible labels and sentence case for explanatory text.
Prefer:

- “Choose Your AI Tool” over “Choose a CLI tool.”
- “Use Codex for My First Run” over “Set as default profile.”
- “Default for New Chains” as the status badge.
- “Check That Codex Works” over “Run readiness.”
- “Browse GitHub Projects” over “Configure repository integration.”
- “Choose a Project” over “Set up your workspace.”
- “Run a Sample Chain” over “Seed sample and open run.”
- “Try Again” over “Retry operation.”

Do not use:

- “Configured” when only a local draft is saved.
- “Connected” when only a binary is detected.
- “Ready” when the run has merely started.
- “GitHub account connected” when only Mentiko login used GitHub.
- “Default” without the exact profile or chain scope.
- “Success” for a skipped optional feature.

## Failure taxonomy

Map technical failures to one of these user-facing categories:

- tool_missing: install the tool, then Check Again;
- auth_required: show the provider auth action;
- auth_rejected: explain that sign-in was not completed and offer Try Again;
- credential_unusable: reconnect or update the secret;
- profile_missing: reinstall/sync the selected bundle;
- default_not_persisted: retry activation and read back the profile;
- readiness_unknown: explain that the provider has no proof signal;
- readiness_failed: show safe provider/runner diagnosis and repair;
- runner_unavailable: show runtime repair or contact/admin guidance;
- github_not_connected: Connect GitHub or choose another source;
- github_scope_missing: reauthorize with the named repository capability;
- github_repo_inaccessible: choose another repository or branch;
- clone_failed: retry, choose branch, or use another source;
- workspace_inaccessible: choose a valid local/workspace path;
- run_queued: show queue position or waiting state, not failure;
- run_failed: show the first actionable repair category;
- timed_out: explain what was checked and offer Recheck;
- state_conflict: a newer revision of this onboarding state exists (another tab,
  device, or a resumed operation). Show "This setup was updated elsewhere —
  reload to continue," offer Reload, and never let the stale writer overwrite.
  This is the user-facing category for the compare-and-swap rejection the state
  model requires; see Version 11 resolution G12.

Each failure has a correlation/request ID available behind “Details” for
support, never a secret or raw provider trace.

## Security and authorization

- Scope every onboarding read/write to the authenticated user, namespace, and
  organization derived from a validated session. Ignore browser-supplied scope
  headers and IDs unless they are revalidated against that session.
- Define ownership explicitly: the default onboarding connection is
  user-owned but bound to the namespace/org; an org-shared connection requires
  an authorized owner/admin action. Profile default changes and workspace
  registration have an explicit RBAC matrix and fail closed when membership or
  role resolution is missing.
- Do not trust a browser-provided profile ID, repository name, branch, or path
  without revalidation.
- Use provider capability adapters rather than one generic token field.
- Prefer GitHub App selected-repository access where the deployment supports it.
- Request read-only repository contents for pull/clone; request write access
  only at the explicit publish/push action.
- Store tokens in the existing secret vault or an encrypted server-side
  integration store. Never send raw tokens back to the browser after capture.
- The GitHub onboarding API accepts only a connection/credential reference
  after App/OAuth or terminal authentication. It does not accept raw PATs for
  clone, list, test, or workspace requests.
- Clone through an ephemeral server-side credential helper or equivalent.
  Credentials must not appear in clone URLs, argv, unrelated process
  environments, Git config, errors, logs, analytics, browser request bodies
  after connection, or run metadata.
- OAuth state and return URLs must be server-owned, bound to the initiating
  session/user/namespace/org/intent, single-use, allowlisted, and expiring;
  use PKCE where the provider flow supports it.
- Disconnect/revoke must clear the server-side credential reference and
  invalidate cached repository data.
- Do not use a real GitHub issue or push as a connectivity test. The existing
  integrations/test route can create side effects and is not an onboarding
  readiness check.
- The GitHub-backed path accepts only repositories returned by the current
  connection and approved hosts/protocols. Generic Git fallback requires an
  explicit host/protocol allowlist, DNS/IP validation, private-network/SSRF
  blocking, realpath/symlink checks, server-issued destination targets, and
  no destructive folder actions.
- A readiness chain must be non-mutating, bounded, and clearly labeled.
- Do not change a user's existing default without an explicit Switch action.

## Telemetry

Emit product events with setupVersion, sourceSurface, namespace/org scope
identifier as permitted by existing telemetry policy, provider CLI, and safe
status/error code:

- onboarding_started;
- provider_detected;
- provider_selected;
- provider_auth_started;
- provider_auth_succeeded;
- provider_auth_failed;
- profile_activation_started;
- profile_default_verified;
- input_bar_setup_started;
- input_bar_check_succeeded;
- input_bar_skipped;
- github_connect_started;
- github_connected;
- github_repositories_loaded;
- github_repository_selected;
- workspace_clone_started;
- workspace_created;
- readiness_started;
- readiness_succeeded;
- readiness_failed;
- sample_run_started;
- sample_run_succeeded;
- sample_run_failed;
- readiness_timed_out;
- sample_run_timed_out;
- operation_conflict (idempotency-key or stale-revision conflict);
- onboarding_exited;

Never include API keys, tokens, raw command output, full local paths, private
repository contents, or user prompts in analytics. Repository owner/name
requires an explicit privacy decision; default to a non-identifying repository
metadata category if the existing policy does not permit names.

## Implementation plan

### Phase 0: stop the immediate failure

- Add a regression test for an existing bundle profile with no default.
- Change default activation to target an explicit profile, not
  installed[0].
- Make the bundle endpoint return the effective profile and default
  verification.
- Await the onboarding mutation and surface errors.
- Add a read-back check before the UI advances.
- Add the catalog recommendation/readiness metadata required for each supported
  provider.
- Add per-scope serialization, crash-safe profile writes, and an idempotency
  ledger before exposing default activation as verified.
- Add explicit actor/RBAC checks for profile/default/workspace mutations and
  fail closed on unknown membership or role.
- Remove raw GitHub token handling from onboarding clone/list/test requests;
  use App/OAuth or terminal/server-side credential references.
- Add the versioned non-mutating sample goal and route all sample callers
  through the canonical onboarding sample operation.

Exit proof: a new user and a user with pre-existing synced profiles can select
Codex, see the exact default badge, reload, and run without opening Agent
Configs.

### Phase 1: canonical state and provider step

- Build SetupCenter state machine and server state endpoint.
- Reuse provider auth components through an adapter shell.
- Remove silent fire-and-forget onboarding mutations.
- Make GettingStarted a launcher/mirror.
- Add default/profile/readiness contract tests.

Exit proof: reload, logout/login, embedded/standalone entry, and changing the
provider preserve the correct server truth.

### Phase 2: readiness and inline run proof

- Reuse readiness chain creation and run status/output APIs.
- Add a panel run monitor with terminal proof.
- Seed/run the sample chain in-panel.
- Record explicit requested/effective profile IDs.
- Make readiness fail closed regardless of ambient environment flags and
  preflight executor support for local, SSH, and Docker workspaces.
- Define queue ownership, deadline, cancellation, and restart reconciliation
  against the existing runner admission path.

Exit proof: start-only, unknown, failed, timeout, queued, and completed runs
render distinct states.

### Phase 3: GitHub and workspace browser

- Implement GitHub connection callback and connection read model.
- Prefer GitHub App selected repositories; document fallback.
- Add repository search/filter/pagination.
- Add branch selection and workspace creation progress.
- Preserve local/new/ZIP/manual Git fallback.
- Implement one durable import operation for clone, extract, local attach, new
  project, ZIP, SSH, and Docker paths with cleanup or explicit reattach.
- Add SSRF/private-network/host allowlists and server-issued destination
  targets for all remote import paths.

Exit proof: public/private repo, organization approval, expired auth, empty
list, clone failure, branch change, and workspace re-entry all work.

### Phase 4: input bar and polish

- Add input bar availability/connection check.
- Put a direct Setup Center route behind the bar's setup action.
- Present input-bar setup after first value by default; keep it optional and
  outside required progress.
- Add responsive/a11y coverage at 390/820/desktop.
- Remove duplicate dashboard logic and stale wording.
- Add telemetry and support detail IDs.

Exit proof: enabled, disabled, offline, reconnect, skipped, and connected bar
states are honest and recoverable.

### Release and rollback

- Keep old /welcome state readable during rollout.
- Gate new UI behind a reversible feature flag if the repository's rollout
  conventions require it.
- On API or UI regression, route users to the existing Agent Configs and
  Project Setup surfaces without deleting profiles, workspaces, or secrets.
- Never migrate or delete credentials as part of this UX change.
- Do not build Docker images locally on Mac. Use the repository's required CI
  path for any later implementation/release.
- If provider catalog or runner-v2 profile logic changes, regenerate tracked
  runner bundles, run runner-typed-bundle-parity.test.mjs, and run
  npm run build:bundles before any release.

## Acceptance tests

### Provider/default

- New user with no profiles chooses Codex, completes auth, and the profile
  read-back says isDefault true without visiting Agent Configs.
- Existing user has Codex bundle profiles but no default, chooses Codex, and
  the explicitly selected profile becomes default even when the bundle result
  says skipped.
- Existing user has a different default, chooses Codex, selects Switch, and
  exactly one persisted default remains.
- Existing user has a different default, chooses Keep, and the existing
  default remains unchanged.
- Two concurrent activation requests leave one default and return the same
  idempotent result.
- Injected failure between clearing and writing defaults leaves the prior valid
  state or a recovered valid new state; never a corrupt JSON file or two
  defaults.
- Bundle sync does not overwrite user-edited fields outside the declared sync
  set.
- API-key auth stores a secret reference and never returns/logs the secret.
- Provider auth failure blocks advancement and exposes a repair action.
- A provider with no readiness signal is Unverified, not green Ready.
- Codex default selection uses catalog metadata and a passing readiness path,
  not array order.
- With onboarding profile A verified and workspace default B configured, the
  onboarding readiness and sample paths use A unless the user explicitly
  selects B.
- A stale or unauthorized actor cannot change a user or org default; missing
  membership/role data fails closed.

### Readiness/run

- Readiness starts with the exact profile ID and workspace ID.
- A 200 start response with a still-running run shows Checking.
- A readiness failure shows Needs Attention with a safe error category.
- Unknown/no_ready_signal cannot show Ready under fail-closed behavior.
- A timeout has Recheck and repair actions.
- A queued run shows waiting/queue status, not failure.
- A completed readiness run shows one bounded answer and a run ID.
- The sample chain stays in the Setup Center until the user chooses Open Full
  Run.
- The sample sends the defined non-empty goal, does not depend on a missing
  {TASK}, does not 404 on a stale deep link, and reaches a terminal result
  through the actual current run surface.
- Sample run metadata records requested and effective profile IDs and they
  match.
- A sample run cannot silently fall back to a missing or unrelated default.
- Same-key sample/readiness retries return one run; different payloads with the
  same key return a stable conflict.
- Queue saturation, cancellation, timeout, API restart, and runner restart
  reconcile without duplicate runs or leaked capacity.

### GitHub/workspace

- Sign-in with GitHub is not treated as repository connection without the
  required repository access.
- GitHub App selected-repository install shows the account and capability
  summary on return.
- GitHub App/OAuth is explicit and scoped; the self-hosted terminal fallback
  yields only a server-side connection reference; no raw PAT enters clone,
  list, test, or workspace requests.
- Public repositories work without private access; private repositories
  require the named capability.
- Organization approval or revoked access has a repair state.
- Repository list supports search, cursor/limit, empty, refresh, and failure.
- Branch selection defaults to the repository default branch and can change.
- Repository selection persists across a retry.
- Clone progress is visible and workspace record creation is not premature.
- Clone failure leaves no false ready workspace and offers fallbacks.
- Browser-supplied arbitrary paths, symlink escapes, home/code-root escapes,
  localhost/private-network targets, arbitrary SSH hosts, and cross-scope
  workspace IDs are rejected without filesystem mutation.
- A client disconnect after clone/extract/mkdir can resume, reattach, or clean
  up through the same operation without an orphan or duplicate workspace.
- Local, new, ZIP, and manual URL paths still work.
- Workspace scope prevents cross-user or cross-organization access.

### Input bar

- Available and connected shows a real test result.
- Offline/reconnect shows one repair action and preserves the rest of setup.
- Feature-disabled install shows Not available, not failure.
- Skipping the bar does not block provider, workspace, readiness, or sample run.
- The bar backend/profile is not silently confused with the chain provider.
- The bar setup card is optional side content after first value by default and
  never appears as incomplete required progress when skipped.

### Surface and UX

- /welcome and FloatingWelcomePanel show the same server state.
- GettingStarted opens the exact unmet step and does not maintain duplicate
  completion logic.
- The bar setup action opens Setup Center, not a settings scavenger hunt.
- Every visible card and step status is keyboard reachable and has a clear
  action or is marked informational.
- Back, close, resume, and reload preserve state safely.
- The embedded panel has dialog semantics, focus entry/return, aria-current
  step controls, live operation announcements, and safe close behavior during
  in-flight work.
- Two tabs and stale revisions cannot roll back a newer onboarding state.
- 390 px has no horizontal overflow or unreachable sticky action.
- 820 px keeps search, branch, and primary actions usable.
- Desktop has no hidden continuation below the fold.
- Screen readers receive step, status, progress, error, and terminal-run
  announcements.

## Sibling-surface sweep

Implementation must inspect and reconcile all of these surfaces before the
change is called complete:

- /welcome.
- FloatingWelcomePanel.
- WelcomeWizard and all current step components.
- Dashboard GettingStarted.
- /settings/agent-configs profile list/editor and its Run Readiness action.
- Agent Configs install-bundle modal.
- FloatingKollaborBar setup link, connection/error states, and feature flag.
- Project Setup Git, local, new, ZIP, SSH, and Docker components.
- WorkspaceProvider selection and workspace list.
- Chain Builder default profile controls.
- RunChainPanel and the full run page.
- Sample chain template, seed helper, and every caller of the sample deep link.
- Run-agent-profile resolution and all workspace/chain fallback paths.
- Agent profile APIs, bundle sync, default PATCH, test, and test-session.
- Onboarding storage/localStorage helpers, workspace storage, and path
  validation.
- CLI auth operation/session APIs and GitHub connection callback APIs.
- GitHub integration save/test and clone/workspace APIs.

For each surface, confirm copy, status vocabulary, casing, profile IDs,
workspace IDs, default semantics, and the repair route are consistent.

## Review checklist for version 9

The five independent reviewers must review this version 9 candidate without
editing it. Each review must identify concrete gaps with:

- severity;
- exact spec section;
- user or implementation scenario;
- required change;
- acceptance test.

Review roles:

1. Runtime/architecture: profile resolution, async operations, state, API
   contracts, runner-v2/readiness, and migration.
2. Beginner UX: 10-year-old teachability, cognitive load, copy, progressive
   disclosure, and dead ends.
3. Security/auth: GitHub permissions, secret handling, auth boundaries,
   multi-tenant scope, and side effects.
4. QA/reliability: failure matrix, idempotency, reload/resume, race conditions,
   responsive behavior, and sibling regressions.
5. Product/design: end-to-end first value, visual hierarchy, accessibility,
   competitive patterns, and whether the requested experience feels coherent.

The final version must publish every accepted finding in the version 10 review
log, or state why a finding was rejected.

## Version 10 review log

Five independent agents reviewed Version 9. All five returned a blocking
review; no material finding was rejected. Duplicate findings were consolidated
into the normative requirements and acceptance tests above.

1. Dewey — runtime/architecture reviewer
   (agent 01a041a6-78c3-7d41-9292-9592c4f74ee3). Accepted: explicit resolver
   precedence, atomic default activation, durable scoped operations, server
   state storage, fail-closed readiness, idempotent workspace import, and an
   explicit sample-run operation.
2. Hooke — beginner UX reviewer
   (agent 01a041a6-77f3-7951-b988-059c6942511e). Accepted: shortest
   provider-to-first-value path, visible default choice, advanced project
   disclosure, inline errors, server-only completion truth, and semantic
   clickable controls.
3. Raman — security/auth reviewer
   (agent 01a041a6-7718-73a0-879e-49dab8fe7325). Accepted: no raw PAT in
   onboarding clone/list/test requests, server-side credential references,
   SSRF/path defenses, bound OAuth state, explicit ownership/RBAC, and no
   write-side-effect tests.
4. Singer — QA/reliability reviewer
   (agent 01a041a6-7987-72c0-89db-771807328fc4). Accepted: crash-safe
   activation, durable idempotency fingerprints, compare-and-swap resume,
   terminal readiness proof, resumable import, queue/deadline recovery, and
   executable sibling/viewport test gates.
5. Russell — product/design reviewer
   (agent 01a041a6-7b94-7d21-8396-184dc4b87dbd). Accepted: an explicit
   non-empty sample goal, one valid run-surface contract, input-bar setup
   after first value, separate embedded/full-page shells, dialog/focus
   semantics, workspace host/permission disclosure, and research-to-IA
   decisions.

Final verdict: approve the direction for implementation only after the Phase 0
security, operation, resolver, and sample-contract gates pass. The document
does not claim that those code changes have been implemented.

## Version 11 resolutions

Version 10 was labeled final. A subsequent review against both this document
and the current Mentiko checkout found thirteen gaps still open — five
substantive and eight internal-consistency. The consistency ones (G4, G5, G6,
G11, G12) are corrected in place in the sections above; all thirteen are
resolved normatively here. Where a resolution names a concrete Mentiko fact
(single-org trust boundary, container-only runtime, interactive CLI auth, the
existing three-agent sample), that fact was verified against the checkout, not
assumed.

### G1 — GitHub App is optional, not the assumed happy path

Gap: the flow made a GitHub App the "preferred path" but never said who
registers the App for a self-hosted tenant VPS. On most self-hosted installs no
App exists, so the happy path is a phantom.

Resolution (normative): the GitHub source resolves to one of three tiers,
detected server-side at runtime and named honestly in the connection card:

1. app_or_oauth — the deployment has GitHub App or OAuth credentials configured
   (e.g. GITHUB_APP_ID or client id/secret present). Prefer a selected-repository
   App install; OAuth is the fallback. Only in this tier may the UI offer
   "Connect GitHub" as a browser authorization.
2. server_credential — the common self-hosted tier with no App/OAuth configured.
   Repository access comes from a server-side credential: the user runs
   `gh auth login` in the app's existing terminal, or an administrator captures a
   server-side token into the vault. The browser then holds only a connection id
   and a safe capability summary.
3. unavailable — neither is configured. The GitHub source is marked Not
   available (not failed); local folder, Git URL, ZIP, and new-project remain.

The repository browser and clone run over whichever tier is active using the
server-side credential; no raw browser PAT ever enters list/clone/test/workspace
requests. "Connect GitHub" copy must never imply an App exists when the active
tier is server_credential or unavailable.

Test: on a deployment with no GitHub App/OAuth env, the GitHub source shows the
terminal/admin credential path and never renders App-only "Connect GitHub"
authorization; browsing still works over the server credential.

### G2 — interactive CLI login is a first-class, specified auth method

Gap: the auth contract centered API-key/secret-vault capture, but the dominant
providers (Codex, Claude Code, OpenCode) authenticate through an interactive
terminal login. That path had no normative completion/verification contract.

Resolution (normative): authMethod is one of interactive_cli, provider_api_key,
or oauth_app.

- interactive_cli: started through the existing CLI-auth operation
  (start_cli_auth) and polled via poll_cli_auth to a terminal auth state. The
  browser never receives credentials. "Auth completed" requires both the
  provider's own authenticated signal AND confirmation by the fact-6 readiness
  run — a login that cannot produce one bounded answer is auth_rejected or
  credential_unusable, never passed. This is the headline path for the
  "Sign in to Codex" example.
- provider_api_key: captured only by the provider's existing server-owned secret
  form; the browser sees only a reference. Unchanged.
- oauth_app: for providers that use OAuth; same vault and redaction rules.

Test: choosing Codex runs the terminal login; the provider card shows Signed in
only after poll_cli_auth reports authenticated, and Ready only after readiness
passes.

### G3 — the sample is non-mutating by authority, and distinct from the existing sample

Gap: "non-mutating" was asserted by prompt text ("Do not modify files"), which
is not a guarantee, and it collided with the existing on-disk sample-starter
chain — a three-agent Researcher→Writer→Editor pipeline that grants read,
run_commands, and write_artifacts authorities.

Resolution (normative):

- The onboarding readiness/first-value sample is a NEW versioned chain, distinct
  from sample-starter. Its single agent's authorities are read-only —
  can: ["read_files"], no run_commands, no write_artifacts, empty
  needs_approval. The prompt text is not the guarantee; the authority set is.
  Zero file writes hold even if the prompt were edited.
- The server supplies the non-empty default goal at run start (the goal/{TASK}
  binding), so the user types nothing and a missing-{TASK} substitution cannot
  occur.
- The existing three-agent sample-starter is left in place as an optional richer
  example the user can open later; onboarding does not route through it. The
  onboarding sample carries its own id and version, re-syncs idempotently, and
  never clobbers a user-edited chain that shares the id.
- A future sample that must write is a separate explicit sample version with the
  path, content type, approval mode, and confirmation disclosure required by
  Step 3/Step 4 before launch.

Test: the onboarding sample run writes zero files even with an altered prompt,
because its authorities forbid writes; sample-starter is untouched.

### G4 — provider readiness and preflight readiness are one proof (see The invariant)

Gap: Step 1 showed "Codex is ready" (implying a readiness run) and Step 3
"check everything works" implied another, with no defined relationship; and
provider/complete's ready phase name collided with fail-closed readiness.

Resolution (normative, applied in The invariant above): one readiness run per
selected profile, bound to it. Step 3 preflight reads and re-displays that
fact-6 proof and adds only fact-7/-8 checks; it does not start a second provider
readiness run. provider/complete's ready phase means activation-complete, not
readiness-proven; the provider card shows Ready only after the separate
/provider/readiness operation passes.

Test: completing provider setup does not by itself flip the card to Ready;
Ready appears only after the readiness op returns a terminal pass, and the Step 3
preflight for that profile issues no new readiness run.

### G5 — the advisor default is a separate, independently-unique default (see State model)

Gap: the code has two defaults — isDefault (agent default) and isAdvisorDefault
— and install-bundle sets both, but the spec's "exactly one default" invariant
and state record never mentioned the advisor default.

Resolution (normative, fields added in State model above): the atomicity
invariant applies independently to each — a completed activation leaves exactly
0-or-1 agent default AND 0-or-1 advisor default. Neither substitutes for the
other. Onboarding presents only the agent default as "Default for new chains";
the advisor default is set by bundle sync (preferredAdvisorDefault), recorded as
advisorDefaultProfileId, and is not a required milestone.

Test: after provider completion, exactly one agent default and at most one
advisor default persist; setting or clearing one never disturbs the other.

### G6 — step numbering (fixed in place)

The required path is Step 0 welcome then Steps 1–4 (choose tool, connect
project, check works, run chain). The optional input-bar side quest is
deliberately unnumbered and never counts toward required progress.

### G7 — one canonical status vocabulary

Gap: milestone status, derived status, run-queue status, and readiness status
used four overlapping vocabularies, and nextAction's values were undefined.

Resolution (normative): two axes, one enum each.

- Milestone status (what every step card and GET /state status field uses):
  not_started, in_progress, needs_attention, ready, skipped, not_available.
- Operation/run lifecycle (surfaced as run detail, never as milestone status):
  queued, running, completed, failed, timed_out, cancelled, recovered.

Readiness maps onto milestone status: Checking→in_progress, Ready→ready,
Needs Attention→needs_attention, Timed Out→needs_attention (with a timed_out run
detail), Unverified→needs_attention with an unverified reason (never ready).
nextAction is one of: provider, project, readiness, sample, input_bar, done.

Test: every status string the UI renders is a member of the milestone enum, or
of the lifecycle enum for run detail; no third vocabulary appears.

### G8 — concrete deadline policy

Gap: deadlines were "explicit and server-owned" but never given a value.

Resolution (normative): server constants, single source, surfaced as deadlineAt.
Readiness operation deadline = 90 seconds (a bounded single-answer probe);
sample-run operation deadline = 5 minutes. On deadline with no terminal proof
the state is timed_out with Recheck, never Ready. These onboarding deadlines
govern the onboarding readiness and sample operations specifically and are not
the per-agent chain timeout.

Test: a readiness run with no terminal state at 90s shows Timed Out with a
Recheck action, not a spinner or a green Ready.

### G9 — the input-bar backend has a defined source

Gap: the bar's own backend was never sourced, so the "optional" step could
dead-end exactly as the spec faults the current bar link for.

Resolution (normative): inputBarBackend is resolved from the bar's own
configuration, independent of the chain provider.

- Exposed with a configured Mentiko/Kollab bar backend → that is inputBarBackend
  and the card names it.
- Exposed with no configured backend → the card offers to set one (its own
  selection); until then the check is unavailable-pending, never a silent reuse
  of the chain-provider profile.
- Not exposed by the install → Not available.

The bar setup card's action opens the Setup Center bar step, not a settings
page.

Test: the bar check never uses the chain-provider profile unless the user
explicitly selects it; a no-backend state shows a set-backend action.

### G10 — "local" means the Mentiko host, pinned to the runtime

Gap: "local" was left ambiguous, and the spec required the UI to "say which"
without answering which.

Resolution (normative): on a tenant install there is no browser-side executor.
"local" ≡ the Mentiko host — the tenant container the runner executes in. The
preflight and sample panel label a local execution host as "Mentiko host (this
server)", and name the SSH or Docker executor when the workspace targets one.
"Your machine" is never shown for a local workspace.

Test: the sample preflight shows execution host "Mentiko host" for a local
workspace, never "your machine".

### G11 — record and in-flight migration (fixed in place)

See State model → Record and in-flight migration: forward-compatible schema
upgrades, re-derivation of stale setupVersion records against live truth,
reload-only for newer records, and re-derivation (not carry-over) of pre-v2
localStorage-only wizard users.

### G12 — stale-revision failure category and telemetry (fixed in place)

See Failure taxonomy (state_conflict) and Telemetry (readiness_timed_out,
sample_run_timed_out, operation_conflict): the compare-and-swap rejection the
state model requires now has a user-facing category and matching events.

### G13 — authorization scoped to the real trust boundary

Gap: the elaborate cross-org RBAC matrix and org-shared-connection admin flows
assume a multi-org boundary, but a Mentiko deployment is one trust boundary
(single BETTER_AUTH_SECRET; tokens are cross-forgeable within a deployment) and
tenants are effectively single-org.

Resolution (normative): the baseline is single-org. Onboarding
connection/default/workspace are user-owned within the deployment's
namespace/org, authorized by the validated session, fail-closed on a missing
session. The cross-org RBAC matrix and org-shared-connection owner/admin gates
are optional and apply only to a multi-org deployment; on the default single-org
tenant they collapse to session-scoped user authorization with no separate
org-admin gate. Multi-org language is retained as a forward-compat note, not a
baseline requirement. This removes the phantom RBAC surface without weakening
fail-closed session scoping.

Test: on a single-org tenant, no onboarding step requires an org-admin role that
does not exist; a valid session authorizes the user's own onboarding actions and
a missing session still fails closed.

## Version 11 review log

The thirteen gaps above were found by a single post-v10 review that read this
document against the current Mentiko checkout, rather than by the five-agent
protocol used for v9→v10. Each finding was accepted and turned into a normative
resolution or an in-place correction; none was rejected. The document still does
not authorize implementation — it is a stronger spec, not a shipped feature.

## Definition of done

This spec is complete when:

- Version 1 through Version 11 are present and meaningfully versioned.
- The front matter summarizes the changes and names the current version.
- Five independent reviewers have returned findings (v9→v10), and the post-v10
  review is recorded (v10→v11).
- Version 10 records accepted/rejected findings; Version 11 records the thirteen
  gaps found after v10 and their resolutions.
- The final normative sections satisfy the invariant, failure boundaries,
  proposed contracts, acceptance tests, and sibling sweep, with no open gap the
  Version 11 resolutions do not close.
- Current source evidence and online research receipts are included.
- The artifact itself is readable, internally consistent (one status
  vocabulary, correct step numbering, both defaults modeled), and free of claims
  that are only inferred from localStorage or a start response.

## Version history

### Version 1 — fix the invariant

Defined the original bug as a producer/consumer mismatch: setup can detect,
authenticate, and install a CLI while the runner still has no persisted
default. Established that the default must be explicit, durable, and verified.

### Version 2 — one canonical Setup Center

Replaced separate wizard/dashboard/settings assumptions with one resumable
state model rendered by /welcome and FloatingWelcomePanel. Made server truth
authoritative and localStorage draft-only.

### Version 3 — provider choice and default activation

Specified provider cards, auth adapters, exact profile IDs, explicit
“Use this for my first run,” safe switching, catalog recommendations, and
read-back confirmation. Closed the current skipped-bundle/default gap.

### Version 4 — proof through the real runner

Added a real readiness chain, terminal polling, fail-closed semantics, inline
output, sample run metadata, and a rule that launch or HTTP success is not
readiness.

### Version 5 — input bar as a separate capability

Added an honest setup path for the floating chat-like bar, separate bar versus
chain-provider semantics, optional skip, disabled-install handling, and a
direct return path from the bar.

### Version 6 — GitHub and first workspace

Added separate GitHub repository authorization, least-privilege access, a
browsable repository picker, branch choice, clone progress, workspace
creation, and local/new/ZIP/manual fallbacks.

### Version 7 — clickable, teachable interaction

Added one primary action per state, visible status controls, plain-language
copy, summaries and repair actions, mobile behavior, and a concrete
10-year-old teachability test.

### Version 8 — hardening and rollout

Added security, scope validation, secret redaction, idempotency, telemetry,
failure taxonomy, accessibility, rollout, rollback, and platform-specific
bundle/build constraints.

### Version 9 — review candidate

Added current source audit, online research receipts, state/data model,
proposed API contracts, run-resolution rules, implementation phases, detailed
acceptance tests, sibling sweep, and the five-agent review protocol.

### Version 10 — final after five-agent review

Final. Version 10 incorporates the five returned reviews. It shortens the
novice path to provider → project → readiness → sample run, moves input-bar
setup after first value without removing it from the same Setup Center, defines
a non-empty non-mutating sample contract, makes default activation and all
long-running operations durable/idempotent, hardens GitHub and filesystem
boundaries, adds fail-closed readiness and explicit run resolution, and turns
accessibility/sibling coverage into release gates.

### Version 11 — resolves thirteen gaps left open by v10

A post-v10 review against this document and the current Mentiko checkout found
thirteen gaps despite the "final" label. Version 11 resolves all of them: it
demotes the GitHub App to one of three honestly-detected access tiers (App/OAuth,
server-side terminal credential, or unavailable) so the self-hosted case has a
real path; makes interactive CLI login a first-class specified auth method
alongside API key and OAuth; makes the sample non-mutating by read-only
authority rather than prompt text and separates it from the existing three-agent
sample-starter; defines provider and preflight readiness as one bound proof;
gives the ignored advisor default its own uniqueness invariant and record
fields; fixes the step numbering; collapses four status vocabularies into one
milestone enum plus a run-lifecycle enum with a defined nextAction set; sets
concrete 90-second readiness and 5-minute sample deadlines; sources the
input-bar backend independently of the chain provider; pins "local" to the
Mentiko host; specifies record and in-flight-user migration; adds a
state_conflict failure category with timeout/conflict telemetry; and scopes the
authorization model to the single-org trust boundary the platform actually has.
Like v10, it does not authorize implementation.
