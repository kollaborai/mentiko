DECISION FLOW - UI DESIGN SPEC
================================
date: 2026-03-16
status: implementation-ready design spec
inputs: DECISION_FLOW_IA_SPEC.md, DESIGN_SYSTEM.md, existing components
scope: maps every IA component to concrete React + Tailwind implementation


TABLE OF CONTENTS
=================
  0. conventions used in this doc
  1. data model type additions (decision-types.ts)
  2. component tree overview
  3. decision detail orchestrator
  4. round indicator
  5. round 1: tinder cards
  6. round 2: tailored option cards
  7. round 3: plan view
  8. dashboard mode (tabs)
  9. verdict card
  10. approval bar
  11. briefing mode (carousel)
  12. guided flow skill (reusable)
  13. shared sub-components
  14. keyboard map
  15. animation inventory
  16. responsive rules


0. CONVENTIONS
===============

file paths: relative to web/ (e.g. components/decision/verdict-card.tsx)
tokens: only bg-card, bg-muted, bg-accent, bg-background (never bg-white/5)
corners: rounded-sm or rounded-md (never rounded-xl on inner elements)
icons: @aliimam/icons only (never lucide-react)
labels: text-xs text-foreground/40 font-medium (never uppercase tracking)
spacing: px-4 py-3 for sections
buttons: h-7 compact
text: text-xs labels, text-sm body, text-base titles


1. DATA MODEL TYPE ADDITIONS
==============================

file: lib/decision-types.ts

add to existing file (do NOT replace existing types):

  // --- guided flow types ---

  export type RoundStatus = "pending" | "in_progress" | "complete" | "skipped";

  export interface GuidedFlow {
    currentRound: 0 | 1 | 2 | 3;
    round1: Round1State;
    round2: Round2State;
    round3: Round3State;
    startedAt?: string;
    completedAt?: string;
  }

  export interface Round1State {
    status: RoundStatus;
    questions: TradeoffQuestion[];
    answers: TradeoffAnswer[];
    preferenceProfile?: PreferenceProfile;
    generationJobId?: string;
  }

  export interface TradeoffQuestion {
    id: string;
    text: string;
    optionA: { label: string; value: string; icon?: string };
    optionB: { label: string; value: string; icon?: string };
    category: string;
    weight: number;
  }

  export interface TradeoffAnswer {
    questionId: string;
    choice: "a" | "b" | "skip";
    answeredAt: string;
  }

  export interface PreferenceProfile {
    preferences: Record<string, string>;
    constraints: string[];
    summary: string;
  }

  export interface Round2State {
    status: "pending" | "generating" | "ready" | "complete";
    tailoredOptions: TailoredOption[];
    selectedOptionId?: string;
    customizations?: string[];
    generationJobId?: string;
  }

  export interface TailoredOption {
    id: string;
    letter: string;
    name: string;
    description: string;
    preview?: OptionPreview;
    matchScore: number;
    pros: string[];
    cons: string[];
    effort: "low" | "medium" | "high";
    risk: "low" | "medium" | "high";
    estimatedTime?: string;
  }

  export interface OptionPreview {
    type: "image" | "component" | "code";
    content: string;
  }

  export interface Round3State {
    status: "pending" | "generating" | "ready" | "complete";
    plan?: ExecutionPlan;
    generationJobId?: string;
  }

  export interface ExecutionPlan {
    summary: string;
    tasks: PlanTask[];
    totalEstimate?: string;
    dependencies: PlanDependency[];
  }

  export interface PlanTask {
    id: string;
    title: string;
    description: string;
    subtasks: string[];
    estimate?: string;
    assignee?: string;
    priority: number;
    phase: number;
  }

  export interface PlanDependency {
    from: string;
    to: string;
  }

  // --- extend Decision ---
  // add these fields to the existing Decision interface:
  //   guidedFlow?: GuidedFlow;
  //   mode?: "classic" | "guided";


2. COMPONENT TREE OVERVIEW
============================

decision detail panel renders one of three modes:

  DecisionDetailOrchestrator
    mode === "guided" && status === "pending"
      -> GuidedFlowShell
           -> RoundIndicator
           -> Round1Tinder | Round2Options | Round3Plan

    mode === "classic" || status !== "pending"
      -> DashboardView
           -> VerdictCard
           -> TabBar (overview | options | context | history)
           -> OverviewTab | OptionsTab | ContextTab | HistoryTab
           -> ApprovalBar (pending only)

    briefing === true
      -> BriefingView
           -> BriefingCard[]

file tree (new files):

  components/decision/
    decision-detail-orchestrator.tsx   replaces decision-detail.tsx
    verdict-card.tsx
    overview-tab.tsx
    options-tab.tsx
    context-tab.tsx
    history-tab.tsx
    approval-bar.tsx
    dashboard-view.tsx
    briefing-view.tsx
    briefing-card.tsx

  components/guided-flow/
    guided-flow-shell.tsx
    round-indicator.tsx
    round1-tinder.tsx
    tradeoff-card.tsx
    round2-options.tsx
    tailored-option-card.tsx
    round3-plan.tsx
    plan-task-tree.tsx

existing files to reuse (NOT rewrite):
    components/decision/option-cards.tsx       comparison table
    components/decision/intake-dialog.tsx      new decision dialog
    components/ui/wave-spinner.tsx             loading states
    components/ui/raised-button.tsx            primary actions
    components/ui/button.tsx                   standard buttons
    components/ui/page-header.tsx              page header
    components/ui/workflow-sidebar.tsx         sidebar primitives
    lib/status-colors.ts                      status color system


3. DECISION DETAIL ORCHESTRATOR
=================================

file: components/decision/decision-detail-orchestrator.tsx
replaces: components/decision/decision-detail.tsx (deprecate old file)

props:

  interface DecisionDetailOrchestratorProps {
    decisionId: string;
    onBack?: () => void;
    onUpdate?: () => void;
    onDelete?: () => void;
  }

same props as current DecisionDetail. drop-in replacement.

internal state:

  const [decision, setDecision] = useState<Decision | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"guided" | "classic" | "briefing">("guided");

viewMode resolution on load:

  if decision.mode === "classic" -> "classic"
  if decision.status !== "pending" -> "classic"
  if decision.guidedFlow exists -> "guided"
  else -> "classic"

the user can toggle between guided and classic via header buttons.

layout:

  <div className="flex h-full flex-col overflow-y-auto">
    {/* header (always) */}
    <DetailHeader ... />

    {/* body switches on viewMode */}
    {viewMode === "guided" && <GuidedFlowShell ... />}
    {viewMode === "classic" && <DashboardView ... />}
    {viewMode === "briefing" && <BriefingView ... />}
  </div>

DetailHeader (inline, not a separate component):

  same structure as current decision-detail.tsx header (lines 568-713)
  but with mode-switch buttons added to the action cluster:

  right actions by status:
    pending + guided:  [dashboard] [skip] [delete]
    pending + classic: [guided] [refine] [briefing] [skip] [delete]
    approved/done:     [open task] [retro] [briefing] [delete]
    skipped:           [reopen] [delete]
    intake/research:   (none, just delete)

  [dashboard] and [guided] are DetailSecondaryButton (h-7, bg-card, text-xs).
  they toggle viewMode state.

  header layout is identical to current: px-4 py-3, title text-base font-medium,
  badges row, then metadata grid.

states:
  loading:  centered "loading..." text-sm text-muted-foreground (existing)
  error:    centered "decision not found" text-sm text-muted-foreground (existing)
  populated: switches to appropriate view mode


4. ROUND INDICATOR
====================

file: components/guided-flow/round-indicator.tsx

props:

  interface RoundIndicatorProps {
    currentRound: 0 | 1 | 2 | 3;
    round1Status: RoundStatus;
    round2Status: Round2State["status"];
    round3Status: Round3State["status"];
    onSelectRound: (round: 1 | 2 | 3) => void;
    onStartOver?: () => void;
    onSkipToDashboard?: () => void;
    labels?: { round1?: string; round2?: string; round3?: string };
  }

