import { existsSync, readdirSync, rmSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import config from "@/lib/config";

export interface MarketplaceSyncResult {
  status: "cloned" | "synced" | "up-to-date" | "skipped";
  path: string;
  agents: number;
  templates: number;
  chains: number;
  artifacts: number;
  plugins: number;
  commit: string;
  duration: number;
}

function countDirs(dir: string): number {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).length;
}

function countFiles(dir: string, ext: string): number {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith(ext)).length;
}

export async function syncMarketplace(opts: {
  url?: string;
  force?: boolean;
  timeout?: number;
} = {}): Promise<MarketplaceSyncResult> {
  const start = Date.now();
  const marketplaceDir = join(config.globalRoot, "marketplace");

  const url =
    opts.url ||
    process.env.MARKETPLACE_URL ||
    "https://github.com/kollaborai/mentiko-marketplace";

  const timeout = opts.timeout ?? parseInt(process.env.MARKETPLACE_SYNC_TIMEOUT || "120000", 10);
  const force = opts.force ?? false;

  let status: MarketplaceSyncResult["status"];

  if (!existsSync(marketplaceDir) || force) {
    if (force && existsSync(marketplaceDir)) {
      rmSync(marketplaceDir, { recursive: true });
    }
    execSync(`git clone --depth 1 "${url}" "${marketplaceDir}"`, {
      timeout,
      stdio: "pipe",
    });
    status = "cloned";
  } else if (existsSync(join(marketplaceDir, ".git"))) {
    // marketplace is a read-only cache - nuke any local changes before pulling
    execSync(`git -C "${marketplaceDir}" reset --hard HEAD`, { timeout, stdio: "pipe" });
    execSync(`git -C "${marketplaceDir}" clean -fd`, { timeout, stdio: "pipe" });
    const pullOut = execSync(`git -C "${marketplaceDir}" pull origin main`, {
      timeout,
      stdio: "pipe",
    }).toString();
    status = pullOut.includes("Already up to date") ? "up-to-date" : "synced";
  } else {
    throw new Error(
      "marketplace/ exists but is not a git repo. Use force=true to re-clone."
    );
  }

  const agents = countDirs(join(marketplaceDir, "agents"));
  const templates = countDirs(join(marketplaceDir, "templates"));
  const chains = countDirs(join(marketplaceDir, "chains"));
  const artifacts = countFiles(join(marketplaceDir, "artifacts"), ".md");
  const plugins = countDirs(join(marketplaceDir, "plugins"));

  const commit = execSync(`git -C "${marketplaceDir}" rev-parse --short HEAD`, {
    stdio: "pipe",
  })
    .toString()
    .trim();

  return {
    status,
    path: marketplaceDir,
    agents,
    templates,
    chains,
    artifacts,
    plugins,
    commit,
    duration: Date.now() - start,
  };
}
