// analytics abstraction layer
// supports ga4 and plausible with unified api

type AnalyticsProvider = "ga4" | "plausible" | "none";

export interface AnalyticsConfig {
  provider: AnalyticsProvider;
  ga4MeasurementId?: string;
  plausibleDomain?: string;
  plausibleUrl?: string;
  disabled?: boolean;
  debug?: boolean;
}

export interface AnalyticsEvent {
  name: string;
  params?: Record<string, string | number | boolean | undefined>;
}

export interface PageViewOptions {
  title?: string;
  referrer?: string;
  customDimensions?: Record<string, string>;
}

export interface UserFlowOptions {
  flowName: string;
  stepName: string;
  stepNumber?: number;
  totalSteps?: number;
}

// analytics config (loaded from env)
function getConfig(): AnalyticsConfig {
  if (typeof window === "undefined") {
    return { provider: "none" };
  }

  return {
    provider: (process.env.NEXT_PUBLIC_ANALYTICS_PROVIDER as AnalyticsProvider) || "none",
    ga4MeasurementId: process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID,
    plausibleDomain: process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN,
    plausibleUrl: process.env.NEXT_PUBLIC_PLAUSIBLE_URL,
    disabled: process.env.NODE_ENV === "development" && !process.env.NEXT_PUBLIC_ANALYTICS_DEBUG,
    debug: process.env.NEXT_PUBLIC_ANALYTICS_DEBUG === "true",
  };
}

// ga4 implementation
class Ga4Analytics {
  private measurementId: string;
  private debug: boolean;

  constructor(measurementId: string, debug = false) {
    this.measurementId = measurementId;
    this.debug = debug;
  }

  init(): void {
    if (typeof window === "undefined" || !window.gtag) return;

    window.gtag("js", new Date());
    window.gtag("config", this.measurementId, {
      send_page_view: false, // we'll handle manually
      debug_mode: this.debug,
    });
  }

  pageView(path: string, options: PageViewOptions = {}): void {
    if (typeof window === "undefined" || !window.gtag) return;

    window.gtag("event", "page_view", {
      page_title: options.title || document.title,
      page_location: window.location.href,
      page_path: path,
      ...options.customDimensions,
    });
  }

  track(event: AnalyticsEvent): void {
    if (typeof window === "undefined" || !window.gtag) return;

    window.gtag("event", event.name, event.params);
  }

  userFlow(options: UserFlowOptions): void {
    if (typeof window === "undefined" || !window.gtag) return;

    window.gtag("event", "user_flow_step", {
      flow_name: options.flowName,
      step_name: options.stepName,
      step_number: options.stepNumber,
      total_steps: options.totalSteps,
    });
  }

  setUserId(id: string): void {
    if (typeof window === "undefined" || !window.gtag) return;

    window.gtag("set", "user_id", id);
  }

  setCustomDimension(key: string, value: string): void {
    if (typeof window === "undefined" || !window.gtag) return;

    window.gtag("set", key, value);
  }
}

// plausible implementation
class PlausibleAnalytics {
  private domain: string;
  private api_url: string;
  private debug: boolean;

  constructor(domain: string, apiUrl = "https://plausible.io/api/event", debug = false) {
    this.domain = domain;
    this.api_url = apiUrl;
    this.debug = debug;
  }

  init(): void {
    // plausible uses script-based init, no manual init needed
  }

  pageView(path: string, options: PageViewOptions = {}): void {
    if (typeof window === "undefined") return;

    const payload = {
      name: "pageview",
      url: `${window.location.origin}${path}`,
      domain: this.domain,
      referrer: options.referrer || document.referrer,
      props: options.customDimensions,
    };

    this.send(payload);
  }

  track(event: AnalyticsEvent): void {
    if (typeof window === "undefined") return;

    const payload = {
      name: event.name,
      url: window.location.href,
      domain: this.domain,
      props: event.params,
    };

    this.send(payload);
  }

  userFlow(options: UserFlowOptions): void {
    if (typeof window === "undefined") return;

    const payload = {
      name: "user_flow_step",
      url: window.location.href,
      domain: this.domain,
      props: {
        flow_name: options.flowName,
        step_name: options.stepName,
        step_number: options.stepNumber,
        total_steps: options.totalSteps,
      },
    };

    this.send(payload);
  }

  setUserId(_id: string): void {
    // plausible doesn't support user id directly
    // use custom props instead
  }

  setCustomDimension(_key: string, _value: string): void {
    // plausible uses props per event, not global dimensions
  }

  private send(payload: unknown): void {
    if (this.debug) {
      console.log("[plausible]", payload);
      return;
    }

    fetch(this.api_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }).catch(() => {
      // silently fail - analytics shouldn't break the app
    });
  }
}

// no-op implementation
class NoOpAnalytics {
  init(): void {}
  pageView(_path: string, _options?: PageViewOptions): void {}
  track(_event: AnalyticsEvent): void {}
  userFlow(_options: UserFlowOptions): void {}
  setUserId(_id: string): void {}
  setCustomDimension(_key: string, _value: string): void {}
}

// unified analytics interface
let analyticsInstance: ReturnType<typeof createAnalytics> | null = null;

function createAnalytics() {
  const config = getConfig();

  if (config.disabled || config.provider === "none") {
    return new NoOpAnalytics();
  }

  switch (config.provider) {
    case "ga4":
      if (!config.ga4MeasurementId) {
        console.warn("ga4 provider specified but no measurement id configured");
        return new NoOpAnalytics();
      }
      return new Ga4Analytics(config.ga4MeasurementId, config.debug);

    case "plausible":
      if (!config.plausibleDomain) {
        console.warn("plausible provider specified but no domain configured");
        return new NoOpAnalytics();
      }
      return new PlausibleAnalytics(
        config.plausibleDomain,
        config.plausibleUrl,
        config.debug
      );

    default:
      return new NoOpAnalytics();
  }
}

function getAnalytics() {
  if (!analyticsInstance) {
    analyticsInstance = createAnalytics();
  }
  return analyticsInstance;
}

// public api
export const analytics = {
  // initialize analytics (call once on app load)
  init: () => {
    getAnalytics().init();
  },

  // track page view
  pageView: (path: string, options?: PageViewOptions) => {
    getAnalytics().pageView(path, options);
  },

  // track custom event
  track: (event: AnalyticsEvent) => {
    getAnalytics().track(event);
  },

  // track user flow step
  userFlow: (options: UserFlowOptions) => {
    getAnalytics().userFlow(options);
  },

  // set user id for cross-session tracking
  setUserId: (id: string) => {
    getAnalytics().setUserId(id);
  },

  // set custom dimension/metric
  setCustomDimension: (key: string, value: string) => {
    getAnalytics().setCustomDimension(key, value);
  },
};

// react hook for analytics
export function useAnalytics() {
  return analytics;
}

// hook for tracking user flows
export function useUserFlow(flowName: string, totalSteps: number) {
  return {
    trackStep: (stepName: string, stepNumber: number) => {
      analytics.userFlow({
        flowName,
        stepName,
        stepNumber,
        totalSteps,
      });
    },
  };
}

// type declarations for gtag
declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
  }
}
