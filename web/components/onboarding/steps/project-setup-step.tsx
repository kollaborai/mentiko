"use client";

import { useState } from "react";
import {
  GlobalFilled,
  FolderOpenFilled,
  MagicStarFilled,
  ExportFilled,
  ArrowLeft2Filled,
} from "@aliimam/icons";
import { motion, AnimatePresence } from "motion/react";
import { GitCloneSetup } from "@/components/onboarding/project-setup/git-clone-setup";
import { LocalFolderSetup } from "@/components/onboarding/project-setup/local-folder-setup";
import { NewProjectSetup } from "@/components/onboarding/project-setup/new-project-setup";
import { UploadSetup } from "@/components/onboarding/project-setup/upload-setup";
import { SshSetup } from "@/components/onboarding/project-setup/ssh-setup";
import { DockerSetup } from "@/components/onboarding/project-setup/docker-setup";

type Method = "git" | "local" | "new" | "upload" | "ssh" | "docker" | null;

interface ProjectSetupStepProps {
  onComplete: (data: {
    workspaceId: string;
    workspaceName: string;
    workspacePath: string;
    method: string;
  }) => void;
  onBack: () => void;
  onSkip: () => void;
  workspacesDir?: string;
}

const METHODS = [
  {
    key: "git" as const,
    icon: GlobalFilled,
    title: "Clone a git repository",
    description: "clone from GitHub, GitLab, or any git remote",
  },
  {
    key: "local" as const,
    icon: FolderOpenFilled,
    title: "Use an existing folder",
    description: "point to a project already on this machine",
  },
  {
    key: "new" as const,
    icon: MagicStarFilled,
    title: "Start from scratch",
    description: "create a new empty project directory",
  },
  {
    key: "upload" as const,
    icon: ExportFilled,
    title: "Upload a zip",
    description: "extract a zip or tarball into a workspace",
  },
];

export function ProjectSetupStep({
  onComplete,
  onBack,
  onSkip,
  workspacesDir,
}: ProjectSetupStepProps) {
  const [method, setMethod] = useState<Method>(null);

  const handleBack = () => setMethod(null);

  return (
    <AnimatePresence mode="wait">
      {method === null && (
        <motion.div
          key="picker"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.3 }}
          className="space-y-6"
        >
          <div className="text-center">
            <h2 className="text-lg font-semibold mb-1">Set up your project</h2>
            <p className="text-sm text-foreground/50">
              how do you want to connect a project?
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {METHODS.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => setMethod(m.key)}
                className="flex flex-col items-start gap-2 p-4 rounded-md bg-card hover:bg-accent transition-colors text-left group"
              >
                <m.icon className="h-5 w-5 text-foreground/40 group-hover:text-foreground/70 transition-colors" />
                <div>
                  <p className="text-xs font-medium">{m.title}</p>
                  <p className="text-[10px] text-foreground/40">{m.description}</p>
                </div>
              </button>
            ))}
          </div>

          {/* Hidden: SSH and Docker workspace types not implemented yet
          <div className="text-center">
            <span className="text-[10px] text-foreground/30">more options: </span>
            <button
              type="button"
              onClick={() => setMethod("ssh")}
              className="text-[10px] text-foreground/40 hover:text-foreground transition-colors"
            >
              SSH
            </button>
            <span className="text-[10px] text-foreground/20 mx-1.5">|</span>
            <button
              type="button"
              onClick={() => setMethod("docker")}
              className="text-[10px] text-foreground/40 hover:text-foreground transition-colors"
            >
              Docker
            </button>
          </div>
          */}

          <div className="flex items-center justify-between">
            <button
              onClick={onBack}
              className="flex items-center gap-1 text-xs text-foreground/40 hover:text-foreground transition-colors"
            >
              <ArrowLeft2Filled className="h-3.5 w-3.5" />
              back
            </button>
            <button
              onClick={onSkip}
              className="text-xs text-foreground/30 hover:text-foreground/50 transition-colors"
            >
              skip
            </button>
          </div>
        </motion.div>
      )}

      {method === "git" && (
        <motion.div
          key="git"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.3 }}
        >
          <GitCloneSetup
            onComplete={onComplete}
            onBack={handleBack}
            workspacesDir={workspacesDir}
          />
        </motion.div>
      )}

      {method === "local" && (
        <motion.div
          key="local"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.3 }}
        >
          <LocalFolderSetup
            onComplete={onComplete}
            onBack={handleBack}
            workspacesDir={workspacesDir}
          />
        </motion.div>
      )}

      {method === "new" && (
        <motion.div
          key="new"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.3 }}
        >
          <NewProjectSetup
            onComplete={onComplete}
            onBack={handleBack}
            workspacesDir={workspacesDir}
          />
        </motion.div>
      )}

      {method === "upload" && (
        <motion.div
          key="upload"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.3 }}
        >
          <UploadSetup
            onComplete={onComplete}
            onBack={handleBack}
            workspacesDir={workspacesDir}
          />
        </motion.div>
      )}

      {method === "ssh" && (
        <motion.div
          key="ssh"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.3 }}
        >
          <SshSetup onComplete={onComplete} onBack={handleBack} />
        </motion.div>
      )}

      {method === "docker" && (
        <motion.div
          key="docker"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.3 }}
        >
          <DockerSetup onComplete={onComplete} onBack={handleBack} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
