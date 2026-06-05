import { execFileSync } from "child_process";
import { normalizeCronExpression } from "./cron-validation";

const CRONITER_SCRIPT = `
from datetime import datetime
from croniter import croniter
import sys

cron_expr = sys.argv[1]
if len(sys.argv) > 2:
    base = datetime.fromtimestamp(int(sys.argv[2]) / 1000)
else:
    base = datetime.now()

iterator = croniter(cron_expr, base)
print(iterator.get_next(datetime).isoformat())
`;

interface CalculateCronNextRunOptions {
  afterMs?: number;
  timeoutMs?: number;
}

export function calculateCronNextRun(
  cron: string,
  { afterMs, timeoutMs = 2000 }: CalculateCronNextRunOptions = {},
): string | null {
  const safeCron = normalizeCronExpression(cron);
  const args = ["-c", CRONITER_SCRIPT, safeCron];
  if (afterMs !== undefined) {
    if (!Number.isFinite(afterMs) || afterMs < 0) return null;
    args.push(String(Math.floor(afterMs)));
  }

  try {
    const result = execFileSync("python3", args, {
      encoding: "utf-8",
      timeout: timeoutMs,
      shell: false,
    });
    return result.trim() || null;
  } catch {
    return null;
  }
}
