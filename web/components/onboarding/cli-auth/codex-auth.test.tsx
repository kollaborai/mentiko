import { render, screen, waitFor } from "@testing-library/react";
import { CodexAuth } from "./codex-auth";

jest.mock("@/lib/use-namespace-fetch", () => ({
  useNamespaceFetch: () => ({
    fetchWithNamespace: jest.fn(),
  }),
}));

jest.mock("@/components/secrets/secret-form", () => ({
  SecretForm: () => <div data-testid="secret-form" />,
}));

jest.mock("./terminal-auth-option", () => ({
  TerminalAuthOption: () => <div data-testid="terminal-auth-option" />,
}));

describe("CodexAuth", () => {
  beforeEach(() => {
    (global.fetch as jest.Mock | undefined)?.mockReset?.();
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/agent-profiles") {
        return new Response(JSON.stringify({ data: { profiles: [] } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
  });

  it("falls back to bundled Codex agent configs, not stale raw OpenAI models", async () => {
    render(
      <CodexAuth
        onSave={jest.fn()}
        onBack={jest.fn()}
        detectedVersion="codex-cli 0.130.0"
        initialAuthMethod="login"
      />,
    );

    const select = await screen.findByRole("combobox");

    await waitFor(() => {
      expect(select).toHaveValue("codex-default");
    });

    expect(screen.getByRole("option", { name: "Codex / GPT-5.5" })).toHaveValue("codex-default");
    expect(screen.queryByRole("option", { name: "gpt-4o" })).toBeNull();
  });
});
