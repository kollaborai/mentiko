import { DEFAULT_TASK_TEMPLATE } from "@/lib/generation-template-storage";

describe("DEFAULT_TASK_TEMPLATE", () => {
  it("keeps the example acceptance criteria aligned with Given/When/Then instructions", () => {
    expect(DEFAULT_TASK_TEMPLATE).toContain(
      'Each criterion: "Given X, when Y, then Z"'
    );
    expect(DEFAULT_TASK_TEMPLATE).toContain(
      '"acceptance_criteria": "Given each webhook endpoint exists, when it is created, then it has a unique signing secret'
    );
    expect(DEFAULT_TASK_TEMPLATE).toContain(
      "Given a consumer receives an outbound request, when it verifies X-Mentiko-Signature"
    );
  });
});
