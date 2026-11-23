/** @jest-environment node */
import { createServer, type Server } from "net";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Fake pty-mgr daemon: records every `send` payload in arrival order.
const received: Array<{ name: string; text: string }> = [];
const socketPath = join(mkdtempSync(join(tmpdir(), "pty-send-")), "d.sock");
let server: Server;
let pty: typeof import("./pty-client").pty;

beforeAll(async () => {
  process.env.PTY_SOCKET_PATH = socketPath;
  process.env.MENTIKO_PTY_SUBMIT_GAP_MS = "30";
  server = createServer((conn) => {
    conn.on("data", (data) => {
      const req = JSON.parse(data.toString().split("\n")[0]);
      if (req.cmd === "send") received.push({ name: req.name, text: req.args.text });
      conn.write(JSON.stringify({ ok: true }) + "\n");
    });
  });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  ({ pty } = await import("./pty-client"));
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => { received.length = 0; });

// Issue #123: an Enter in the same write as pasted text is consumed by a
// paste-burst TUI (Codex) and the text is never submitted.
test("sendKeys writes the text, then Enter as its own later write", async () => {
  await pty.sendKeys("agent", "line one\n\nline two");
  expect(received).toEqual([
    { name: "agent", text: "line one\n\nline two" },
    { name: "agent", text: "\r" },
  ]);
});

test("a caller-supplied trailing return is not sent inside the text write", async () => {
  await pty.sendKeys("agent", "do it\r");
  expect(received.map((m) => m.text)).toEqual(["do it", "\r"]);
});

test("two sends to one session do not interleave during the gap", async () => {
  await Promise.all([pty.sendKeys("agent", "first"), pty.sendKeys("agent", "second")]);
  expect(received.map((m) => m.text)).toEqual(["first", "\r", "second", "\r"]);
});

test("sends to different sessions are not serialized behind each other", async () => {
  await Promise.all([pty.sendKeys("a", "one"), pty.sendKeys("b", "two")]);
  expect(received.filter((m) => m.name === "a").map((m) => m.text)).toEqual(["one", "\r"]);
  expect(received.filter((m) => m.name === "b").map((m) => m.text)).toEqual(["two", "\r"]);
});
