"use client"

import { useState, useEffect } from "react"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { unwrapApiData, getApiErrorMessage } from "@/lib/api-client"
import Link from "next/link"

export interface ComposeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultTo?: string
  defaultSubject?: string
  defaultReplyTo?: string
}

export function ComposeDialog({
  open,
  onOpenChange,
  defaultTo = "",
  defaultSubject = "",
  defaultReplyTo,
}: ComposeDialogProps) {
  const [to, setTo] = useState(defaultTo)
  const [subject, setSubject] = useState(defaultSubject)
  const [text, setText] = useState("")
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [smtpConfigured, setSmtpConfigured] = useState<boolean | null>(null)

  useEffect(() => {
    if (!open) return
    fetch("/api/email/smtp-status")
      .then((r) => r.json())
      .then((j) => setSmtpConfigured(unwrapApiData<{ configured?: boolean }>(j).configured ?? false))
      .catch(() => setSmtpConfigured(false))
  }, [open])

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault()
    if (!to.trim() || !subject.trim()) {
      setError("Please fill in all required fields")
      return
    }

    setSending(true)
    setError(null)

    try {
      const payload: { to: string; subject: string; text?: string; replyTo?: string } = {
        to: to.trim(),
        subject: subject.trim(),
      }

      if (text.trim()) {
        payload.text = text.trim()
      }

      if (defaultReplyTo) {
        payload.replyTo = defaultReplyTo
      }

      const res = await fetch("/api/email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const raw = await res.json().catch(() => ({}))
        throw new Error(getApiErrorMessage(raw, "Failed to send email"))
      }

      setTo("")
      setSubject("")
      setText("")
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send email")
    } finally {
      setSending(false)
    }
  }

  const handleClose = () => {
    if (!sending) {
      setTo("")
      setSubject("")
      setText("")
      setError(null)
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Compose Email</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {smtpConfigured === false && (
            <div className="rounded-md bg-amber-500/10 border border-amber-500/20 px-3 py-2.5 text-xs text-amber-400">
              SMTP is not configured — emails cannot be sent.{" "}
              <Link href="/settings/email" className="underline underline-offset-2 hover:text-amber-300" onClick={() => handleClose()}>
                Set up in Settings
              </Link>
            </div>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="to">To</Label>
            <Input
              id="to"
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="recipient@example.com"
              disabled={sending}
              className="bg-muted border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
              required
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="subject">Subject</Label>
            <Input
              id="subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Email subject"
              disabled={sending}
              className="bg-muted border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
              required
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="body">Message</Label>
            <Textarea
              id="body"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Write your message..."
              disabled={sending}
              className="bg-muted border-0 focus-visible:ring-0 focus-visible:ring-offset-0 min-h-[160px]"
            />
          </div>

          {error && (
            <p className="text-red-400 text-sm">{error}</p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={handleClose}
              disabled={sending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={sending || !to.trim() || !subject.trim()}>
              {sending && <span className="animate-spin mr-2">⟳</span>}
              Send
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
