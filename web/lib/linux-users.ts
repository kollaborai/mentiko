/**
 * linux-users: create and manage linux user accounts on tenant VPSes.
 *
 * Phase 2 of user split architecture. when a user signs up on the
 * platform, this creates their linux account so they get:
 *   - /home/{username}/ with .bashrc
 *   - membership in tenants + docker groups
 *   - interactive terminal access via pty-manager
 *   - SSH access to the VPS
 *
 * runs as www-data with limited sudo (useradd/chpasswd/usermod/chown).
 * only active on VPS tier (NODE_ENV=production + not docker).
 */

import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { existsSync, writeFileSync } from "fs";

const execFileAsync = promisify(execFile);

/**
 * derive a linux username from an email address.
 * takes the part before @, strips non-alphanumeric chars, lowercases.
 * handles collisions by appending a number.
 */
export function deriveUsername(email: string): string {
  const prefix = email.split("@")[0] || "user";
  const sanitized = prefix.toLowerCase().replace(/[^a-z0-9]/g, "");
  return sanitized || "user";
}

/**
 * check if a linux user already exists.
 */
async function userExists(username: string): Promise<boolean> {
  try {
    await execFileAsync("id", [username]);
    return true;
  } catch {
    return false;
  }
}

/**
 * find a unique username. if "marco" is taken, try "marco2", "marco3", etc.
 */
export async function findUniqueUsername(email: string): Promise<string> {
  const base = deriveUsername(email);
  if (!(await userExists(base))) return base;

  for (let i = 2; i <= 99; i++) {
    const candidate = `${base}${i}`;
    if (!(await userExists(candidate))) return candidate;
  }

  // fallback: use full email hash prefix
  const { createHash } = await import("crypto");
  const hash = createHash("sha256").update(email).digest("hex").slice(0, 8);
  return `u${hash}`;
}

/**
 * check if we're running on a VPS (not local dev, not docker tier).
 * linux user creation only makes sense on VPS.
 */
function isVpsTier(): boolean {
  if (process.env.NODE_ENV !== "production") return false;
  // docker tier containers have MENTIKO_TIER=docker
  if (process.env.MENTIKO_TIER === "docker") return false;
  // VPS has /etc/sudoers.d/mentiko-web (set up by tenant-setup.sh)
  return existsSync("/etc/sudoers.d/mentiko-web");
}

export interface CreateLinuxUserResult {
  username: string;
  created: boolean;
  error?: string;
}

/**
 * create a linux user account for a platform user.
 *
 * - derives username from email
 * - creates home dir with .bashrc
 * - adds to tenants + docker groups
 * - sets initial password
 *
 * idempotent: returns existing username if user already exists.
 * no-op on non-VPS environments.
 */
