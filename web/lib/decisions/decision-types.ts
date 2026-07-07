export type DecisionStatus =
  | "intake"
  | "researching"
  | "briefed"
  | "pending"
  | "approved"
  | "in_progress"
  | "done"
  | "skipped"
  | "superseded";

export interface Option {
  id: string;
  letter: string;
  name: string;
  description: string;
  pros: string[];
  cons: string[];
  effort: "low" | "medium" | "high";
  risk: "low" | "medium" | "high";
}

export interface Recommendation {
  choiceId: string;
  rationale: string;
  confidence: "low" | "medium" | "high";
  alternatives?: string[];
}

export interface Resolution {
  selectedOptionId: string;
  selectedBy: string;
  selectedAt: string;
  notes?: string;
  taskId?: string;
  taskIds?: string[];
}

export interface Retrospective {
  summary: string;
  outcome: string;
  lessonsLearned: string[];
  completedAt: string;
}

export interface DecisionContext {
  problem: string;
  currentState: string;
  whyProblem: string;
  affectedAreas: string[];
  constraints: string[];
  references: string[];
}

export interface TradeoffChoice {
  label: string;
  value: string;
  icon?: string;
  summary?: string;
  pros?: string[];
  cons?: string[];
}

export interface TradeoffQuestion {
  id: string;
  text: string;
  optionA: TradeoffChoice;
  optionB: TradeoffChoice;
  category: string;
  weight: number;
  recommendation?: {
    choice: "a" | "b" | "either";
    rationale: string;
  };
}

export interface TradeoffAnswer {
  questionId: string;
  choice: "a" | "b" | "skip";
  answeredAt: string;
}

export interface PreferenceProfile {
  summary: string;
  priorities: string[];
  willing_to_sacrifice: string[];
  non_negotiables: string[];
  risk_profile: "conservative" | "moderate" | "aggressive";
  time_horizon: "short_term" | "medium_term" | "long_term";
  decision_style: string;
  // legacy fields kept for backward compat with existing decisions
  preferences?: Record<string, string>;
  constraints?: string[];
}

export interface Round1State {
  status: "pending" | "in_progress" | "synthesizing" | "complete" | "skipped";
  questions: TradeoffQuestion[];
  answers: TradeoffAnswer[];
  preferenceProfile?: PreferenceProfile;
  generationJobId?: string;
  generationRunId?: string;
  synthesisJobId?: string;
}

export interface OptionPreview {
  type: "image" | "component" | "code";
  content: string;
}

export interface TailoredOption {
  id: string;
  letter: string;
  name: string;
  description: string;
  preview?: OptionPreview;
  matchScore: number;
  matchLabel?: string;
  pros: string[];
  cons: string[];
  effort: "low" | "medium" | "high";
  risk: "low" | "medium" | "high";
}

export interface Round2State {
  status: "pending" | "generating" | "ready" | "complete";
  tailoredOptions: TailoredOption[];
  selectedOptionId?: string;
  customizations?: string[];
  generationJobId?: string;
  generationRunId?: string;
}

export interface PlanTask {
  id: string;
  title: string;
  description: string;
  subtasks: string[];
  assignee?: string;
  priority: number;
  phase: number;
}

export interface PlanDependency {
  from: string;
  to: string;
}

export interface ExecutionPlan {
  summary: string;
  tasks: PlanTask[];
  dependencies: PlanDependency[];
}

export interface Round3State {
  status: "pending" | "generating" | "ready" | "complete";
  plan?: ExecutionPlan;
  generationJobId?: string;
  generationRunId?: string;
}

export interface GuidedFlow {
  currentRound: 0 | 1 | 2 | 3;
  round1: Round1State;
  round2: Round2State;
  round3: Round3State;
  startedAt?: string;
  completedAt?: string;
}

export interface DecisionBrief {
  headline: string;
  situation: string;
  situation_bullets?: string[];
  problem: string;
  problem_bullets?: string[];
  impact: string;
  impact_bullets?: string[];
  scope: string;
  scope_bullets?: string[];
}

export type DecisionMode = "classic" | "guided";

export interface Decision {
  id: string;
  status: DecisionStatus;
  prompt: string;
  title?: string;
  priority?: string;
  category?: string;
  source?: string;
  createdAt: string;
  updatedAt: string;
  brief?: DecisionBrief;
  context?: DecisionContext;
  options: Option[];
  recommendation?: Recommendation;
  resolution?: Resolution;
  retrospective?: Retrospective;
  activeJobId?: string;
  researchRunId?: string;
  retroJobId?: string;
  retroRunId?: string;
  guidedFlow?: GuidedFlow;
  mode?: DecisionMode;
  /** Task row that represents this decision in the task tree. */
  taskId?: string;
  /** Existing epic/task that should receive approved follow-up tasks. */
  parentTaskId?: string;
  /** workspace path that scopes this decision (undefined = legacy namespace-level) */
  workspacePath?: string;
}
