/**
 * Docker container provisioner for mentiko workspaces.
 *
 * Provisions isolated Docker containers as execution environments.
 * Unlike cloud infra providers (Linode/AWS), this runs containers
 * on the local Docker daemon — suitable for self-hosted deployments.
 *
 * Naming conventions:
 *   container:  mentiko-{namespaceId}-{slug}
 *   volume:     mentiko-vol-{namespaceId}-{slug}
 *   network:    mentiko-net-{namespaceId}
 */

import { execSync, execFileSync } from "child_process";

// ── types ─────────────────────────────────────────────────────────────────────

export interface DockerProvisionOptions {
  /** workspace slug (alphanumeric + hyphens) */
  name: string;
  /** tenant namespace ID for isolation */
  namespaceId: string;
  /** path inside container (default /workspace) */
  workspacePath?: string;
  /** docker image (default ubuntu:22.04) */
  image?: string;
  /** memory limit e.g. "4g" (default "4g") */
  memoryLimit?: string;
  /** cpu limit e.g. "2" (default "2") */
  cpuLimit?: string;
  /** additional env vars to inject */
  env?: Record<string, string>;
}

export interface DockerContainerInfo {
  /** container name mentiko-{ns}-{slug} */
  containerName: string;
  /** volume name */
  volumeName: string;
  /** network name */
  networkName: string;
  /** container ID */
  containerId: string;
  /** working dir inside container */
  workspacePath: string;
  /** docker image used */
  image: string;
  /** container status */
  status: "running" | "stopped" | "not_found";
  createdAt: string;
}

export interface DockerListEntry {
  containerName: string;
  containerId: string;
  status: string;
  image: string;
  createdAt: string;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);
}

function containerName(namespaceId: string, name: string): string {
  return `mentiko-${slugify(namespaceId)}-${slugify(name)}`;
}

function volumeName(namespaceId: string, name: string): string {
  return `mentiko-vol-${slugify(namespaceId)}-${slugify(name)}`;
}

function networkName(namespaceId: string): string {
  return `mentiko-net-${slugify(namespaceId)}`;
}

function run(cmd: string, args: string[]): string {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", timeout: 60_000 }).trim();
  } catch (err: unknown) {
    const e = err as { stderr?: Buffer | string; message?: string };
    throw new Error(e.stderr?.toString().trim() || e.message || String(err));
  }
}

// ── docker availability ───────────────────────────────────────────────────────

