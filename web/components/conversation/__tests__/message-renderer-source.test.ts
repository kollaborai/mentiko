import { readFileSync } from "fs";

describe("message renderer source contract", () => {
  const source = readFileSync(new URL("../message-renderer.tsx", import.meta.url), "utf8");

  it("wraps long conversation text inside narrow embedded run panels", () => {
    expect(source).toContain("messageTextClassName");
    expect(source).toContain("[overflow-wrap:anywhere]");
    expect(source).toContain("whitespace-pre-wrap");
  });
});
