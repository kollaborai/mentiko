import { PROVIDER_BUNDLES } from "@/lib/provider-bundles";
import { PROVIDER_CREDENTIALS } from "@/lib/provider-config";

describe("kollab cli bundle", () => {
  it("uses the env key expected by the kollab cli", () => {
    expect(PROVIDER_CREDENTIALS.kollabor.envKey).toBe("KOLLAB_API_KEY");
  });

  it("uses the canonical trust-mode permission flag", () => {
    const bundle = PROVIDER_BUNDLES.find((b) => b.provider === "kollabor");

    expect(bundle?.profiles[0]?.cli).toBe("kollab");
    expect(bundle?.profiles[0]?.permission_flag).toBe("--permissions trust");
  });
});
