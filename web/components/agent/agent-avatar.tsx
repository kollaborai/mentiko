"use client";

import { useMemo } from "react";
import { createAvatar } from "@dicebear/core";
import * as botttsNeutral from "@dicebear/bottts-neutral";

interface AgentAvatarProps {
  seed: string;
  size?: number;
  className?: string;
}

export function AgentAvatar({ seed, size = 24, className = "" }: AgentAvatarProps) {
  const svg = useMemo(() => {
    const avatar = createAvatar(botttsNeutral, {
      seed,
      size,
    });
    return avatar.toString();
  }, [seed, size]);

  return (
    <div
      className={`shrink-0 rounded-sm overflow-hidden ${className}`}
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