layout:

  single horizontal row, full width of the detail panel.

  +----------------------------------------------------------------+
  |  (1) preferences  ---- (2) options  ---- (3) plan    [actions] |
  +----------------------------------------------------------------+

  structure:

  <div className="flex items-center gap-3 px-4 py-3">
    <RoundStep number={1} label={labels.round1 || "preferences"} ... />
    <div className="h-px flex-1 bg-foreground/10" />
    <RoundStep number={2} label={labels.round2 || "options"} ... />
    <div className="h-px flex-1 bg-foreground/10" />
    <RoundStep number={3} label={labels.round3 || "plan"} ... />

    <div className="ml-auto flex items-center gap-1">
      {onStartOver && (
        <button className="h-7 px-2 text-xs text-foreground/30 hover:text-foreground/60">
          start over
        </button>
      )}
      {onSkipToDashboard && (
        <button className="h-7 px-2 text-xs text-foreground/30 hover:text-foreground/60">
          dashboard
        </button>
      )}
    </div>
  </div>

RoundStep (inline sub-component, not exported):

  props: number, label, status, isActive, onClick

  status rendering:
    locked:    text-foreground/20, not clickable, no cursor-pointer
    active:    text-foreground, circle has bg-foreground text-background
    complete:  text-foreground/60, circle has bg-emerald-500/15, TickCircleFilled icon

  the circle:

    <button
      onClick={onClick}
      disabled={status === "locked"}
      className={cn(
        "flex items-center gap-1.5",
        status === "locked" && "cursor-default opacity-30",
        status === "active" && "text-foreground",
        status === "complete" && "text-foreground/60 cursor-pointer"
      )}
    >
      <span className={cn(
        "flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold",
        status === "active" && "bg-foreground text-background",
        status === "complete" && "bg-emerald-500/15 text-emerald-400",
        status === "locked" && "bg-foreground/5 text-foreground/30"
      )}>
        {status === "complete" ? <TickCircleFilled className="h-3 w-3" /> : number}
      </span>
      <span className="text-xs font-medium">{label}</span>
    </button>

  the connecting line between steps:
    bg-foreground/10 by default
    bg-emerald-400 if the step to its left is complete

responsive:
  - labels hidden on very narrow widths (< 400px): show only numbered circles
  - actions row wraps below on mobile

icons needed: TickCircleFilled from @aliimam/icons


5. ROUND 1: TINDER CARDS
==========================

file: components/guided-flow/round1-tinder.tsx

props:

  interface Round1TinderProps {
    questions: TradeoffQuestion[];
    answers: TradeoffAnswer[];
    onAnswer: (questionId: string, choice: "a" | "b" | "skip") => void;
    onComplete: () => void;
    onBack: () => void;
    preferenceProfile?: PreferenceProfile;
    loading?: boolean;
  }

internal state:

  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  // initialIndex = first unanswered question index (for resume)
  const [direction, setDirection] = useState<"left" | "right" | null>(null);

layout - question view:

  <div className="flex flex-col items-center px-4 py-6">
    {/* question counter */}
    <span className="text-xs text-foreground/40 font-medium">
      question {currentIndex + 1} of {questions.length}
    </span>

    {/* question text */}
    <p className="mt-3 text-center text-sm font-medium leading-relaxed max-w-md">
      {question.text}
    </p>

    {/* two cards side by side */}
    <div className="mt-4 grid grid-cols-2 gap-3 w-full max-w-lg">
      <TradeoffCard side="a" option={question.optionA} ... />
      <TradeoffCard side="b" option={question.optionB} ... />
    </div>

    {/* skip link */}
    <button className="mt-3 text-xs text-foreground/30 hover:text-foreground/50">
      skip this question
    </button>

    {/* progress bar */}
    <div className="mt-4 w-full max-w-lg">
      <ProgressBar current={currentIndex} total={questions.length} answers={answers} />
    </div>
  </div>

layout - preference profile (after all questions answered):

  <div className="px-4 py-6 max-w-lg mx-auto">
    <span className="text-xs text-foreground/40 font-medium">your preferences</span>

    <p className="mt-2 text-sm text-foreground/70 leading-relaxed">
      {preferenceProfile.summary}
    </p>

    <div className="mt-3 space-y-1.5">
      {Object.entries(preferenceProfile.preferences).map(([category, value]) => (
        <div key={category} className="flex items-center gap-2 text-xs">
          <span className="text-foreground/40">{category}</span>
          <span className="text-foreground/70 font-medium">{value}</span>
        </div>
      ))}
    </div>

    <div className="mt-4 flex items-center gap-2">
      <RaisedButton onClick={onComplete} color="#00bbff" className="h-7 px-3 text-xs">
        continue to options
      </RaisedButton>
      <button onClick={onRedoRound1} className="h-7 px-3 text-xs text-foreground/40 ...">
        redo preferences
      </button>
    </div>
  </div>

loading state (generating questions or profile):

  <div className="flex flex-col items-center justify-center py-12">
    <WaveSpinner size="sm" color="primary" pattern="square3x3" />
    <span className="mt-3 text-sm text-foreground/50">
      {loading === "questions" ? "preparing questions..." : "building your profile..."}
    </span>
  </div>


TRADEOFF CARD
--------------

file: components/guided-flow/tradeoff-card.tsx

props:

  interface TradeoffCardProps {
    side: "a" | "b";
    label: string;
    value: string;
    selected?: boolean;
    onSelect: () => void;
    disabled?: boolean;
  }

layout:

  <button
    type="button"
    onClick={onSelect}
    disabled={disabled}
    className={cn(
      "flex flex-col rounded-md bg-card p-3 text-left transition-colors",
      "hover:bg-accent",
      selected && "bg-accent",
      disabled && "opacity-50 cursor-not-allowed"
    )}
  >
    <span className="text-sm font-medium leading-tight">{label}</span>
    <span className="mt-1 text-xs text-foreground/50 leading-relaxed">{value}</span>
    <span className={cn(
      "mt-2 self-start inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold",
      selected ? "bg-foreground text-background" : "bg-foreground/5 text-foreground/40"
    )}>
      {side.toUpperCase()}
    </span>
  </button>

  min-height: none. card height determined by content.
  both cards in the grid row stretch to match the taller one (via grid).

selected state:
  - bg-accent (standard selected state from workflow-sidebar)
  - letter badge inverts: bg-foreground text-background
  - NO border, NO shadow (design system rule)

answering behavior:
  1. user clicks card -> onSelect fires
  2. selected card gets bg-accent for 300ms
  3. after 300ms, direction state triggers slide animation
  4. next question slides in from right (see section 15)

keyboard:
  left arrow -> onSelect("a")
  right arrow -> onSelect("b")
  down arrow -> skip
  backspace -> go to previous question

mobile (< 640px):
  - grid-cols-2 stays (cards are narrow enough)
  - at < 400px, switch to grid-cols-1 (stack vertically)
  - when stacked: option A on top, option B below
  - labels change: "A (left)" -> just "A", "B (right)" -> just "B"


PROGRESS BAR
--------------

inline sub-component within round1-tinder.tsx, not a separate file.

layout:

  <div className="flex items-center gap-1.5">
    {questions.map((_, i) => {
      const answered = answers.find(a => a.questionId === questions[i].id);
      const isCurrent = i === currentIndex;
      return (
        <button
          key={i}
          onClick={() => goToQuestion(i)}
          className={cn(
            "h-1 flex-1 rounded-full transition-colors",
            answered ? "bg-foreground/40" : "bg-foreground/10",
            isCurrent && "bg-foreground"
          )}
        />
      );
    })}
    <span className="ml-2 text-[10px] text-foreground/30 shrink-0">
      {answeredCount}/{questions.length}
    </span>
  </div>

  clicking a completed segment goes back to that question.
  segments are thin bars (h-1), not dots.
  current segment is brighter (bg-foreground).


