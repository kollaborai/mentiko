"use client"

import { useEmailUnreadCount } from "@/hooks/use-email-unread-count"

export function EmailNavBadge() {
  const { total } = useEmailUnreadCount()
  if (total === 0) return null
  return (
    <span className="ml-auto inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-foreground px-1 text-[10px] font-medium text-background">
      {total > 99 ? "99+" : total}
    </span>
  )
}
