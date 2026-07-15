/** @jest-environment node */
/* eslint-disable @typescript-eslint/no-require-imports */

import { readFileSync } from "fs";
import {
  isPayloadCompatibleWithKind,
  jobTypeToGenerationKind,
  normalizeResultForKind,
} from "@/lib/generation/payload-contract";
import {
  payloadContractRuntimePath,
  payloadContractSourcePath,
  renderPayloadContractRuntime,
} from "@/scripts/generate-payload-contract-runtime";

const runtime = require(payloadContractRuntimePath) as {
  isPayloadCompatibleWithKind: typeof isPayloadCompatibleWithKind;
  jobTypeToGenerationKind: typeof jobTypeToGenerationKind;
  normalizeResultForKind: typeof normalizeResultForKind;
};

describe("generation payload contract runtime binding", () => {
  it("is the deterministic generated output of the canonical TypeScript parser", () => {
    const source = readFileSync(payloadContractSourcePath, "utf8");
    const generated = readFileSync(payloadContractRuntimePath, "utf8");
    expect(generated).toBe(renderPayloadContractRuntime(source));
  });

  it.each([
    [{ route: "task", task: { title: "Typed task" } }, "task"],
    [{ route: "decision", reason: "Needs input" }, "task"],
    [{ report: "unrelated" }, "task"],
    [{ name: "chain", agents: [] }, "chain_generation"],
    [{ action: "use_existing", chain_id: "release-review" }, "chain_recommendation"],
    [{ report: "unrelated" }, "chain_recommendation"],
  ] as const)("keeps generated validation parity for kind %s", (payload, kind) => {
    expect(runtime.isPayloadCompatibleWithKind(payload, kind))
      .toBe(isPayloadCompatibleWithKind(payload, kind));
  });

  it("keeps generated normalization and job-kind mapping parity", () => {
    const chain = { name: "generated", agents: [{ id: "writer" }] };
    expect(runtime.normalizeResultForKind(chain, "chain_generation"))
      .toEqual(normalizeResultForKind(chain, "chain_generation"));
    for (const jobType of ["recommend", "generate", "task", "agent"]) {
      expect(runtime.jobTypeToGenerationKind(jobType)).toBe(jobTypeToGenerationKind(jobType));
    }
  });
});
