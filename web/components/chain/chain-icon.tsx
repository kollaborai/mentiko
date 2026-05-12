"use client";

import { useMemo } from "react";
import { allVectors } from "@aliimam/vectors";

// Extract abstract category vectors into a flat array
const abstractVectors = Object.values(allVectors.abstract)
  .sort((a, b) => a.metadata.id.localeCompare(b.metadata.id));

// darkish muted palette - looks good on both light and dark backgrounds
const colors = [
  "#6d5daa", // purple
  "#4a7c8f", // teal
  "#8b6b4a", // bronze
  "#5b7a5e", // sage
  "#7c5474", // mauve
  "#4a6fa5", // steel blue
  "#8a6352", // clay
  "#5c7c94", // slate blue
  "#7a6248", // umber
  "#5a6e82", // storm
  "#856a5d", // mocha
  "#5d7468", // fern
  "#7b5f7b", // plum
  "#6a7d5a", // olive
  "#6b6f8d", // twilight
  "#8c6d72", // rose dust
];

// djb2 hash - deterministic string -> number
function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

interface ChainIconProps {
  seed: string;
  size?: number;
  className?: string;
}

export function ChainIcon({ seed, size = 24, className = "" }: ChainIconProps) {
  const { Icon, color } = useMemo(() => {
    const h = hashString(seed);
    const iconIndex = h % abstractVectors.length;
    const colorIndex = hashString(seed + "_color") % colors.length;
    return {
      Icon: abstractVectors[iconIndex].Component,
      color: colors[colorIndex],
    };
  }, [seed]);

  return (
    <div
      className={`shrink-0 rounded-sm overflow-hidden ${className}`}
      style={{ width: size, height: size, color }}
    >
      <Icon size={size} />
    </div>
  );
}
