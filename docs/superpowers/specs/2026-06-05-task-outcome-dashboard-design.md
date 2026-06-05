# Task Outcome Dashboard Design

## Goal

Replace the five experimental task outcome panels with one compact dashboard that tells the task outcome story: what happened, whether the orchestration made the right decisions, what evidence proves it, and what Mentiko should learn from the run.

## Users

- Project managers need a fast answer to whether work finished, needs review, or produced follow-up work.
- Builders need provenance: generated task, recommendation run, generated chain run, execution run, and artifacts.
- Mentiko improvement agents need operational signals: retries, stale state, wrong-chain recommendations, tool confusion, missing artifacts, partial summaries, duration, and cost.

## Product Shape

The dashboard appears in task detail below the chain section when a task has run metadata. It is one borderless, flat, dense panel with internal widgets:

1. Outcome strip: outcome, confidence, decision-required state, artifacts, run duration, and cost when available.
2. AI narrative: a generated run story that explains what happened, why it matters, and what to do next.
3. Execution journey: task -> recommendation -> generation -> execution, with run links and provenance labels.
4. Evidence: artifacts, final proof files, findings, risks, and acceptance evidence.
5. Improvement signals: issues in the orchestration itself, such as retries, stale run state, summary lag, or chain mismatch.
6. Receipt: compact ids and timestamps for auditing.

## Data Model

Existing structured summary remains as `metadata.last_run_summary`. It is deterministic and built from `run-summary.json`.

New AI narrative summary lives in:

- `metadata.task_outcome_summary`
- `metadata.task_outcome_summary_job_id`
- `metadata.task_outcome_summary_status`
- `metadata.task_outcome_summary_run_id`
- `metadata.task_outcome_summary_completed_at`
- `metadata.task_outcome_summary_error`

The AI summary job type is `task_run_summary`. It uses the existing `run-summary-generation` core chain, but with a task-run-specific template.

## AI Summary Contract

The task-run summary job outputs JSON:

```json
{
  "headline": "one sentence",
  "narrative": "two to four sentences",
  "outcome": "complete",
  "confidence": "high",
  "decision_required": false,
  "what_happened": ["specific fact"],
  "evidence": ["specific artifact or acceptance proof"],
  "improvement_signals": ["system-level learning"],
  "next_actions": ["actionable next step"]
}
```

The summary must be factual and grounded in the run metadata, task contract, artifacts list, and deterministic run summary. It must not invent file changes or agent behavior.

## Stale State Rule

The task detail pane must not keep showing old run metadata after the list refreshes. When a task is selected, the page periodically fetches the selected task detail directly and reconciles it into the selected pane and list row. The outcome dashboard also guards against mismatched provenance by preferring a summary whose `run_id` matches `last_run_id`.

## Acceptance Criteria

- A completed task displays one outcome dashboard instead of five option panels.
- The dashboard prefers `task_outcome_summary` when it matches the current execution run.
- If the AI summary is missing, the dashboard still renders from `last_run_summary` and shows summary generation state.
- A task-run summary job can be started for a completed task and writes its result back into task metadata.
- Link-run summary behavior remains unchanged.
- TASK-070 shows the final run `run-1780629719979`, not stale prior run data.
