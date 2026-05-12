"use client";

import { cn } from "@/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import { type HTMLAttributes } from "react";
import "./wave-spinner.css";

// --- Color Presets ---

export const COLOR_PRESETS = {
  primary: "#5b9ef5",
  success: "#22c55e",
  warning: "#f59e0b",
  danger: "#ef4444",
  muted: "#71717a",
  purple: "#a855f7",
  cyan: "#06b6d4",
  rose: "#f43f5e",
  indigo: "#6366f1",
  emerald: "#10b981",
} as const;

export type ColorPreset = keyof typeof COLOR_PRESETS;

// --- Grid Patterns ---

type DotPosition = { row: number; col: number };

export const GRID_CONFIGS = {
  square3x3: {
    dots: [
      { row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 },
      { row: 1, col: 0 }, { row: 1, col: 1 }, { row: 1, col: 2 },
      { row: 2, col: 0 }, { row: 2, col: 1 }, { row: 2, col: 2 },
    ] as DotPosition[],
    cols: 3,
    rows: 3,
  },
  square2x2: {
    dots: [
      { row: 0, col: 0 }, { row: 0, col: 1 },
      { row: 1, col: 0 }, { row: 1, col: 1 },
    ] as DotPosition[],
    cols: 2,
    rows: 2,
  },
  square4x4: {
    dots: Array.from({ length: 16 }, (_, i) => ({
      row: Math.floor(i / 4),
      col: i % 4,
    })) as DotPosition[],
    cols: 4,
    rows: 4,
  },
  line: {
    dots: [
      { row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 },
    ] as DotPosition[],
    cols: 3,
    rows: 1,
  },
  diamond: {
    dots: [
      { row: 0, col: 1 },
      { row: 1, col: 0 }, { row: 1, col: 1 }, { row: 1, col: 2 },
      { row: 2, col: 1 },
    ] as DotPosition[],
    cols: 3,
    rows: 3,
  },
  cross: {
    dots: [
      { row: 0, col: 1 },
      { row: 1, col: 0 }, { row: 1, col: 1 }, { row: 1, col: 2 },
      { row: 2, col: 1 },
    ] as DotPosition[],
    cols: 3,
    rows: 3,
  },
  circle: {
    dots: [
      { row: 0, col: 1 }, { row: 0, col: 2 },
      { row: 1, col: 0 }, { row: 1, col: 3 },
      { row: 2, col: 0 }, { row: 2, col: 3 },
      { row: 3, col: 1 }, { row: 3, col: 2 },
    ] as DotPosition[],
    cols: 4,
    rows: 4,
  },
} as const;

export type GridPattern = keyof typeof GRID_CONFIGS;

// --- Delay Patterns ---

function getDelayForDot(
  pattern: DelayPattern,
  dot: DotPosition,
  index: number,
  total: number,
  rows: number,
  cols: number,
  duration: number
): number {
  const maxDelay = duration * 0.8;
  const centerRow = (rows - 1) / 2;
  const centerCol = (cols - 1) / 2;

  switch (pattern) {
    case "diagonalTL":
      return ((dot.row + dot.col) / (rows + cols - 2)) * maxDelay;
    case "diagonalTR":
      return ((dot.row + (cols - 1 - dot.col)) / (rows + cols - 2)) * maxDelay;
    case "diagonalBL":
      return (((rows - 1 - dot.row) + dot.col) / (rows + cols - 2)) * maxDelay;
    case "diagonalBR":
      return (((rows - 1 - dot.row) + (cols - 1 - dot.col)) / (rows + cols - 2)) * maxDelay;
    case "ripple": {
      const dist = Math.sqrt(
        (dot.row - centerRow) ** 2 + (dot.col - centerCol) ** 2
      );
      const maxDist = Math.sqrt(centerRow ** 2 + centerCol ** 2);
      return (dist / maxDist) * maxDelay;
    }
    case "horizontal":
      return (dot.col / Math.max(cols - 1, 1)) * maxDelay;
    case "vertical":
      return (dot.row / Math.max(rows - 1, 1)) * maxDelay;
    case "random":
      return Math.random() * maxDelay;
    case "spiral": {
      const angle = Math.atan2(dot.row - centerRow, dot.col - centerCol);
      const dist = Math.sqrt(
        (dot.row - centerRow) ** 2 + (dot.col - centerCol) ** 2
      );
      const maxDist = Math.sqrt(centerRow ** 2 + centerCol ** 2);
      const normalized = ((angle + Math.PI) / (2 * Math.PI) + dist / (maxDist * 2)) % 1;
      return normalized * maxDelay;
    }
    default:
      return (index / total) * maxDelay;
  }
}

export const DELAY_PATTERNS = [
  "diagonalTL",
  "diagonalTR",
  "diagonalBL",
  "diagonalBR",
  "ripple",
  "horizontal",
  "vertical",
  "random",
  "spiral",
] as const;

export type DelayPattern = (typeof DELAY_PATTERNS)[number];

// --- Size Variants ---

const spinnerVariants = cva("inline-grid", {
  variants: {
    size: {
      xs: "gap-[2px]",
      sm: "gap-[3px]",
      md: "gap-1",
      lg: "gap-1.5",
      xl: "gap-2",
    },
  },
  defaultVariants: {
    size: "md",
  },
});

const dotSizeMap = {
  xs: 4,
  sm: 5,
  md: 6,
  lg: 8,
  xl: 10,
} as const;

// --- Component ---

export interface WaveSpinnerProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "color">,
    VariantProps<typeof spinnerVariants> {
  color?: ColorPreset | (string & {});
  pattern?: GridPattern;
  animation?: DelayPattern;
  duration?: number;
  dotShape?: "square" | "rounded" | "circle";
  "aria-label"?: string;
}

export function WaveSpinner({
  color = "primary",
  pattern = "square3x3",
  animation = "diagonalTL",
  duration = 0.7,
  dotShape = "square",
  size = "md",
  className,
  "aria-label": ariaLabel = "Loading",
  ...props
}: WaveSpinnerProps) {
  const resolvedColor =
    color in COLOR_PRESETS
      ? COLOR_PRESETS[color as ColorPreset]
      : color;

  const grid = GRID_CONFIGS[pattern];
  const dotSize = dotSizeMap[size ?? "md"];

  const borderRadius =
    dotShape === "circle"
      ? "50%"
      : dotShape === "rounded"
        ? "2px"
        : "0px";

  return (
    <div
      role="status"
      aria-label={ariaLabel}
      className={cn(spinnerVariants({ size }), className)}
      style={{
        gridTemplateColumns: `repeat(${grid.cols}, ${dotSize}px)`,
        gridTemplateRows: `repeat(${grid.rows}, ${dotSize}px)`,
      }}
      {...props}
    >
      {grid.dots.map((dot, i) => {
        const delay = getDelayForDot(
          animation,
          dot,
          i,
          grid.dots.length,
          grid.rows,
          grid.cols,
          duration
        );

        return (
          <div
            key={`${dot.row}-${dot.col}`}
            className="wave-spinner-dot"
            style={{
              gridRow: dot.row + 1,
              gridColumn: dot.col + 1,
              width: dotSize,
              height: dotSize,
              backgroundColor: resolvedColor,
              borderRadius,
              animation: `waveSpinnerPulse ${duration}s ease-in-out ${delay}s infinite`,
            }}
          />
        );
      })}
    </div>
  );
}
