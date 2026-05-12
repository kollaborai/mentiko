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
import { Button } from "@/components/ui/button"
import { unwrapApiData, getApiErrorMessage } from "@/lib/api-client"
import type { EmailInbox } from "@/lib/email-types"

export interface CreateInboxDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (inbox: EmailInbox) => void
}

export function CreateInboxDialog({
  open,
  onOpenChange,
  onCreated,
}: CreateInboxDialogProps) {
  const [name, setName] = useState("")
  const [address, setAddress] = useState("")
  const [folder, setFolder] = useState("")
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [emailDomain, setEmailDomain] = useState("")

  useEffect(() => {
    fetch("/api/email/smtp-status")
      .then((r) => r.json())
      .then((j) => { const d = unwrapApiData<{ emailDomain?: string }>(j); if (d.emailDomain) setEmailDomain(d.emailDomain) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
    setFolder("emails/" + slug)
    // auto-fill address when a domain is known and address hasn't been manually edited
    if (emailDomain && slug) {
      setAddress(`${slug}@${emailDomain}`)
    }
  }, [name, emailDomain])

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault()

    if (!name.trim()) {
      setError("Inbox name is required")
      return
    }

    if (!address.trim()) {
      setError("Email address is required")
      return
    }

    if (!address.includes("@")) {
      setError("Invalid email address")
      return
    }

    setCreating(true)
    setError(null)

    try {
      const res = await fetch("/api/email/inboxes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          address: address.trim(),
          folder,
        }),
      })

      if (!res.ok) {
        const raw = await res.json().catch(() => ({}))
        throw new Error(getApiErrorMessage(raw, "Failed to create inbox"))
      }

      const data = unwrapApiData<{ inbox: EmailInbox }>(await res.json())
      onCreated(data.inbox)
      setName("")
      setAddress("")
      setError(null)
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create inbox")
    } finally {
      setCreating(false)
    }
  }

  const handleClose = () => {
    if (!creating) {
      setName("")
      setAddress("")
      setFolder("")
      setError(null)
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create Inbox</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="name">Inbox Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Support"
              disabled={creating}
              className="bg-muted border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
              required
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="address">Email Address</Label>
            <Input
              id="address"
              type="email"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder={emailDomain ? `support@${emailDomain}` : "support@yourdomain.com"}
              disabled={creating}
              className="bg-muted border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
              required
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="folder">Folder</Label>
            <Input
              id="folder"
              value={folder}
              readOnly
              className="bg-muted/50 opacity-70 cursor-not-allowed border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Auto-generated from name. Format: emails/slug
            </p>
          </div>

          {error && (
            <p className="text-red-400 text-sm">{error}</p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={handleClose}
              disabled={creating}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={creating || !name.trim() || !address.trim()}
            >
              {creating && <span className="animate-spin mr-2">⟳</span>}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
