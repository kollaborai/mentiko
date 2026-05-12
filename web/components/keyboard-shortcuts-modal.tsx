"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ShortcutGroup {
  title: string;
  shortcuts: Array<{
    keys: string[];
    description: string;
  }>;
}

const shortcutGroups: ShortcutGroup[] = [
  {
    title: "Navigation",
    shortcuts: [
      { keys: ["?"], description: "Show keyboard shortcuts" },
      { keys: ["⌘", "K"], description: "Open search" },
      { keys: ["G", "D"], description: "Go to dashboard" },
      { keys: ["G", "R"], description: "Go to runs" },
      { keys: ["G", "C"], description: "Go to chains" },
      { keys: ["G", "T"], description: "Go to tasks" },
      { keys: ["G", "A"], description: "Go to agents" },
    ],
  },
  {
    title: "Actions",
    shortcuts: [
      { keys: ["N"], description: "New task (on tasks page)" },
      { keys: ["R"], description: "Run chain (on chains page)" },
      { keys: ["⌘", "/"], description: "Toggle sidebar" },
    ],
  },
  {
    title: "General",
    shortcuts: [
      { keys: ["Esc"], description: "Close modals / dialogs" },
      { keys: ["⌘", "K"], description: "Quick command palette" },
    ],
  },
];

function KeyBadge({ keys }: { keys: string[] }) {
  return (
    <div className="flex items-center gap-0.5">
      {keys.map((key, i) => (
        <span key={i} className="inline-flex px-1.5 py-0.5 bg-muted rounded text-xs font-mono">
          {key}
        </span>
      ))}
    </div>
  );
}

export function KeyboardShortcutsModal() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handleOpen = () => setOpen(true);
    window.addEventListener("open-keyboard-shortcuts", handleOpen);
    return () => window.removeEventListener("open-keyboard-shortcuts", handleOpen);
  }, []);

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
          <DialogDescription>
            Press <kbd className="px-1 py-0.5 bg-muted rounded text-[10px] font-mono">?</kbd> anytime to open this dialog
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {shortcutGroups.map((group) => (
            <div key={group.title}>
              <h4 className="text-xs font-medium text-foreground/70 mb-2">{group.title}</h4>
              <div className="space-y-1.5">
                {group.shortcuts.map((shortcut) => (
                  <div key={shortcut.description} className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">{shortcut.description}</span>
                    <KeyBadge keys={shortcut.keys} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
