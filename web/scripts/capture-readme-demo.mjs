#!/usr/bin/env node

import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { chromium } from "@playwright/test";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(webRoot, "..");

const defaults = {
  baseUrl: "http://localhost:3017",
  out: path.join(repoRoot, "docs", "assets", "mentiko-demo.gif"),
  fps: 10,
  width: 960,
  framesPerPage: 18,
  seedShowcase: false,
};

function parseArgs(argv) {
  const args = { ...defaults };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === "--base-url" && next) {
      args.baseUrl = next;
      i += 1;
    } else if (arg === "--out" && next) {
      args.out = path.resolve(next);
      i += 1;
    } else if (arg === "--fps" && next) {
      args.fps = Number(next);
      i += 1;
    } else if (arg === "--width" && next) {
      args.width = Number(next);
      i += 1;
    } else if (arg === "--frames-per-page" && next) {
      args.framesPerPage = Number(next);
      i += 1;
    } else if (arg === "--seed-showcase") {
      args.seedShowcase = true;
    } else if (arg === "--help") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }

  return args;
}

function printHelp() {
  console.log(`Capture the README demo GIF from a running Mentiko browser runtime.

Usage:
  npm run demo:gif -- --base-url http://localhost:3017

Options:
  --base-url <url>          Running Mentiko app URL. Default: ${defaults.baseUrl}
  --out <path>              GIF output path. Default: ../docs/assets/mentiko-demo.gif
  --fps <number>            GIF frames per second. Default: ${defaults.fps}
  --width <number>          Output GIF width. Default: ${defaults.width}
  --frames-per-page <n>     Captured frames per page. Default: ${defaults.framesPerPage}
  --seed-showcase           Write a disposable showcase run under MENTIKO_GLOBAL_ROOT.

Local demo auth:
  For localhost captures, the script sends a throwaway session cookie and a
  bearer token. Start the app with BETTER_AUTH_SECRET=demo-secret-for-readme-gif
  or set MENTIKO_DEMO_AUTH_TOKEN to match your local demo server.

Recommended README capture:
  MENTIKO_GLOBAL_ROOT=/tmp/mentiko-readme-demo-root \\
    npm run demo:gif -- --base-url http://localhost:3017 --seed-showcase
`);
}

function localDemoToken(baseUrl) {
  const hostname = new URL(baseUrl).hostname;
  const isLocalhost = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  if (!isLocalhost) return process.env.MENTIKO_DEMO_AUTH_TOKEN || "";
  return process.env.MENTIKO_DEMO_AUTH_TOKEN || process.env.BETTER_AUTH_SECRET || "demo-secret-for-readme-gif";
}

function ensureFfmpeg() {
  const check = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
  if (check.status !== 0) {
    throw new Error("ffmpeg is required to render the GIF. Install ffmpeg, then rerun npm run demo:gif.");
  }
}

async function launchBrowser() {
  try {
    return await chromium.launch({ channel: "chrome", headless: true });
  } catch {
    return chromium.launch({ headless: true });
  }
}

async function waitForApp(page) {
  await page.waitForLoadState("domcontentloaded", { timeout: 15000 });
  await page.locator("main").waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(900);
}

async function hideDevOverlays(page) {
  await page.addStyleTag({
    content: `
      nextjs-portal,
      [aria-label="Open Next.js Dev Tools"],
      [data-nextjs-dev-tools-button] {
        display: none !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }
      #mentiko-capture-caption {
        position: fixed;
        left: 24px;
        right: auto;
        bottom: 22px;
        z-index: 2147483647;
        width: min(560px, calc(100vw - 48px));
        padding: 14px 16px 15px;
        border-radius: 10px;
        background: rgba(6, 6, 7, 0.88);
        border: 1px solid rgba(255, 255, 255, 0.14);
        box-shadow: 0 16px 40px rgba(0, 0, 0, 0.45);
        color: #fff;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        backdrop-filter: blur(14px);
      }
      #mentiko-capture-caption .eyebrow {
        margin-bottom: 5px;
        color: rgba(255, 255, 255, 0.55);
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.16em;
        text-transform: uppercase;
      }
      #mentiko-capture-caption .title {
        margin: 0;
        color: #fff;
        font-size: 22px;
        font-weight: 800;
        line-height: 1.05;
        letter-spacing: 0;
      }
      #mentiko-capture-caption .body {
        margin: 7px 0 0;
        color: rgba(255, 255, 255, 0.72);
        font-size: 13px;
        line-height: 1.35;
      }
    `,
  }).catch(() => {});
}

