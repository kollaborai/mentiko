import { isKollaborBarEnabled } from "../ai-engine/kollabor-bar-flag";

describe("isKollaborBarEnabled", () => {
  it("defaults the floating Kollabor bar on when the flag is unset", () => {
    expect(isKollaborBarEnabled(undefined)).toBe(true);
  });

  it("keeps the floating Kollabor bar on for explicit enabled values", () => {
    expect(isKollaborBarEnabled("1")).toBe(true);
  });

  it("allows explicitly disabling the floating Kollabor bar", () => {
    expect(isKollaborBarEnabled("0")).toBe(false);
  });
});