6. ROUND 2: TAILORED OPTION CARDS
====================================

file: components/guided-flow/round2-options.tsx

props:

  interface Round2OptionsProps {
    options: TailoredOption[];
    selectedOptionId?: string;
    onSelect: (optionId: string) => void;
    onConfirm: () => void;
    onBack: () => void;
    onMix: (instructions: string) => void;
    onToggleCompare: () => void;
    showCompare?: boolean;
    mixLoading?: boolean;
    loading?: boolean;
  }

internal state:

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showMix, setShowMix] = useState(false);
  const [mixText, setMixText] = useState("");

layout:

  <div className="flex flex-col px-4 py-3">
    {/* header */}
    <div className="flex items-center justify-between">
      <span className="text-xs text-foreground/40 font-medium">
        your options (tailored to your preferences)
      </span>
      <button
        onClick={onToggleCompare}
        className="text-xs text-foreground/30 hover:text-foreground/60"
      >
        {showCompare ? "card view" : "compare all"}
      </button>
    </div>

    {/* compare table (conditional) */}
    {showCompare && <CompareTable options={options} ... />}

    {/* option cards (vertical stack) */}
    {!showCompare && (
      <div className="mt-3 space-y-2">
        {options.map(option => (
          <TailoredOptionCard
            key={option.id}
            option={option}
            selected={selectedOptionId === option.id}
            expanded={expandedId === option.id}
            onSelect={() => onSelect(option.id)}
            onToggleExpand={() => setExpandedId(
              expandedId === option.id ? null : option.id
            )}
          />
        ))}
      </div>
    )}

    {/* mix section */}
    <div className="mt-3">
      {!showMix ? (
        <button
          onClick={() => setShowMix(true)}
          className="text-xs text-foreground/30 hover:text-foreground/50"
        >
          want to mix elements from multiple options?
        </button>
      ) : (
        <div className="space-y-2">
          <Textarea value={mixText} onChange={...}
            placeholder="describe what you want to combine"
            rows={3} className="text-sm" />
          <div className="flex gap-2">
            <button onClick={() => setShowMix(false)}
              className="h-7 px-3 text-xs text-foreground/40 ...">
              cancel
            </button>
            <button onClick={() => onMix(mixText)}
              disabled={!mixText.trim() || mixLoading}
              className="h-7 px-3 text-xs bg-foreground text-background ...">
              {mixLoading ? "generating..." : "generate custom option"}
            </button>
          </div>
        </div>
      )}
    </div>

    {/* confirmation (when option selected) */}
    {selectedOptionId && (
      <div className="mt-4 flex items-center gap-2">
        <RaisedButton onClick={onConfirm} color="#00bbff" className="h-7 px-3 text-xs">
          continue to plan
        </RaisedButton>
        <button onClick={() => onSelect("")}
          className="h-7 px-3 text-xs text-foreground/40 ...">
          change selection
        </button>
      </div>
    )}
  </div>

loading state:

  <div className="flex flex-col items-center justify-center py-12">
    <WaveSpinner size="sm" color="primary" pattern="square3x3" />
    <span className="mt-3 text-sm text-foreground/50">generating tailored options...</span>
  </div>

keyboard:
  1/2/3/4 -> select option by index
  space -> toggle expand on focused option
  enter -> confirm selection (if option selected)
  c -> toggle compare view
  backspace -> go back to round 1


TAILORED OPTION CARD
----------------------

file: components/guided-flow/tailored-option-card.tsx

props:

  interface TailoredOptionCardProps {
    option: TailoredOption;
    selected: boolean;
    expanded: boolean;
    onSelect: () => void;
    onToggleExpand: () => void;
    readOnly?: boolean;
  }

layout:

  <div className={cn(
    "rounded-md p-3 transition-colors",
    selected ? "bg-accent" : "bg-card",
    !selected && "hover:bg-muted"
  )}>
    {/* row 1: letter + name + match score */}
    <div className="flex items-start justify-between gap-2">
      <div className="flex items-center gap-2 min-w-0">
        <span className={cn(
          "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-[10px] font-bold",
          selected ? "bg-foreground text-background" : "bg-muted text-foreground"
        )}>
          {option.letter}
        </span>
        <span className="text-sm font-medium truncate">{option.name}</span>
      </div>
      <MatchScoreBadge score={option.matchScore} />
    </div>

    {/* row 2: 1-line description */}
    <p className="mt-1 text-xs text-foreground/50 line-clamp-1 pl-8">
      {option.description}
    </p>

    {/* row 3: signal pills + actions */}
    <div className="mt-2 flex items-center justify-between pl-8">
      <div className="flex flex-wrap gap-1.5 text-[10px]">
        <span className="rounded bg-muted px-2 py-0.5 text-muted-foreground">
          effort: <span className={effortColor(option.effort)}>{option.effort}</span>
        </span>
        <span className="rounded bg-muted px-2 py-0.5 text-muted-foreground">
          risk: <span className={riskColor(option.risk)}>{option.risk}</span>
        </span>
        {option.estimatedTime && (
          <span className="rounded bg-muted px-2 py-0.5 text-muted-foreground">
            delivery: <span className="text-foreground">{option.estimatedTime}</span>
          </span>
        )}
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {!readOnly && (
          <button onClick={onSelect} className={cn(
            "h-7 px-3 rounded-md text-xs font-medium",
            selected
              ? "bg-foreground text-background"
              : "bg-muted text-foreground hover:bg-accent"
          )}>
            {selected ? "selected" : "select"}
          </button>
        )}
        <button onClick={onToggleExpand}
          className="h-7 px-2 text-xs text-foreground/30 hover:text-foreground/60">
          {expanded ? "less" : "more"}
        </button>
      </div>
    </div>

    {/* expanded: pros/cons */}
    {expanded && (
      <div className="mt-3 grid gap-3 pt-3 md:grid-cols-2 pl-8"
        style={{ borderTop: "1px solid hsl(var(--foreground) / 0.05)" }}>
        <div>
          <div className="mb-1.5 text-xs text-foreground/40 font-medium">pros</div>
          <ul className="space-y-1">
            {option.pros.map((pro, i) => (
              <li key={i} className="text-xs text-foreground/60">+ {pro}</li>
            ))}
          </ul>
        </div>
        <div>
          <div className="mb-1.5 text-xs text-foreground/40 font-medium">cons</div>
          <ul className="space-y-1">
            {option.cons.map((con, i) => (
              <li key={i} className="text-xs text-foreground/60">- {con}</li>
            ))}
          </ul>
        </div>

        {/* optional preview */}
        {option.preview && (
          <div className="col-span-2 mt-2">
            {option.preview.type === "image" && (
              <img src={option.preview.content} alt={option.name}
                className="rounded-md max-h-48 object-contain" />
            )}
            {option.preview.type === "code" && (
              <pre className="rounded-md bg-muted p-2 text-xs font-mono text-foreground/70 overflow-x-auto">
                {option.preview.content}
              </pre>
            )}
          </div>
        )}
      </div>
    )}
  </div>


MATCH SCORE BADGE
------------------

inline sub-component within tailored-option-card.tsx.

  function MatchScoreBadge({ score }: { score: number }) {
    const tone = score >= 90 ? "text-emerald-400"
      : score >= 70 ? "text-amber-400"
      : "text-foreground/40";

    return (
      <div className="flex items-center gap-1.5 shrink-0">
        <div className="w-12 h-1 rounded-full bg-foreground/10 overflow-hidden">
          <div
            className={cn("h-full rounded-full", tone.replace("text-", "bg-"))}
            style={{ width: `${score}%` }}
          />
        </div>
        <span className={cn("text-[10px] font-medium", tone)}>{score}%</span>
      </div>
    );
  }


