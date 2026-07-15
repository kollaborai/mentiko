export interface BackgroundWorkerShutdownState {
  signal: string;
  exitCode: number;
}

export interface BackgroundWorkerShutdownDependencies {
  stop(): void | Promise<void>;
  finalize(state: BackgroundWorkerShutdownState): void | Promise<void>;
  exit(exitCode: number): void;
  onError?(error: unknown): void;
}

export interface BackgroundWorkerShutdownController {
  request(signal: string, exitCode?: number): Promise<void>;
  isStopping(): boolean;
  exitCode(): number;
}

/**
 * Create one reentrant shutdown path. Later fatal requests can only raise the
 * latched exit code, and every caller observes the same in-flight promise.
 * Finalization is attempted even when service shutdown rejects.
 */
export function createBackgroundWorkerShutdown(
  dependencies: BackgroundWorkerShutdownDependencies,
): BackgroundWorkerShutdownController {
  let stopping = false;
  let requestedExitCode = 0;
  let requestedSignal = "shutdown";
  let shutdownPromise: Promise<void> | undefined;

  const latch = (signal: string, exitCode: number) => {
    if (exitCode >= requestedExitCode) requestedSignal = signal;
    requestedExitCode = Math.max(requestedExitCode, exitCode);
  };

  return {
    request(signal, exitCode = 0) {
      latch(signal, exitCode);
      if (shutdownPromise) return shutdownPromise;
      stopping = true;
      shutdownPromise = (async () => {
        try {
          await dependencies.stop();
        } catch (error) {
          latch("shutdownFailure", 1);
          dependencies.onError?.(error);
        }

        try {
          await dependencies.finalize({
            signal: requestedSignal,
            exitCode: requestedExitCode,
          });
        } catch (error) {
          latch("cleanupFailure", 1);
          dependencies.onError?.(error);
        } finally {
          dependencies.exit(requestedExitCode);
        }
      })();
      return shutdownPromise;
    },
    isStopping() {
      return stopping;
    },
    exitCode() {
      return requestedExitCode;
    },
  };
}
