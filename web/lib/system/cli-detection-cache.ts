export interface CachedCliTool {
  name: string;
  found: boolean;
  version?: string;
  path?: string;
  authenticated?: boolean;
}

export interface CliDetectionCacheEntry {
  checkedAt: number;
  tools: CachedCliTool[];
}

let cachedDetection: CliDetectionCacheEntry | undefined;

export function readCliDetectionCache(): CliDetectionCacheEntry | undefined {
  return cachedDetection;
}

export function writeCliDetectionCache(entry: CliDetectionCacheEntry): void {
  cachedDetection = entry;
}

export function resetCliDetectionCacheForTests(): void {
  cachedDetection = undefined;
}