COMPARE TABLE (round 2)
-------------------------

inline sub-component within round2-options.tsx.
reuses the same column layout as option-cards.tsx but adds matchScore column.

  <div className="overflow-hidden rounded-md bg-muted mt-3">
    <div className="grid grid-cols-[minmax(0,1.3fr)_repeat(5,minmax(0,0.8fr))_minmax(0,0.6fr)]
      gap-3 px-3 py-2 text-xs text-foreground/40 font-medium">
      <span>option</span>
      <span>effort</span>
      <span>risk</span>
      <span>compatibility</span>
      <span>performance</span>
      <span>recommended</span>
      <span>match</span>
    </div>
    {/* rows: same structure as option-cards.tsx lines 162-199,
        plus match score column */}
  </div>

this is a wrapper around the existing comparison table logic from
option-cards.tsx. reuse effortColor, riskColor, compactSignalTone, etc.


7. ROUND 3: PLAN VIEW
========================

file: components/guided-flow/round3-plan.tsx

props:

  interface Round3PlanProps {
    plan: ExecutionPlan;
    selectedOption: TailoredOption;
    onApprove: () => void;
    onEdit: () => void;
    onRedo: () => void;
    onBack: () => void;
    onTaskEdit?: (taskId: string, title: string) => void;
    onTaskRemove?: (taskId: string) => void;
    onTaskAdd?: (phase: number) => void;
    approving?: boolean;
    loading?: boolean;
  }

layout:

  <div className="flex flex-col px-4 py-3">
    {/* plan header */}
    <div>
      <span className="text-xs text-foreground/40 font-medium">execution plan</span>
      <p className="mt-0.5 text-xs text-foreground/30">
        based on: {selectedOption.letter} - {selectedOption.name}
      </p>
    </div>

    {/* summary */}
    <p className="mt-2 text-sm text-foreground/70 leading-relaxed">
      {plan.summary}
    </p>

    {/* signal row */}
    <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-foreground/40">
      {plan.totalEstimate && (
        <span>total: <span className="text-foreground/60 font-medium">{plan.totalEstimate}</span></span>
      )}
      <span>tasks: <span className="text-foreground/60 font-medium">{plan.tasks.length}</span></span>
      <span>phases: <span className="text-foreground/60 font-medium">{maxPhase}</span></span>
    </div>

    {/* task tree */}
    <div className="mt-3">
      <PlanTaskTree
        tasks={plan.tasks}
        dependencies={plan.dependencies}
        onTaskEdit={onTaskEdit}
        onTaskRemove={onTaskRemove}
        onTaskAdd={onTaskAdd}
      />
    </div>

    {/* actions */}
    <div className="mt-4 flex items-center gap-2">
      <RaisedButton onClick={onApprove} color="#00bbff"
        disabled={approving}
        className="h-7 px-3 text-xs font-semibold">
        {approving ? "creating tasks..." : "approve + create tasks"}
      </RaisedButton>
      <button onClick={onEdit}
        className="h-7 px-3 text-xs text-foreground/40 rounded-md bg-card hover:bg-accent">
        edit plan
      </button>
      <button onClick={onRedo}
        className="h-7 px-3 text-xs text-foreground/30 hover:text-foreground/50">
        redo
      </button>
    </div>
  </div>

loading state:

  <div className="flex flex-col items-center justify-center py-12">
    <WaveSpinner size="sm" color="primary" pattern="square3x3" />
    <span className="mt-3 text-sm text-foreground/50">building your plan...</span>
  </div>


PLAN TASK TREE
---------------

file: components/guided-flow/plan-task-tree.tsx

props:

  interface PlanTaskTreeProps {
    tasks: PlanTask[];
    dependencies: PlanDependency[];
    onTaskEdit?: (taskId: string, title: string) => void;
    onTaskRemove?: (taskId: string) => void;
    onTaskAdd?: (phase: number) => void;
  }

layout:

  tasks grouped by phase number. each phase is a section.

  <div className="space-y-3">
    {phases.map(phase => (
      <div key={phase.number}>
        {/* phase header */}
        <div className="flex items-center justify-between py-1">
          <span className="text-xs text-foreground/40 font-medium">
            phase {phase.number}: {phase.label}
          </span>
          <span className="text-[10px] text-foreground/30">
            ~{phase.estimate}
          </span>
        </div>

        {/* tasks in this phase */}
        <div className="space-y-1 pl-2">
          {phase.tasks.map(task => (
            <PlanTaskRow key={task.id} task={task} ... />
          ))}
        </div>

        {/* add task */}
        {onTaskAdd && (
          <button onClick={() => onTaskAdd(phase.number)}
            className="mt-1 pl-2 text-xs text-foreground/20 hover:text-foreground/40">
            + add task
          </button>
        )}
      </div>
    ))}
  </div>

PlanTaskRow (inline sub-component):

  <div className="group flex items-start gap-2 rounded-sm px-2 py-1.5 hover:bg-muted">
    {/* cosmetic checkbox */}
    <span className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-sm bg-foreground/5" />

    <div className="flex-1 min-w-0">
      <span className="text-sm text-foreground/70">{task.title}</span>

      {/* dependency indicator */}
      {taskDeps.length > 0 && (
        <div className="mt-0.5 text-[10px] text-foreground/25">
          depends on: {taskDeps.map(d => d.title).join(", ")}
        </div>
      )}

      {/* subtasks */}
      {task.subtasks.length > 0 && (
        <div className="mt-1 space-y-0.5 pl-4">
          {task.subtasks.map((sub, i) => (
            <div key={i} className="text-xs text-foreground/40">{sub}</div>
          ))}
        </div>
      )}
    </div>

    {/* delete button (visible on hover) */}
    {onTaskRemove && (
      <button onClick={() => onTaskRemove(task.id)}
        className="opacity-0 group-hover:opacity-100 h-5 w-5 text-foreground/20 hover:text-red-400">
        <CloseCircleFilled className="h-3 w-3" />
      </button>
    )}
  </div>

dependencies are shown via text, NOT drawn lines.
indentation conveys the hierarchy (subtasks indented via pl-4).
phase grouping provides the execution order.

icons needed: CloseCircleFilled from @aliimam/icons


8. DASHBOARD MODE (TABS)
===========================

file: components/decision/dashboard-view.tsx

props:

  interface DashboardViewProps {
    decision: Decision;
    selectedOptionId: string | null;
    onSelectOption: (id: string) => void;
    onApprove: () => void;
    onSwitchToGuided?: () => void;
    approving?: boolean;
    notes: string;
    onNotesChange: (notes: string) => void;
  }

layout:

  <div className="flex flex-col h-full">
    {/* verdict card (sticky) */}
    <VerdictCard decision={decision} />

    {/* tab bar */}
    <TabBar activeTab={activeTab} onTabChange={setActiveTab}
      tabs={visibleTabs} />

    {/* tab content (scrolls) */}
    <div className="flex-1 overflow-y-auto">
      {activeTab === "overview" && <OverviewTab decision={decision} />}
      {activeTab === "options" && <OptionsTab decision={decision} ... />}
      {activeTab === "context" && <ContextTab decision={decision} />}
      {activeTab === "history" && <HistoryTab decision={decision} />}
    </div>

    {/* approval bar (pending only) */}
    {decision.status === "pending" && (
      <ApprovalBar
        selectedOptionId={selectedOptionId}
        options={decision.options}
        notes={notes}
        onNotesChange={onNotesChange}
        onApprove={onApprove}
        onSkip={onSkip}
        approving={approving}
      />
    )}
  </div>

TAB BAR
--------

reuse WorkflowSidebarSegmentedControl from components/ui/workflow-sidebar.tsx.
it already has the exact visual pattern needed (text labels, bg-foreground active).

  const tabs: WorkflowSidebarOption[] = [
    { value: "overview", label: "Overview" },
    { value: "options", label: "Options" },
    { value: "context", label: "Context" },
    // only show history for resolved decisions:
    ...(isResolved ? [{ value: "history", label: "History" }] : []),
  ];

  <div className="px-4 py-2">
    <WorkflowSidebarSegmentedControl
      options={tabs}
      value={activeTab}
      onChange={setActiveTab}
    />
  </div>

