/**
 * platform version endpoint. public, no auth required.
 * returns build commit, build time, node version, uptime.
 * used by: control plane monitoring, settings/system page, external health checks.
 */

import { NextResponse } from "next/server";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

export const dynamic = "force-dynamic";

let cachedVersion: { version: string; commit: string; builtAt: string; repo: string } | null = null;

function loadVersion() {
  if (cachedVersion) return cachedVersion;

  // try /app/version.json (baked into tenant image by assemble-platform-context.sh)
  const paths = [
    join(process.cwd(), "version.json"),
    "/app/version.json",
  ];

  for (const p of paths) {
    if (existsSync(p)) {
      try {
        const data = JSON.parse(readFileSync(p, "utf-8"));
        cachedVersion = {
          version: data.version || "unknown",
          commit: data.commit || "unknown",
          builtAt: data.builtAt || "unknown",
          repo: data.repo || "unknown",
        };
        return cachedVersion;
      } catch {
        // invalid json, try next path
      }
    }
  }

  return { version: "unknown", commit: "unknown", builtAt: "unknown", repo: "unknown" };
}

export async function GET() {
  const version = loadVersion();

  return NextResponse.json(
    {
      version: version.version,
      commit: version.commit,
      buildTime: version.builtAt,
      nodeVersion: process.version,
      uptime: Math.floor(process.uptime()),
      environment: process.env.NODE_ENV || "development",
    },
    {
      headers: { "Cache-Control": "no-store" },
    },
  );
}
