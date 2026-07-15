import type { RuntimeDataShape, RuntimeShapeStatus } from "./runtime-catalog";

/**
 * Plain-language meaning of each assurance level and evidence status.
 *
 * Shared by the docs legend (components/docs/data-shapes-catalog.tsx) and the
 * LLM clipboard payload (clipboard.ts) so a copied shape explains its own
 * counts the same way the page does. Without them a payload carrying
 * `assurance: "typed"` next to `validCount: 0` reads as a failed or verified
 * check when it actually means no canonical schema was available to run.
 */
export const ASSURANCE_MEANING: Record<RuntimeDataShape["assurance"], string> = {
  enforced: "A writer, validator, or database schema actively constrains this shape.",
  "drift-checked": "A JSON Schema is checked against current persisted artifacts on every catalog load.",
  typed: "The producer and reader have a code-level type, but persisted artifacts are not schema-gated.",
  observed: "Fields come from current artifacts; no canonical contract is enforced.",
  open: "The format intentionally accepts arbitrary producer output.",
};

export const STATUS_LEGEND: Array<{
  status: RuntimeShapeStatus;
  label: string;
  description: string;
}> = [
  {
    status: "valid",
    label: "Valid",
    description: "Artifacts exist and every inspected record passed the canonical schema.",
  },
  {
    status: "observed",
    label: "Observed",
    description: "Artifacts were inspected, but no canonical schema was available to validate them.",
  },
  {
    status: "absent",
    label: "Absent",
    description: "No matching artifact or inspectable record exists in the current scope.",
  },
  {
    status: "drift",
    label: "Drift",
    description: "At least one artifact failed validation, parsing, or inspection.",
  },
  {
    status: "unavailable",
    label: "Unavailable",
    description: "No safe runtime sample is configured for this shape.",
  },
];

export function statusMeaning(status: RuntimeShapeStatus): string {
  return STATUS_LEGEND.find((entry) => entry.status === status)?.description ?? "";
}
