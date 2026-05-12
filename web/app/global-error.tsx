"use client";

import { useEffect } from "react";

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

// stale-deploy safety net: deploymentId already triggers a hard reload on most
// navigation mismatches, but a user mid-action (server action invocation, chunk
// import) when the redeploy lands can still hit one of these errors. force a
// reload so they pick up the new build instead of being stuck on this screen.
const STALE_DEPLOY_ERROR =
  /ChunkLoadError|Loading chunk|Failed to find Server Action|deployment changed/i;

export default function GlobalError({ error, reset }: ErrorProps) {
  useEffect(() => {
    console.error("[global error]", error);
    if (STALE_DEPLOY_ERROR.test(String(error?.message ?? ""))) {
      window.location.reload();
    }
  }, [error]);

  return (
    <html>
      <body style={{ margin: 0, background: "#000", color: "#fff", fontFamily: "sans-serif" }}>
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
          <div style={{ textAlign: "center", maxWidth: "360px" }}>
            <p style={{ fontSize: "4rem", fontWeight: "bold", opacity: 0.1, margin: "0 0 1rem" }}>500</p>
            <h1 style={{ fontSize: "1.1rem", fontWeight: 600, margin: "0 0 0.5rem" }}>Critical error</h1>
            <p style={{ fontSize: "0.875rem", color: "#888", margin: "0 0 1.5rem" }}>
              The app crashed. Please reload or contact support.
              {error.digest && (
                <span style={{ display: "block", marginTop: "0.25rem", fontFamily: "monospace", fontSize: "0.75rem", color: "#555" }}>
                  ref: {error.digest}
                </span>
              )}
            </p>
            <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center" }}>
              <button
                onClick={reset}
                style={{ padding: "0.5rem 1rem", borderRadius: "6px", background: "#fff", color: "#000", border: "none", cursor: "pointer", fontSize: "0.875rem" }}
              >
                Try again
              </button>
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a
                href="/"
                style={{ padding: "0.5rem 1rem", borderRadius: "6px", background: "#333", color: "#fff", textDecoration: "none", fontSize: "0.875rem" }}
              >
                Go home
              </a>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
