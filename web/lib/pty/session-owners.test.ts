import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  recordSessionOwner,
  getSessionOwner,
  removeSessionOwner,
  canAccessSession,
  filterAccessibleSessions,
} from "./session-owners";

// session-owners reads PTY_MANAGER_DIR at call time, so point it at a fresh
// temp dir per test for an isolated, disposable registry file.
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "session-owners-test-"));
  process.env.PTY_MANAGER_DIR = dir;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.PTY_MANAGER_DIR;
});

describe("pty session ownership (regression: cross-user PTY attach, finding #2)", () => {
  const alice = "user-alice";
  const bob = "user-bob";

  test("records and reads back an owner", () => {
    recordSessionOwner("alice-shell", alice);
    expect(getSessionOwner("alice-shell")).toBe(alice);
  });

  test("owner can access their own session", () => {
    recordSessionOwner("alice-shell", alice);
    expect(canAccessSession("alice-shell", alice)).toBe(true);
  });

  test("a different user CANNOT access someone else's session (the bug)", () => {
    recordSessionOwner("alice-shell", alice);
    expect(canAccessSession("alice-shell", bob)).toBe(false);
  });

  test("un-owned (agent/legacy) sessions stay org-shared", () => {
    // never recorded -> any authed user may access (agent-run replay etc.)
    expect(canAccessSession("agent-research-step", bob)).toBe(true);
  });

  test("undefined userId fails closed on an owned session, open on un-owned", () => {
    recordSessionOwner("alice-shell", alice);
    expect(canAccessSession("alice-shell", undefined)).toBe(false);
    expect(canAccessSession("some-agent-session", undefined)).toBe(true);
  });

  test("filter hides other users' sessions, keeps own + un-owned", () => {
    recordSessionOwner("alice-shell", alice);
    recordSessionOwner("bob-shell", bob);
    const all = ["alice-shell", "bob-shell", "agent-step"];
    expect(filterAccessibleSessions(all, alice).sort()).toEqual([
      "agent-step",
      "alice-shell",
    ]);
  });

  test("removeSessionOwner reverts a session to org-shared", () => {
    recordSessionOwner("alice-shell", alice);
    removeSessionOwner("alice-shell");
    expect(getSessionOwner("alice-shell")).toBeNull();
    // now un-owned -> accessible again (no owner to enforce)
    expect(canAccessSession("alice-shell", bob)).toBe(true);
  });

  test("a missing registry file just means org-shared (no crash)", () => {
    // nothing recorded at all in this fresh dir
    expect(getSessionOwner("whatever")).toBeNull();
    expect(canAccessSession("whatever", alice)).toBe(true);
  });
});
