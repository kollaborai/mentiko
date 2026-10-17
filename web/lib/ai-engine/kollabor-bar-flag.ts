// -------------------------------------------------------------------
// kollabor-bar-flag.ts — Feature flag for the kollabor agent bar.
// -------------------------------------------------------------------
// The agent bar (floating chat interface) is opt-in via NEXT_PUBLIC_KOLLABOR_BAR.
// Set to "0" to disable, any other value (or unset) enables it.
//
// This flag is the deployment master switch. The authenticated, scoped user
// preference lives in kollabor-bar-store and is evaluated by
// floating-bar-availability; deployment=false always wins over that setting.
// NEXT_PUBLIC_KOLLABOR_BAR_WIDTH is the deployment-time default for the
// user-adjustable scoped bar width; it does not change the deployment/user
// enablement decision.
// Default is enabled for backwards compatibility, so a missing user key keeps
// existing users visible after the preference hydrates.
// -------------------------------------------------------------------

export function isKollaborBarEnabled(
  flag = process.env.NEXT_PUBLIC_KOLLABOR_BAR,
): boolean {
  return flag !== "0";
}

// Deployment-time visual config. The bar component still clamps this to the
// viewport on narrow screens, so a wide desktop value cannot cause overflow.
export const KOLLABOR_BAR_DEFAULT_WIDTH_PX = 373;
export const KOLLABOR_BAR_MIN_WIDTH_PX = 240;
export const KOLLABOR_BAR_MAX_WIDTH_PX = 720;

export function getKollaborBarWidth(
  value = process.env.NEXT_PUBLIC_KOLLABOR_BAR_WIDTH,
): number {
  if (value === undefined || value.trim() === "") {
    return KOLLABOR_BAR_DEFAULT_WIDTH_PX;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return KOLLABOR_BAR_DEFAULT_WIDTH_PX;
  if (parsed < KOLLABOR_BAR_MIN_WIDTH_PX || parsed > KOLLABOR_BAR_MAX_WIDTH_PX) {
    return KOLLABOR_BAR_DEFAULT_WIDTH_PX;
  }
  return parsed;
}
