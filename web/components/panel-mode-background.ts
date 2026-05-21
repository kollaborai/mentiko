import type { CSSProperties } from "react";

export const PANEL_MODE_BACKGROUND_MASK =
  "radial-gradient(ellipse 85% 85% at 50% 50%, black 40%, transparent 70%)";

export const PANEL_MODE_BACKGROUND_LAYERS: CSSProperties[] = [
  {
    WebkitMaskImage: PANEL_MODE_BACKGROUND_MASK,
    backgroundImage: "radial-gradient(circle at 1px 1px, #111113 0.5px, transparent 0)",
    backgroundSize: "8px 8px",
    maskImage: PANEL_MODE_BACKGROUND_MASK,
    opacity: 0.3,
  },
  {
    WebkitMaskImage: PANEL_MODE_BACKGROUND_MASK,
    backgroundImage: "radial-gradient(circle at 1px 1px, #18181b 1px, transparent 0)",
    backgroundSize: "24px 24px",
    maskImage: PANEL_MODE_BACKGROUND_MASK,
    opacity: 0.2,
  },
  {
    WebkitMaskImage: PANEL_MODE_BACKGROUND_MASK,
    backgroundImage: "radial-gradient(circle at 1px 1px, #242428 2px, transparent 0)",
    backgroundSize: "56px 56px",
    maskImage: PANEL_MODE_BACKGROUND_MASK,
    opacity: 0.15,
  },
];
