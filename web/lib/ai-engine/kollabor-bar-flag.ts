export function isKollaborBarEnabled(
  flag = process.env.NEXT_PUBLIC_KOLLABOR_BAR,
): boolean {
  return flag !== "0";
}
