export function cleanAiOutput(output) {
  return String(output || "")
    .replace(/```json\s*/g, "")
    .replace(/```\s*/g, "")
    .trim();
}

export function extractJsonCandidates(text) {
  const candidates = [];
  const source = String(text || "");
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }

    if (ch === "\"") {
      inString = true;
      continue;
    }

    if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }

    if (ch === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        candidates.push(source.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return candidates;
}

export function parseAiJsonOutput(output) {
  const cleaned = cleanAiOutput(output);
  try {
    return JSON.parse(cleaned);
  } catch {
    for (const candidate of extractJsonCandidates(cleaned).reverse()) {
      try {
        return JSON.parse(candidate);
      } catch {
        // Keep scanning. Tool transcripts often contain non-JSON code blocks first.
      }
    }
  }
  return null;
}
