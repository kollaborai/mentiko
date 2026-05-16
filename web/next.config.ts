import path from "node:path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { withSentryConfig } from "@sentry/nextjs";

const withNextIntl = createNextIntlPlugin("./lib/i18n-request.ts");

const nextConfig: NextConfig = {
  output: "standalone",

  // version-skew protection: when a user has a tab open during a redeploy,
  // their cached chunks / server-action hashes are stale. with deploymentId set,
  // next.js stamps `?dpl=<id>` on static assets and emits x-deployment-id headers
  // on client nav; the client triggers a hard reload on mismatch instead of
  // showing "Failed to find Server Action" or chunk-load errors.
  // generateBuildId must match across all instances serving the same build.
  // both fall through to next's random id locally (where GIT_SHA is unset).
  // see: https://nextjs.org/docs/app/api-reference/config/next-config-js/deploymentId
  ...(process.env.GIT_SHA
    ? {
        deploymentId: process.env.GIT_SHA,
        generateBuildId: async () => process.env.GIT_SHA as string,
      }
    : {}),

  // pin workspace root to web/ — repo root also has a package.json (puppeteer in
  // devDeps) and there's a stray package-lock.json in $HOME, so Next.js otherwise
  // infers a parent dir as the workspace root and the resolver tries to load
  // tailwindcss from there (not web/node_modules).
  // turbopack.root: dev server (Next 16 defaults to turbopack)
  // outputFileTracingRoot: standalone build tracing
  turbopack: {
    root: path.resolve(__dirname),
  },
  outputFileTracingRoot: path.resolve(__dirname),

  // redirect renamed settings routes so old links don't 404
  async redirects() {
    return [
      {
        source: "/settings/agent-profiles",
        destination: "/settings/agent-configs",
        permanent: true,
      },
      {
        source: "/settings/agent-profiles/:path*",
        destination: "/settings/agent-configs/:path*",
        permanent: true,
      },
      {
        source: "/dashboard/profiles",
        destination: "/dashboard/performance",
        permanent: true,
      },
      {
        source: "/dashboard/profiles/:path*",
        destination: "/dashboard/performance/:path*",
        permanent: true,
      },
    ];
  },

  // allow web-proxy responses to be framed (overrides middleware security headers)
  async headers() {
    return [
      {
        source: "/api/system/web-proxy",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
        ],
      },
    ];
  },

  // native/optional packages that must not be bundled by webpack
  // nodemailer: optional email dep — dynamic import inside try-catch in email.ts,
  //   webpack can't resolve it at compile time so we mark it external
  serverExternalPackages: ["better-sqlite3", "better-sqlite3-multiple-ciphers", "nodemailer"],

  // enable production source maps for debugging
  productionBrowserSourceMaps: false,

  // experimental optimizations
  experimental: {
    // Next 16.2.x enables Turbopack's dev filesystem cache by default. In this
    // app the root shell references large optional surfaces (terminal, code,
    // app panels, markdown), and the persistent cache can grow into tens of GB
    // during long dev sessions. Keep dev caching in memory so .next/dev does not
    // become the local disk and heap offender.
    turbopackFileSystemCacheForDev: false,
    turbopackSourceMaps: false,
    turbopackInputSourceMaps: false,
    optimizePackageImports: [
      "@aliimam/icons",
      "@aliimam/logos",
      "@aliimam/vectors",
      "@xyflow/react",
      "lucide-react",
      "radix-ui",
    ],
    serverActions: {
      bodySizeLimit: "2gb",
    },
  },

  // webpack config for bundle analysis
  webpack: (config, { dev, isServer }) => {
    // ignore runtime data dirs — sqlite WAL writes and namespace files
    // must not trigger HMR rebuilds (causes infinite rebuild loop)
    config.watchOptions = {
      ...config.watchOptions,
      ignored: [
        "**/web/data/**",
        "**/namespaces/**",
        "**/.next/**",
        "**/node_modules/**",
      ],
    };

    if (!isServer) {
      config.resolve = config.resolve || {};
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
      };
    }

    if (dev) {
      config.devtool = false;
    }

    // bundle analyzer
    if (process.env.ANALYZE === "true") {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { BundleAnalyzerPlugin } = require("@next/bundle-analyzer")();
      config.plugins.push(
        new BundleAnalyzerPlugin({
          analyzerMode: "static",
          reportFilename: "./analyze.html",
          openAnalyzer: false,
        })
      );
    }

    return config;
  },
};

const withIntl = withNextIntl(nextConfig);

// only apply Sentry instrumentation if SENTRY_DSN is configured.
// withSentryConfig adds source-map uploads and wraps the build.
export default process.env.SENTRY_DSN
  ? withSentryConfig(withIntl, {
      org: process.env.SENTRY_ORG || "mentiko",
      project: process.env.SENTRY_PROJECT || "web",
      // disable telemetry
      telemetry: false,
      // suppress noisy build output
      silent: true,
      // upload source maps for readable stack traces
      sourcemaps: {
        deleteSourcemapsAfterUpload: true,
      },
      // auto-instrument common routes + API routes
      autoInstrumentServerFunctions: true,
      autoInstrumentMiddleware: true,
    })
  : withIntl;
