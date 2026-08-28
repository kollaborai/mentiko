import { SetupCenter } from "@/components/onboarding/setup-center";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

export default function WelcomePage() {
  const workspacesDir = process.env.WORKSPACES_DIR || config.workspaceDir;
  return <SetupCenter workspacesDir={workspacesDir} />;
}
