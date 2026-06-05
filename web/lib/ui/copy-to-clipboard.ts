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
