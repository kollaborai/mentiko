"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { BuildingFilled as Building2, Link2Filled as Hash, ExportFilled as Save, TrashFilled as Trash2, TickCircleFilled as Check, RotateFilled as Loader2 } from "@aliimam/icons";

export interface OrgSettings {
  id: string;
  name: string;
  slug: string;
}

interface OrgSettingsPanelProps {
  org: OrgSettings;
  onSave?: (data: Partial<OrgSettings>) => Promise<void>;
  onDelete?: () => Promise<void>;
}

export function OrgSettingsPanel({ org, onSave, onDelete }: OrgSettingsPanelProps) {
  const [name, setName] = useState(org.name);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasChanges = name !== org.name;

  const handleSave = async () => {
    if (!hasChanges || !onSave) return;

    setSaving(true);
    setError(null);

    try {
      await onSave({ name });
      showSavedFeedback();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete) return;

    setDeleting(true);
    setError(null);

    try {
      await onDelete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
      setDeleting(false);
    }
  };

  const showSavedFeedback = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="space-y-4">
      {/* org info card */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-foreground/60" />
            <CardTitle className="text-base">Organization</CardTitle>
          </div>
          <CardDescription>Manage your organization settings</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* name input */}
          <div className="space-y-2">
            <Label htmlFor="org-name" className="text-xs text-foreground/60">
              Name
            </Label>
            <Input
              id="org-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Organization name"
              className="max-w-sm"
            />
          </div>

          {/* slug (readonly) */}
          <div className="space-y-2">
            <Label className="text-xs text-foreground/60">Slug</Label>
            <div className="flex items-center gap-2">
              <Hash className="h-4 w-4 text-foreground/40" />
              <span className="text-sm text-foreground/80">{org.slug}</span>
            </div>
          </div>

          {/* save button */}
          {onSave && (
            <div className="flex items-center gap-2 pt-2">
              <Button
                size="sm"
                onClick={handleSave}
                disabled={!hasChanges || saving}
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : saved ? (
                  <Check className="h-4 w-4 mr-1" />
                ) : (
                  <Save className="h-4 w-4 mr-1" />
                )}
                {saving ? "Saving..." : saved ? "Saved" : "Save"}
              </Button>
              {error && (
                <span className="text-xs text-destructive">{error}</span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* danger zone */}
      {onDelete && (
        <Card className="bg-destructive/5">
          <CardHeader>
            <CardTitle className="text-sm text-destructive flex items-center gap-2">
              <Trash2 className="h-4 w-4" />
              Danger Zone
            </CardTitle>
            <CardDescription>
              Irreversible actions that affect your organization
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={deleting}
                >
                  {deleting ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4 mr-1" />
                  )}
                  Delete Organization
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Organization</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure? This will permanently delete the organization
                    {" "}
                    <span className="font-medium">{org.name}</span>
                    and all associated data. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={deleting}>
                    Cancel
                  </AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDelete}
                    disabled={deleting}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {deleting ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                        Deleting...
                      </>
                    ) : (
                      "Delete Organization"
                    )}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
