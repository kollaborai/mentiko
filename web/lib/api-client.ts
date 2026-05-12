"use client";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function unwrapApiData<T>(payload: unknown): T {
  if (isRecord(payload)) {
    // reject API error responses instead of passing them through as data
    if ("success" in payload && payload.success === false) {
      const msg = isRecord(payload.error) && typeof payload.error.message === "string"
        ? payload.error.message
        : "API request failed";
      throw new Error(msg);
    }
    if ("data" in payload && payload.data !== undefined) {
      return payload.data as T;
    }
  }
  return payload as T;
}

export function getApiErrorMessage(payload: unknown, fallback: string): string {
  if (!isRecord(payload)) return fallback;

  if (typeof payload.error === "string") {
    return payload.error;
  }

  if (isRecord(payload.error) && typeof payload.error.message === "string") {
    return payload.error.message;
  }

  if (typeof payload.message === "string") {
    return payload.message;
  }

  return fallback;
}
