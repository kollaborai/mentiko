import { execFile } from "child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";
import { createRunRecord, updateRunJson } from "@/lib/runner-v2/run-state";

function runWorker(workerPath: string, failureId: string, runJsonPath: string, stateDir: string): Promise<void> {
  const tsNode = resolve(process.cwd(), "node_modules", ".bin", "ts-node-transpile-only");
  return new Promise((resolvePromise, reject) => {
    execFile(tsNode, ["-P", join(dirname(workerPath), "tsconfig.json"), workerPath, failureId, runJsonPath, stateDir], {
      cwd: process.cwd(),
      timeout: 30_000,
      env: process.env,
    }, (error, _stdout, stderr) => {
      if (error) reject(new Error(`${error.message}\n${stderr}`));
      else resolvePromise();
    });
  });
}

describe("runner-v2 circuit persistence concurrency", () => {
  it("serializes concurrent distinct failure identities without losing either", async () => {
    const dir = mkdtempSync(join(tmpdir(), "runner-v2-circuit-concurrency-"));
    const runJsonPath = join(dir, "run.json");
    const run = createRunRecord({ chainName: "Build Chain", goal: "test" });
    updateRunJson(runJsonPath, () => ({ ...run, id: "run-123", status: "running" }));
    const adaptersPath = resolve(process.cwd(), "lib", "runner-v2", "adapters.ts");
    const tsconfigPathsPath = require.resolve("tsconfig-paths");
    const workerPath = join(dir, "record-circuit.ts");
    writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({
      compilerOptions: {
        target: "ES2020",
        module: "commonjs",
        moduleResolution: "node",
        esModuleInterop: true,
        baseUrl: process.cwd(),
        paths: { "@/*": ["*"] },
      },
    }));
    writeFileSync(workerPath, `
      const { register } = require(${JSON.stringify(tsconfigPathsPath)});
      register({ baseUrl: ${JSON.stringify(process.cwd())}, paths: { "@/*": ["*"] } });
      const { recordCircuitFailure } = require(${JSON.stringify(adaptersPath)});
      const [failureId, runJsonPath, stateDir] = process.argv.slice(2);
      recordCircuitFailure({
        type: "circuit-breaker",
        action: "record-failure",
        chainName: "Build Chain",
        agentId: "writer",
        threshold: 5,
        timeout: 300,
        failureId,
      }, { runJsonPath, stateDir });
    `);

    await Promise.all([
      runWorker(workerPath, "retry-failure:occurrence-a:0", runJsonPath, dir),
      runWorker(workerPath, "retry-failure:occurrence-b:0", runJsonPath, dir),
    ]);

    const circuitFiles = readdirSync(join(dir, "retry"))
      .filter((name) => name.startsWith("circuit_") && name.endsWith(".json"));
    expect(circuitFiles).toHaveLength(1);
    const circuit = JSON.parse(readFileSync(join(dir, "retry", circuitFiles[0]), "utf8")) as {
      chain_name: string;
      agent_id: string;
      failure_count: number;
      applied_failure_ids: string[];
    };
    expect(circuit.chain_name).toBe("Build Chain");
    expect(circuit.agent_id).toBe("writer");
    expect(circuit.failure_count).toBe(2);
    expect(new Set(circuit.applied_failure_ids)).toEqual(new Set([
      "retry-failure:occurrence-a:0",
      "retry-failure:occurrence-b:0",
    ]));
  });
});
