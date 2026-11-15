#!/usr/bin/env node
// pm-image-modules.test.mjs — packaging parity for the process manager.
//
// The tenant image compiles process-manager.ts with tsc in the Dockerfile and
// copies an EXPLICIT list of emitted .js files into /context/lib. Node's CJS
// require does not resolve the .ts sources that the context assembly also
// copies, so any runtime import missing from that copy list breaks tenant
// boot (issue #105 round 2, P1). This test parses the Dockerfile copy list
// and asserts every relative import reachable from process-manager.ts is in
// it. Runs in CI without Docker.
//
// Usage: node tests/pm-image-modules.test.mjs

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dockerfile = readFileSync(join(repoRoot, 'Dockerfile'), 'utf-8');
const libDir = join(repoRoot, 'web', 'lib');

// 1. extract the process-manager compile block from the Dockerfile
const blockMatch = dockerfile.match(/compiling process-manager\.ts[\s\S]*?rm -rf \/tmp\/pm-out;[\s\S]*?\n\s*fi/);
if (!blockMatch) {
  console.error('FAIL: could not find the process-manager compile block in Dockerfile');
  process.exit(1);
}
const block = blockMatch[0];

// 2. the emitted modules the Dockerfile copies into the image
const copied = new Set();
for (const m of block.matchAll(/cp \/tmp\/pm-out\/([\w.-]+\.js) \/context\/lib\//g)) {
  copied.add(m[1]);
}
if (copied.size === 0) {
  console.error('FAIL: process-manager compile block copies no .js files — copy list parse broken?');
  process.exit(1);
}

// 3. walk the relative-import closure of process-manager.ts
const specRe = /(?:from|import)\s+'(\.[^']+)'/g;
const required = new Map(); // jsName -> importer chain
const queue = [['process-manager.ts', '<entry>']];
const seen = new Set(['process-manager.ts']);
while (queue.length) {
  const [file, importer] = queue.shift();
  const srcPath = join(libDir, file);
  if (!existsSync(srcPath)) {
    console.error(`FAIL: ${file} (imported by ${importer}) does not exist under web/lib`);
    process.exit(1);
  }
  const jsName = file.replace(/\.ts$/, '.js');
  if (!copied.has(jsName)) required.set(jsName, importer);
  const src = readFileSync(srcPath, 'utf-8');
  for (const m of src.matchAll(specRe)) {
    const spec = m[1];
    let target = join(dirname(file), spec);
    if (!target.endsWith('.ts')) target += '.ts';
    const rel = target.replace(/^\//, '');
    if (!seen.has(rel)) { seen.add(rel); queue.push([rel, file]); }
  }
}

// 4. every reachable module must be in the copy list
if (required.size > 0) {
  console.error('FAIL: modules reachable from process-manager.ts at runtime but NOT copied into the image:');
  for (const [jsName, importer] of required) {
    console.error(`  - ${jsName} (imported by ${importer})`);
  }
  console.error('\nFix: add the missing .ts inputs to the tsc command and the missing .js files to the cp list in the Dockerfile process-manager compile block.');
  process.exit(1);
}

console.log(`OK: all ${copied.size} modules reachable from process-manager.ts are copied into the tenant image`);
