// -------------------------------------------------------------------
// kollabor-bar-flag.ts — Feature flag for the kollabor agent bar.
// -------------------------------------------------------------------
// The agent bar (floating chat interface) is opt-in via NEXT_PUBLIC_KOLLABOR_BAR.
// Set to "0" to disable, any other value (or unset) enables it.
//
// This flag allows deployments to disable the bar without code changes.
// Default is enabled for backwards compatibility.
// -------------------------------------------------------------------

export function isKollaborBarEnabled(
  flag = process.env.NEXT_PUBLIC_KOLLABOR_BAR,
): boolean {
  return flag !== "0";
}
