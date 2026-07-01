declare module "@sentry/nextjs" {
  type InitOptions = {
    beforeSend?: (event: any) => any;
    [key: string]: any;
  };

  export const init: (options: InitOptions) => void;
  export const withSentryConfig: <Config>(
    nextConfig: Config,
    sentryBuildOptions?: any
  ) => Config;
}
