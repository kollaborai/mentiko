/**
 * next.js instrumentation hook.
 *
 * this file is evaluated in BOTH node and edge runtimes.
 * it must not import any node-only modules (fs, path, child_process,
 * better-auth, better-sqlite3, etc.) at top level or via static imports.
 *
 * all node-only startup work lives in instrumentation.node.ts and is
 * loaded via dynamic import ONLY when running in the node runtime.
 *
 * DO NOT inline the node code back into this file. the previous attempt
 * to do that (to work around turbopack stripping the dynamic import)
 * broke the edge/node runtime boundary and caused better-auth to fail
 * in production with "You are using the default secret" errors.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const mod = await import("./instrumentation.node");
    await mod.register();
  }
}
