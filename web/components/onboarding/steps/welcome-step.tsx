"use client";

import { Button } from "@/components/ui/button";
import {
  FlashCircleFilled,
  CommandSquareFilled,
  MagicStarFilled,
  ArrowRight2Filled,
} from "@aliimam/icons";
import { motion } from "motion/react";

interface WelcomeStepProps {
  onNext: () => void;
}

const features = [
  {
    icon: FlashCircleFilled,
    title: "chain agents together",
    description: "one agent reviews, another implements, another tests",
  },
  {
    icon: CommandSquareFilled,
    title: "real agent sessions",
    description: "each agent runs in its own terminal with full tool access",
  },
  {
    icon: MagicStarFilled,
    title: "marketplace agents",
    description: "pre-built agents for code review, writing, data, and more",
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
          Your AI agent orchestration platform
        </h1>
        <p className="text-sm text-foreground/50 max-w-md mx-auto">
          Chain agents together in pipelines. Define workflows, connect agents,
          and watch them collaborate to complete complex tasks.
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