keyboard: 1/2/3/4 to switch tabs.


OVERVIEW TAB
--------------

file: components/decision/overview-tab.tsx

props:

  interface OverviewTabProps {
    decision: Decision;
  }

layout (SCQA narrative, 5 items max):

  <div className="px-4 py-3 space-y-4">
    {/* 1. problem statement */}
    <div>
      <span className="text-xs text-foreground/40 font-medium">problem</span>
      <p className="mt-1 text-sm text-foreground/70 leading-relaxed">
        {decision.context?.problem || decision.prompt}
      </p>
    </div>

    {/* 2. impact */}
    {decision.context?.whyProblem && (
      <div>
        <span className="text-xs text-foreground/40 font-medium">impact</span>
        <p className="mt-1 text-sm text-foreground/70 leading-relaxed">
          {decision.context.whyProblem}
        </p>
      </div>
    )}

    {/* 3. recommendation rationale */}
    {decision.recommendation?.rationale && (
      <div>
        <span className="text-xs text-foreground/40 font-medium">recommendation</span>
        <p className="mt-1 text-sm text-foreground/70 leading-relaxed">
          {decision.recommendation.rationale}
        </p>
      </div>
    )}

    {/* 4. before/after card */}
    {(decision.context?.currentState || selectedOption) && (
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-md bg-muted px-3 py-2.5">
          <span className="text-xs text-foreground/40 font-medium">before</span>
          <p className="mt-1 text-sm text-foreground/70">
            {decision.context?.currentState || decision.context?.problem || decision.prompt}
          </p>
        </div>
        <div className="rounded-md bg-muted px-3 py-2.5">
          <span className="text-xs text-foreground/40 font-medium">after</span>
          <p className="mt-1 text-sm text-foreground/70">
            {selectedOption?.description || "choose an option to define the path forward."}
          </p>
        </div>
      </div>
    )}

    {/* 5. constraints (as chips) */}
    {decision.context?.constraints?.length ? (
      <div>
        <span className="text-xs text-foreground/40 font-medium">constraints</span>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {decision.context.constraints.map((c, i) => (
            <span key={i} className="rounded-md bg-foreground/5 px-2 py-0.5 text-xs text-foreground/60">
              {c}
            </span>
          ))}
        </div>
      </div>
    ) : null}
  </div>


OPTIONS TAB
-------------

file: components/decision/options-tab.tsx

props:

  interface OptionsTabProps {
    decision: Decision;
    selectedOptionId: string | null;
    onSelectOption?: (id: string) => void;
    readOnly?: boolean;
  }

layout:

  wraps the existing OptionCards component. no changes needed to option-cards.tsx
  except migrating lucide-react imports (CheckCircle2 -> TickCircleFilled,
  ChevronDown/Up -> ArrowDown1Filled/ArrowUp1Filled from @aliimam/icons).

  <div className="px-4 py-3">
    <OptionCards
      options={decision.options}
      recommendation={decision.recommendation}
      selectedId={selectedOptionId}
      onSelect={readOnly ? undefined : onSelectOption}
      readOnly={readOnly}
    />

    {/* guided flow link (if available) */}
    {decision.guidedFlow?.round1?.preferenceProfile && (
      <button className="mt-3 text-xs text-foreground/30 hover:text-foreground/50">
        these options were tailored to your preferences
      </button>
    )}
  </div>


CONTEXT TAB
-------------

file: components/decision/context-tab.tsx

props:

  interface ContextTabProps {
    decision: Decision;
  }

layout:

  extracts the existing "technical detail" CollapsibleSection content from
  decision-detail.tsx (lines 864-900) and the affected files section
  (lines 902-916).

  <div className="px-4 py-3 space-y-3">
    {/* reuse SummaryTextRow for label/value pairs */}
    <SummaryTextRow label="decision brief" value={decision.prompt} />
    <SummaryTextRow label="current state" value={decision.context?.currentState} />
    <SummaryTextRow label="impact" value={decision.context?.whyProblem} />

    {/* affected areas (chips) */}
    {decision.context?.affectedAreas?.length ? (
      <div className="py-3">
        <div className="text-xs text-foreground/40 font-medium">affected areas</div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {decision.context.affectedAreas.map((area, i) => (
            <span key={i} className="rounded-md bg-foreground/5 px-2 py-0.5 text-xs text-foreground/60">
              {area}
            </span>
          ))}
        </div>
      </div>
    ) : null}

    {/* affected files (mono chips) */}
    {affectedFiles.length > 0 && (
      <div className="py-3">
        <div className="text-xs text-foreground/40 font-medium">affected files</div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {affectedFiles.map((f, i) => (
            <span key={i} className="rounded-md bg-foreground/5 px-2 py-0.5 font-mono text-xs text-foreground/60">
              {f}
            </span>
          ))}
        </div>
      </div>
    )}

    {/* all references */}
    {references.length > 0 && (
      <div className="py-3">
        <div className="text-xs text-foreground/40 font-medium">references</div>
        <ul className="mt-2 space-y-1">
          {references.map((ref, i) => (
            <li key={i} className="font-mono text-xs text-foreground/60">{ref}</li>
          ))}
        </ul>
      </div>
    )}
  </div>

  reuses inferAffectedFiles and extractNonFileReferences from
  current decision-detail.tsx. extract them to a shared utility:
  lib/decision-utils.ts.


HISTORY TAB
-------------

file: components/decision/history-tab.tsx

props:

  interface HistoryTabProps {
    decision: Decision;
    onGenerateRetro?: () => void;
    retroLoading?: boolean;
  }

layout:

  <div className="px-4 py-3 space-y-4">
    {/* resolution details */}
    {decision.resolution && (
      <div>
        <span className="text-xs text-foreground/40 font-medium">resolution</span>
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          <SignalCard label="approved by" value={decision.resolution.selectedBy} />
          <SignalCard label="approved at" value={formatDate(decision.resolution.selectedAt, true)} />
        </div>
        {decision.resolution.notes && (
          <p className="mt-2 text-sm text-foreground/70">{decision.resolution.notes}</p>
        )}
      </div>
    )}

    {/* linked task */}
    {decision.resolution?.taskId && (
      <div>
        <span className="text-xs text-foreground/40 font-medium">linked task</span>
        <a href={`/tasks?task=${encodeURIComponent(decision.resolution.taskId)}`}
          className="mt-1 flex items-center gap-1.5 text-sm font-medium text-blue-300 hover:underline">
          <CodeFilled className="h-3 w-3" />
          {decision.resolution.taskId}
        </a>
      </div>
    )}

    {/* guided flow summary (if used) */}
    {decision.guidedFlow && (
      <div>
        <span className="text-xs text-foreground/40 font-medium">guided flow</span>
        <div className="mt-2 space-y-1.5">
          {decision.guidedFlow.round1.preferenceProfile && (
            <div className="text-xs text-foreground/50">
              round 1: {decision.guidedFlow.round1.preferenceProfile.summary}
            </div>
          )}
          {decision.guidedFlow.round2.selectedOptionId && (
            <div className="text-xs text-foreground/50">
              round 2: selected {decision.guidedFlow.round2.tailoredOptions.find(
                o => o.id === decision.guidedFlow!.round2.selectedOptionId
              )?.name || "an option"}
              (match: {decision.guidedFlow.round2.tailoredOptions.find(
                o => o.id === decision.guidedFlow!.round2.selectedOptionId
              )?.matchScore}%)
            </div>
          )}
          {decision.guidedFlow.completedAt && (
            <div className="text-xs text-foreground/50">
              round 3: plan created {formatDate(decision.guidedFlow.completedAt)}
            </div>
          )}
        </div>
      </div>
    )}

    {/* retrospective */}
    {decision.retrospective ? (
      <div>
        <span className="text-xs text-foreground/40 font-medium">retrospective</span>
        <SummaryTextRow label="summary" value={decision.retrospective.summary} />
        <SummaryTextRow label="outcome" value={decision.retrospective.outcome} />
        <SummaryListRow label="lessons" items={decision.retrospective.lessonsLearned} />
        <div className="text-[10px] text-foreground/30 pt-2">
          completed {formatDate(decision.retrospective.completedAt, true)}
        </div>
      </div>
    ) : onGenerateRetro ? (
      <button onClick={onGenerateRetro} disabled={retroLoading}
        className="h-7 px-3 text-xs rounded-md bg-card text-foreground hover:bg-accent">
        <BookFilled className={cn("h-3 w-3 mr-1", retroLoading && "animate-pulse")} />
        {retroLoading ? "generating..." : "generate retrospective"}
      </button>
    ) : null}
  </div>

