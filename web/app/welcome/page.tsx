import { WelcomeWizard } from "@/components/onboarding/welcome-wizard";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

export default function WelcomePage() {
  const workspacesDir = process.env.WORKSPACES_DIR || config.workspaceDir;
  return <WelcomeWizard workspacesDir={workspacesDir} />;
}
