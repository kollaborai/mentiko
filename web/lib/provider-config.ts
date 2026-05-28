import {
  CpuFilled as Cpu,
  MagicStarFilled as Sparkles,
  LinkFilled as GitBranch,
  UserFilled as Users,
  MagicStarFilled as Wand2,
} from "@aliimam/icons";
import {
  CLI_TOOLS as CATALOG_CLI_TOOLS,
  COMMON_PRESETS,
  PROVIDER_CREDENTIALS,
  getAgentConfigOptionsForTool,
  getCliTool,
  getDefaultAgentConfigIdForTool,
  getProviderColors,
} from "./agent-provider-catalog";

const ICONS = {
  claude: Cpu,
  openai: Sparkles,
  aider: GitBranch,
  gemini: Wand2,
  kollab: Users,
  opencode: Sparkles,
  custom: Wand2,
} as const;

export const CLI_TOOLS = CATALOG_CLI_TOOLS
  .filter((tool) => tool.id !== "opencode")
  .map((tool) => ({
    ...tool,
    icon: ICONS[tool.iconKey as keyof typeof ICONS] ?? Sparkles,
  }));

export {
  COMMON_PRESETS,
  PROVIDER_CREDENTIALS,
  getAgentConfigOptionsForTool,
  getCliTool,
  getDefaultAgentConfigIdForTool,
  getProviderColors,
};
