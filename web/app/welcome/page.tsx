import { SetupCenter, type MilestoneStep } from "@/components/onboarding/setup-center";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

const VALID_MILESTONE_STEPS = new Set<string>(["provider", "workspace", "readiness", "sampleRun"]);
function asMilestoneStep(value: string | string[] | undefined): MilestoneStep | undefined {
  const step = Array.isArray(value) ? value[0] : value;
  return step && VALID_MILESTONE_STEPS.has(step) ? (step as MilestoneStep) : undefined;
}

export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string | string[] }>;
}) {
  const workspacesDir = process.env.WORKSPACES_DIR || config.workspaceDir;
  const { step } = await searchParams;
  return <SetupCenter workspacesDir={workspacesDir} initialStep={asMilestoneStep(step)} />;
}
