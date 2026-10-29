"use client";

import { Button } from "@/components/ui/button";
import {
  FlashCircleFilled,
  MagicStarFilled,
  ArrowRight2Filled,
} from "@aliimam/icons";
import { motion } from "motion/react";
import { TerminalIcon } from "@/components/ui/terminal-icon";

interface WelcomeStepProps {
  onNext: () => void;
}

const features = [
  {
    icon: FlashCircleFilled,
    title: "chain agents together",
    description: "review → implement → test",
  },
  {
    icon: TerminalIcon,
    title: "real agent sessions",
    description: "each agent gets its own terminal",
  },
  {
    icon: MagicStarFilled,
    title: "marketplace agents",
    description: "ready-made agents for common tasks",
  },
];

export function WelcomeStep({ onNext }: WelcomeStepProps) {
  return (
    <motion.div
      key="welcome"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.3 }}
      className="text-center space-y-6"
    >
      <div>
        <h1 className="text-xl font-semibold mb-2">
          Agent orchestration
        </h1>
        <p className="text-sm text-foreground/50 max-w-md mx-auto">
          Chain agents into pipelines and run them on your projects.
        </p>
      </div>
      <div className="space-y-3 text-left max-w-sm mx-auto">
        {features.map((f) => (
          <div key={f.title} className="flex items-start gap-3">
            <f.icon className="h-4 w-4 text-foreground/40 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-medium">{f.title}</p>
              <p className="text-[10px] text-foreground/40">{f.description}</p>
            </div>
          </div>
        ))}
      </div>
      <Button onClick={onNext} className="gap-2 w-full sm:w-auto">
        get started
        <ArrowRight2Filled className="h-4 w-4" />
      </Button>
    </motion.div>
  );
}
