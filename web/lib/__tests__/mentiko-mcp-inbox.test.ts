import {
  getCurrentPage,
  isEffectDelivered,
  markEffectDelivered,
  popEffects,
  pushEffect,
  setCurrentPage,
} from "../mentiko-mcp-inbox";

describe("mentiko MCP inbox", () => {
  it("marks an effect delivered only after the session stream drains it", () => {
    const sessionId = `session-delivery-${Date.now()}`;
    const effect = pushEffect("navigate", { route: "/runs/run-1" }, sessionId);

    expect(isEffectDelivered(sessionId, effect.id)).toBe(false);
    expect(popEffects(sessionId)).toEqual([effect]);
    expect(isEffectDelivered(sessionId, effect.id)).toBe(false);
    markEffectDelivered(sessionId, effect.id);
    expect(isEffectDelivered(sessionId, effect.id)).toBe(true);
  });

  it("keeps current-page context scoped to the engine session", () => {
    const sessionA = `session-page-a-${Date.now()}`;
    const sessionB = `session-page-b-${Date.now()}`;

    setCurrentPage(sessionA, {
      pathname: "/runs/run-1",
      search: "",
      label: "Run detail",
      updatedAt: Date.now(),
    });
    setCurrentPage(sessionB, {
      pathname: "/dashboard",
      search: "?from=test",
      label: "Dashboard",
      updatedAt: Date.now(),
    });

    expect(getCurrentPage(sessionA)?.pathname).toBe("/runs/run-1");
    expect(getCurrentPage(sessionB)?.pathname).toBe("/dashboard");
  });

  it("returns unknown for stale current-page context", () => {
    const sessionId = `session-stale-${Date.now()}`;

    setCurrentPage(sessionId, {
      pathname: "/dashboard",
      search: "",
      label: "Dashboard",
      updatedAt: Date.now() - 120_000,
    });

    expect(getCurrentPage(sessionId)).toBeNull();
  });
});
