/**
 * @jest-environment node
 */

describe("isExpectedSmokeContent", () => {
  const load = () =>
    import(new URL("../../bin/ai-gateway-smoke-match.mjs", import.meta.url).href);
  const expected = "gateway smoke ok";

  it("accepts the exact phrase", async () => {
    const { isExpectedSmokeContent } = await load();
    expect(isExpectedSmokeContent("gateway smoke ok", expected)).toBe(true);
  });

  it("accepts case-insensitive and trailing punctuation", async () => {
    const { isExpectedSmokeContent } = await load();
    expect(isExpectedSmokeContent("Gateway Smoke OK.", expected)).toBe(true);
    expect(isExpectedSmokeContent("GATEWAY SMOKE OK!", expected)).toBe(true);
  });

  it("accepts leading quotes and whitespace wrappers", async () => {
    const { isExpectedSmokeContent } = await load();
    expect(isExpectedSmokeContent('"gateway smoke ok"', expected)).toBe(true);
    expect(isExpectedSmokeContent("  gateway smoke ok\n", expected)).toBe(true);
    expect(isExpectedSmokeContent("'gateway smoke ok.'", expected)).toBe(true);
    expect(isExpectedSmokeContent("`gateway smoke ok`", expected)).toBe(true);
  });

  it("rejects leading negation words", async () => {
    const { isExpectedSmokeContent } = await load();
    expect(isExpectedSmokeContent("not gateway smoke ok", expected)).toBe(false);
    expect(isExpectedSmokeContent("never gateway smoke ok", expected)).toBe(false);
  });

  it("rejects arbitrary preambles", async () => {
    const { isExpectedSmokeContent } = await load();
    expect(isExpectedSmokeContent("sure: gateway smoke ok", expected)).toBe(false);
    expect(isExpectedSmokeContent("here you go - gateway smoke ok", expected)).toBe(false);
    expect(isExpectedSmokeContent("I cannot say gateway smoke ok", expected)).toBe(false);
  });

  it("rejects empty, missing, or non-string content", async () => {
    const { isExpectedSmokeContent } = await load();
    expect(isExpectedSmokeContent("", expected)).toBe(false);
    expect(isExpectedSmokeContent("   ", expected)).toBe(false);
    expect(isExpectedSmokeContent(undefined as unknown as string, expected)).toBe(false);
    expect(isExpectedSmokeContent(null as unknown as string, expected)).toBe(false);
    expect(isExpectedSmokeContent(42 as unknown as string, expected)).toBe(false);
  });

  it("requires a non-empty expected phrase", async () => {
    const { isExpectedSmokeContent } = await load();
    expect(isExpectedSmokeContent("anything", "")).toBe(false);
  });
});
