// build-runtime-natives-lock.mjs
//
// usage: node scripts/build-runtime-natives-lock.mjs <web-lock-path> <out-dir>
//
// reads web/package-lock.json, walks the dependency closure of the four
// runtime native packages, and writes a self-contained package-lock.json
// to <out-dir>/package-lock.json (plus a matching thin package.json).
//
// every entry copied is taken verbatim from the source lockfile —
// version + resolved url + integrity hash + dependencies. nothing is
// re-resolved against the registry. `npm ci --omit=dev` against the
// output is the only operation that touches the network, and it can
// only fetch the exact tarballs the source lockfile committed to.
//
// what this fixes vs the previous approach:
//   the prior builder generated a thin package.json and ran
//   `npm install --package-lock-only`, which re-resolves the
//   transitive sub-tree against the public npm registry at build
//   time. two builds of the same commit could install different
//   transitives. this script makes the runtime native install
//   bit-for-bit reproducible from the same source lockfile.
//
// targets are hardcoded (ws, @xterm/headless, better-sqlite3,
// better-sqlite3-multiple-ciphers) because they map 1:1 to what
// the runtime stage needs to overlay onto the standalone bundle.

import fs from 'node:fs';
import path from 'node:path';

const TARGETS = [
  'ws',
  '@xterm/headless',
  'better-sqlite3',
  'better-sqlite3-multiple-ciphers',
];

const [, , LOCK_PATH, OUT_DIR] = process.argv;
if (!LOCK_PATH || !OUT_DIR) {
  console.error('usage: node build-runtime-natives-lock.mjs <web-lock-path> <out-dir>');
  process.exit(2);
}

const srcLock = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));
if (srcLock.lockfileVersion !== 3) {
  console.error(`FATAL: unsupported lockfile version ${srcLock.lockfileVersion} (need 3)`);
  process.exit(1);
}

// walk dependency closure starting from each target.
// node naming: in lockfileVersion 3, `packages` is keyed by install path —
// hoisted deps live at "node_modules/<name>", nested at
// "node_modules/<parent>/node_modules/<name>", etc.
// we resolve each declared dep by walking UP from the dependent's path,
// the same algorithm npm uses at install time.

function findEntry(depName, fromPath) {
  // fromPath is the lockfile key of the dependent ("" for root,
  // "node_modules/<x>" otherwise). search nested first, then walk up.
  const segments = fromPath ? fromPath.split('/node_modules/') : [''];
  // strip the empty first segment if fromPath was non-empty
  if (fromPath) segments[0] = 'node_modules/' + segments[0].split('node_modules/').pop();
  for (let i = segments.length; i >= 0; i--) {
    const prefix = segments.slice(0, i).filter(Boolean).join('/node_modules/');
    const candidate = (prefix ? prefix + '/' : '') + 'node_modules/' + depName;
    if (srcLock.packages[candidate]) return candidate;
  }
  return null;
}

const closure = new Set();
const queue = [];

for (const t of TARGETS) {
  const key = 'node_modules/' + t;
  if (!srcLock.packages[key]) {
    console.error(`FATAL: target ${t} not found in lockfile`);
    process.exit(1);
  }
  queue.push(key);
}

while (queue.length) {
  const key = queue.shift();
  if (closure.has(key)) continue;
  closure.add(key);
  const entry = srcLock.packages[key];
  for (const dep of Object.keys(entry.dependencies || {})) {
    const depKey = findEntry(dep, key);
    if (!depKey) {
      console.error(`FATAL: cannot resolve ${dep} from ${key}`);
      process.exit(1);
    }
    queue.push(depKey);
  }
  // also follow optionalDependencies (sharp uses these for per-arch packages)
  for (const dep of Object.keys(entry.optionalDependencies || {})) {
    const depKey = findEntry(dep, key);
    if (depKey) queue.push(depKey);
  }
}

// build the thin package.json with target versions only.
const thinPkg = {
  name: 'mentiko-runtime-natives',
  version: '0.0.0',
  private: true,
  dependencies: {},
};
for (const t of TARGETS) {
  thinPkg.dependencies[t] = srcLock.packages['node_modules/' + t].version;
}

// build the new lockfile. the root entry "" is required by npm.
const outLock = {
  name: 'mentiko-runtime-natives',
  version: '0.0.0',
  lockfileVersion: 3,
  requires: true,
  packages: {
    '': {
      name: 'mentiko-runtime-natives',
      version: '0.0.0',
      dependencies: thinPkg.dependencies,
    },
  },
};

// copy each closure entry verbatim — version, resolved, integrity,
// dependencies, engines, etc. nothing is re-derived.
for (const key of Array.from(closure).sort()) {
  outLock.packages[key] = srcLock.packages[key];
}

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'package.json'), JSON.stringify(thinPkg, null, 2));
fs.writeFileSync(path.join(OUT_DIR, 'package-lock.json'), JSON.stringify(outLock, null, 2));

console.log(`runtime-natives lockfile built: ${closure.size} packages`);
for (const t of TARGETS) {
  console.log(`  ${t}: ${srcLock.packages['node_modules/' + t].version}`);
}
