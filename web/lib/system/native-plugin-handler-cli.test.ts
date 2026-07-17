import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  dispatchCustomWebhook,
  dispatchEmailDigest,
  dispatchGithubPr,
  dispatchLinear,
  dispatchNotifyEmail,
  dispatchPagerDuty,
} from "@/lib/system/native-plugin-handler-cli";

const repoRoot = join(process.cwd(), "..");

describe("typed PagerDuty native handler", () => {
  it("preserves the trigger payload and accepts PagerDuty 202", async () => {
    const post = jest.fn().mockResolvedValue({ statusCode: 202, dedupKey: "pd-1" });
    const stdout = jest.spyOn(console, "log").mockImplementation();
    const stderr = jest.spyOn(console, "error").mockImplementation();
    try {
      await dispatchPagerDuty({ PLUGIN_ROUTING_KEY: "key", PLUGIN_EVENT_TYPE: "chain-stopped", PLUGIN_CHAIN_ID: "chain", PLUGIN_RUN_ID: "run", PLUGIN_SEVERITY: "critical" }, post);
      expect(JSON.parse(post.mock.calls[0][0])).toEqual(expect.objectContaining({ routing_key: "key", event_action: "trigger", dedup_key: "mentiko-chain", payload: expect.objectContaining({ summary: "Chain 'chain' failed (run: run)", severity: "critical", source: "mentiko" }) }));
      expect(stdout).not.toHaveBeenCalled();
      expect(stderr).toHaveBeenCalledWith("[pagerduty] incident triggered: pd-1");
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
  });
  it("surfaces the PagerDuty error message for non-202 responses", async () => {
    await expect(dispatchPagerDuty({ PLUGIN_ROUTING_KEY: "key", PLUGIN_EVENT_TYPE: "chain-stopped", PLUGIN_CHAIN_ID: "chain" }, async () => ({ statusCode: 400, message: "bad key" }))).rejects.toThrow("HTTP 400): bad key");
  });
});

describe("typed custom-webhook native handler", () => {
  it("preserves the filtered outbound POST payload and accepts non-2xx responses", async () => {
    const post = jest.fn().mockResolvedValue({ statusCode: 500 });
    const stdout = jest.spyOn(console, "log").mockImplementation();
    const stderr = jest.spyOn(console, "error").mockImplementation();
    try {
      await expect(dispatchCustomWebhook({ PLUGIN_URL: "https://example.test/hook", PLUGIN_SECRET: "secret", PLUGIN_EVENTS: "chain-stopped", PLUGIN_EVENT_TYPE: "chain-stopped", PLUGIN_CHAIN_ID: "chain", PLUGIN_RUN_ID: "run" }, post, () => new Date("2026-07-16T12:34:56.789Z"))).resolves.toBeUndefined();
      expect(post).toHaveBeenCalledWith("https://example.test/hook", JSON.stringify({ event_type: "chain-stopped", chain_id: "chain", run_id: "run", timestamp: "2026-07-16T12:34:56Z" }), "secret");
      expect(stdout).not.toHaveBeenCalled();
      expect(stderr).not.toHaveBeenCalled();
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
  });

  it("skips filtered events before requiring a URL and propagates delivery errors", async () => {
    const post = jest.fn().mockRejectedValue(new Error("connection refused"));
    await expect(dispatchCustomWebhook({ PLUGIN_EVENTS: "chain-stopped", PLUGIN_EVENT_TYPE: "chain-completed" }, post)).resolves.toBeUndefined();
    expect(post).not.toHaveBeenCalled();
    await expect(dispatchCustomWebhook({ PLUGIN_URL: "https://example.test/hook", PLUGIN_EVENT_TYPE: "chain-stopped" }, post)).rejects.toThrow("connection refused");
  });
});

describe("typed GitHub PR native handler", () => {
  it("uses Git only as the external branch probe and emits the typed GitHub request", async () => {
    const request = jest.fn()
      .mockResolvedValueOnce({ statusCode: 200, body: [] })
      .mockResolvedValueOnce({ statusCode: 201, body: { html_url: "https://github.test/pr/1" } });
    const git = jest.fn()
      .mockResolvedValueOnce("feature/typed")
      .mockResolvedValueOnce("2");
    await dispatchGithubPr({ PLUGIN_EVENT_TYPE: "chain-completed", PLUGIN_TOKEN: "token", PLUGIN_OWNER: "owner", PLUGIN_REPO: "repo", PLUGIN_CHAIN_ID: "chain", PLUGIN_RUN_ID: "run", PLUGIN_DRAFT: "true" }, request, git);
    expect(git).toHaveBeenNthCalledWith(1, ["rev-parse", "--abbrev-ref", "HEAD"]);
    expect(git).toHaveBeenNthCalledWith(2, ["rev-list", "--count", "main..feature/typed"]);
    expect(request.mock.calls[1][1].body).toEqual(expect.objectContaining({ head: "feature/typed", base: "main", draft: true }));
  });

  it("skips an existing open pull request before creating another", async () => {
    const request = jest.fn().mockResolvedValue({ statusCode: 200, body: [{ id: 1 }] });
    const git = jest.fn().mockResolvedValueOnce("feature").mockResolvedValueOnce("1");
    await dispatchGithubPr({ PLUGIN_EVENT_TYPE: "chain-completed", PLUGIN_TOKEN: "token", PLUGIN_OWNER: "owner", PLUGIN_REPO: "repo" }, request, git);
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe("typed Linear native handler", () => {
  it("resolves an omitted team, applies the matching state, and creates an issue", async () => {
    const request = jest.fn()
      .mockResolvedValueOnce({ statusCode: 200, body: { data: { teams: { nodes: [{ id: "team-1" }] } } } })
      .mockResolvedValueOnce({ statusCode: 200, body: { data: { workflowStates: { nodes: [{ id: "done" }] } } } })
      .mockResolvedValueOnce({ statusCode: 200, body: { data: { issueCreate: { success: true, issue: { url: "https://linear.test/1" } } } } });
    await dispatchLinear({ PLUGIN_API_KEY: "key", PLUGIN_EVENT_TYPE: "chain-completed", PLUGIN_CHAIN_ID: "chain" }, request);
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls[2][1].body).toEqual(expect.objectContaining({ variables: { input: expect.objectContaining({ teamId: "team-1", stateId: "done" }) } }));
  });

  it("does not contact Linear for unsupported event types", async () => {
    const request = jest.fn();
    await dispatchLinear({ PLUGIN_API_KEY: "key", PLUGIN_EVENT_TYPE: "other" }, request);
    expect(request).not.toHaveBeenCalled();
  });
});

describe("typed email native handlers", () => {
  it("filters notification events before requiring recipient configuration", async () => {
    const post = jest.fn();
    await dispatchNotifyEmail({ PLUGIN_NOTIFY_ON: "chain-stopped", PLUGIN_EVENT_TYPE: "chain-completed" }, post);
    expect(post).not.toHaveBeenCalled();
  });

  it("constructs and checks the internal email request", async () => {
    const post = jest.fn().mockResolvedValue({ statusCode: 202, body: {} });
    await dispatchNotifyEmail({ PLUGIN_TO: "ops@example.test", PLUGIN_EVENT_TYPE: "chain-completed", PLUGIN_CHAIN_ID: "chain", PLUGIN_RUN_ID: "run", MENTIKO_WEB_URL: "http://mentiko.test/" }, post);
    expect(post).toHaveBeenCalledWith("http://mentiko.test/api/email/send", expect.objectContaining({ to: "ops@example.test", subject: "[mentiko] Chain 'chain' completed", text: expect.stringContaining("Run ID: run") }));
  });

  it("owns append, JSONL validation, threshold flush, and post-success retirement of a digest buffer", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mentiko-native-digest-"));
    const path = join(dir, "digest.jsonl");
    const post = jest.fn().mockResolvedValue({ statusCode: 202, body: {} });
    const env = { PLUGIN_TO: "ops@example.test", PLUGIN_DIGEST_FILE: path, PLUGIN_SEND_AFTER_EVENTS: "2", PLUGIN_EVENT_TYPE: "chain-completed", PLUGIN_CHAIN_ID: "chain" };
    await dispatchEmailDigest(env, post, () => new Date("2026-07-16T12:00:00.000Z"));
    expect(readFileSync(path, "utf8")).toContain('"event":"chain-completed"');
    await dispatchEmailDigest({ ...env, PLUGIN_EVENT_TYPE: "chain-stopped" }, post, () => new Date("2026-07-16T12:01:00.000Z"));
    expect(post).toHaveBeenCalledWith(expect.stringContaining("/api/email/send"), expect.objectContaining({ subject: "[mentiko] Chain digest — 2 events", text: expect.stringContaining("chain-stopped") }));
    expect(() => readFileSync(path, "utf8")).toThrow();
  });
});

describe("non-Slack built-in manifest ownership", () => {
  it("routes every migrated built-in directly to a native handler with no shell event script", () => {
    for (const [id, handler] of [["github-pr", "github-pr"], ["linear", "linear"], ["email-digest", "email-digest"], ["notify-email", "notify-email"]] as const) {
      const dir = join(repoRoot, "lib", "plugins", id);
      const manifest = JSON.parse(readFileSync(join(dir, "plugin.json"), "utf8")) as Record<string, unknown>;
      expect(manifest.nativeHandler).toBe(handler);
      expect(manifest.onEventScript).toBeUndefined();
      expect(existsSync(join(dir, "on-event.sh"))).toBe(false);
    }
    expect(existsSync(join(repoRoot, "lib", "plugins", "notify-slack", "on-event.sh"))).toBe(true);
  });
});