export async function createLinuxUser(
  email: string,
  password: string,
): Promise<CreateLinuxUserResult> {
  if (!isVpsTier()) {
    return { username: deriveUsername(email), created: false };
  }

  try {
    const username = await findUniqueUsername(email);

    if (await userExists(username)) {
      return { username, created: false };
    }

    // create user with home dir, bash shell, tenants + docker groups
    await execFileAsync("sudo", [
      "useradd",
      "-m",
      "-d", `/home/${username}`,
      "-s", "/bin/bash",
      "-G", "tenants,docker",
      username,
    ]);

    // set password via chpasswd (needs stdin pipe)
    await new Promise<void>((resolve, reject) => {
      const proc = spawn("sudo", ["chpasswd"], { stdio: ["pipe", "pipe", "pipe"] });
      proc.stdin.write(`${username}:${password}\n`);
      proc.stdin.end();
      proc.on("close", (code) => code === 0 ? resolve() : reject(new Error(`chpasswd exited ${code}`)));
      proc.on("error", reject);
    });

    // write .bashrc (parameterized by NAMESPACE_ID)
    const nsId = process.env.NAMESPACE_ID || "default";
    const bashrc = [
      `export PATH="/opt/mentiko/bin:/usr/local/bin:/usr/bin:/bin"`,
      `export MENTIKO_ROOT="/app"`,
      `export MENTIKO_CODE_ROOT="/opt/mentiko"`,
      `export MENTIKO_GLOBAL_ROOT="/app"`,
      `export NAMESPACE_ID="${nsId}"`,
      `export NAMESPACES_BASE="/app/namespaces"`,
      `export WORKSPACES_DIR="/app/namespaces/${nsId}/workspaces"`,
      `export XDG_CONFIG_HOME="$HOME/.config"`,
      `export XDG_CACHE_HOME="$HOME/.cache"`,
      `export XDG_DATA_HOME="$HOME/.local/share"`,
      ``,
      `alias ws='cd $WORKSPACES_DIR'`,
      `alias chains='cd /app/namespaces/${nsId}/chains'`,
    ].join("\n") + "\n";

    const bashrcPath = `/home/${username}/.bashrc`;
    writeFileSync(bashrcPath, bashrc);

    // fix ownership (www-data wrote the file, needs to be owned by user)
    await execFileAsync("sudo", [
      "chown", "-R", `${username}:${username}`, `/home/${username}`,
    ]);

    console.log(`[linux-users] created user ${username} for ${email}`);
    return { username, created: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[linux-users] failed to create user for ${email}: ${msg}`);
    return { username: deriveUsername(email), created: false, error: msg };
  }
}

/**
 * disable a linux user account (lock, don't delete).
 * home dir preserved for data retention.
 */
export async function disableLinuxUser(username: string): Promise<void> {
  if (!isVpsTier()) return;

  try {
    await execFileAsync("sudo", ["usermod", "-L", username]);
    console.log(`[linux-users] disabled user ${username}`);
  } catch (err) {
    console.error(
      `[linux-users] failed to disable ${username}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// SSH key management
// ---------------------------------------------------------------------------

const SSH_KEY_RE = /^(ssh-rsa|ssh-ed25519|ecdsa-sha2-nistp256|ecdsa-sha2-nistp384|ecdsa-sha2-nistp521|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com)\s+[A-Za-z0-9+/=]+(\s+.*)?$/;

/**
 * validate an SSH public key format.
 */
export function isValidSshKey(key: string): boolean {
  return SSH_KEY_RE.test(key.trim());
}

/**
 * extract algorithm from an SSH public key.
 */
export function getSshKeyAlgorithm(key: string): string {
  const parts = key.trim().split(/\s+/);
  return parts[0] || "unknown";
}

/**
 * compute fingerprint of an SSH public key (SHA256).
 */
export async function getSshKeyFingerprint(key: string): Promise<string> {
  const { createHash } = await import("crypto");
  const parts = key.trim().split(/\s+/);
  if (parts.length < 2) return "invalid";
  const keyData = Buffer.from(parts[1], "base64");
  const hash = createHash("sha256").update(keyData).digest("base64");
  // remove trailing = padding to match ssh-keygen output
  return `SHA256:${hash.replace(/=+$/, "")}`;
}

/**
 * get the authorized_keys file path for a user.
 */
function authorizedKeysPath(username: string): string {
  return `/home/${username}/.ssh/authorized_keys`;
}

/**
 * list SSH public keys for a linux user.
 */
export async function listSshKeys(username: string): Promise<string[]> {
  if (!isVpsTier()) return [];

  const keyPath = authorizedKeysPath(username);
  try {
    const { readFileSync } = await import("fs");
    const content = readFileSync(keyPath, "utf8");
    return content.split("\n").filter((line) => line.trim() && !line.startsWith("#"));
  } catch {
    return [];
  }
}

/**
 * add an SSH public key for a linux user.
 * creates ~/.ssh/ if it doesn't exist.
 */
export async function addSshKey(username: string, publicKey: string): Promise<void> {
  if (!isVpsTier()) return;

  const key = publicKey.trim();
  if (!isValidSshKey(key)) {
    throw new Error("Invalid SSH public key format");
  }

  // ensure .ssh dir exists with correct permissions
  const sshDir = `/home/${username}/.ssh`;
  await execFileAsync("sudo", ["mkdir", "-p", sshDir]);
  await execFileAsync("sudo", ["chmod", "700", sshDir]);
  await execFileAsync("sudo", ["chown", `${username}:${username}`, sshDir]);

  // read existing keys, avoid duplicates
  const existing = await listSshKeys(username);
  const keyBase = key.split(/\s+/).slice(0, 2).join(" ");
  const isDuplicate = existing.some((k) => {
    const kBase = k.split(/\s+/).slice(0, 2).join(" ");
    return kBase === keyBase;
  });

  if (isDuplicate) {
    throw new Error("This SSH key is already added");
  }

  // append key
  const keyPath = authorizedKeysPath(username);
  const { appendFileSync } = await import("fs");
  try {
    appendFileSync(keyPath, key + "\n");
  } catch {
    // www-data might not have write access, use tee via sudo
    await new Promise<void>((resolve, reject) => {
      const proc = spawn("sudo", ["tee", "-a", keyPath], { stdio: ["pipe", "pipe", "pipe"] });
      proc.stdin.write(key + "\n");
      proc.stdin.end();
      proc.on("close", (code) => code === 0 ? resolve() : reject(new Error(`tee exited ${code}`)));
      proc.on("error", reject);
    });
  }

  await execFileAsync("sudo", ["chmod", "600", keyPath]);
  await execFileAsync("sudo", ["chown", `${username}:${username}`, keyPath]);

  console.log(`[linux-users] added SSH key for ${username}`);
}

/**
 * remove an SSH public key for a linux user by fingerprint.
 */
export async function removeSshKey(username: string, fingerprint: string): Promise<void> {
  if (!isVpsTier()) return;

  const keys = await listSshKeys(username);
  const remaining: string[] = [];

  for (const key of keys) {
    const fp = await getSshKeyFingerprint(key);
    if (fp !== fingerprint) {
      remaining.push(key);
    }
  }

  if (remaining.length === keys.length) {
    throw new Error("SSH key not found");
  }

  // write filtered keys back
  const keyPath = authorizedKeysPath(username);
  const content = remaining.join("\n") + (remaining.length > 0 ? "\n" : "");

  await new Promise<void>((resolve, reject) => {
    const proc = spawn("sudo", ["tee", keyPath], { stdio: ["pipe", "pipe", "pipe"] });
    proc.stdin.write(content);
    proc.stdin.end();
    proc.on("close", (code) => code === 0 ? resolve() : reject(new Error(`tee exited ${code}`)));
    proc.on("error", reject);
  });

  await execFileAsync("sudo", ["chmod", "600", keyPath]);
  await execFileAsync("sudo", ["chown", `${username}:${username}`, keyPath]);

  console.log(`[linux-users] removed SSH key ${fingerprint} for ${username}`);
}
