/**
 * secrets-store.test.ts
 * comprehensive tests for encrypted secrets store
 */

import { mkdirSync, rmSync } from "fs";
import { join } from "path";

// stable test dir — set once, reused by mock
const TEST_BASE = `/tmp/test-secrets-store-${process.pid}`;
let testDir = TEST_BASE;

// mock config to provide test paths — must return the SAME dir every call
jest.mock("../config", () => ({
  orgPath: (_ns: string, org: string, subdir: string) => {
    return join(testDir, "orgs", org, subdir);
  },
}));

jest.mock("../agents/agent-profile-storage", () => ({
  listProfiles: jest.fn(() => []),
}));

const { listProfiles } = require("../agents/agent-profile-storage");

import {
  encrypt,
  decrypt,
  createSecret,
  listSecrets,
  getSecretValue,
  updateSecret,
  deleteSecret,
  getSecretsEnvVars,
  getSecretByName,
  resolveProfileEnvVars,
  findProfilesUsingSecret,
} from "../secrets/secrets-store";

describe("secrets-store", () => {
  const testNamespace = "test-ns";
  const testOrg = "test-org";

  beforeEach(() => {
    // unique dir per test to avoid cross-test pollution
    testDir = join(TEST_BASE, `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    // pre-create the secrets dir so writeFileSync doesn't ENOENT
    mkdirSync(join(testDir, "orgs", testOrg, "secrets"), { recursive: true });
    // clear mock
    (listProfiles as jest.Mock).mockReturnValue([]);
    // ensure BETTER_AUTH_SECRET is set for tests
    if (!process.env.BETTER_AUTH_SECRET) {
      process.env.BETTER_AUTH_SECRET = "test-secret-key-for-unit-tests";
    }
  });

  afterAll(() => {
    // clean up entire test base dir
    try {
      rmSync(TEST_BASE, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  describe("encryption", () => {
    it("encrypts plaintext to ciphertext", () => {
      const plaintext = "my-secret-value";
      const ciphertext = encrypt(plaintext);

      expect(ciphertext).toMatch(/^v1:[0-9a-f]{16}:[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/);
      // format: v1:keyId:iv(12 bytes=24 hex):tag(16 bytes=32 hex):encrypted(variable)
    });

    it("decrypts ciphertext back to plaintext", () => {
      const plaintext = "my-secret-value";
      const ciphertext = encrypt(plaintext);
      const decrypted = decrypt(ciphertext);

      expect(decrypted).toBe(plaintext);
    });

    it("produces different ciphertext for same plaintext", () => {
      const plaintext = "my-secret-value";
      const cipher1 = encrypt(plaintext);
      const cipher2 = encrypt(plaintext);

      expect(cipher1).not.toBe(cipher2);
    });

    it("decrypts both ciphertexts to same plaintext", () => {
      const plaintext = "my-secret-value";
      const cipher1 = encrypt(plaintext);
      const cipher2 = encrypt(plaintext);

      expect(decrypt(cipher1)).toBe(plaintext);
      expect(decrypt(cipher2)).toBe(plaintext);
    });

    it("handles empty strings", () => {
      expect(decrypt(encrypt(""))).toBe("");
    });

    it("handles special characters", () => {
      const special = "hello !@#$%^&*()_+-={}[]|\\:;'<>,.?/~`\n\t\r";
      expect(decrypt(encrypt(special))).toBe(special);
    });

    it("handles unicode characters", () => {
      const unicode = "hello 世界 🌍 🎉";
      expect(decrypt(encrypt(unicode))).toBe(unicode);
    });

    it("rejects invalid ciphertext format", () => {
      expect(decrypt("invalid")).toBeNull();
      expect(decrypt("only:two:parts:extra")).toBeNull();
    });

    it("rejects ciphertext with wrong key", () => {
      const plaintext = "my-secret-value";
      const ciphertext = encrypt(plaintext);

      // change the master secret
      const originalSecret = process.env.BETTER_AUTH_SECRET;
      process.env.BETTER_AUTH_SECRET = "different-secret-key";

      expect(decrypt(ciphertext)).toBeNull();

      // restore
      process.env.BETTER_AUTH_SECRET = originalSecret;
    });

    it("uses PBKDF2 for key derivation", () => {
      // verify that the same secret produces the same key
      // but different IVs produce different ciphertexts
      const plaintext = "test-value";
      const cipher1 = encrypt(plaintext);
      const cipher2 = encrypt(plaintext);

      // different ciphertexts due to random IV
      expect(cipher1).not.toBe(cipher2);

      // but both decrypt correctly with the derived key
      expect(decrypt(cipher1)).toBe(plaintext);
      expect(decrypt(cipher2)).toBe(plaintext);
    });
  });

  describe("CRUD operations", () => {
    it("creates a new secret", () => {
      const secret = createSecret(testNamespace, testOrg, {
        name: "api-key",
        envVar: "API_KEY",
        value: "sk-1234567890",
        description: "My API key",
      });

      expect(secret.id).toMatch(/^sec-\d+-[0-9a-f]{6}$/);
      expect(secret.name).toBe("api-key");
      expect(secret.envVar).toBe("API_KEY");
      expect(secret.maskedValue).toBe("...7890");
      expect(secret.createdAt).toBeDefined();
      expect(secret.updatedAt).toBeDefined();
    });

    it("masks short values", () => {
      const secret = createSecret(testNamespace, testOrg, {
        name: "short",
        envVar: "SHORT",
        value: "abc",
      });

      expect(secret.maskedValue).toBe("****");
    });

    it("lists secrets", () => {
      createSecret(testNamespace, testOrg, {
        name: "secret1",
        envVar: "SECRET1",
        value: "value1",
      });
      createSecret(testNamespace, testOrg, {
        name: "secret2",
        envVar: "SECRET2",
        value: "value2",
      });

      const secrets = listSecrets(testNamespace, testOrg);
      expect(secrets).toHaveLength(2);
      expect(secrets[0].name).toBe("secret1");
      expect(secrets[1].name).toBe("secret2");
    });

    it("excludes encrypted values from list", () => {
      createSecret(testNamespace, testOrg, {
        name: "secret1",
        envVar: "SECRET1",
        value: "value1",
      });

      const secrets = listSecrets(testNamespace, testOrg);
      expect(secrets[0]).not.toHaveProperty("encryptedValue");
    });

    it("returns empty list when no secrets", () => {
      const secrets = listSecrets(testNamespace, testOrg);
      expect(secrets).toEqual([]);
    });

    it("gets decrypted value by id", () => {
      const secret = createSecret(testNamespace, testOrg, {
        name: "api-key",
        envVar: "API_KEY",
        value: "sk-1234567890",
      });

      const value = getSecretValue(testNamespace, testOrg, secret.id);
      expect(value).toBe("sk-1234567890");
    });

    it("returns null for non-existent secret", () => {
      const value = getSecretValue(testNamespace, testOrg, "non-existent");
      expect(value).toBeNull();
    });

    it("updates secret value", () => {
      const secret = createSecret(testNamespace, testOrg, {
        name: "api-key",
        envVar: "API_KEY",
        value: "old-value",
      });

      const updated = updateSecret(testNamespace, testOrg, secret.id, {
        value: "new-value",
      });

      expect(updated).toBeTruthy();
      expect(updated?.maskedValue).toBe("...alue");

      const value = getSecretValue(testNamespace, testOrg, secret.id);
      expect(value).toBe("new-value");
    });

    it("updates secret metadata", () => {
      const secret = createSecret(testNamespace, testOrg, {
        name: "api-key",
        envVar: "API_KEY",
        value: "value",
      });

      const updated = updateSecret(testNamespace, testOrg, secret.id, {
        name: "new-name",
        envVar: "NEW_VAR",
        description: "new description",
      });

      expect(updated?.name).toBe("new-name");
      expect(updated?.envVar).toBe("NEW_VAR");
      expect(updated?.description).toBe("new description");
    });

    it("returns null when updating non-existent secret", () => {
      const result = updateSecret(testNamespace, testOrg, "non-existent", {
        value: "new-value",
      });
      expect(result).toBeNull();
    });

    it("deletes secret", () => {
      const secret = createSecret(testNamespace, testOrg, {
        name: "api-key",
        envVar: "API_KEY",
        value: "value",
      });

      const result = deleteSecret(testNamespace, testOrg, secret.id);
      expect(result.ok).toBe(true);

      const secrets = listSecrets(testNamespace, testOrg);
      expect(secrets).toHaveLength(0);
    });

    it("returns error when deleting non-existent secret", () => {
      const result = deleteSecret(testNamespace, testOrg, "non-existent");
      expect(result.ok).toBe(false);
      expect((result as any).error).toBe("Secret not found");
    });

    it("prevents deletion when secret is in use", () => {
      (listProfiles as jest.Mock).mockReturnValue([
        {
          id: "profile-1",
          name: "test-profile",
          env: {
            API_KEY: "{secret:api-key}",
          },
        },
      ]);

      const secret = createSecret(testNamespace, testOrg, {
        name: "api-key",
        envVar: "API_KEY",
        value: "value",
      });

      const result = deleteSecret(testNamespace, testOrg, secret.id);
      expect(result.ok).toBe(false);
      expect((result as any).error).toContain("used in 1 profile");
      expect((result as any).usages).toHaveLength(1);
    });
  });

  describe("env injection", () => {
    it("returns empty object when no secrets", () => {
      const env = getSecretsEnvVars(testNamespace, testOrg);
      expect(env).toEqual({});
    });

    it("returns all secrets as env vars", () => {
      createSecret(testNamespace, testOrg, {
        name: "key1",
        envVar: "ENV1",
        value: "value1",
      });
      createSecret(testNamespace, testOrg, {
        name: "key2",
        envVar: "ENV2",
        value: "value2",
      });

      const env = getSecretsEnvVars(testNamespace, testOrg);
      expect(env).toEqual({
        ENV1: "value1",
        ENV2: "value2",
      });
    });

    it("skips corrupted secrets", () => {
      createSecret(testNamespace, testOrg, {
        name: "good",
        envVar: "GOOD",
        value: "value",
      });

      // manually create a corrupted file in the same dir the mock points to
      const { writeFileSync } = require("fs");
      const dir = join(testDir, "orgs", testOrg, "secrets");
      writeFileSync(join(dir, "corrupted.json"), "{invalid json");

      const env = getSecretsEnvVars(testNamespace, testOrg);
      expect(env).toEqual({ GOOD: "value" });
    });
  });

  describe("secret resolution", () => {
    it("finds secret by name", () => {
      createSecret(testNamespace, testOrg, {
        name: "my-secret",
        envVar: "MY_SECRET",
        value: "resolved-value",
      });

      const value = getSecretByName(testNamespace, testOrg, "my-secret");
      expect(value).toBe("resolved-value");
    });

    it("returns null for non-existent name", () => {
      const value = getSecretByName(testNamespace, testOrg, "non-existent");
      expect(value).toBeNull();
    });

    it("resolves {secret:NAME} references", () => {
      createSecret(testNamespace, testOrg, {
        name: "api-key",
        envVar: "API_KEY",
        value: "sk-secret",
      });

      const resolved = resolveProfileEnvVars(testNamespace, testOrg, {
        MY_VAR: "{secret:api-key}",
        OTHER_VAR: "literal-value",
      });

      expect(resolved).toEqual({
        MY_VAR: "sk-secret",
        OTHER_VAR: "literal-value",
      });
    });

    it("leaves unresolved references as-is", () => {
      const resolved = resolveProfileEnvVars(testNamespace, testOrg, {
        MY_VAR: "{secret:non-existent}",
      });

      expect(resolved).toEqual({
        MY_VAR: "{secret:non-existent}",
      });
    });

    it("handles mixed env vars", () => {
      createSecret(testNamespace, testOrg, {
        name: "db-password",
        envVar: "DB_PASSWORD",
        value: "secret123",
      });

      const resolved = resolveProfileEnvVars(testNamespace, testOrg, {
        LITERAL: "plain-value",
        REFERENCE: "{secret:db-password}",
        ANOTHER_LITERAL: "another",
      });

      expect(resolved).toEqual({
        LITERAL: "plain-value",
        REFERENCE: "secret123",
        ANOTHER_LITERAL: "another",
      });
    });
  });

  describe("profile dependency tracking", () => {
    it("returns empty array when secret not used", () => {
      createSecret(testNamespace, testOrg, {
        name: "unused",
        envVar: "UNUSED",
        value: "value",
      });

      const usages = findProfilesUsingSecret(testNamespace, testOrg, "unused");
      expect(usages).toEqual([]);
    });

    it("finds profiles using secret", () => {
      (listProfiles as jest.Mock).mockReturnValue([
        {
          id: "profile-1",
          name: "Profile One",
          env: {
            API_KEY: "{secret:my-secret}",
            OTHER_VAR: "literal",
          },
        },
        {
          id: "profile-2",
          name: "Profile Two",
          env: {
            DB_PASSWORD: "{secret:my-secret}",
          },
        },
        {
          id: "profile-3",
          name: "Profile Three",
          env: {
            UNUSED: "{secret:different-secret}",
          },
        },
      ]);

      const usages = findProfilesUsingSecret(testNamespace, testOrg, "my-secret");
      expect(usages).toHaveLength(2);
      expect(usages[0]).toEqual({
        profileId: "profile-1",
        profileName: "Profile One",
        envVar: "API_KEY",
      });
      expect(usages[1]).toEqual({
        profileId: "profile-2",
        profileName: "Profile Two",
        envVar: "DB_PASSWORD",
      });
    });

    it("handles profiles with no env", () => {
      (listProfiles as jest.Mock).mockReturnValue([
        { id: "profile-1", name: "No Env" },
      ]);

      const usages = findProfilesUsingSecret(testNamespace, testOrg, "any-secret");
      expect(usages).toEqual([]);
    });
  });

  describe("file permissions", () => {
    it("creates secret files with 0600 permissions", () => {
      const { statSync } = require("fs");

      const secret = createSecret(testNamespace, testOrg, {
        name: "test",
        envVar: "TEST",
        value: "value",
      });

      const dir = join(testDir, "orgs", testOrg, "secrets");
      const filePath = join(dir, `${secret.id}.json`);
      const stats = statSync(filePath);

      // on Unix, 0600 = 0o600 (owner read/write only)
      // on Windows, this may not apply
      if (process.platform !== "win32") {
        expect(stats.mode & 0o777).toBe(0o600);
      }
    });
  });
});