icons needed: CodeFilled, BookFilled from @aliimam/icons


9. VERDICT CARD
=================

file: components/decision/verdict-card.tsx

props:

  interface VerdictCardProps {
    decision: Decision;
  }

this is a compact summary card that sticks below the header and above tabs.
it is the "headline" from the inverted pyramid.

when to render:
  - always in dashboard mode when recommendation or resolution exists
  - hidden during intake/researching (no data yet)

layout (pending):

  <div className="mx-4 mt-1 mb-2 rounded-md bg-muted px-4 py-3">
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm font-semibold">
        option {recommendedOption.letter}: {recommendedOption.name}
      </span>
    </div>
    <div className="mt-1.5 flex flex-wrap gap-2 text-[10px]">
      <span className={cn("font-medium", confidenceTone(recommendation.confidence))}>
        {recommendation.confidence} confidence
      </span>
      <span className={cn("font-medium", riskColor(recommendedOption.risk))}>
        {recommendedOption.risk} risk
      </span>
      <span className={cn("font-medium", effortColor(recommendedOption.effort))}>
        {changeSizeLabel(recommendedOption.effort)} change
      </span>
    </div>
    {recommendation.rationale && (
      <p className="mt-1.5 text-sm text-foreground/50 line-clamp-2 leading-relaxed">
        {recommendation.rationale}
      </p>
    )}
  </div>

layout (approved/done):

  <div className="mx-4 mt-1 mb-2 rounded-md bg-muted px-4 py-3">
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm font-semibold">
        option {selectedOption.letter}: {selectedOption.name}
      </span>
      <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-400 font-medium">
        approved
      </span>
    </div>
    <div className="mt-1 text-xs text-foreground/40">
      by {decision.resolution.selectedBy} on {formatDate(decision.resolution.selectedAt)}
    </div>
    {decision.resolution.taskId && (
      <a href={`/tasks?task=${encodeURIComponent(decision.resolution.taskId)}`}
        className="mt-1 text-xs text-blue-300 hover:underline">
        {decision.resolution.taskId}
      </a>
    )}
  </div>

layout (researching):

  <div className="mx-4 mt-1 mb-2 rounded-md bg-muted px-4 py-3 flex items-center gap-3">
    <WaveSpinner size="xs" color="primary" pattern="line" />
    <span className="text-sm text-foreground/50">analyzing...</span>
  </div>

the verdict card uses bg-muted (NOT a featured blue card, NOT bg-accent).
no shadows, no glow, no border. just a tonal shift.


10. APPROVAL BAR
==================

file: components/decision/approval-bar.tsx

props:

  interface ApprovalBarProps {
    selectedOptionId: string | null;
    options: Option[];
    notes: string;
    onNotesChange: (notes: string) => void;
    onApprove: () => void;
    onSkip: () => void;
    approving?: boolean;
    planMode?: boolean;  // true when guided flow round 3 is active
  }

layout:

  sticky bottom bar, always visible when status === "pending".

  <div className="shrink-0 px-4 py-2"
    style={{ borderTop: "1px solid hsl(var(--foreground) / 0.05)" }}>

    {/* notes textarea (expandable) */}
    {showNotes && (
      <div className="mb-2">
        <Textarea value={notes} onChange={e => onNotesChange(e.target.value)}
          placeholder="approval notes (optional)"
          rows={2} className="text-sm" />
      </div>
    )}

    <div className="flex items-center justify-between">
      <button onClick={() => setShowNotes(!showNotes)}
        className="text-xs text-foreground/30 hover:text-foreground/50">
        {showNotes ? "hide notes" : "add notes"}
      </button>

      <div className="flex items-center gap-2">
        <button onClick={onSkip}
          className="h-7 px-3 rounded-md text-xs text-foreground/40 hover:bg-accent">
          skip
        </button>
        <RaisedButton
          onClick={onApprove}
          disabled={!selectedOptionId || approving}
          color="#00bbff"
          className="h-7 px-3 text-xs font-semibold disabled:opacity-40"
        >
          {approving
            ? "approving..."
            : planMode
              ? "approve + create tasks"
              : `approve ${selectedLetter}`}
        </RaisedButton>
      </div>
    </div>
  </div>

  where selectedLetter = options.find(o => o.id === selectedOptionId)?.letter || ""

the bar uses a faint top border (foreground/5%) to separate from content.
no shadow, no blur, no gradient.

keyboard:
  enter -> approve (when option selected and not in textarea)
  escape -> hide notes textarea
  n -> toggle notes


11. BRIEFING MODE (CAROUSEL)
===============================

file: components/decision/briefing-view.tsx

props:

  interface BriefingViewProps {
    decision: Decision;
    onExit: () => void;
    onApprove: () => void;
  }

internal state:

  const [currentCard, setCurrentCard] = useState(0);

card sequence (5 cards):

  cards = [
    { title: "the question", content: <QuestionCard /> },
    { title: "the situation", content: <SituationCard /> },
    { title: "the options", content: <OptionsCard /> },
    { title: "the recommendation", content: <RecommendationCard /> },
    { title: "the ask", content: <AskCard /> },
  ];

layout:

  <div className="flex h-full flex-col">
    {/* card header */}
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-xs text-foreground/40 font-medium">
        {cards[currentCard].title}
      </span>
      <div className="flex items-center gap-3">
        <span className="text-[10px] text-foreground/30">
          {currentCard + 1}/{cards.length}
        </span>
        <button onClick={onExit}
          className="h-5 w-5 text-foreground/30 hover:text-foreground/60">
          <CloseCircleFilled className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>

    {/* card content (centered, fills remaining space) */}
    <div className="flex-1 flex flex-col items-center justify-center px-6 py-4 overflow-hidden">
      <div className="w-full max-w-lg">
        {cards[currentCard].content}
      </div>
    </div>

    {/* navigation */}
    <div className="flex items-center justify-between px-4 py-3">
      <button onClick={prev} disabled={currentCard === 0}
        className="h-7 px-3 text-xs text-foreground/30 hover:text-foreground/60 disabled:opacity-20">
        <ArrowLeftFilled className="h-3.5 w-3.5" />
      </button>

      {/* dots */}
      <div className="flex items-center gap-1.5">
        {cards.map((_, i) => (
          <button key={i} onClick={() => setCurrentCard(i)}
            className={cn(
              "h-1.5 w-1.5 rounded-full transition-colors",
              i === currentCard ? "bg-foreground" : "bg-foreground/20"
            )}
          />
        ))}
      </div>

      <button onClick={next} disabled={currentCard === cards.length - 1}
        className="h-7 px-3 text-xs text-foreground/30 hover:text-foreground/60 disabled:opacity-20">
        <ArrowRightFilled className="h-3.5 w-3.5" />
      </button>
    </div>
  </div>

card transition:
  slide left/right via transform + opacity (see section 15).

