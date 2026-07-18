import { registerKollabMentikoMcpServer } from "../kollabor-mcp-settings";

function usage(): string {
  return "usage: kollabor-mcp-settings-cli register --command <mentiko-mcp-path> [--home <path>]";
}

export function runKollaborMcpSettingsCli(argv: string[]): string {
  if (argv[0] !== "register") throw new Error(usage());
  let command = "";
  let homeDir: string | undefined;
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--command") command = argv[++index] ?? "";
    else if (argument === "--home") homeDir = argv[++index] ?? "";
    else throw new Error(`${usage()}: unknown argument ${argument}`);
  }
  return `${JSON.stringify(registerKollabMentikoMcpServer({ command, homeDir }))}\n`;
}

if (require.main === module) {
  try {
    process.stdout.write(runKollaborMcpSettingsCli(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
