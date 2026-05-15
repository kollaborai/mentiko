// analytics script injection and provider
// handles ga4 and plausible script loading

"use client";

interface Gtag {
  (...args: unknown[]): void;
}

import { Suspense, useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { analytics } from "@/lib/analytics";

// ga4 script loader
function loadGa4(measurementId: string): void {
  if (typeof window === "undefined" || window.gtag) return;

  const dl = window.dataLayer || ([] as unknown[]);
  window.dataLayer = dl;
  window.gtag = function gtag(...args: unknown[]) {
    dl.push(args);
  } as Gtag;

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
  document.head.appendChild(script);
}

// plausible script loader
function loadPlausible(domain: string, apiUrl?: string): void {
  if (typeof window === "undefined") return;

  const script = document.createElement("script");
  script.async = true;
  script.defer = true;
  script.dataset.domain = domain;

  if (apiUrl) {
    script.setAttribute("data-api-url", apiUrl);
  }

  script.src = apiUrl
    ? `${apiUrl}/js/plausible.js`
    : "https://plausible.io/js/plausible.js";

  document.head.appendChild(script);
}

function AnalyticsScripts() {
  const provider = process.env.NEXT_PUBLIC_ANALYTICS_PROVIDER;

  useEffect(() => {
    if (provider === "ga4") {
      const measurementId = process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID;
      if (measurementId) loadGa4(measurementId);
    } else if (provider === "plausible") {
      const domain = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN;
      if (domain) loadPlausible(domain);
    }

    // initialize analytics
    analytics.init();
  }, [provider]);

  return null;
}

// tracks page views on route changes
function PageViewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    const path = pathname + (searchParams.toString() ? `?${searchParams.toString()}` : "");
    analytics.pageView(path);
  }, [pathname, searchParams]);

  return null;
}

// combined provider component
function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AnalyticsScripts />
      <Suspense fallback={null}>
        <PageViewTracker />
      </Suspense>
      {children}
    </>
  );
}
