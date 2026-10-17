/** @jest-environment node */

/** FEAT-001/TASK-005 — attachment lifecycle cleanup:
 *  - taskDelete choke point removes blob dirs (rows go via FK cascade)
 *  - taskClose keeps blobs (task survives archive)
 *  - sweepOrphanAttachmentBlobs GC removes orphan task dirs, keeps live ones
 *  - init-time sweep runs once per namespace per process
 *  - org purge removes all attachment traces for one org only
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

jest.mock("../../config", () => ({
  __esModule: true,
  default: {
    globalRoot: "/tmp/mentiko-attach-cleanup-test-" + process.pid,
    codeRoot: "/tmp",
  },
}));

import config from "../../config";
import { attachmentTaskBlobDir } from "../task-attachment-types";
import {
  closeAll,
  _getDb,
  sweepOrphanAttachmentBlobs,
  sweepOrphanAttachmentBlobsOnce,
  taskClose,
  taskCreate,
  taskDelete,
} from "../task-store";
import {
  taskAttachmentCreate,
  taskAttachmentsForTask,
  taskAttachmentsPurgeOrg,
} from "../task-attachment-store";

const testRoot = "/tmp/mentiko-attach-cleanup-test-" + process.pid;

const PNG_1PX = Buffer.from(
  "89504e470d0a1a0a0000000d494844520000000100000001080600000" +
    "01f15c4890000000a49444154789c6360000002000154a24f5c000000004945" +
    "4e44ae426082",
  "hex"
);

function makeTask(orgId: string, title: string): string {
  return taskCreate(orgId, { title }).id;
}

function upload(orgId: string, taskId: string, namespaceId = "default") {
  return taskAttachmentCreate({
    orgId,
    taskId,
    namespaceId,
    createdBy: "user-1",
    file: { name: "shot.png", type: "image/png", bytes: PNG_1PX },
  });
}

function blobDir(orgId: string, taskId: string, namespaceId = "default"): string {
  const namespaceRoot = join(config.globalRoot, "namespaces", namespaceId);
  return attachmentTaskBlobDir(namespaceRoot, orgId, taskId);
}

/** org-level attachment dir (parent of all task dirs for one org) */
function orgBlobDir(orgId: string, namespaceId = "default"): string {
  const namespaceRoot = join(config.globalRoot, "namespaces", namespaceId);
  return attachmentTaskBlobDir(namespaceRoot, orgId, "");
}

function attachmentRowCount(taskId: string): number {
  const db = _getDb("default");
  return (
    db.prepare("SELECT COUNT(*) AS n FROM task_attachments WHERE task_id = ?").get(taskId) as {
      n: number;
    }
  ).n;
}

