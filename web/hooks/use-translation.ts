import { useLocaleStore } from "@/lib/i18n/locale-store";
import { t, tParams } from "@/lib/i18n/i18n";
import { useMemo } from "react";

export function useTranslations() {
  const locale = useLocaleStore((state) => state.locale);

  return useMemo(
    () => ({
      locale,
      t: (key: string, params?: Record<string, string | number>) =>
        params ? tParams(key, params, locale) : t(key, locale),
    }),
    [locale]
  );
}
