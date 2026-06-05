"use client"

import { useState, useEffect, useCallback } from "react"
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch"

interface PollResponse {
  counts: Record<string, string>
  total: number
}

export function useEmailUnreadCount() {
  const [total, setTotal] = useState(0)
  const [counts, setCounts] = useState<Record<string, number>>({})
  const { fetchWithNamespace } = useNamespaceFetch()

  const poll = useCallback(async () => {
    try {
      const res = await fetchWithNamespace("/api/email/poll")
      if (res.ok) {
        const data: PollResponse = await res.json()
        setTotal(data.total)
        setCounts(
          Object.fromEntries(
            Object.entries(data.counts).map(([k, v]) => [k, Number(v)])
          )
        )
      }
    } catch {
      // keep showing last known count
    }
  }, [fetchWithNamespace])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    poll()
    const interval = setInterval(poll, 30000)

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        poll()
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange)

    return () => {
      clearInterval(interval)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [poll])

  return { total, counts }
}
