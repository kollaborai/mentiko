import { readFileSync } from "fs";
import { withRunJsonLock, writeRunJsonAtomic } from "@/lib/runs/run-json-lock";
import { clearIdleIncidentOnActivity } from "@/lib/runs/idle-incident";
import type { RunRecord } from "@/lib/runs/run-record";

/** Update a legacy run shape without replacing changes committed by another writer. */
export function mutateExistingRunJson<T>(path: string, mutate: (run: T) => T): T {
  return withRunJsonLock(path, () => {
    const before: T = JSON.parse(readFileSync(path, "utf8"));
    const next = mutate(structuredClone(before));
    const result = clearIdleIncidentOnActivity(before as RunRecord, next as RunRecord) as T;
    writeRunJsonAtomic(path, result);
    return result;
  });
}

/** Fail closed when a previously read snapshot changed during asynchronous work. */
export function commitRunJsonSnapshot<T>(path: string, before: T, next: T): boolean {
  return withRunJsonLock(path, () => {
    const current = JSON.parse(readFileSync(path, "utf8"));
    if (JSON.stringify(current) !== JSON.stringify(before)) return false;
    const result = clearIdleIncidentOnActivity(current as RunRecord, next as RunRecord);
    writeRunJsonAtomic(path, result);
    return true;
  });
}
