"use client";

import {
  TickCircleFilled,
  ArrowRight2Filled,
  PlayFilled,
  ShopFilled,
  CommandSquareFilled,
  SettingFilled,
  HomeFilled,
  InfoCircleFilled,
} from "@aliimam/icons";
import { motion } from "motion/react";

interface ConfiguredTool {
  tool: string;
  authMethod: "login" | "api-key" | "gateway";
  model?: string;
}

interface DoneStepProps {
  configuredTools: ConfiguredTool[];
  workspaceName?: string;
  workspacePath?: string;
  projectMethod?: string;
  onFinish: (route: string) => void;
}

const METHOD_LABELS: Record<string, string> = {
  local: "local folder",
  git: "cloned from git",
  ssh: "ssh remote",
  docker: "docker container",
};

// --- setup summary ---

function SummaryItem({
  label,
  configured,
  value,
  fixLabel,
  fixRoute,
  onFinish,
}: {
  label: string;
  configured: boolean;
  value: string;
  fixLabel?: string;
  fixRoute?: string;
  onFinish: (route: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs py-1.5">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-foreground/40 shrink-0">{label}</span>
        {configured ? (
          <span className="text-foreground/70 font-mono truncate">{value}</span>
        ) : (
          <span className="text-foreground/30 italic">{value}</span>
        )}
      </div>
      {configured ? (
        <TickCircleFilled className="h-3.5 w-3.5 text-green-400 shrink-0" />
      ) : fixRoute ? (
        <button
          onClick={() => onFinish(fixRoute)}
          className="text-foreground/40 hover:text-foreground text-[10px] shrink-0 transition-colors"
        >
          {fixLabel || "set up"}
        </button>
      ) : null}
    </div>
  );
}

// --- quick action cards ---

interface ActionCard {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  route: string;
}

function ActionCardButton({
  card,
  index,
  onFinish,
}: {
  card: ActionCard;
  index: number;
  onFinish: (route: string) => void;
}) {
  const Icon = card.icon;
  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15 + index * 0.06 }}
      onClick={() => onFinish(card.route)}
      className="flex flex-col items-start gap-2 p-4 rounded-md bg-muted hover:bg-accent/50 transition-colors text-left group"
    >
      <Icon className="h-5 w-5 text-foreground/40 group-hover:text-foreground/70 transition-colors" />
      <div>
        <p className="text-xs font-medium">{card.title}</p>
        <p className="text-[10px] text-foreground/40">{card.description}</p>
      </div>
    </motion.button>
  );
}

// --- contextual tip ---

function ContextualTip({ message }: { message: string }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.5 }}
      className="flex items-start gap-2 rounded-md bg-muted/40 px-3 py-2.5"
    >
      <InfoCircleFilled className="h-3.5 w-3.5 text-foreground/30 shrink-0 mt-0.5" />
      <p className="text-[11px] text-foreground/40 leading-relaxed">{message}</p>
    </motion.div>
  );
}

// --- main component ---

const ACTIONS: ActionCard[] = [
  {
    icon: PlayFilled,
    title: "run a sample chain",
    description: "try a template to see agents in action",
    route: "/chains",
  },
  {
    icon: ShopFilled,
    title: "browse the marketplace",
    description: "find chains, agents, and templates",
    route: "/marketplace",
  },
  {
    icon: CommandSquareFilled,
    title: "open your workspace",
    description: "terminal + editor for your project",
    route: "/code",
  },
  {
    icon: SettingFilled,
    title: "agent configs",
    description: "manage CLI tools and model settings",
    route: "/settings/agent-configs",
  },
];

export function DoneStep({
  configuredTools,
  workspaceName,
  workspacePath,
  projectMethod,
  onFinish,
}: DoneStepProps) {
  const hasTools = configuredTools.length > 0;
  const hasWorkspace = !!workspaceName;

  // pick the right tip
  let tip: string;
  if (!hasTools && !hasWorkspace) {
    tip =
      "you skipped setup, but that's fine. add an AI provider and workspace in settings when you're ready.";
  } else if (!hasTools) {
    tip =
      "you'll need an AI provider to run chains. set one up in settings when ready.";
  } else if (!hasWorkspace) {
    tip =
      "add a workspace to start running agents on your code.";
  } else {
    tip =
      "you're ready to go. try running a sample chain to see your agents in action.";
  }

  // build the provider summary line
  const providerValue = hasTools
    ? configuredTools.map((t) => t.tool).join(", ")
    : "not configured yet";

  // build the workspace summary line
  const workspaceValue = hasWorkspace
    ? workspacePath
      ? `${workspaceName} at ${workspacePath}`
      : workspaceName
    : "no workspace";

  return (
    <motion.div
      key="done"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.3 }}
      className="space-y-5"
    >
      {/* header */}
      <div className="flex justify-center">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
          className="p-3 rounded-md bg-muted"
        >
          <TickCircleFilled className="h-7 w-7 text-green-400" />
        </motion.div>
      </div>
      <div className="text-center">
        <h2 className="text-lg font-semibold mb-0.5">you&apos;re all set!</h2>
        <p className="text-xs text-foreground/50">
          here&apos;s what you set up and where to go next.
        </p>
      </div>

      {/* setup summary */}
      <div className="rounded-md bg-muted/30 px-4 py-2">
        <SummaryItem
          label="ai provider"
          configured={hasTools}
          value={providerValue}
          fixLabel="set up now"
          fixRoute="/settings/agent-configs"
          onFinish={onFinish}
        />
        <SummaryItem
          label="workspace"
          configured={hasWorkspace}
          value={workspaceValue}
          fixLabel="add one"
          fixRoute="/workspaces"
          onFinish={onFinish}
        />
        {hasWorkspace && projectMethod && (
          <div className="flex items-center gap-2 text-xs py-1 text-foreground/30">
            <span className="text-foreground/25">source</span>
            <span className="font-mono text-[10px]">
              {METHOD_LABELS[projectMethod] || projectMethod}
            </span>
          </div>
        )}
      </div>

      {/* quick actions grid */}
      <div>
        <p className="text-[10px] text-foreground/30 uppercase tracking-wider mb-2 px-0.5">
          quick actions
        </p>
        <div className="grid grid-cols-2 gap-2">
          {ACTIONS.map((card, i) => (
            <ActionCardButton
              key={card.route}
              card={card}
              index={i}
              onFinish={onFinish}
            />
          ))}
        </div>
      </div>

      {/* contextual tip */}
      <ContextualTip message={tip} />

      {/* dashboard CTA */}
      <div className="flex items-center justify-center">
        <button
          onClick={() => onFinish("/dashboard")}
          className="flex items-center gap-2 text-xs text-foreground/40 hover:text-foreground transition-colors group"
        >
          <HomeFilled className="h-3.5 w-3.5" />
          <span>go to dashboard</span>
          <ArrowRight2Filled className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
        </button>
      </div>
    </motion.div>
  );
}
