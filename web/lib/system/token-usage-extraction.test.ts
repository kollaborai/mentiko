import {
  addTokenTotals,
  emptyTokenTotals,
  hasTokenCounts,
  parseTranscriptTokens,
  providerForModel,
} from "@/lib/system/token-usage-extraction";

// Line shapes below mirror transcripts observed on disk: Claude assistant
// messages carry a nested server_tool_use object inside usage, and codex emits
// cumulative token_count events.
const claudeLine = (input: number, output: number, cacheRead = 0, cacheWrite = 0, model = "claude-opus-4-8") =>
  JSON.stringify({
    type: "assistant",
    message: {
      model,
      usage: {
        input_tokens: input,
        output_tokens: output,
        cache_read_input_tokens: cacheRead,
        cache_creation_input_tokens: cacheWrite,
        server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
      },
    },
  });

const codexTokenCount = (input: number, cached: number, output: number) =>
  JSON.stringify({
    timestamp: "2026-05-27T04:27:49.968Z",
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        total_token_usage: {
          input_tokens: input,
          cached_input_tokens: cached,
          output_tokens: output,
          reasoning_output_tokens: 0,
          total_tokens: input + output,
        },
      },
    },
  });

describe("token usage extraction", () => {
  describe("provider derivation", () => {
    it("derives the provider from an observed model id", () => {
      expect(providerForModel("claude-opus-4-8")).toBe("claude");
      expect(providerForModel("gpt-5.5")).toBe("openai");
      expect(providerForModel("o3-mini")).toBe("openai");
      expect(providerForModel("gemini-3.5-flash")).toBe("gemini");
      expect(providerForModel("llama-3.1")).toBe("ollama");
    });

    it("reports unknown rather than guessing when no model was observed", () => {
      expect(providerForModel(undefined)).toBe("unknown");
      expect(providerForModel("")).toBe("unknown");
      expect(providerForModel("   ")).toBe("unknown");
      expect(providerForModel("some-internal-model")).toBe("unknown");
    });
  });

  describe("claude transcripts", () => {
    it("sums per-message usage and keeps cache counters separate from input", () => {
      const content = [claudeLine(100, 10, 5, 2), claudeLine(200, 20, 7, 3)].join("\n");
      expect(parseTranscriptTokens(content)).toEqual({
        inputTokens: 300,
        outputTokens: 30,
        cacheReadTokens: 12,
        cacheWriteTokens: 5,
        observedModel: "claude-opus-4-8",
      });
    });

    it("reads usage past the nested server_tool_use object that broke the shell regex", () => {
      const totals = parseTranscriptTokens(claudeLine(38335, 459, 64, 0));
      expect(totals.inputTokens).toBe(38335);
      expect(totals.outputTokens).toBe(459);
      expect(totals.cacheReadTokens).toBe(64);
    });

    it("keeps the real model when a trailing synthetic message closes the transcript", () => {
      // Observed on disk: 31 claude-fable-5 messages followed by one
      // "<synthetic>" message. Last-model-wins would misreport the model and
      // price the run at the fallback rate.
      const content = [
        claudeLine(100, 10, 0, 0, "claude-fable-5"),
        claudeLine(0, 0, 0, 0, "<synthetic>"),
      ].join("\n");
      const totals = parseTranscriptTokens(content);
      expect(totals.observedModel).toBe("claude-fable-5");
      expect(providerForModel(totals.observedModel)).toBe("claude");
    });

    it("ignores non-assistant lines", () => {
      const content = [
        JSON.stringify({ type: "user", message: { content: "hi" } }),
        claudeLine(50, 5),
      ].join("\n");
      expect(parseTranscriptTokens(content).inputTokens).toBe(50);
    });
  });

  describe("codex transcripts", () => {
    it("takes the last cumulative total instead of summing the running events", () => {
      const content = [
        codexTokenCount(1000, 0, 100),
        codexTokenCount(2000, 0, 200),
        codexTokenCount(3000, 0, 300),
      ].join("\n");
      const totals = parseTranscriptTokens(content);
      expect(totals.inputTokens).toBe(3000);
      expect(totals.outputTokens).toBe(300);
    });

    it("splits cached input out of the inclusive input count", () => {
      // observed on disk: input 32440 includes cached 31104; total_tokens 32820
      // equals input + output, proving inclusivity.
      const totals = parseTranscriptTokens(codexTokenCount(32440, 31104, 380));
      expect(totals.inputTokens).toBe(32440 - 31104);
      expect(totals.cacheReadTokens).toBe(31104);
      expect(totals.outputTokens).toBe(380);
    });

    it("never lets a cached count exceed the reported input", () => {
      const totals = parseTranscriptTokens(codexTokenCount(100, 500, 10));
      expect(totals.inputTokens).toBe(0);
      expect(totals.cacheReadTokens).toBe(100);
    });

    it("observes the model from the session payload", () => {
      const content = [
        JSON.stringify({ type: "session_meta", payload: { model: "gpt-5.5" } }),
        codexTokenCount(500, 0, 50),
      ].join("\n");
      expect(parseTranscriptTokens(content).observedModel).toBe("gpt-5.5");
    });
  });

  describe("resilience", () => {
    it("skips malformed lines without throwing", () => {
      const content = ["{not json", "", claudeLine(10, 1), "]["].join("\n");
      expect(parseTranscriptTokens(content).inputTokens).toBe(10);
    });

    it("leaves the model unobserved when no line names one", () => {
      const content = JSON.stringify({
        type: "assistant",
        message: { usage: { input_tokens: 5, output_tokens: 1 } },
      });
      expect(parseTranscriptTokens(content).observedModel).toBeUndefined();
    });

    it("ignores negative and non-numeric counts", () => {
      const content = JSON.stringify({
        type: "assistant",
        message: { usage: { input_tokens: -5, output_tokens: "12" } },
      });
      expect(parseTranscriptTokens(content)).toEqual(emptyTokenTotals());
    });

    it("returns zeroed totals for empty content", () => {
      expect(parseTranscriptTokens("")).toEqual(emptyTokenTotals());
      expect(hasTokenCounts(emptyTokenTotals())).toBe(false);
    });
  });

  describe("combining transcripts", () => {
    it("adds totals and keeps the most recently observed model", () => {
      const combined = addTokenTotals(
        { inputTokens: 10, outputTokens: 1, cacheReadTokens: 2, cacheWriteTokens: 3, observedModel: "claude-opus-4-8" },
        { inputTokens: 20, outputTokens: 2, cacheReadTokens: 4, cacheWriteTokens: 5, observedModel: "gpt-5.5" },
      );
      expect(combined).toEqual({
        inputTokens: 30,
        outputTokens: 3,
        cacheReadTokens: 6,
        cacheWriteTokens: 8,
        observedModel: "gpt-5.5",
      });
    });

    it("retains an earlier observed model when the next transcript names none", () => {
      const combined = addTokenTotals(
        { ...emptyTokenTotals(), observedModel: "claude-opus-4-8" },
        emptyTokenTotals(),
      );
      expect(combined.observedModel).toBe("claude-opus-4-8");
    });
  });
});
