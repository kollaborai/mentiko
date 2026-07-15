import { serializeRunnerEvent, type RunnerEventInput } from "@/lib/runner-v2/events";

export function runnerEventFixture(
  input: Omit<RunnerEventInput, "timestamp"> & { timestamp?: string; extensions?: Record<string, string> },
): string {
  const { extensions, timestamp, ...event } = input;
  const content = serializeRunnerEvent({
    ...event,
    timestamp: timestamp ?? "2026-07-14T12:00:00.000Z",
  });
  const extensionLines = Object.entries(extensions ?? {})
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
  return extensionLines ? `${content}${extensionLines}\n` : content;
}
