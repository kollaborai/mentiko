export const ONBOARDING_DISMISSED_KEY = "mentiko-onboarding-dismissed";
export const OPEN_WELCOME_PANEL_KEY = "mentiko-open-welcome-panel";
export const ONBOARDING_STEP_KEY = "mentiko-onboarding-step";
export const ONBOARDING_STATE_KEY = "mentiko-onboarding-state";

type OnboardingStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function scopedKey(baseKey: string, userId?: string | null): string {
  return `${baseKey}:${userId || "anonymous"}`;
}

export function getOnboardingStepKey(userId?: string | null): string {
  return scopedKey(ONBOARDING_STEP_KEY, userId);
}

export function getOnboardingStateKey(userId?: string | null): string {
  return scopedKey(ONBOARDING_STATE_KEY, userId);
}

export function isOnboardingDismissed(
  storage: OnboardingStorage,
  userId?: string | null,
): boolean {
  return storage.getItem(scopedKey(ONBOARDING_DISMISSED_KEY, userId)) === "true";
}

export function setOnboardingDismissed(
  storage: OnboardingStorage,
  userId?: string | null,
): void {
  storage.setItem(scopedKey(ONBOARDING_DISMISSED_KEY, userId), "true");
}

export function consumeWelcomeOpenRequest(
  storage: OnboardingStorage,
  userId?: string | null,
): boolean {
  const userScopedKey = scopedKey(OPEN_WELCOME_PANEL_KEY, userId);
  const hasRequest =
    storage.getItem(userScopedKey) === "true" ||
    storage.getItem(OPEN_WELCOME_PANEL_KEY) === "true";

  if (!hasRequest) return false;

  storage.removeItem(userScopedKey);
  storage.removeItem(OPEN_WELCOME_PANEL_KEY);
  storage.removeItem(scopedKey(ONBOARDING_DISMISSED_KEY, userId));
  storage.removeItem(ONBOARDING_DISMISSED_KEY);

  return true;
}

export function shouldAutoOpenWelcome({
  storage,
  userId,
  workspacesCount,
}: {
  storage: OnboardingStorage;
  userId?: string | null;
  workspacesCount: number;
}): boolean {
  return workspacesCount === 0 && !isOnboardingDismissed(storage, userId);
}
