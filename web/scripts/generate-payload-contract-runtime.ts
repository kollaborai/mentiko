import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import ts from "typescript";

const webRoot = resolve(__dirname, "..");
export const payloadContractSourcePath = resolve(webRoot, "lib/generation/payload-contract.ts");
export const payloadContractRuntimePath = resolve(webRoot, "lib/generation/payload-contract.runtime.js");

const GENERATED_HEADER = [
  "// GENERATED FILE. DO NOT EDIT.",
  "// Canonical source: web/lib/generation/payload-contract.ts",
  "// Regenerate: npm run generate:payload-contract",
  "",
].join("\n");

export function renderPayloadContractRuntime(source: string): string {
  const emitted = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      strict: true,
      removeComments: false,
      newLine: ts.NewLineKind.LineFeed,
    },
    fileName: payloadContractSourcePath,
    reportDiagnostics: true,
  });
  const errors = (emitted.diagnostics || []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  if (errors.length > 0) {
    throw new Error(ts.formatDiagnostics(errors, {
      getCanonicalFileName: (fileName) => fileName,
      getCurrentDirectory: () => webRoot,
      getNewLine: () => "\n",
    }));
  }
  return `${GENERATED_HEADER}${emitted.outputText}`;
}

export function generatePayloadContractRuntime(): string {
  const generated = renderPayloadContractRuntime(readFileSync(payloadContractSourcePath, "utf8"));
  writeFileSync(payloadContractRuntimePath, generated, "utf8");
  return generated;
}

if (require.main === module) {
  generatePayloadContractRuntime();
}
