import {
  consumeWelcomeOpenRequest,
  getOnboardingStateKey,
  getOnboardingStepKey,
  isOnboardingDismissed,
  setOnboardingDismissed,
  shouldAutoOpenWelcome,
} from "../system/onboarding-storage";

class MemoryStorage implements Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  private readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

describe("onboarding storage", () => {
  it("scopes dismissed state by signed-in user", () => {
    const storage = new MemoryStorage();

    setOnboardingDismissed(storage, "user-a");

    expect(isOnboardingDismissed(storage, "user-a")).toBe(true);
    expect(isOnboardingDismissed(storage, "user-b")).toBe(false);
  });

  it("does not let legacy browser-level dismissal suppress a signed-in user", () => {
    const storage = new MemoryStorage();
    storage.setItem("mentiko-onboarding-dismissed", "true");

    expect(isOnboardingDismissed(storage, "fresh-user")).toBe(false);
    expect(shouldAutoOpenWelcome({ storage, userId: "fresh-user", workspacesCount: 0 })).toBe(true);
  });

  it("does not let legacy browser-level dismissal suppress anonymous first-run setup", () => {
    const storage = new MemoryStorage();
    storage.setItem("mentiko-onboarding-dismissed", "true");

    expect(isOnboardingDismissed(storage, null)).toBe(false);
    expect(shouldAutoOpenWelcome({ storage, userId: null, workspacesCount: 0 })).toBe(true);
  });

  it("consumes signup open-once request for the current user and clears dismissal", () => {
    const storage = new MemoryStorage();
    storage.setItem("mentiko-open-welcome-panel", "true");
    storage.setItem("mentiko-onboarding-dismissed:user-a", "true");

    expect(consumeWelcomeOpenRequest(storage, "user-a")).toBe(true);
    expect(storage.getItem("mentiko-open-welcome-panel")).toBeNull();
    expect(storage.getItem("mentiko-onboarding-dismissed:user-a")).toBeNull();
  });

  it("uses user-scoped wizard progress keys", () => {
    expect(getOnboardingStepKey("user-a")).toBe("mentiko-onboarding-step:user-a");
    expect(getOnboardingStateKey("user-a")).toBe("mentiko-onboarding-state:user-a");
    expect(getOnboardingStepKey(null)).toBe("mentiko-onboarding-step:anonymous");
  });
});
