import { spawn, type ChildProcess } from "node:child_process";

export interface DetachedDirectRunInput {
  runtimePath: string;
  chainPath: string;
  workspacePath?: string;
  env: NodeJS.ProcessEnv;
}

/** The only schedule launch boundary: Node executes the compiled typed owner directly. */
export function launchDetachedDirectRun(input: DetachedDirectRunInput): ChildProcess {
  const args = [input.runtimePath, input.chainPath];
  if (input.workspacePath) args.push("--workspace", input.workspacePath);
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: "ignore",
    env: input.env,
  });
  child.unref();
  return child;
}
