const SAFE_CRON_RE = /^[A-Za-z0-9*,/\-?#LW\s]+$/;
const SAFE_TIMEZONE_RE = /^[A-Za-z0-9_+\-/.]{1,128}$/;

export function normalizeCronExpression(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("cron expression must be a string");
  }

  const cron = value.trim().replace(/\s+/g, " ");
  if (!cron) throw new Error("cron expression required");
  if (cron.length > 200) throw new Error("cron expression is too long");
  if (cron.includes("\0") || cron.includes("\n") || cron.includes("\r")) {
    throw new Error("cron expression contains invalid characters");
  }
  if (!SAFE_CRON_RE.test(cron)) {
    throw new Error("cron expression contains invalid characters");
  }

  const parts = cron.split(/\s+/);
  if (parts.length < 5 || parts.length > 6) {
    throw new Error("cron expression must have 5 or 6 fields");
  }

  return cron;
}

export function isSafeCronExpression(value: unknown): boolean {
  try {
    normalizeCronExpression(value);
    return true;
  } catch {
    return false;
  }
}

export function normalizeTimezone(value: unknown, fallback = "UTC"): string {
  const timezone = typeof value === "string" && value.trim() ? value.trim() : fallback;
  if (!SAFE_TIMEZONE_RE.test(timezone)) {
    throw new Error("timezone contains invalid characters");
  }
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
  } catch {
    throw new Error("invalid timezone");
  }
  return timezone;
}
