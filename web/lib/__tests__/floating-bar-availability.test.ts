import { getFloatingBarAvailability } from "@/lib/ui/floating-bar-availability";

jest.mock("@/lib/ai-engine/kollabor-bar-flag", () => ({
  isKollaborBarEnabled: () => process.env.NEXT_PUBLIC_KOLLABOR_BAR !== "0",
  getKollaborBarWidth: () => 373,
  KOLLABOR_BAR_MIN_WIDTH_PX: 240,
  KOLLABOR_BAR_MAX_WIDTH_PX: 720,
}));

const baseState = {
  enabled: true,
  storageScope: "scope-a",
  storageScopeReady: true,
  preferenceReadResolved: true,
  cleanupBlocked: false,
  sessionId: "session-a",
  sessionScope: "scope-a",
  connected: true,
};

describe("floating bar availability", () => {
  const originalFlag = process.env.NEXT_PUBLIC_KOLLABOR_BAR;

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.NEXT_PUBLIC_KOLLABOR_BAR;
    else process.env.NEXT_PUBLIC_KOLLABOR_BAR = originalFlag;
  });

  it("requires deployment, hydrated preference, clean shutdown, and matching connected session", () => {
    expect(getFloatingBarAvailability(baseState as never)).toMatchObject({
      deploymentEnabled: true,
      effectiveEnabled: true,
      runtimeMayStart: true,
      activeSessionMatchesScope: true,
      canApproveUiControl: true,
    });

    expect(getFloatingBarAvailability({ ...baseState, enabled: false } as never).runtimeMayStart).toBe(false);
    expect(getFloatingBarAvailability({ ...baseState, storageScopeReady: false } as never).runtimeMayStart).toBe(false);
    expect(getFloatingBarAvailability({ ...baseState, preferenceReadResolved: false } as never).runtimeMayStart).toBe(false);
    expect(getFloatingBarAvailability({ ...baseState, cleanupBlocked: true } as never).runtimeMayStart).toBe(false);
    expect(getFloatingBarAvailability({ ...baseState, sessionScope: "scope-b" } as never).canApproveUiControl).toBe(false);
    expect(getFloatingBarAvailability({ ...baseState, connected: false } as never).canApproveUiControl).toBe(false);
  });

  it("keeps a deployment-off preference visible but makes runtime and approval unavailable", () => {
    process.env.NEXT_PUBLIC_KOLLABOR_BAR = "0";
    expect(getFloatingBarAvailability(baseState as never)).toMatchObject({
      deploymentEnabled: false,
      effectiveEnabled: false,
      runtimeMayStart: false,
      canApproveUiControl: false,
    });
  });
});
