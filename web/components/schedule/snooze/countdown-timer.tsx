"use client";

import { useEffect, useState, useMemo } from "react";
import { cn } from "@/lib/utils";

interface CountdownTimerProps {
  snoozedUntil: string;
  className?: string;
}

function calculateTimeLeft(expiryTime: number, now: number) {
  const diff = expiryTime - now;

  if (diff <= 0) {
    return null;
  }

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);

  return { days, hours, minutes, seconds };
}

export function CountdownTimer({ snoozedUntil, className }: CountdownTimerProps) {
  const [now, setNow] = useState(() => Date.now());

  const expiryTime = useMemo(() => new Date(snoozedUntil).getTime(), [snoozedUntil]);
  const timeLeft = useMemo(() => calculateTimeLeft(expiryTime, now), [expiryTime, now]);

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  if (!timeLeft) {
    return null;
  }

  const formatTime = () => {
    const parts: string[] = [];

    if (timeLeft.days > 0) {
      parts.push(`${timeLeft.days}d`);
    }
    if (timeLeft.hours > 0) {
      parts.push(`${timeLeft.hours}h`);
    }
    if (timeLeft.minutes > 0) {
      parts.push(`${timeLeft.minutes}m`);
    }
    if (timeLeft.seconds > 0 || parts.length === 0) {
      parts.push(`${timeLeft.seconds}s`);
    }

    return parts.join(" ");
  };

  return (
    <span className={cn("text-xs text-amber-400", className)}>
      {formatTime()}
    </span>
  );
}
