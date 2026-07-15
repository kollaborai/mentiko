/** @jest-environment node */

import { spawn, type ChildProcess } from "child_process";
import fs, { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { nsPath } from "@/lib/config";
import {
  NotificationPersistenceError,
  addNotification,
  readNotifications,
  type PersistedNotification,
} from "@/lib/notifications/notification-persistence";

jest.mock("@/lib/config", () => ({
  nsPath: jest.fn(),
}));

const childFixture = join(__dirname, "__fixtures__", "notification-writer-child.ts");

function notificationInput(id: string) {
  return {
    id,
    type: "info",
    title: `Notification ${id}`,
    message: "persistence test",
  };
}

function spawnWriter(root: string, idempotencyKey: string): ChildProcess {
  return spawn(process.execPath, [
    "-r",
    "ts-node/register/transpile-only",
    "-r",
    "tsconfig-paths/register",
    childFixture,
    "default",
    idempotencyKey,
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      MENTIKO_GLOBAL_ROOT: root,
      NAMESPACE_ID: "default",
      ORG_ID: "default",
      TS_NODE_BASEURL: ".",
      TS_NODE_COMPILER_OPTIONS: JSON.stringify({
        module: "CommonJS",
        moduleResolution: "node",
      }),
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
}

function waitForExit(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    let stderr = "";
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`notification writer exited ${code ?? signal}: ${stderr}`));
    });
  });
}

describe("notification persistence", () => {
  let root: string;
  let file: string;

  beforeEach(() => {
    jest.restoreAllMocks();
    root = mkdtempSync(join(tmpdir(), "notification-persistence-"));
    file = join(root, "notifications.json");
    (nsPath as jest.Mock).mockReturnValue(root);
  });

  it("rejects a malformed store without replacing its bytes", () => {
    const corrupt = "{not-json\n";
    writeFileSync(file, corrupt);

    expect(() => addNotification("default", notificationInput("notif-new")))
      .toThrow(NotificationPersistenceError);
    expect(readFileSync(file, "utf8")).toBe(corrupt);
    expect(readdirSync(root)).not.toContain(".notifications.claim");
  });

  it("surfaces a read failure without replacing the existing store", () => {
    addNotification("default", notificationInput("notif-existing"));
    const before = readFileSync(file, "utf8");
    const originalRead = fs.readFileSync;
    jest.spyOn(fs, "readFileSync").mockImplementation(((path: fs.PathOrFileDescriptor, options?: unknown) => {
      if (String(path) === file) {
        throw Object.assign(new Error("read interrupted"), { code: "EIO" });
      }
      return Reflect.apply(originalRead, fs, [path, options]);
    }) as typeof fs.readFileSync);

    expect(() => addNotification("default", notificationInput("notif-new")))
      .toThrow(expect.objectContaining({ operation: "read" }));
    jest.restoreAllMocks();
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("surfaces a temp-write failure without replacing the existing store", () => {
    addNotification("default", notificationInput("notif-existing"));
    const before = readFileSync(file, "utf8");
    const originalWrite = fs.writeFileSync;
    jest.spyOn(fs, "writeFileSync").mockImplementation(((
      path: fs.PathOrFileDescriptor,
      data: string | NodeJS.ArrayBufferView,
      options?: unknown,
    ) => {
      if (String(path).includes(".notifications.json.tmp-")) {
        throw Object.assign(new Error("write interrupted"), { code: "EIO" });
      }
      return Reflect.apply(originalWrite, fs, [path, data, options]);
    }) as typeof fs.writeFileSync);

    expect(() => addNotification("default", notificationInput("notif-new")))
      .toThrow(expect.objectContaining({ operation: "write" }));
    jest.restoreAllMocks();
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("uses a same-directory temp rename and preserves the store when rename fails", () => {
    addNotification("default", notificationInput("notif-existing"));
    const before = readFileSync(file, "utf8");
    const originalRename = fs.renameSync.bind(fs);
    let tempPath = "";
    jest.spyOn(fs, "renameSync").mockImplementation((oldPath, newPath) => {
      if (String(oldPath).includes(".notifications.json.tmp-")) {
        tempPath = String(oldPath);
        expect(dirname(tempPath)).toBe(dirname(String(newPath)));
        throw Object.assign(new Error("rename interrupted"), { code: "EIO" });
      }
      return originalRename(oldPath, newPath);
    });

    expect(() => addNotification("default", notificationInput("notif-new")))
      .toThrow(expect.objectContaining({ operation: "write" }));
    jest.restoreAllMocks();
    expect(tempPath).not.toBe("");
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(readdirSync(root).some((entry) => entry.includes(".notifications.json.tmp-"))).toBe(false);
  });

  it("ignores an interrupted temp file and reads the committed store", () => {
    const expected = addNotification("default", notificationInput("notif-existing"));
    const interrupted = join(root, ".notifications.json.tmp-interrupted");
    writeFileSync(interrupted, "partial");

    expect(readNotifications("default")).toEqual([expected]);
    expect(readFileSync(interrupted, "utf8")).toBe("partial");
  });
});

describe("notification persistence across processes", () => {
  it("preserves every distinct stable ID from concurrent child writers", async () => {
    const root = mkdtempSync(join(tmpdir(), "notification-concurrent-distinct-"));
    const keys = Array.from({ length: 8 }, (_, index) => `distinct-${index}`);
    await Promise.all(keys.map((key) => waitForExit(spawnWriter(root, key))));

    const file = join(root, "namespaces", "default", "notifications", "notifications.json");
    const notifications = JSON.parse(readFileSync(file, "utf8")) as PersistedNotification[];
    expect(notifications).toHaveLength(keys.length);
    expect(new Set(notifications.map((notification) => notification.id)).size).toBe(keys.length);
  }, 20_000);

  it("stores one record when concurrent child writers use the same stable ID", async () => {
    const root = mkdtempSync(join(tmpdir(), "notification-concurrent-same-"));
    await Promise.all(Array.from({ length: 8 }, () =>
      waitForExit(spawnWriter(root, "same-idempotency-key"))));

    const file = join(root, "namespaces", "default", "notifications", "notifications.json");
    const notifications = JSON.parse(readFileSync(file, "utf8")) as PersistedNotification[];
    expect(notifications).toHaveLength(1);
  }, 20_000);
});
