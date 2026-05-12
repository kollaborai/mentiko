"use client"

import { useState, useEffect } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { slugify } from "@/lib/utils"

interface OrgCreateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (data: { name: string; slug: string }) => Promise<void>
  creating?: boolean
}

export function OrgCreateDialog({
  open,
  onOpenChange,
  onCreate,
  creating = false,
}: OrgCreateDialogProps) {
  const [name, setName] = useState("")
  const [slug, setSlug] = useState("")
  const [error, setError] = useState("")

  // auto-generate slug from name
  useEffect(() => {
    queueMicrotask(() => {
      if (name) {
        setSlug(slugify(name));
      } else {
        setSlug("");
      }
    });
  }, [name]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    if (!name.trim()) {
      setError("name is required")
      return
    }

    if (!slug.trim()) {
      setError("slug is required")
      return
    }

    try {
      await onCreate({ name: name.trim(), slug: slug.trim() })
      setName("")
      setSlug("")
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to create org")
    }
  }

  const handleCancel = () => {
    if (!creating) {
      setName("")
      setSlug("")
      setError("")
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={creating ? undefined : onOpenChange}>
      <DialogContent
        className="rounded-md max-w-md"
        onInteractOutside={(e) => {
          if (creating) e.preventDefault()
        }}
        onEscapeKeyDown={(e) => {
          if (creating) e.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle>Create Organization</DialogTitle>
          <DialogDescription>
            Set up a new workspace for your team
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          {/* name input */}
          <div className="space-y-2">
            <Label htmlFor="org-name">Name</Label>
            <Input
              id="org-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Corp"
              disabled={creating}
              autoFocus
            />
          </div>

          {/* slug input */}
          <div className="space-y-2">
            <Label htmlFor="org-slug">Slug</Label>
            <Input
              id="org-slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="acme-corp"
              disabled={creating}
            />
            <p className="text-xs text-muted-foreground">
              used in URLs: mentiko.com/o/{slug || "slug"}
            </p>
          </div>

          {/* error display */}
          {error && (
            <div className="text-sm text-destructive">
              {error}
            </div>
          )}
        </form>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={handleCancel}
            disabled={creating}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            onClick={handleSubmit}
            disabled={creating || !name.trim() || !slug.trim()}
            loading={creating}
          >
            {creating ? "Creating..." : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