card content is centered vertically and horizontally within the panel.
typography is larger than dashboard mode:
  - card title: text-xs text-foreground/40 (in the header, compact)
  - content title: text-lg font-medium (larger for presentation)
  - body: text-sm text-foreground/70
  - padding: px-6 py-4 (more generous than standard px-4 py-3)

no scroll within a card. content must fit the panel.
if content overflows, the card implementation should truncate
with line-clamp or reduce item count.


BRIEFING CARD (per-card content)
-----------------------------------

file: components/decision/briefing-card.tsx

each card type is a simple function component, all in one file.

  card 1 - QuestionCard:
    decision title (text-lg font-medium)
    problem statement (text-sm text-foreground/70)
    "this decision needs your input" (text-xs text-foreground/40)
    category + priority badges

  card 2 - SituationCard:
    context.currentState (text-sm)
    context.whyProblem (text-sm text-foreground/70)
    affected areas as chips

  card 3 - OptionsSummaryCard:
    mini comparison table (3 columns: option name, effort, risk)
    recommended option row has bg-muted
    all on one card, compact

  card 4 - RecommendationCard:
    recommended option name (text-lg font-medium)
    confidence + risk + effort chips
    2-3 sentence rationale
    before/after in two columns

  card 5 - AskCard:
    "approve option {letter}?" (text-lg font-medium)
    [approve] RaisedButton (h-7, blue)
    [view details] secondary button (exits to dashboard)
    [request changes] text button (exits to dashboard with refine active)

keyboard:
  left/right arrows -> prev/next card
  1-5 -> jump to card
  escape -> exit briefing
  enter -> approve (on card 5 only)

icons needed: ArrowLeftFilled, ArrowRightFilled, CloseCircleFilled from @aliimam/icons


12. GUIDED FLOW SKILL (REUSABLE)
===================================

file: components/guided-flow/guided-flow-shell.tsx

this is the orchestrator that wraps rounds 1-3 and makes the whole
thing reusable by other screens.

props:

  interface GuidedFlowProps {
    title: string;
    description: string;
    context: Record<string, unknown>;

    // generation callbacks
    onGenerateQuestions: (ctx: Record<string, unknown>) => Promise<TradeoffQuestion[]>;
    onGenerateOptions: (ctx: Record<string, unknown>, preferences: PreferenceProfile) => Promise<TailoredOption[]>;
    onGeneratePlan: (ctx: Record<string, unknown>, preferences: PreferenceProfile, selectedOption: TailoredOption) => Promise<ExecutionPlan>;

    // persistence (optional)
    state?: GuidedFlow;
    onStateChange?: (state: GuidedFlow) => void;

    // completion
    onComplete: (result: GuidedFlowResult) => void;
    onCancel: () => void;

    // customization
    round1Label?: string;     // default: "preferences"
    round2Label?: string;     // default: "options"
    round3Label?: string;     // default: "plan"
    skipRound1?: boolean;
    skipRound3?: boolean;
  }

  interface GuidedFlowResult {
    preferences: PreferenceProfile;
    selectedOption: TailoredOption;
    plan?: ExecutionPlan;
    customizations?: string[];
  }

internal state:

  if props.state is provided, use it (controlled mode).
  if not, maintain internal state (uncontrolled mode).

  const [flowState, setFlowState] = useState<GuidedFlow>(
    props.state || defaultGuidedFlow()
  );

  function updateState(next: GuidedFlow) {
    setFlowState(next);
    props.onStateChange?.(next);
  }

layout:

  <div className="flex flex-col h-full">
    <RoundIndicator
      currentRound={flowState.currentRound}
      round1Status={flowState.round1.status}
      round2Status={flowState.round2.status}
      round3Status={flowState.round3.status}
      onSelectRound={goToRound}
      onStartOver={handleStartOver}
      onSkipToDashboard={props.onCancel}
      labels={{
        round1: props.round1Label,
        round2: props.round2Label,
        round3: props.round3Label,
      }}
    />

    <div className="flex-1 overflow-y-auto">
      {flowState.currentRound === 1 && !props.skipRound1 && (
        <Round1Tinder
          questions={flowState.round1.questions}
          answers={flowState.round1.answers}
          onAnswer={handleAnswer}
          onComplete={handleRound1Complete}
          onBack={props.onCancel}
          preferenceProfile={flowState.round1.preferenceProfile}
          loading={round1Loading}
        />
      )}

      {flowState.currentRound === 2 && (
        <Round2Options
          options={flowState.round2.tailoredOptions}
          selectedOptionId={flowState.round2.selectedOptionId}
          onSelect={handleOptionSelect}
          onConfirm={handleRound2Confirm}
          onBack={() => goToRound(1)}
          onMix={handleMix}
          onToggleCompare={() => setShowCompare(!showCompare)}
          showCompare={showCompare}
          loading={round2Loading}
        />
      )}

      {flowState.currentRound === 3 && !props.skipRound3 && (
        <Round3Plan
          plan={flowState.round3.plan!}
          selectedOption={selectedOption!}
          onApprove={handleApprove}
          onEdit={() => setEditingPlan(true)}
          onRedo={() => goToRound(2)}
          onBack={() => goToRound(2)}
          loading={round3Loading}
        />
      )}
    </div>
  </div>

round navigation logic:

  goToRound(round: 1 | 2 | 3):
    - can always go backward (to a completed round)
    - can only go forward if current round is complete
    - does NOT erase forward progress
    - if going to round 2 and round 1 answers changed since last
      round 2 generation, regenerate round 2 options

  handleStartOver():
    - requires confirmation (window.confirm or inline confirmation)
    - resets flowState to defaultGuidedFlow()
    - starts round 1 question generation

how another screen plugs in:

  the host screen provides three generation callbacks. these can call
  any backend. the GuidedFlowShell manages the flow state and UI.

  example for decision detail:

    <GuidedFlowShell
      title={decision.title}
      description={decision.prompt}
      context={{ decisionId: decision.id }}
      state={decision.guidedFlow}
      onStateChange={(next) => patchDecision({ guidedFlow: next })}
      onGenerateQuestions={async (ctx) => {
        const res = await fetch(`/api/decisions/${ctx.decisionId}/guided/round1/generate`, { method: "POST" });
        const data = await res.json();
        return pollJob(data.jobId);
      }}
      onGenerateOptions={async (ctx, prefs) => { ... }}
      onGeneratePlan={async (ctx, prefs, option) => { ... }}
      onComplete={(result) => resolveDecision(result)}
      onCancel={() => setViewMode("classic")}
    />

  example for onboarding:

    <GuidedFlowShell
      title="set up your workspace"
      description="we'll figure out what you need"
      context={{ userId, teamSize }}
      skipRound3
      round1Label="preferences"
      round2Label="templates"
      onGenerateQuestions={generateOnboardingQuestions}
      onGenerateOptions={generateTemplateOptions}
      onGeneratePlan={async () => ({ summary: "", tasks: [], dependencies: [] })}
      onComplete={(result) => installTemplate(result.selectedOption)}
      onCancel={() => router.push("/dashboard")}
    />

sub-components exported individually for a la carte use:

  export { GuidedFlowShell } from "./guided-flow-shell";
  export { RoundIndicator } from "./round-indicator";
  export { Round1Tinder } from "./round1-tinder";
  export { TradeoffCard } from "./tradeoff-card";
  export { Round2Options } from "./round2-options";
  export { TailoredOptionCard } from "./tailored-option-card";
  export { Round3Plan } from "./round3-plan";
  export { PlanTaskTree } from "./plan-task-tree";


13. SHARED SUB-COMPONENTS
============================

these already exist in decision-detail.tsx but should be extracted
to shared files so tabs and the orchestrator can reuse them.


COLLAPSIBLE SECTION
---------------------

