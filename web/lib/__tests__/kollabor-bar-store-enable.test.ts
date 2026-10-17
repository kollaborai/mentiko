import {
  BAR_SAVE_ERROR,
  BAR_SHUTDOWN_ERROR,
  LS_ENABLED_KEY,
  LS_APPEARANCE_KEY,
  LS_PENDING_SHUTDOWN_KEY,
  LS_WIDTH_KEY,
  LS_YOLO_KEY,
  LS_YOLO_SEEN_KEY,
  hydrateKollaborBarPreference,
  readEnabledPreference,
  readPendingShutdownMarker,
  setKollaborBarStorageScope,
  useKollaborBarStore,
  writePendingShutdownMarker,
  KOLLABOR_BAR_APPEARANCE_DEFAULTS,
} from "@/lib/ui/kollabor-bar-store";

describe("floating bar scoped enablement", () => {
  beforeEach(() => {
    localStorage.clear();
    useKollaborBarStore.setState({
      storageScopeReady: false,
      preferenceReadResolved: false,
      preferenceStorageError: null,
      shutdownPending: false,
      cleanupBlocked: false,
      shutdownError: null,
      messages: [],
      sessionId: null,
      sessionScope: null,
      yoloMode: false,
      yoloPromptSeen: false,
      yoloPreferenceWriteFailed: false,
      enabled: true,
      appearance: { ...KOLLABOR_BAR_APPEARANCE_DEFAULTS },
    });
  });

  it("defaults enabled and persists only under the active scope", () => {
    setKollaborBarStorageScope("install:test:user:a");
    expect(readEnabledPreference()).toEqual({ value: true, resolved: true, error: null });

    useKollaborBarStore.setState({ storageScopeReady: true });
    useKollaborBarStore.getState().setEnabled(false);

    expect(localStorage.getItem(`${LS_ENABLED_KEY}:install:test:user:a`)).toBe("0");
    expect(localStorage.getItem(`${LS_ENABLED_KEY}:install:test:user:b`)).toBeNull();

    setKollaborBarStorageScope("install:test:user:b");
    expect(useKollaborBarStore.getState().enabled).toBe(true);
    setKollaborBarStorageScope("install:test:user:a");
    expect(useKollaborBarStore.getState().enabled).toBe(false);
  });

  it("seeds width from deployment config and persists scoped user overrides", () => {
    const scopeA = "install:test:user:width-a";
    const scopeB = "install:test:user:width-b";
    setKollaborBarStorageScope(scopeA);
    expect(useKollaborBarStore.getState().barWidth).toBe(373);

    useKollaborBarStore.setState({ storageScopeReady: true, preferenceReadResolved: true });
    useKollaborBarStore.getState().setBarWidth(480);
    expect(useKollaborBarStore.getState().barWidth).toBe(480);
    expect(localStorage.getItem(`${LS_WIDTH_KEY}:${scopeA}`)).toBe("480");

    setKollaborBarStorageScope(scopeB);
    expect(useKollaborBarStore.getState().barWidth).toBe(373);
    setKollaborBarStorageScope(scopeA);
    expect(useKollaborBarStore.getState().barWidth).toBe(480);
  });

  it("bounds numeric width preferences and rejects malformed storage", () => {
    const scope = "install:test:user:width-bounds";
    setKollaborBarStorageScope(scope);
    useKollaborBarStore.setState({ storageScopeReady: true, preferenceReadResolved: true });

    useKollaborBarStore.getState().setBarWidth(100);
    expect(useKollaborBarStore.getState().barWidth).toBe(240);
    useKollaborBarStore.getState().setBarWidth(900);
    expect(useKollaborBarStore.getState().barWidth).toBe(720);

    localStorage.setItem(`${LS_WIDTH_KEY}:${scope}`, "not-a-width");
    setKollaborBarStorageScope("install:test:user:width-other");
    setKollaborBarStorageScope(scope);
    expect(useKollaborBarStore.getState().barWidth).toBe(373);
  });

  it("persists scoped appearance controls and bounds malformed numeric values", () => {
    const scopeA = "install:test:user:appearance-a";
    const scopeB = "install:test:user:appearance-b";
    setKollaborBarStorageScope(scopeA);
    useKollaborBarStore.setState({ storageScopeReady: true, preferenceReadResolved: true });

    useKollaborBarStore.getState().setAppearance({
      backdropEnabled: false,
      backdropBlur: 999,
      backdropWidth: 100,
      surfaceRadius: -10,
    });
    expect(useKollaborBarStore.getState().appearance).toMatchObject({
      backdropEnabled: false,
      backdropBlur: 40,
      backdropWidth: 240,
      surfaceRadius: 0,
    });
    expect(localStorage.getItem(`${LS_APPEARANCE_KEY}:${scopeA}`)).toContain('"backdropEnabled":false');

    setKollaborBarStorageScope(scopeB);
    expect(useKollaborBarStore.getState().appearance).toEqual(KOLLABOR_BAR_APPEARANCE_DEFAULTS);
    setKollaborBarStorageScope(scopeA);
    expect(useKollaborBarStore.getState().appearance.backdropEnabled).toBe(false);
  });

  it("reloads YOLO booleans in both directions and migrates raw keys only for anonymous scope", () => {
    localStorage.setItem(LS_YOLO_KEY, "1");
    localStorage.setItem(LS_YOLO_SEEN_KEY, "1");

    setKollaborBarStorageScope("anonymous:tab-a");
    expect(useKollaborBarStore.getState().yoloMode).toBe(true);
    expect(useKollaborBarStore.getState().yoloPromptSeen).toBe(true);
    expect(localStorage.getItem(LS_YOLO_KEY)).toBe("1");
    expect(localStorage.getItem(`${LS_YOLO_KEY}:anonymous:tab-a`)).toBe("1");

    setKollaborBarStorageScope("install:test:user-b");
    expect(useKollaborBarStore.getState().yoloMode).toBe(true);
    expect(useKollaborBarStore.getState().yoloPromptSeen).toBe(true);
    expect(localStorage.getItem(`${LS_YOLO_KEY}:install:test:user-b`)).toBeNull();

    useKollaborBarStore.getState().setYoloPromptSeen(false);
    expect(localStorage.getItem(`${LS_YOLO_SEEN_KEY}:install:test:user-b`)).toBe("0");
    useKollaborBarStore.getState().setYoloMode(false);
    expect(localStorage.getItem(`${LS_YOLO_KEY}:install:test:user-b`)).toBe("0");
    expect(localStorage.getItem(`${LS_YOLO_SEEN_KEY}:install:test:user-b`)).toBe("1");
    expect(useKollaborBarStore.getState().yoloPromptSeen).toBe(true);

    setKollaborBarStorageScope("install:test:user-c");
    expect(useKollaborBarStore.getState().yoloMode).toBe(true);
    expect(useKollaborBarStore.getState().yoloPromptSeen).toBe(true);
    setKollaborBarStorageScope("install:test:user-b");
    expect(useKollaborBarStore.getState().yoloMode).toBe(false);
    expect(useKollaborBarStore.getState().yoloPromptSeen).toBe(true);

    setKollaborBarStorageScope("anonymous:tab-a");
    expect(useKollaborBarStore.getState().yoloMode).toBe(true);
    expect(useKollaborBarStore.getState().yoloPromptSeen).toBe(true);
  });

  it("defaults missing scoped YOLO preferences to enabled with the first-run choice resolved", () => {
    const scope = "install:test:user:yolo-defaults";

    setKollaborBarStorageScope(scope);
    hydrateKollaborBarPreference();

    expect(useKollaborBarStore.getState().yoloMode).toBe(true);
    expect(useKollaborBarStore.getState().yoloPromptSeen).toBe(true);
    expect(localStorage.getItem(`${LS_YOLO_KEY}:${scope}`)).toBeNull();
    expect(localStorage.getItem(`${LS_YOLO_SEEN_KEY}:${scope}`)).toBeNull();
  });

  it("preserves an explicit anonymous raw-key opt-out during the legacy migration", () => {
    localStorage.setItem(LS_YOLO_KEY, "0");
    localStorage.setItem(LS_YOLO_SEEN_KEY, "0");

    setKollaborBarStorageScope("anonymous:tab-opt-out");

    expect(useKollaborBarStore.getState().yoloMode).toBe(false);
    expect(useKollaborBarStore.getState().yoloPromptSeen).toBe(false);
    expect(localStorage.getItem(LS_YOLO_KEY)).toBe("0");
    expect(localStorage.getItem(LS_YOLO_SEEN_KEY)).toBe("0");
    expect(localStorage.getItem(`${LS_YOLO_KEY}:anonymous:tab-opt-out`)).toBe("0");
    expect(localStorage.getItem(`${LS_YOLO_SEEN_KEY}:anonymous:tab-opt-out`)).toBe("0");
  });

  it("reports partial YOLO writes and retries the explicit scoped choice", () => {
    const scope = "install:test:user:yolo-write-failure";
    const modeKey = `${LS_YOLO_KEY}:${scope}`;
    const seenKey = `${LS_YOLO_SEEN_KEY}:${scope}`;
    setKollaborBarStorageScope(scope);
    useKollaborBarStore.setState({ storageScopeReady: true, preferenceStorageError: null });

    const originalSetItem = localStorage.setItem.bind(localStorage);
    const setItem = jest.spyOn(Storage.prototype, "setItem").mockImplementation((key, value) => {
      if (key === modeKey) throw new Error("quota for mode key");
      originalSetItem(key, value);
    });
    try {
      expect(useKollaborBarStore.getState().setYoloMode(false)).toBe(false);
      expect(useKollaborBarStore.getState().yoloMode).toBe(false);
      expect(useKollaborBarStore.getState().yoloPromptSeen).toBe(true);
      expect(useKollaborBarStore.getState().yoloPreferenceWriteFailed).toBe(true);
      expect(useKollaborBarStore.getState().preferenceStorageError).toBe(BAR_SAVE_ERROR);
      expect(localStorage.getItem(modeKey)).toBeNull();
      expect(localStorage.getItem(seenKey)).toBe("1");
      expect(useKollaborBarStore.getState().setYoloPromptSeen(true)).toBe(true);
      expect(useKollaborBarStore.getState().preferenceStorageError).toBe(BAR_SAVE_ERROR);
    } finally {
      setItem.mockRestore();
    }

    expect(useKollaborBarStore.getState().setYoloMode(false)).toBe(true);
    expect(useKollaborBarStore.getState().yoloPreferenceWriteFailed).toBe(false);
    expect(useKollaborBarStore.getState().preferenceStorageError).toBeNull();
    expect(localStorage.getItem(modeKey)).toBe("0");
    expect(localStorage.getItem(seenKey)).toBe("1");

    const seenWrite = jest.spyOn(Storage.prototype, "setItem").mockImplementation((key, value) => {
      if (key === seenKey) throw new Error("quota for seen key");
      originalSetItem(key, value);
    });
    try {
      expect(useKollaborBarStore.getState().setYoloPromptSeen(false)).toBe(false);
      expect(useKollaborBarStore.getState().preferenceStorageError).toBe(BAR_SAVE_ERROR);
    } finally {
      seenWrite.mockRestore();
    }
    expect(useKollaborBarStore.getState().setYoloPromptSeen(false)).toBe(true);
    expect(useKollaborBarStore.getState().preferenceStorageError).toBeNull();
    expect(useKollaborBarStore.getState().setYoloMode(false)).toBe(true);

    setKollaborBarStorageScope("install:test:user:yolo-write-retry-other");
    setKollaborBarStorageScope(scope);
    expect(useKollaborBarStore.getState().yoloMode).toBe(false);
    expect(useKollaborBarStore.getState().yoloPromptSeen).toBe(true);
  });

  it("fails closed on malformed YOLO values and local-storage read failures", () => {
    const malformedScope = "install:test:user:yolo-malformed";
    localStorage.setItem(`${LS_YOLO_KEY}:${malformedScope}`, "true");
    localStorage.setItem(`${LS_YOLO_SEEN_KEY}:${malformedScope}`, "seen");

    setKollaborBarStorageScope(malformedScope);

    expect(useKollaborBarStore.getState().yoloMode).toBe(false);
    expect(useKollaborBarStore.getState().yoloPromptSeen).toBe(false);

    const rawMalformedScope = "anonymous:tab-malformed-raw";
    localStorage.setItem(LS_YOLO_KEY, "enabled");
    localStorage.setItem(LS_YOLO_SEEN_KEY, "yes");
    setKollaborBarStorageScope(rawMalformedScope);
    expect(useKollaborBarStore.getState().yoloMode).toBe(false);
    expect(useKollaborBarStore.getState().yoloPromptSeen).toBe(false);
    expect(localStorage.getItem(LS_YOLO_KEY)).toBe("enabled");
    expect(localStorage.getItem(LS_YOLO_SEEN_KEY)).toBe("yes");
    expect(localStorage.getItem(`${LS_YOLO_KEY}:${rawMalformedScope}`)).toBeNull();
    expect(localStorage.getItem(`${LS_YOLO_SEEN_KEY}:${rawMalformedScope}`)).toBeNull();

    const getItem = jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked storage");
    });
    try {
      setKollaborBarStorageScope("install:test:user:yolo-read-failure");
      expect(useKollaborBarStore.getState().yoloMode).toBe(false);
      expect(useKollaborBarStore.getState().yoloPromptSeen).toBe(false);
    } finally {
      getItem.mockRestore();
    }
  });

  it("fails closed on malformed or unreadable enabled storage", () => {
    const scope = "install:test:user:malformed";
    localStorage.setItem(`${LS_ENABLED_KEY}:${scope}`, "true");
    expect(readEnabledPreference(scope)).toEqual({
      value: false,
      resolved: false,
      error: "Could not read your bar setting",
    });

    const getItem = jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked storage");
    });
    expect(readEnabledPreference(scope)).toEqual({
      value: false,
      resolved: false,
      error: "Could not read your bar setting",
    });
    expect(readPendingShutdownMarker(scope)).toMatchObject({
      scope,
      sessionId: "unknown",
    });
    getItem.mockRestore();
  });

  it("changes this tab on write failure, reports unsaved state, and clears it on retry", () => {
    const scope = "install:test:user:write-failure";
    setKollaborBarStorageScope(scope);
    useKollaborBarStore.setState({ storageScopeReady: true });
    const setItem = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });

    useKollaborBarStore.getState().setEnabled(false);
    expect(useKollaborBarStore.getState().enabled).toBe(false);
    expect(useKollaborBarStore.getState().preferenceStorageError).toBe(BAR_SAVE_ERROR);

    setItem.mockRestore();
    useKollaborBarStore.getState().setEnabled(true);
    expect(useKollaborBarStore.getState().enabled).toBe(true);
    expect(useKollaborBarStore.getState().preferenceStorageError).toBeNull();
    expect(localStorage.getItem(`${LS_ENABLED_KEY}:${scope}`)).toBe("1");
  });

  it("resets transient state on A to B scope changes and isolates pending shutdown markers", () => {
    const scopeA = "install:test:user:a";
    const scopeB = "install:test:user:b";
    setKollaborBarStorageScope(scopeA);
    useKollaborBarStore.setState({
      storageScopeReady: true,
      connected: true,
      connecting: true,
      expanded: true,
      inputValue: "stale",
      sessionId: "session-a",
      sessionScope: scopeA,
      messages: [{ id: "a", role: "assistant", content: "A", timestamp: 1 }],
      cleanupBlocked: true,
    });
    writePendingShutdownMarker({ scope: scopeA, sessionId: "session-a", generation: 2, startedAt: 1 });

    setKollaborBarStorageScope(scopeB);
    const stateB = useKollaborBarStore.getState();
    expect(stateB.storageScope).toBe(scopeB);
    expect(stateB.expanded).toBe(false);
    expect(stateB.inputValue).toBe("");
    expect(stateB.connected).toBe(false);
    expect(stateB.connecting).toBe(false);
    expect(stateB.sessionId).toBeNull();
    expect(stateB.messages).toEqual([]);
    expect(readPendingShutdownMarker(scopeB)).toBeNull();
    expect(stateB.cleanupBlocked).toBe(false);

    setKollaborBarStorageScope(scopeA);
    expect(readPendingShutdownMarker(scopeA)).toMatchObject({ sessionId: "session-a" });
    hydrateKollaborBarPreference();
    expect(useKollaborBarStore.getState().shutdownError).toBe(BAR_SHUTDOWN_ERROR);
    expect(localStorage.getItem(`${LS_PENDING_SHUTDOWN_KEY}:${scopeB}`)).toBeNull();
  });

  it("marks pending permission and ask prompts cancelled without deleting committed transcript", () => {
    useKollaborBarStore.setState({
      messages: [
        { id: "committed", role: "assistant", content: "done", timestamp: 1 },
        {
          id: "permission",
          role: "permission",
          content: "",
          timestamp: 2,
          permission: {
            toolId: "tool-1",
            toolName: "terminal",
            input: {},
            riskLevel: "high",
            riskReason: "test",
          },
        },
        {
          id: "ask",
          role: "assistant",
          content: "",
          timestamp: 3,
          ask: { toolId: "ask-1", kind: "ask_confirm", prompt: "Continue?" },
        },
      ],
    });

    useKollaborBarStore.getState().cancelPendingPrompts();
    const messages = useKollaborBarStore.getState().messages;
    expect(messages[0]).toMatchObject({ id: "committed", content: "done" });
    expect(messages[1].permission).toMatchObject({ decision: "cancelled", cancelled: true });
    expect(messages[2].ask).toMatchObject({ result: "cancelled" });
  });
});
