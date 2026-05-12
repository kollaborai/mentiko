"use client";

import { cn } from "@/lib/utils";

interface GradientDotsProps {
  dotSize?: number;
  spacing?: number;
  duration?: number;
  colorCycleDuration?: number;
  backgroundColor?: string;
  className?: string;
}

export function GradientDots({
  dotSize = 8,
  spacing = 10,
  duration = 30,
  colorCycleDuration = 6,
  backgroundColor = "var(--background)",
  className,
}: GradientDotsProps) {
  const hexSpacing = spacing * 1.732;

  return (
    <div
      className={cn("absolute inset-0", className)}
      style={{
        backgroundColor,
        backgroundImage: `
radial-gradient(circle at 50% 50%, transparent 1.5px, ${backgroundColor} 0 ${dotSize}px, transparent ${dotSize}px),
radial-gradient(circle at 50% 50%, transparent 1.5px, ${backgroundColor} 0 ${dotSize}px, transparent ${dotSize}px),
radial-gradient(circle at 50% 50%, #f00, transparent 60%),
radial-gradient(circle at 50% 50%, #ff0, transparent 60%),
radial-gradient(circle at 50% 50%, #0f0, transparent 60%),
radial-gradient(ellipse at 50% 50%, #00f, transparent 60%)
`,
        backgroundSize: `
${spacing}px ${hexSpacing}px,
${spacing}px ${hexSpacing}px,
200% 200%,
200% 200%,
200% 200%,
200% ${hexSpacing}px
`,
        backgroundPosition: `
0px 0px, ${spacing / 2}px ${hexSpacing / 2}px,
0% 0%,
0% 0%,
0% 0px
`,
        animation: `gradient-dots-move ${duration}s linear infinite, gradient-dots-hue ${colorCycleDuration}s linear infinite`,
      }}
    />
  );
}
