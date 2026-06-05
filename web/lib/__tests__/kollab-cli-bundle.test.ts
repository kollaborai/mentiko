import { PROVIDER_BUNDLES } from "@/lib/agents/provider-bundles";
import { PROVIDER_CREDENTIALS } from "@/lib/agents/provider-config";
import { bundleProfileToAgentProfile } from "@/lib/agents/provider-bundles";

describe("kollab cli bundle", () => {
  it("uses the env key expected by the kollab cli", () => {
    expect(PROVIDER_CREDENTIALS.kollab.envKey).toBe("KOLLAB_API_KEY");
  });

  it("uses the canonical trust-mode permission flag", () => {
    const bundle = PROVIDER_BUNDLES.find((b) => b.provider === "kollab");

    expect(bundle?.profiles[0]?.cli).toBe("kollab");
    expect(bundle?.profiles[0]?.permission_flag).toBe("--permissions trust");
  });

  it("marks the product-native kollab profile as preferred for advisor seeding", () => {
    const bundle = PROVIDER_BUNDLES.find((b) => b.provider === "kollab");
    const profile = bundle?.profiles[0];

    expect(profile?.preferredAdvisorDefault).toBe(true);
    expect(profile && bundle ? bundleProfileToAgentProfile(profile, bundle) : null).toMatchObject({
      id: "kollab",
      isAdvisorDefault: false,
    });
  });
});
