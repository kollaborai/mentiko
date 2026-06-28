"use client";

import type { ReactNode } from "react";

const DOT_STYLE = {
  backgroundColor: "var(--background)",
  backgroundImage:
    "radial-gradient(circle at 50% 50%, transparent 1.5px, var(--background) 0 6px, transparent 6px), " +
    "radial-gradient(circle at 50% 50%, transparent 1.5px, var(--background) 0 6px, transparent 6px), " +
    "radial-gradient(circle at 50% 50%, #f00, transparent 60%), " +
    "radial-gradient(circle at 50% 50%, #ff0, transparent 60%), " +
    "radial-gradient(circle at 50% 50%, #0f0, transparent 60%), " +
    "radial-gradient(ellipse at 50% 50%, #00f, transparent 60%)",
  backgroundSize:
    "12px 20.784px, 12px 20.784px, 200% 200%, 200% 200%, 200% 200%, 200% 20.784px",
  backgroundPosition: "0px 0px, 6px 10.392px, 0% 0%, 0% 0%, 0% 0px",
  animation:
    "40s linear 0s infinite normal none running gradient-dots-move, " +
    "8s linear 0s infinite normal none running gradient-dots-hue",
} as const;

interface DetailHeaderProps {
  children: ReactNode;
  className?: string;
}

export function DetailHeader({ children, className = "" }: DetailHeaderProps) {
  return (
    <div
      className={`relative flex items-center justify-between bg-muted dark:bg-[#0a0a0a] rounded-md px-4 py-3 overflow-hidden ${className}`}
    >
      <div
        className="absolute inset-0 opacity-[0.07] pointer-events-none"
        style={DOT_STYLE}
      />
      {children}
    </div>
  );
}
