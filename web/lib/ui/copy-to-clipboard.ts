/**
 * Safe clipboard write that works in non-secure contexts (HTTP, unfocused tab, SSR).
 * Uses Clipboard API when available, falls back to textarea + execCommand.
 */
export function copyToClipboard(text: string): void {
  if (fallbackCopy(text)) return;

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(text).catch(() => {});
  }
}

/** Uses a verifiable result for UI that must not claim a copy before it succeeds. */
export async function copyToClipboardWithResult(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the legacy path for blocked or unfocused contexts.
    }
  }

  return fallbackCopy(text);
}

function fallbackCopy(text: string): boolean {
  if (typeof document === 'undefined') return false;

  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(ta);
    return copied;
  } catch {
    return false;
  }
}