async function addCaption(page, item) {
  await page.evaluate(({ eyebrow, title, body }) => {
    document.querySelector("#mentiko-capture-caption")?.remove();
    const caption = document.createElement("div");
    caption.id = "mentiko-capture-caption";
    caption.innerHTML = `
      <div class="eyebrow">${eyebrow}</div>
      <p class="title">${title}</p>
      <p class="body">${body}</p>
    `;
    document.body.appendChild(caption);
  }, {
    eyebrow: item.eyebrow || "Mentiko",
    title: item.title,
    body: item.body,
  }).catch(() => {});
}

async function clickFirstText(page, text) {
  const target = page.getByText(text, { exact: true }).first();
  if (await target.count()) {
    await target.click({ timeout: 2500 }).catch(() => {});
    await page.waitForTimeout(500);
  }
}

async function runAction(page, action) {
  if (!action) return;

  if (action === "select-research-chain") {
    await clickFirstText(page, "Research & Write");
  } else if (action === "select-code-reviewer") {
    await clickFirstText(page, "Code Reviewer");
  }
}

async function capturePage(page, baseUrl, item, frameState) {
  await page.goto(new URL(item.path, baseUrl).toString(), { waitUntil: "domcontentloaded" });
  await waitForApp(page);
  await hideDevOverlays(page);
  await runAction(page, item.action);
  await hideDevOverlays(page);
  await addCaption(page, item);

  for (let i = 0; i < item.frames; i += 1) {
    if (item.scroll && i === Math.floor(item.frames / 2)) {
      await page.mouse.wheel(0, item.scroll);
      await page.waitForTimeout(250);
    }

    const file = path.join(frameState.dir, `frame-${String(frameState.count).padStart(4, "0")}.png`);
    await page.screenshot({ path: file, fullPage: false });
    frameState.count += 1;
    await page.waitForTimeout(100);
  }
}

async function seedShowcaseRun(args) {
  const globalRoot = process.env.MENTIKO_GLOBAL_ROOT || process.env.MENTIKO_ROOT;
  if (!globalRoot) {
    throw new Error("--seed-showcase requires MENTIKO_GLOBAL_ROOT or MENTIKO_ROOT to point at a disposable demo data root.");
  }

  const namespaceId = process.env.NAMESPACE_ID || "default";
  const runId = "run-readme-visible-workflow";
  const namespaceRoot = path.join(globalRoot, "namespaces", namespaceId);
  const runDir = path.join(namespaceRoot, "runs", runId);
  const artifactsDir = path.join(runDir, "artifacts");
  const now = Date.now();
  const started = new Date(now - 1000 * 60 * 13).toISOString();
  const completed = new Date(now - 1000 * 60 * 2).toISOString();
  const sessions = [
    "mentiko-code-review-coder-run-readme-visible-workflow",
    "mentiko-code-review-reviewer-run-readme-visible-workflow",
    "mentiko-code-review-approver-run-readme-visible-workflow",
  ];

  const run = {
    id: runId,
    chain: "Code Review",
    chainId: "code-review",
    goal: "Review a change, implement the highest-impact fix, and publish a QA summary.",
    started,
    completed,
    status: "complete",
    agents: [
      { id: "coder", name: "Coder", status: "complete", session: sessions[0] },
      { id: "reviewer", name: "Code Reviewer", status: "complete", session: sessions[1] },
      { id: "approver", name: "PR Approver", status: "complete", session: sessions[2] },
    ],
    sessions,
  };

  const summaries = {
    coder: {
      status: "complete",
      agentId: "coder",
      agentName: "Coder",
      runId,
      executiveSummary: "Implemented the requested workflow cleanup and left a concise change summary.",
      workCompleted: ["Updated route handling", "Added focused regression coverage", "Prepared implementation notes"],
      artifactsProduced: ["workspace/changes.md", "workspace/test-results.md"],
    },
    reviewer: {
      status: "complete",
      agentId: "reviewer",
      agentName: "Code Reviewer",
      runId,
      executiveSummary: "Reviewed the patch for correctness, release risk, and test coverage.",
      findings: ["No blocking regressions found", "Recommended one follow-up hardening task"],
      artifactsProduced: ["workspace/review.md"],
    },
    approver: {
      status: "complete",
      agentId: "approver",
      agentName: "PR Approver",
      runId,
      executiveSummary: "Approved the run and recorded the release handoff.",
      workCompleted: ["Verified agent outputs", "Confirmed artifacts", "Marked workflow ready"],
      artifactsProduced: ["workspace/approval.md"],
    },
  };

  await mkdir(artifactsDir, { recursive: true });
  await writeFile(path.join(runDir, "run.json"), JSON.stringify(run, null, 2));

  for (const [agentId, summary] of Object.entries(summaries)) {
    await writeFile(path.join(artifactsDir, `${agentId}-summary.json`), JSON.stringify(summary, null, 2));
    await writeFile(path.join(artifactsDir, `${agentId}-summary.md`), [
      `# ${summary.agentName}`,
      "",
      summary.executiveSummary,
      "",
      "## Highlights",
      ...((summary.workCompleted || summary.findings || []).map((item) => `- ${item}`)),
      "",
    ].join("\n"));
    await writeFile(path.join(artifactsDir, `${agentId}-output.txt`), [
      `$ mentiko agent ${agentId}`,
      "Loading workspace context...",
      "Running assigned work...",
      "Writing artifacts...",
      "AGENT_COMPLETE",
      "",
    ].join("\n"));
    await writeFile(path.join(artifactsDir, `${agentId}-files-changed.json`), JSON.stringify([
      { status: "modified", file: "workspace/review.md" },
      { status: "created", file: "workspace/approval.md" },
    ], null, 2));
  }

  console.log(`seeded showcase run ${runId} under ${runDir}`);
  return args;
}

