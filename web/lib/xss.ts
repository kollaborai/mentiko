// xss prevention utilities

// basic html escaping (for when dompurify is not available)
export function escapeHtml(unsafe: string): string {
  if (!unsafe) return "";
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// escape javascript string
export function escapeJs(unsafe: string): string {
  if (!unsafe) return "";
  return unsafe.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/"/g, '\\"');
}

// escape url parameter
export function escapeUrl(unsafe: string): string {
  if (!unsafe) return "";
  return encodeURIComponent(unsafe);
}

// validate and sanitize html content
// for production, use dompurify: npm install dompurify @types/dompurify
export function sanitizeHtml(html: string, allowedTags: string[] = []): string {
  // strict mode: strip all html
  if (allowedTags.length === 0) {
    return html.replace(/<[^>]*>/g, "");
  }

  // permissive mode: allow specific tags (basic implementation)
  // for production, use dompurify with proper config
  const tagRegex = new RegExp(
    `<(?!\\/?(${allowedTags.join("|")})\\s*\/?>)[^>]+>`,
    "gi"
  );
  return html.replace(tagRegex, "");
}

// validate json structure (prevent json injection)
export function validateJson(json: string): boolean {
  try {
    const parsed = JSON.parse(json);
    // check for prototype pollution
    const str = JSON.stringify(parsed);
    if (str.includes("__proto__") || str.includes("constructor")) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

// safe attribute value for react/dom
export function safeAttr(value: string): string {
  return value.replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
}

// check for potential xss patterns
export function containsXssPatterns(input: string): boolean {
  const patterns = [
    /<script/i,
    /javascript:/i,
    /on\w+\s*=/i, // onclick=, onload=, etc
    /<iframe/i,
    /<object/i,
    /<embed/i,
    /<link/i,
    /style\s*=/i,
    /expression\s*\(/i, // css expression
  ];

  return patterns.some((pattern) => pattern.test(input));
}

// sanitize user input for display
export function sanitizeUserInput(input: string): string {
  if (!input) return "";
  return escapeHtml(input.trim());
}

// validate content-type header
export function isValidContentType(header: string | null): boolean {
  if (!header) return false;
  const validTypes = [
    "application/json",
    "text/plain",
    "multipart/form-data",
    "application/x-www-form-urlencoded",
  ];
  return validTypes.some((type) => header.includes(type));
}