export function isDockerAvailable(): boolean {
  try {
    execSync("docker info --format '{{.ServerVersion}}'", {
      stdio: "pipe",
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

// ── network management ────────────────────────────────────────────────────────

function ensureNetwork(nsId: string): string {
  const net = networkName(nsId);
  try {
    // check if network exists
    run("docker", ["network", "inspect", net, "--format", "{{.Id}}"]);
  } catch {
    // create it
    run("docker", [
      "network", "create",
      "--driver", "bridge",
      "--label", "mentiko.namespace=" + nsId,
      "--label", "mentiko.managed=true",
      net,
    ]);
  }
  return net;
}

// ── volume management ─────────────────────────────────────────────────────────

function ensureVolume(nsId: string, name: string): string {
  const vol = volumeName(nsId, name);
  try {
    run("docker", ["volume", "inspect", vol, "--format", "{{.Name}}"]);
  } catch {
    run("docker", [
      "volume", "create",
      "--label", "mentiko.namespace=" + nsId,
      "--label", "mentiko.workspace=" + name,
      "--label", "mentiko.managed=true",
      vol,
    ]);
  }
  return vol;
}

// ── container status ──────────────────────────────────────────────────────────

function containerStatus(name: string): "running" | "stopped" | "not_found" {
  try {
    const status = run("docker", [
      "inspect", name,
      "--format", "{{.State.Status}}",
    ]);
    return status === "running" ? "running" : "stopped";
  } catch {
    return "not_found";
  }
}

// ── provision ─────────────────────────────────────────────────────────────────

const DEFAULT_IMAGE = "ubuntu:22.04";
const BOOTSTRAP_SCRIPT = `#!/bin/bash
set -e
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git curl jq build-essential nodejs npm 2>/dev/null
npm install -g @anthropic-ai/claude-code 2>/dev/null || true
mkdir -p /workspace
echo "mentiko bootstrap complete" >> /var/log/mentiko-boot.log
`;

export async function provisionContainer(
  opts: DockerProvisionOptions
): Promise<DockerContainerInfo> {
  if (!isDockerAvailable()) {
    throw new Error("Docker daemon not available. Is Docker running?");
  }

  const name = opts.name;
  const nsId = opts.namespaceId;
  const image = opts.image || DEFAULT_IMAGE;
  const wPath = opts.workspacePath || "/workspace";
  const mem = opts.memoryLimit || "4g";
  const cpu = opts.cpuLimit || "2";
  const cName = containerName(nsId, name);
  const vol = ensureVolume(nsId, name);
  const net = ensureNetwork(nsId);

  // check if already running
  const existingStatus = containerStatus(cName);
  if (existingStatus === "running") {
    return getContainerInfo(nsId, name);
  }

  // remove stopped container if it exists so we can recreate
  if (existingStatus === "stopped") {
    run("docker", ["rm", cName]);
  }

  // pull image if not present (best-effort, don't fail if offline)
  try {
    run("docker", ["image", "inspect", image, "--format", "{{.Id}}"]);
  } catch {
    run("docker", ["pull", image]);
  }

  // build env flags
  const envFlags: string[] = [];
  if (opts.env) {
    for (const [k, v] of Object.entries(opts.env)) {
      envFlags.push("-e", `${k}=${v}`);
    }
  }

  // run container
  const args = [
    "run", "-d",
    "--name", cName,
    "--network", net,
    "--memory", mem,
    "--cpus", cpu,
    "--volume", `${vol}:${wPath}`,
    "--workdir", wPath,
    "--restart", "unless-stopped",
    "--label", "mentiko.managed=true",
    "--label", `mentiko.namespace=${nsId}`,
    "--label", `mentiko.workspace=${name}`,
    ...envFlags,
    image,
    "sleep", "infinity",
  ];

  run("docker", args);

  // bootstrap the container (install deps)
  try {
    run("docker", [
      "exec", cName,
      "bash", "-c", BOOTSTRAP_SCRIPT,
    ]);
  } catch {
    // bootstrap failure is non-fatal — container is running, deps just might not be installed
  }

  return getContainerInfo(nsId, name);
}

// ── get info ──────────────────────────────────────────────────────────────────

export function getContainerInfo(
  namespaceId: string,
  name: string
): DockerContainerInfo {
  const cName = containerName(namespaceId, name);
  const vol = volumeName(namespaceId, name);
  const net = networkName(namespaceId);
  const status = containerStatus(cName);

  let containerId = "";
  let image = DEFAULT_IMAGE;
  let createdAt = new Date().toISOString();

  if (status !== "not_found") {
    try {
      const info = run("docker", [
        "inspect", cName,
        "--format", "{{.Id}}|{{.Config.Image}}|{{.Created}}",
      ]);
      const [id, img, created] = info.split("|");
      containerId = id?.slice(0, 12) || "";
      image = img || DEFAULT_IMAGE;
      createdAt = created || createdAt;
    } catch {
      // ignore inspect errors
    }
  }

  return {
    containerName: cName,
    volumeName: vol,
    networkName: net,
    containerId,
    workspacePath: "/workspace",
    image,
    status,
    createdAt,
  };
}

// ── list containers ───────────────────────────────────────────────────────────

export function listMentikoContainers(namespaceId?: string): DockerListEntry[] {
  try {
    const filter = namespaceId
      ? `--filter=label=mentiko.namespace=${namespaceId}`
      : "--filter=label=mentiko.managed=true";

    const out = run("docker", [
      "ps", "-a",
      filter,
      "--format", "{{.Names}}|{{.ID}}|{{.Status}}|{{.Image}}|{{.CreatedAt}}",
    ]);

    if (!out) return [];

    return out
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [cName, id, status, image, createdAt] = line.split("|");
        return {
          containerName: cName || "",
          containerId: id || "",
          status: status || "",
          image: image || "",
          createdAt: createdAt || "",
        };
      });
  } catch {
    return [];
  }
}

// ── stop / remove ─────────────────────────────────────────────────────────────

export async function stopContainer(namespaceId: string, name: string): Promise<void> {
  const cName = containerName(namespaceId, name);
  try {
    run("docker", ["stop", cName]);
  } catch {
    // already stopped
  }
}

export async function removeContainer(
  namespaceId: string,
  name: string,
  removeVolume = false
): Promise<void> {
  const cName = containerName(namespaceId, name);
  const vol = volumeName(namespaceId, name);

  try {
    run("docker", ["stop", cName]);
  } catch {
    // already stopped
  }
  try {
    run("docker", ["rm", cName]);
  } catch {
    // already removed
  }
  if (removeVolume) {
    try {
      run("docker", ["volume", "rm", vol]);
    } catch {
      // volume may not exist
    }
  }
}
