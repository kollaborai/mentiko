import {
  getKollaborBarWidth,
  isKollaborBarEnabled,
  KOLLABOR_BAR_DEFAULT_WIDTH_PX,
  KOLLABOR_BAR_MAX_WIDTH_PX,
  KOLLABOR_BAR_MIN_WIDTH_PX,
} from "../ai-engine/kollabor-bar-flag";

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

describe("getKollaborBarWidth", () => {
  it("uses the existing 373px geometry when unset", () => {
    expect(getKollaborBarWidth(undefined)).toBe(KOLLABOR_BAR_DEFAULT_WIDTH_PX);
  });

  it("accepts an integer deployment width within the safe bounds", () => {
    expect(getKollaborBarWidth("480")).toBe(480);
    expect(getKollaborBarWidth(String(KOLLABOR_BAR_MIN_WIDTH_PX))).toBe(
      KOLLABOR_BAR_MIN_WIDTH_PX,
    );
    expect(getKollaborBarWidth(String(KOLLABOR_BAR_MAX_WIDTH_PX))).toBe(
      KOLLABOR_BAR_MAX_WIDTH_PX,
    );
  });

  it("falls back for malformed, fractional, and out-of-range values", () => {
    expect(getKollaborBarWidth("480px")).toBe(KOLLABOR_BAR_DEFAULT_WIDTH_PX);
    expect(getKollaborBarWidth("480.5")).toBe(KOLLABOR_BAR_DEFAULT_WIDTH_PX);
    expect(getKollaborBarWidth("239")).toBe(KOLLABOR_BAR_DEFAULT_WIDTH_PX);
    expect(getKollaborBarWidth("721")).toBe(KOLLABOR_BAR_DEFAULT_WIDTH_PX);
  });
});
