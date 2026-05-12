import * as React from "react"
import { cn } from "@/lib/utils"

export interface TimeAgoProps extends React.HTMLAttributes<HTMLTimeElement> {
  date: Date | string | number
  suffix?: boolean
  format?: "short" | "long" | "relative"
}

const timeFormats = {
  short: {
    second: "s",
    minute: "m",
    hour: "h",
    day: "d",
    week: "w",
    month: "mo",
    year: "y",
  },
  long: {
    second: "second",
    minute: "minute",
    hour: "hour",
    day: "day",
    week: "week",
    month: "month",
    year: "year",
  },
  relative: {
    second: "just now",
    minute: "a minute ago",
    hour: "an hour ago",
    day: "a day ago",
    week: "a week ago",
    month: "a month ago",
    year: "a year ago",
  },
}

function getTimeDifference(date: Date): { value: number; unit: keyof typeof timeFormats.long } {
  const now = new Date()
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000)

  if (diffInSeconds < 60) {
    return { value: diffInSeconds, unit: "second" }
  }
  if (diffInSeconds < 3600) {
    return { value: Math.floor(diffInSeconds / 60), unit: "minute" }
  }
  if (diffInSeconds < 86400) {
    return { value: Math.floor(diffInSeconds / 3600), unit: "hour" }
  }
  if (diffInSeconds < 604800) {
    return { value: Math.floor(diffInSeconds / 86400), unit: "day" }
  }
  if (diffInSeconds < 2592000) {
    return { value: Math.floor(diffInSeconds / 604800), unit: "week" }
  }
  if (diffInSeconds < 31536000) {
    return { value: Math.floor(diffInSeconds / 2592000), unit: "month" }
  }
  return { value: Math.floor(diffInSeconds / 31536000), unit: "year" }
}

function formatTime(
  diff: { value: number; unit: keyof typeof timeFormats.long },
  format: "short" | "long" | "relative",
  suffix: boolean
): string {
  const { value, unit } = diff

  if (format === "relative") {
    if (value === 1) {
      return timeFormats.relative[unit]
    }
    return `${value} ${unit}s ago`
  }

  const unitLabel = timeFormats[format][unit]
  const pluralized = value === 1 ? unitLabel : `${unitLabel}${format === "short" ? "" : "s"}`
  const suffixText = suffix ? (format === "short" ? "" : " ago") : ""

  return `${value}${format === "short" ? "" : " "}${pluralized}${suffixText}`
}

export function TimeAgo({
  date,
  suffix = true,
  format = "long",
  className,
  ...props
}: TimeAgoProps) {
  const dateObj = typeof date === "string" || typeof date === "number"
    ? new Date(date)
    : date

  const diff = getTimeDifference(dateObj)
  const formatted = formatTime(diff, format, suffix)

  return (
    <time
      className={cn("text-muted-foreground text-sm tabular-nums", className)}
      dateTime={dateObj.toISOString()}
      {...props}
    >
      {formatted}
    </time>
  )
}
