import { ClaudeAI, OpenAI as OpenAILogo, GoogleIcon } from "@aliimam/logos";
import { BotMessageSquare } from "@aliimam/icons";

// Shared provider mark used by the Setup Center and the legacy CLI setup step.
// Keep this the single source of truth for "which icon represents which tool"
// so the two surfaces can never drift.
export function ProviderLogo({ id, className }: { id: string; className?: string }) {
  switch (id) {
    case "claude":
      return <ClaudeAI className={className} />;
    case "codex":
      return <OpenAILogo className={className} />;
    case "antigravity":
      return <GoogleIcon className={className} />;
    case "kollab":
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
          <path d="M5 3h3v7.5L13.5 3H17l-6 8 6.5 10H14l-6-9.5V21H5z" />
        </svg>
      );
    default:
      return <BotMessageSquare className={className} />;
  }
}