currently defined inline in both decision-detail.tsx and task-detail.tsx.
extract to: components/ui/collapsible-section.tsx

  interface CollapsibleSectionProps {
    title: string;
    children: React.ReactNode;
    defaultOpen?: boolean;
  }

  uses ArrowDown1Filled / ArrowRight1Filled from @aliimam/icons.
  layout: px-4 py-3, text-xs text-foreground/40 font-medium label,
  mt-2 for content.


SIGNAL CARD
-------------

currently defined inline in decision-detail.tsx (lines 195-212).
extract to: components/ui/signal-card.tsx

  interface SignalCardProps {
    label: string;
    value: string;
    tone?: string;
  }

  layout: rounded-md bg-muted px-3 py-2.5,
  label text-xs text-foreground/40, value text-sm font-semibold.


SUMMARY TEXT ROW / SUMMARY LIST ROW
--------------------------------------

currently defined inline in decision-detail.tsx (lines 149-193).
extract to: lib/decision-ui-helpers.tsx (or components/decision/summary-rows.tsx)

  these are presentation components, not business logic.
  keep them simple: label on left (100px), value on right.


DETAIL SECONDARY BUTTON
--------------------------

currently defined inline in decision-detail.tsx (lines 214-233).
extract to: components/ui/detail-secondary-button.tsx
or just use Button variant="ghost" size="sm" with h-7 override.


UTILITY FUNCTIONS TO EXTRACT
-------------------------------

from decision-detail.tsx to lib/decision-utils.ts:

  inferBlastRadius(decision: Decision): "low" | "medium" | "high"
  inferAffectedFiles(references: string[]): string[]
  extractNonFileReferences(references: string[]): string[]
  confidenceTone(confidence?: string): string
  formatDate(value: string, includeTime?: boolean): string
  statusBadge(status: string): JSX.Element
  priorityBadge(priority?: string): JSX.Element | null

from option-cards.tsx to lib/decision-utils.ts:

  effortColor(effort: string): string
  riskColor(risk: string): string
  backwardCompatibility(option: Option): string
  performanceImpact(option: Option): string
  compactSignalTone(value: string): string
  changeSizeLabel(effort: string): string


14. KEYBOARD MAP
==================

all keyboard handlers follow the existing pattern from decision-detail.tsx
(lines 491-526): add event listener in useEffect, filter out textarea/input
targets, clean up on unmount.

  key        | guided r1  | guided r2  | guided r3  | dashboard  | briefing
  -----------|------------|------------|------------|------------|----------
  left       | option A   | -          | -          | -          | prev card
  right      | option B   | -          | -          | -          | next card
  down       | skip q     | -          | -          | next opt   | -
  up         | -          | -          | -          | prev opt   | -
  backspace  | prev q     | -> round 1 | -> round 2 | -          | -
  1          | -          | select 1   | -          | tab 1      | card 1
  2          | -          | select 2   | -          | tab 2      | card 2
  3          | -          | select 3   | -          | tab 3      | card 3
  4          | -          | select 4   | -          | tab 4      | card 4
  5          | -          | -          | -          | -          | card 5
  space      | -          | expand     | -          | -          | -
  enter      | -          | confirm    | approve    | approve    | approve*
  c          | -          | compare    | -          | -          | -
  n          | -          | -          | -          | notes      | -
  b          | -          | -          | -          | briefing   | -
  g          | -          | -          | -          | guided     | -
  e          | -          | -          | edit plan  | -          | -
  escape     | -          | -          | -          | close notes| exit

  * enter on card 5 only

each mode registers its own keydown handler. only one mode is active
at a time, so there are no conflicts.


15. ANIMATION INVENTORY
=========================

minimal. no scroll animations. no decorative motion.

1. tinder card transition (round 1):
   - outgoing: translateX(-100%) + opacity 0, 200ms ease-out
   - incoming: translateX(100%) -> translateX(0) + opacity 1, 200ms ease-out
   - triggered after 300ms answer feedback delay
   - implementation: CSS transition on a wrapper div with data-direction attribute
   - going backward reverses the direction

   css (inline or in a small css module):
     .tinder-slide-left  { animation: slideOutLeft 200ms ease-out forwards; }
     .tinder-slide-right { animation: slideInRight 200ms ease-out forwards; }
     @keyframes slideOutLeft { to { transform: translateX(-100%); opacity: 0; } }
     @keyframes slideInRight { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }

2. briefing card transition:
   - same as tinder but full card
   - slide direction matches navigation direction
   - 200ms ease-out

3. approval bar notes expand:
   - textarea slides up: max-height transition from 0 to auto
   - 150ms ease-out
   - use css: overflow-hidden, transition: max-height 150ms ease-out
   - or: use a simple conditional render with no animation (simpler)

4. round indicator step completion:
   - number -> checkmark: instant swap, no animation
   - connecting line fills: transition-colors 300ms

5. option card expand/collapse (round 2):
   - content area: simple conditional render (existing pattern)
   - no height animation (matches existing option-cards.tsx behavior)

nothing else should animate. the app is dense and operational,
not a showcase.


16. RESPONSIVE RULES
=======================

breakpoint: md (768px) is the split point for most layouts.

round 1 tinder cards:
  >= 640px: grid-cols-2 (side by side)
  < 640px, >= 400px: grid-cols-2 (still fits, cards are narrow)
  < 400px: grid-cols-1 (stacked)

round 2 option cards:
  always vertical stack (no side-by-side). works at all widths.

round 3 plan:
  subtask indentation uses pl-4 at all widths.
  no horizontal changes needed.

dashboard tabs:
  WorkflowSidebarSegmentedControl is already responsive (flex wraps).

verdict card:
  full width at all sizes. signal chips wrap via flex-wrap.

approval bar:
  full width at all sizes. buttons shrink text on mobile but stay h-7.

briefing view:
  fills the panel at all sizes. larger padding (px-6) on desktop,
  px-4 on mobile. text-lg on desktop, text-base on mobile for titles.

before/after card (overview tab):
  >= 768px: grid-cols-2 (side by side)
  < 768px: grid-cols-1 (stacked)

mobile back button:
  only visible on mobile (md:hidden), same as current decision-detail.tsx.
  uses ArrowLeftFilled, triggers onBack.

general rule: the detail panel is already constrained by the sidebar
split. at mobile widths the sidebar is hidden and the detail panel
is full-screen. all components should work at 320px minimum width.


FILE INVENTORY (complete)
===========================

new files to create:

  components/decision/
    decision-detail-orchestrator.tsx     ~200 lines
    dashboard-view.tsx                  ~100 lines
    verdict-card.tsx                    ~80 lines
    overview-tab.tsx                    ~80 lines
    options-tab.tsx                     ~40 lines
    context-tab.tsx                     ~80 lines
    history-tab.tsx                     ~100 lines
    approval-bar.tsx                    ~70 lines
    briefing-view.tsx                   ~120 lines
    briefing-card.tsx                   ~150 lines

  components/guided-flow/
    guided-flow-shell.tsx               ~200 lines
    round-indicator.tsx                 ~80 lines
    round1-tinder.tsx                   ~180 lines
    tradeoff-card.tsx                   ~50 lines
    round2-options.tsx                  ~150 lines
    tailored-option-card.tsx            ~120 lines
    round3-plan.tsx                     ~120 lines
    plan-task-tree.tsx                  ~100 lines

  components/ui/
    collapsible-section.tsx             ~30 lines (extract)
    signal-card.tsx                     ~20 lines (extract)

  lib/
    decision-utils.ts                   ~100 lines (extract)

existing files to modify:

  lib/decision-types.ts                 add ~100 lines of new types
  components/decision/option-cards.tsx  migrate lucide -> @aliimam/icons
  app/decisions/page.tsx                import orchestrator instead of detail

files to deprecate (NOT delete, just stop importing):

  components/decision/decision-detail.tsx   replaced by orchestrator + sub-components

total new code: ~1950 lines across 20 files
total line count is an estimate - some will be shorter, some longer.
