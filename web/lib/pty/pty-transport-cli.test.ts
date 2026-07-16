import { runPtyTransportCli, type PtyTransportClient } from "@/lib/pty/pty-transport-cli";
import type { SessionInfo } from "@/lib/pty/pty-client";

const client: PtyTransportClient = {
  ensure: jest.fn(async () => undefined),
  alive: jest.fn(async (name: string) => name === "alive-agent"),
  has: jest.fn(async (name: string) => name !== "missing-agent"),
  list: jest.fn(async () => ([
    { name: "alive-agent" },
    { name: "exited-agent" },
  ] as unknown as SessionInfo[])),
  pid: jest.fn(async (name: string) => name === "alive-agent" ? 4242 : null),
};

beforeEach(() => jest.clearAllMocks());

describe("typed PTY transport CLI", () => {
  it("owns daemon readiness and registered-session projection", async () => {
    const output: string[] = [];
    await expect(runPtyTransportCli(["ensure"], (line) => output.push(line), client)).resolves.toBe(0);
    await expect(runPtyTransportCli(["list"], (line) => output.push(line), client)).resolves.toBe(0);
    expect(client.ensure).toHaveBeenCalledTimes(1);
    expect(client.list).toHaveBeenCalledTimes(1);
    expect(output).toEqual(["ready", "alive-agent", "exited-agent"]);
  });

  it("owns liveness, existence, and PID result semantics", async () => {
    const output: string[] = [];
    await expect(runPtyTransportCli(["alive", "--name", "alive-agent"], (line) => output.push(line), client)).resolves.toBe(0);
    await expect(runPtyTransportCli(["alive", "--name", "missing-agent"], (line) => output.push(line), client)).resolves.toBe(1);
    await expect(runPtyTransportCli(["has", "--name", "exited-agent"], (line) => output.push(line), client)).resolves.toBe(0);
    await expect(runPtyTransportCli(["pid", "--name", "alive-agent"], (line) => output.push(line), client)).resolves.toBe(0);
    await expect(runPtyTransportCli(["pid", "--name", "missing-agent"], (line) => output.push(line), client)).resolves.toBe(1);
    expect(output).toEqual(["alive", "dead", "exists", "4242", "missing"]);
  });

  it("rejects arguments outside the typed transport contract", async () => {
    await expect(runPtyTransportCli(["list", "--name", "agent"], () => undefined, client))
      .rejects.toThrow("list does not accept arguments");
    await expect(runPtyTransportCli(["alive", "agent"], () => undefined, client))
      .rejects.toThrow("alive requires --name <session>");
  });
});
