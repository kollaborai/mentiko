const CODE_FENCE = "```";
const PROSE_BOUNDARY_RE = /([.!?]["')\]]?)(?=(?:\*\*)?["'“‘(]?[A-Z])/g;
const CHUNK_BOUNDARY_START_RE = /^(?:\*\*)?["'“‘(]?[A-Z]/;
const CHUNK_BOUNDARY_END_RE = /[.!?]["')\]]*$/;

function transformOutsideMarkdownCode(
  input: string,
  transform: (segment: string) => string,
): string {
  let output = "";
  let prose = "";
  let index = 0;

  const flushProse = () => {
    if (!prose) return;
    output += transform(prose);
    prose = "";
  };

  while (index < input.length) {
    if (input.startsWith(CODE_FENCE, index)) {
      flushProse();
      const end = input.indexOf(CODE_FENCE, index + CODE_FENCE.length);
      if (end === -1) {
        output += input.slice(index);
        break;
      }
      output += input.slice(index, end + CODE_FENCE.length);
      index = end + CODE_FENCE.length;
      continue;
    }

    if (input[index] === "`") {
      flushProse();
      const end = input.indexOf("`", index + 1);
      if (end === -1) {
        output += input.slice(index);
        break;
      }
      output += input.slice(index, end + 1);
      index = end + 1;
      continue;
    }

    prose += input[index];
    index += 1;
  }

  flushProse();
  return output;
}

function isInsideMarkdownCode(input: string): boolean {
  let inFence = false;
  let inInlineCode = false;
  let index = 0;

  while (index < input.length) {
    if (!inInlineCode && input.startsWith(CODE_FENCE, index)) {
      inFence = !inFence;
      index += CODE_FENCE.length;
      continue;
    }

    if (!inFence && input[index] === "`") {
      inInlineCode = !inInlineCode;
    }

    index += 1;
  }

  return inFence || inInlineCode;
}

export function repairAgentTextSpacing(text: string): string {
  return transformOutsideMarkdownCode(text, (segment) =>
    segment.replace(PROSE_BOUNDARY_RE, "$1 "),
  );
}

export function appendAgentDraftText(existing: string, chunk: string): string {
  if (!chunk) return existing;
  if (
    existing &&
    !isInsideMarkdownCode(existing) &&
    !/\s$/.test(existing) &&
    !/^\s/.test(chunk) &&
    CHUNK_BOUNDARY_END_RE.test(existing) &&
    CHUNK_BOUNDARY_START_RE.test(chunk)
  ) {
    return `${existing} ${chunk}`;
  }

  return existing + chunk;
}
