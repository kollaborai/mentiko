import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { AgentDefinition } from "./agent-loader";

/**
 * Known CLI tool skill locations.
 * Each entry maps a tool name to where it stores skills.
 */
interface SkillSource {
  tool: string;
  label: string;
  paths: string[];
}

function expandHome(p: string): string {
  if (p.startsWith("~")) return join(homedir(), p.slice(1));
  return p;
}

/**
 * Get all known skill source locations.
 * Checks both global and project-local paths.
 */
export function getSkillSources(projectRoot?: string): SkillSource[] {
  const sources: SkillSource[] = [
    {
      tool: "claude-code",
      label: "Claude Code (global)",
      paths: ["~/.claude/skills"],
    },
  ];

  if (projectRoot) {
    sources.push({
      tool: "claude-code",
      label: "Claude Code (project)",
      paths: [join(projectRoot, ".claude/skills")],
    });
  }

  // future: add codex, aider, etc.
  // {
  //   tool: "codex",
  //   label: "Codex",
  //   paths: ["~/.codex/skills"],
  // },

  return sources;
}

export interface ScannedSkill {
  id: string;
  name: string;
  description: string;
  prompt: string;
  allowedTools: string[];
  tool: string;
  path: string;
  version?: string;
  author?: string;
}

/**
 * Parse a SKILL.md file with YAML frontmatter + markdown body.
 */
function parseSkillFile(content: string): {
  frontmatter: Record<string, string>;
  body: string;
} {
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!fmMatch) {
    return { frontmatter: {}, body: content };
  }

  const frontmatter: Record<string, string> = {};
  const fmLines = fmMatch[1].split("\n");
  let currentKey = "";
  let currentVal = "";

  for (const line of fmLines) {
    const kvMatch = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (kvMatch) {
      if (currentKey) frontmatter[currentKey] = currentVal.trim();
      currentKey = kvMatch[1];
      currentVal = kvMatch[2];
      // handle multi-line YAML values starting with >
      if (currentVal === ">") currentVal = "";
    } else if (currentKey && line.match(/^\s/)) {
      currentVal += " " + line.trim();
    }
  }
  if (currentKey) frontmatter[currentKey] = currentVal.trim();

  return { frontmatter, body: fmMatch[2].trim() };
}

/**
 * Scan a single skill directory and return the parsed skill.
 */
function scanSkillDir(
  skillDir: string,
  tool: string
): ScannedSkill | null {
  const skillFile = join(skillDir, "SKILL.md");
  if (!existsSync(skillFile)) return null;

  try {
    const content = readFileSync(skillFile, "utf-8");
    const { frontmatter, body } = parseSkillFile(content);

    const name = frontmatter.name || "";
    if (!name) return null;

    const allowedToolsRaw = frontmatter["allowed-tools"] || "";
    const allowedTools = allowedToolsRaw
      .split(",")
      .map((t) => t.trim().replace(/"/g, ""))
      .filter(Boolean);

    return {
      id: name.toLowerCase().replace(/\s+/g, "-"),
      name,
      description: frontmatter.description || "",
      prompt: body,
      allowedTools,
      tool,
      path: skillFile,
      version: frontmatter.version,
      author: frontmatter.author,
    };
  } catch {
    return null;
  }
}

/**
 * Scan all known skill sources and return discovered skills.
 */
export function scanAllSkills(projectRoot?: string): ScannedSkill[] {
  const sources = getSkillSources(projectRoot);
  const skills: ScannedSkill[] = [];
  const seen = new Set<string>();

  for (const source of sources) {
    for (const rawPath of source.paths) {
      const dir = expandHome(rawPath);
      if (!existsSync(dir)) continue;

      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;

          const skill = scanSkillDir(join(dir, entry.name), source.tool);
          if (skill && !seen.has(skill.id)) {
            seen.add(skill.id);
            skills.push(skill);
          }
        }
      } catch {
        // dir unreadable
      }
    }
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Convert a scanned skill to an agent definition.
 */
export function skillToAgent(skill: ScannedSkill): AgentDefinition {
  return {
    id: skill.id,
    name: skill.name
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" "),
    description: skill.description,
    role: skill.name,
    version: skill.version || "1.0.0",
    prompt: skill.prompt,
    triggers: ["manual-start"],
    emits: `${skill.id}-complete`,
    tools: skill.allowedTools,
    source_skill: {
      tool: skill.tool,
      path: skill.path,
      last_synced: new Date().toISOString(),
    },
  };
}
