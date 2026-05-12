import { generateDEKForUser, unwrapDEKForUser, encryptForUser, decryptForUser, shredDEK } from "@/lib/user-crypto";
import Database from "better-sqlite3";
import { randomBytes } from "crypto";

// minimal db interface that user-crypto expects
function makeTestDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`CREATE TABLE "user" (id TEXT PRIMARY KEY, wrapped_dek BLOB)`);
  const userId = `test-${randomBytes(4).toString("hex")}`;
  db.prepare(`INSERT INTO "user" (id) VALUES (?)`).run(userId);
  return { db, userId };
}

describe("user-crypto", () => {
  test("generateDEKForUser stores wrapped_dek and can be unwrapped", async () => {
    const { db, userId } = makeTestDb();

    const dek = await generateDEKForUser(userId, db);
    expect(dek).toBeInstanceOf(Buffer);
    expect(dek.length).toBe(32);

    // wrapped_dek should be stored
    const row = db.prepare(`SELECT wrapped_dek FROM "user" WHERE id = ?`).get(userId) as { wrapped_dek: Buffer };
    expect(row.wrapped_dek).toBeTruthy();
    expect(row.wrapped_dek.length).toBeGreaterThan(32); // iv + tag + ciphertext

    // can unwrap back to same DEK
    const unwrapped = await unwrapDEKForUser(userId, db);
    expect(unwrapped).toBeTruthy();
    expect(unwrapped!.toString("hex")).toBe(dek.toString("hex"));

    db.close();
  });

  test("encryptForUser / decryptForUser round-trip", async () => {
    const { db, userId } = makeTestDb();
    await generateDEKForUser(userId, db);

    const plaintext = "sensitive user data that needs GDPR protection";
    const ciphertext = await encryptForUser(userId, plaintext, db);
    expect(ciphertext).toBeTruthy();
    expect(ciphertext!.startsWith("v1:")).toBe(true);

    const decrypted = await decryptForUser(userId, ciphertext!, db);
    expect(decrypted).toBe(plaintext);

    db.close();
  });

  test("shredDEK makes decryption impossible", async () => {
    const { db, userId } = makeTestDb();
    await generateDEKForUser(userId, db);

    const plaintext = "data that should become unreadable";
    const ciphertext = await encryptForUser(userId, plaintext, db);
    expect(ciphertext).toBeTruthy();

    // shred the DEK
    const shredded = await shredDEK(userId, db);
    expect(shredded).toBe(true);

    // decryption should now fail
    const decrypted = await decryptForUser(userId, ciphertext!, db);
    expect(decrypted).toBeNull();

    // unwrap should also fail
    const unwrapped = await unwrapDEKForUser(userId, db);
    expect(unwrapped).toBeNull();

    db.close();
  });

  test("unwrapDEKForUser returns null for user without DEK", async () => {
    const { db, userId } = makeTestDb();

    const unwrapped = await unwrapDEKForUser(userId, db);
    expect(unwrapped).toBeNull();

    db.close();
  });

  test("encryptForUser returns null for user without DEK", async () => {
    const { db, userId } = makeTestDb();

    const ciphertext = await encryptForUser(userId, "test", db);
    expect(ciphertext).toBeNull();

    db.close();
  });
});
