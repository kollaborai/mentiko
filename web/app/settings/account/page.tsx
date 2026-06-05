"use client";

import { useState, useEffect } from "react";
import { authClient, useSession } from "@/lib/auth/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { DangerFilled, UserFilled, LockFilled, ColorSwatchFilled } from "@aliimam/icons";
import { PageBanner } from "@/components/ui/page-banner";
import { AgentAvatar } from "@/components/agent/agent-avatar";
import { sanitizeSvg } from "@/lib/auth/security";
import Image from "next/image";


function detectTimezone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
}

export default function AccountPage() {
  const { data: session } = useSession();

  // profile state
  const [profileName, setProfileName] = useState("");
  const [profileAvatar, setProfileAvatar] = useState("");
  const [profileTimezone, setProfileTimezone] = useState(detectTimezone);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileStatus, setProfileStatus] = useState<string | null>(null);

  // sync from session + auto-detect timezone on first load
  useEffect(() => {
    if (session?.user) {
      setProfileName((prev) => prev || session.user.name || "");
      setProfileAvatar((prev) => prev || session.user.image || "");
    }
    // (timezone already set via lazy initializer)
  }, [session?.user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSaveProfile = async () => {
    setProfileSaving(true);
    try {
      const res = await authClient.updateUser({
        name: profileName,
        image: profileAvatar || undefined,
      });
      if (res?.error) {
        setProfileStatus("save failed: " + (res.error.message || "unknown error"));
      } else {
        setProfileStatus("saved");
      }
    } catch {
      setProfileStatus("save failed");
    } finally {
      setProfileSaving(false);
      setTimeout(() => setProfileStatus(null), 2500);
    }
  };

  // delete account state
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const handleDeleteAccount = async () => {
    setDeleteLoading(true);
    try {
      const res = await authClient.deleteUser();
      if (res?.error) {
        setDeleteError(res.error.message || "Failed to delete account");
      } else {
        window.location.href = "/";
      }
    } catch {
      setDeleteError("Failed to delete account");
    } finally {
      setDeleteLoading(false);
    }
  };

  return (
    <div className="flex-1 overflow-auto">
      <PageBanner
        title="Account"
        subtitle="Manage your profile, display name, avatar, and timezone. Delete your account permanently from the danger zone below."
        icon={UserFilled}
        sectionColor="#a0927b"
        actions={[
          { label: "Security", href: "/settings/security", icon: LockFilled, iconColor: "#a0927b" },
          { label: "Appearance", href: "/settings/appearance", icon: ColorSwatchFilled, iconColor: "#a0927b" },
        ]}
      />
      <div className="px-4 py-3 max-w-4xl mx-auto">
        <div className="space-y-6">
          {/* user profile */}
          <div className="bg-card rounded-md p-6 space-y-6">
            <div className="flex items-center gap-4">
              {profileAvatar && profileAvatar.trim().startsWith("<svg") ? (
                <div
                  className="h-14 w-14 rounded-full overflow-hidden shrink-0"
                  dangerouslySetInnerHTML={{ __html: sanitizeSvg(profileAvatar) }}
                />
              ) : profileAvatar ? (
                <Image
                  src={profileAvatar}
                  alt={profileName || "avatar"}
                  width={56}
                  height={56}
                  className="h-14 w-14 rounded-full object-cover"
                  onError={() => setProfileAvatar("")}
                />
              ) : (
                <AgentAvatar seed={session?.user?.email || profileName || "user"} size={56} className="rounded-full" />
              )}
              <div>
                <p className="text-sm font-medium">{profileName || "set your name"}</p>
                <p className="text-xs text-muted-foreground">{session?.user?.email || ""}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="display-name">Display Name</Label>
                <Input
                  id="display-name"
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                  placeholder="your name"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="avatar-url">Avatar URL or SVG</Label>
                <Input
                  id="avatar-url"
                  value={profileAvatar}
                  onChange={(e) => setProfileAvatar(e.target.value)}
                  placeholder="https://example.com/avatar.png or <svg>...</svg>"
                />
                <p className="text-[11px] text-muted-foreground/60">
                  URL to image or raw SVG markup. Leave empty for generated avatar.
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="timezone">Timezone</Label>
              <Select value={profileTimezone} onValueChange={setProfileTimezone}>
                <SelectTrigger id="timezone">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {/* always include the detected timezone so it renders even if not in the preset list */}
                  {!["UTC","America/New_York","America/Chicago","America/Denver","America/Los_Angeles","Europe/London","Europe/Paris","Asia/Tokyo","Asia/Shanghai"].includes(profileTimezone) && (
                    <SelectItem value={profileTimezone}>{profileTimezone}</SelectItem>
                  )}
                  <SelectItem value="UTC">UTC</SelectItem>
                  <SelectItem value="America/New_York">Eastern Time</SelectItem>
                  <SelectItem value="America/Chicago">Central Time</SelectItem>
                  <SelectItem value="America/Denver">Mountain Time</SelectItem>
                  <SelectItem value="America/Los_Angeles">Pacific Time</SelectItem>
                  <SelectItem value="Europe/London">London</SelectItem>
                  <SelectItem value="Europe/Paris">Paris</SelectItem>
                  <SelectItem value="Asia/Tokyo">Tokyo</SelectItem>
                  <SelectItem value="Asia/Shanghai">Shanghai</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-end gap-3">
              {profileStatus && (
                <span className={`text-xs ${profileStatus.includes("failed") ? "text-destructive" : "text-green-500"}`}>
                  {profileStatus}
                </span>
              )}
              <Button size="sm" onClick={handleSaveProfile} disabled={profileSaving}>
                {profileSaving ? "Saving..." : "Save Profile"}
              </Button>
            </div>
          </div>

          {/* danger zone */}
          <div className="bg-card rounded-md p-6 space-y-4 border border-destructive/20">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <DangerFilled className="h-4 w-4 text-destructive" />
                <h2 className="text-sm font-semibold text-destructive">Danger Zone</h2>
              </div>
              <p className="text-xs text-muted-foreground">Irreversible actions that affect your account.</p>
            </div>

            <div className="flex items-center justify-between py-3 px-4 rounded-md bg-muted/40">
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium">Delete Account</span>
                <span className="text-xs text-muted-foreground">
                  Permanently delete your account and all data
                </span>
              </div>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm">Delete account</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete your account?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This action cannot be undone. All your data, including profiles, chains, runs,
                      and settings will be permanently deleted.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <div className="space-y-4 py-4">
                    <Label htmlFor="delete-confirm">
                      Type <span className="font-mono font-semibold">delete</span> to confirm
                    </Label>
                    <Input
                      id="delete-confirm"
                      value={deleteConfirm}
                      onChange={(e) => setDeleteConfirm(e.target.value)}
                      placeholder="Type 'delete' to confirm"
                    />
                    {deleteError && <p className="text-xs text-destructive">{deleteError}</p>}
                  </div>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleDeleteAccount}
                      disabled={deleteConfirm !== "delete" || deleteLoading}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      {deleteLoading ? "Deleting..." : "Delete account"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
