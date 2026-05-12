import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    release: process.env.COMMIT_SHA || undefined,

    // sample 20% of transactions in production
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.2 : 1.0,

    // don't send errors when not in production unless DSN is explicitly set
    enabled: !!dsn,
  });
}
