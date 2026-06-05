"use client";

import { useState, useTransition } from "react";
import { copyToClipboard } from "@/lib/ui/copy-to-clipboard";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { getApiErrorMessage } from "@/lib/api/api-client";
import { SmsFilled as MailIcon, Link2Filled as LinkIcon, TickCircleFilled as CheckIcon, RotateFilled as Loader2Icon } from "@aliimam/icons";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const roles = [
  { value: "admin", label: "Admin", description: "full access, manage members" },
  { value: "member", label: "Member", description: "create and manage chains" },
  { value: "guest", label: "Guest", description: "view only" },
];

interface OrgInviteDialogProps {
  orgId: string;
  onInviteSent?: (email: string, role: string) => void;
  trigger?: React.ReactNode;
}

export function OrgInviteDialog({ orgId, onInviteSent, trigger }: OrgInviteDialogProps) {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  const reset = () => {
    setEmail("");
    setRole("member");
    setError(null);
    setCopied(false);
    setInviteLink(null);
  };

  const handleClose = () => {
    reset();
    setOpen(false);
  };

  const sendInvite = async () => {
    setError(null);
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      setError("enter a valid email");
      return;
    }

    startTransition(async () => {
      try {
        const res = await fetchWithNamespace(`/api/orgs/${orgId}/invite`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, role }),
        });

        if (!res.ok) {
          const data = await res.json();
          setError(getApiErrorMessage(data, "failed to send invite"));
          return;
        }

        const data = await res.json();
        const token = data.invite?.token || "pending";
        setInviteLink(`${window.location.origin}/invite/${token}`);

        onInviteSent?.(email, role);
      } catch {
        setError("network error");
      }
    });
  };

  const copyInviteLink = () => {
    if (!inviteLink) return;
    copyToClipboard(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="max-w-sm rounded-md bg-card p-4" showCloseButton>
        <DialogHeader>
          <DialogTitle className="text-base text-foreground">invite member</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            create an invite link to share
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          {/* email input */}
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">email</label>
            <div className="relative">
              <MailIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                className="h-8 pl-9 text-xs bg-muted"
                onKeyDown={(e) => e.key === "enter" && sendInvite()}
              />
            </div>
          </div>

          {/* role dropdown */}
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">role</label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger className="h-8 w-full bg-muted text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-card">
                {roles.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    <div className="flex flex-col">
                      <span>{r.label}</span>
                      <span className="text-xs text-muted-foreground">{r.description}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* error */}
          {error && (
            <div className="rounded-md bg-red-400/10 px-3 py-2 text-xs text-red-400">
              {error}
            </div>
          )}

          {/* invite link generated */}
          {inviteLink && (
            <div className="space-y-2 rounded-md bg-muted/50 p-3">
              <div className="text-xs text-muted-foreground">invite link</div>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs bg-muted px-2 py-1.5 rounded truncate">
                  {inviteLink}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={copyInviteLink}
                  className="h-8 shrink-0"
                >
                  {copied ? (
                    <CheckIcon className="w-4 h-4" />
                  ) : (
                    <LinkIcon className="w-4 h-4" />
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button size="sm" variant="outline" onClick={handleClose} disabled={isPending}>
            cancel
          </Button>
          <Button size="sm" onClick={sendInvite} disabled={isPending || !email}>
            {isPending ? (
              <>
                <Loader2Icon className="w-4 h-4 animate-spin" />
                creating...
              </>
            ) : (
              <>
                <LinkIcon className="w-4 h-4" />
                create invite
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
