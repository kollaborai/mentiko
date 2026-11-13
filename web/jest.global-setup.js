const { execFileSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const { join, resolve } = require("node:path");

module.exports = async function buildMentikoMcpForTests() {
  const packageRoot = join(resolve(__dirname, ".."), "lib", "mentiko-mcp");
  const nodeModules = join(packageRoot, "node_modules");
  const hasBuildDependencies = [
    join(nodeModules, "esbuild", "package.json"),
    join(nodeModules, "@modelcontextprotocol", "sdk", "package.json"),
  ].every(existsSync);

  if (!hasBuildDependencies) {
    execFileSync("npm", ["ci", "--no-audit", "--no-fund"], {
      cwd: packageRoot,
      stdio: "inherit",
    });
  }

  // The MCP server is a package build artifact ignored by Git. Build it from
  // the package's locked dependencies before suites exercise the runtime path.
  execFileSync("npm", ["run", "build"], { cwd: packageRoot, stdio: "inherit" });

  const serverPath = join(packageRoot, "dist", "server.js");
  if (!existsSync(serverPath)) {
    throw new Error(`Mentiko MCP build did not produce ${serverPath}`);
  }
};