beforeAll(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

afterAll(() => {
  closeAll();
  rmSync(testRoot, { recursive: true, force: true });
});

describe("task attachment lifecycle cleanup (TASK-005)", () => {
  it("taskDelete removes the task's blob dir and attachment rows, and leaves sibling tasks untouched", () => {
    const orgId = "org1";
    const victim = makeTask(orgId, "doomed");
    const survivor = makeTask(orgId, "survives");
    upload(orgId, victim);
    upload(orgId, survivor);

    expect(existsSync(blobDir(orgId, victim))).toBe(true);

    taskDelete(orgId, victim, "default");

    expect(existsSync(blobDir(orgId, victim))).toBe(false);
    expect(attachmentRowCount(victim)).toBe(0);
    expect(existsSync(blobDir(orgId, survivor))).toBe(true);
    expect(attachmentRowCount(survivor)).toBe(1);
  });

  it("taskDelete succeeds for a task with no attachments (no blob dir present)", () => {
    const orgId = "org1";
    const plain = makeTask(orgId, "never had attachments");
    expect(() => taskDelete(orgId, plain, "default")).not.toThrow();
    expect(attachmentRowCount(plain)).toBe(0);
  });

  it("taskDelete works in a namespace whose task_attachments table was never migrated", () => {
    const freshNs = "no-attach-migration";
    const orgId = "orgX";
    const id = taskCreate(orgId, { title: "fresh namespace task" }, freshNs).id;
    // no upload happened in this namespace -> ensureAttachmentTables never ran there
    expect(() => taskDelete(orgId, id, freshNs)).not.toThrow();
  });

  it("taskClose (archive) keeps blobs -- only true deletes purge", () => {
    const orgId = "org1";
    const id = makeTask(orgId, "closed not deleted");
    upload(orgId, id);

    taskClose(orgId, id, undefined, "default");

    expect(existsSync(blobDir(orgId, id))).toBe(true);
    expect(attachmentRowCount(id)).toBe(1);
  });

  it("sweepOrphanAttachmentBlobs removes orphan task dirs, keeps live tasks and unattributable entries", () => {
    const orgId = "org-sweep";
    const live = makeTask(orgId, "still here");
    upload(orgId, live);

    const sweepOrgDir = orgBlobDir(orgId); // .../task-attachments/org-sweep
    const orphanDir = join(sweepOrgDir, "TASK-ORPHAN-1");
    mkdirSync(orphanDir, { recursive: true });
    writeFileSync(join(orphanDir, "att_x.png"), "x");
    const invalidDir = join(sweepOrgDir, "not a task id!");
    mkdirSync(invalidDir, { recursive: true });

    const removed = sweepOrphanAttachmentBlobs("default", orgId);

    expect(removed).toBe(1);
    expect(existsSync(orphanDir)).toBe(false);
    expect(existsSync(blobDir(orgId, live))).toBe(true);
    expect(existsSync(invalidDir)).toBe(true); // unattributable entries are kept
  });

  it("sweepOrphanAttachmentBlobs scans every org when no org scope is given", () => {
    const orgA = "org-multi-a";
    const orgB = "org-multi-b";
    const aLive = makeTask(orgA, "a live");
    const bOrphan = "TASK-ORPHAN-B";
    upload(orgA, aLive);
    mkdirSync(join(blobDir(orgB, bOrphan)), { recursive: true });

    const removed = sweepOrphanAttachmentBlobs("default");

    expect(removed).toBeGreaterThanOrEqual(1);
    expect(existsSync(blobDir(orgB, bOrphan))).toBe(false);
    expect(existsSync(blobDir(orgA, aLive))).toBe(true);
  });

  it("init sweep runs once per namespace per process (hot-reload guard)", () => {
    const ns = "guard-ns";
    const orgId = "org-guard";
    const orphan1 = join(blobDir(orgId, "TASK-ORPHAN-G1", ns), "blob.png");
    mkdirSync(blobDir(orgId, "TASK-ORPHAN-G1", ns), { recursive: true });
    writeFileSync(orphan1, "x");

    sweepOrphanAttachmentBlobsOnce(ns);
    expect(existsSync(orphan1)).toBe(false); // first run sweeps

    const orphan2 = join(blobDir(orgId, "TASK-ORPHAN-G2", ns), "blob.png");
    mkdirSync(blobDir(orgId, "TASK-ORPHAN-G2", ns), { recursive: true });
    writeFileSync(orphan2, "x");

    sweepOrphanAttachmentBlobsOnce(ns);
    expect(existsSync(orphan2)).toBe(true); // guarded: second call is a no-op

    sweepOrphanAttachmentBlobs(ns, orgId);
    expect(existsSync(orphan2)).toBe(false); // unguarded sweep still reaps
  });

  it("taskAttachmentsPurgeOrg removes rows and blobs for one org only", () => {
    const orgA = "org-purge-a";
    const orgB = "org-purge-b";
    const aTask = makeTask(orgA, "purge me");
    const bTask = makeTask(orgB, "keep me");
    upload(orgA, aTask);
    upload(orgB, bTask);

    taskAttachmentsPurgeOrg(orgA, "default");

    expect(attachmentRowCount(aTask)).toBe(0);
    expect(existsSync(blobDir(orgA, aTask))).toBe(false);
    expect(attachmentRowCount(bTask)).toBe(1);
    expect(existsSync(blobDir(orgB, bTask))).toBe(true);
  });
});