function renderGif(framesDir, out, fps, width) {
  const filter = [
    `fps=${fps}`,
    `scale=${width}:-1:flags=lanczos`,
    "split[s0][s1]",
    "[s0]palettegen=max_colors=128:stats_mode=diff[p]",
    "[s1][p]paletteuse=dither=bayer:bayer_scale=3",
  ].join(",");

  const result = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-framerate",
      String(fps),
      "-i",
      path.join(framesDir, "frame-%04d.png"),
      "-vf",
      filter,
      "-loop",
      "0",
      out,
    ],
    { stdio: "inherit" },
  );

  if (result.status !== 0) {
    throw new Error("ffmpeg failed to render the README demo GIF.");
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  ensureFfmpeg();

  if (args.seedShowcase) {
    await seedShowcaseRun(args);
  }

  const baseUrl = new URL(args.baseUrl);
  const authToken = localDemoToken(baseUrl.toString());
  const framesDir = await mkdtemp(path.join(tmpdir(), "mentiko-readme-demo-"));
  const outPath = path.resolve(args.out);

  const browser = await launchBrowser();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
    extraHTTPHeaders: authToken
      ? {
          Authorization: `Bearer ${authToken}`,
          "x-namespace-id": "default",
          "x-org-id": "default",
        }
      : undefined,
  });

  await context.addCookies([
    {
      name: "better-auth.session_token",
      value: "readme-demo-session",
      domain: baseUrl.hostname,
      path: "/",
      sameSite: "Lax",
    },
  ]);

  await context.addInitScript(() => {
    localStorage.setItem("mentiko-onboarding-dismissed", "true");
    localStorage.setItem("user-preferences", JSON.stringify({ theme: "dark" }));
  });

  const page = await context.newPage();
  const story = [
    {
      path: "/chains",
      frames: args.framesPerPage + 4,
      eyebrow: "Chain Canvas",
      title: "Map agent work as a visible pipeline",
      body: "Agents, triggers, emitted events, and run controls stay on the same inspectable surface.",
    },
    {
      path: "/chains",
      frames: args.framesPerPage,
      action: "select-research-chain",
      eyebrow: "Explicit Handoffs",
      title: "Every handoff is an event you can see",
      body: "Research, writing, review, approval: the workflow shape is not buried in a hidden runtime.",
    },
    {
      path: "/agents",
      frames: args.framesPerPage,
      action: "select-code-reviewer",
      eyebrow: "Agent Library",
      title: "Reusable agents become a team library",
      body: "Prompts, roles, tools, and chain usage are managed as durable building blocks.",
    },
    ...(args.seedShowcase ? [{
      path: "/runs?runId=run-readme-visible-workflow",
      frames: args.framesPerPage + 2,
      eyebrow: "Run History",
      title: "Completed runs stay inspectable",
      body: "Each agent leaves sessions, summaries, artifacts, and status history behind for review.",
    }] : []),
    {
      path: "/docs/getting-started",
      frames: args.framesPerPage,
      eyebrow: "Self-Hosted Ops",
      title: "Terminal-native, documented, and operable",
      body: "The CLI, docs, API, and web app live together so teams can run this in the open.",
      scroll: 320,
    },
  ];

  const frameState = { dir: framesDir, count: 0 };

  try {
    for (const item of story) {
      console.log(`capturing ${item.path}`);
      await capturePage(page, baseUrl.toString(), item, frameState);
    }
  } finally {
    await browser.close();
  }

  await mkdir(path.dirname(outPath), { recursive: true });
  renderGif(framesDir, outPath, args.fps, args.width);

  if (!existsSync(outPath)) {
    throw new Error(`GIF was not created at ${outPath}`);
  }

  if (!process.env.KEEP_MENTIKO_DEMO_FRAMES) {
    await rm(framesDir, { recursive: true, force: true });
  }

  console.log(`wrote ${outPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
