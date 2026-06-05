// shell.ts - safe shell command execution + utility functions

import { execSync } from "child_process";
import {
  sanitizeChainId,
  sanitizePath,
  truncate,
} from "../auth/security";
import { pty } from "../pty/pty-client";

const MAX_CHAIN_ID = 128;
const MAX_PATH_LENGTH = 256;

// get process start time
export function getProcessStartTime(pid: number): string | null {
  if (!Number.isInteger(pid) || pid <= 0 || pid > 2_147_483_647) {
    return null;
  }

  try {
    return execSync(`ps -o lstart= -p ${pid} 2>/dev/null`, {
      encoding: "utf-8",
      timeout: 1000,
    }).trim();
  } catch {
    return null;
  }
}

// read file safely (prevent path traversal)
export function safeReadFile(path: string): string | null {
  const sanitized = sanitizePath(truncate(path, MAX_PATH_LENGTH));

  if (sanitized.startsWith("/") || sanitized.includes("..")) {
    throw new Error("Invalid path");
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const config = require("./config").config;
    const basePath = config.codeRoot;
    const fullPath = `${basePath}/${sanitized}`;

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const resolved = require("path").resolve(fullPath);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const resolvedBase = require("path").resolve(basePath);

    if (!resolved.startsWith(resolvedBase)) {
      throw new Error("Path traversal detected");
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("fs").readFileSync(resolved, "utf-8");
  } catch {
    return null;
  }
}

// validate chain id before using in commands
export function validateChainId(id: string): string {
  const sanitized = sanitizeChainId(truncate(id, MAX_CHAIN_ID));

  if (!/^[a-zA-Z0-9\-_]+$/.test(sanitized)) {
    throw new Error("Invalid chain ID format");
  }

  return sanitized;
}

// re-export pty for convenience
export { pty };
