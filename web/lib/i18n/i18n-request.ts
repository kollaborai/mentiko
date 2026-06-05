import { getRequestConfig } from "next-intl/server";
import { locales, defaultLocale, type Locale } from "./i18n";

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;

  if (!locale || !locales.includes(locale as Locale)) {
    locale = defaultLocale;
  }

  // messages files may not exist (translations are handled by lib/i18n.ts
  // with embedded translation maps, not external JSON files).
  // gracefully fall back to empty messages to avoid crashing page renders.
  let messages = {};
  try {
    messages = (await import(`../messages/${locale}.json`)).default;
  } catch {
    // messages directory doesn't exist - this is expected on VPS deployments
  }

  return {
    locale,
    messages,
  };
});
