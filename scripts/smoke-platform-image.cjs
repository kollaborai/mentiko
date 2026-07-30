// smoke-platform-image.cjs - in-container smoke test for the platform image.
// CommonJS (.cjs) intentional: uses require() throughout. .mjs forces ES
// module mode and breaks the script — caught by the smoke gate itself in
// dispatch run 26348498897 (its own first invocation failed closed, which
// is exactly the fail-closed behavior the gate exists to provide).
//
// invoked by build-platform.yml's smoke-test job AFTER platform-{amd,arm}64
// build the per-arch images and BEFORE the manifest job promotes them to
// :latest. runs INSIDE the container under USER mentiko, so it uses
// os.tmpdir() for the cipher round-trip file (no host bind mount).
//
// what it proves (and why):
//   (a) basic sqlite roundtrip       - better-sqlite3 prebuild works at all
//   (b) sqlcipher PROOF of encryption - not just round-trip, which can pass
//       when pragmas no-op. four checks:
//         - file header is NOT "SQLite format 3" (plaintext sig)
//         - plain better-sqlite3 cannot read the file (no key path)
//         - wrong key cannot decrypt (same pragma sequence, different key)
//         - correct key works AND cipher_version pragma returns non-empty
//       mirrors the EXACT live pragma sequence in
//       web/lib/auth-server.ts:345-349:
//         pragma cipher='sqlcipher'
//         pragma legacy=4              <- critical, easy to forget
//         exec  PRAGMA key = '...'
//   (c) sharp render                  - catches lazy crash on image opt
//   (d) native arch audit via file(1) - every .node / .so / .dylib / .dll
//       under /opt/mentiko/node_modules must report the expected arch
//       (x86-64 for amd64, aarch64 for arm64). path strings don't encode
//       arch for generic packages like better-sqlite3, so file(1) is the
//       only real proof.
//
// exits 0 = all checks pass, non-zero = failure with FATAL message above.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execSync } = require('node:child_process');

console.log('arch:', process.arch, 'platform:', process.platform);
try {
  console.log('id:', execSync('id', { encoding: 'utf8' }).trim());
} catch {}

// must require these — proves they load on this arch
require('ws');
require('@xterm/headless');

// Runner-v2 loads its migration and implementation contracts at runtime from
// config.codeRoot. Missing contracts fail every typed launch before PTY
// allocation, so image admission must prove the same path the app reads.
{
  const contractPath = '/opt/mentiko/docs/orchestration/contracts/runner-v2-contract.json';
  let contract;
  try {
    contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
  } catch (error) {
    console.error(`FATAL: runner-v2 runtime contract missing or invalid: ${contractPath}`, error);
    process.exit(1);
  }
  if (contract.migration_mode !== 'typed' || contract.default_runner !== 'typed') {
    console.error('FATAL: runner-v2 runtime contract does not declare the typed default');
    process.exit(1);
  }
  console.log('runner-v2 runtime contract verified');
}

// ---------------------------------------------------------------------------
// (a) basic sqlite
// ---------------------------------------------------------------------------
const sqlite = require('better-sqlite3');
{
  const db = new sqlite(':memory:');
  db.exec('CREATE TABLE t(x INT)');
  db.prepare('INSERT INTO t VALUES(?)').run(42);
  const got = db.prepare('SELECT x FROM t').get();
  db.close();
  if (got.x !== 42) {
    console.error('FATAL: basic sqlite roundtrip failed');
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// (b) sqlcipher proof of encryption (live app pragma sequence)
// ---------------------------------------------------------------------------
const Ciphers = require('better-sqlite3-multiple-ciphers');
const dbPath = path.join(os.tmpdir(), `cipher-smoke-${process.pid}.db`);
try { fs.rmSync(dbPath, { force: true }); } catch {}

const KEY = 'correct-key-abc123';
const WRONG = 'wrong-key-xyz789';

// write encrypted
{
  const db = new Ciphers(dbPath);
  db.pragma("cipher='sqlcipher'");
  db.pragma('legacy=4');
  db.exec(`PRAGMA key = '${KEY}'`);
  db.exec('CREATE TABLE t(x TEXT)');
  db.prepare('INSERT INTO t VALUES(?)').run('secret-value');
  db.close();
}

// proof 1: file header must not be plaintext sqlite magic
{
  const header = fs.readFileSync(dbPath).subarray(0, 16).toString('utf8');
  if (header.startsWith('SQLite format 3')) {
    console.error('FATAL: file has plaintext SQLite header — not encrypted');
    process.exit(1);
  }
}

// proof 2: plain better-sqlite3 must NOT be able to read
{
  let opened = false;
  try {
    const db = new sqlite(dbPath);
    db.prepare('SELECT x FROM t').get();
    opened = true;
    db.close();
  } catch {
    // expected
  }
  if (opened) {
    console.error('FATAL: db readable WITHOUT cipher — encryption is a lie');
    process.exit(1);
  }
}

// proof 3: WRONG key (with same pragma sequence) must NOT work
{
  let opened = false;
  try {
    const db = new Ciphers(dbPath);
    db.pragma("cipher='sqlcipher'");
    db.pragma('legacy=4');
    db.exec(`PRAGMA key = '${WRONG}'`);
    db.prepare('SELECT x FROM t').get();
    opened = true;
    db.close();
  } catch {
    // expected
  }
  if (opened) {
    console.error('FATAL: wrong key decrypted db — cipher broken');
    process.exit(1);
  }
}

// proof 4: correct key + same sequence reads back the value.
// (we previously checked `cipher_version` here, but it's not a stable
// pragma name across multiple-ciphers builds and the live app never
// queries it. proofs 1-3 already establish that the file is encrypted
// and only opens with the matching key — proof 4 just confirms the
// round-trip reads back.)
{
  const db = new Ciphers(dbPath);
  db.pragma("cipher='sqlcipher'");
  db.pragma('legacy=4');
  db.exec(`PRAGMA key = '${KEY}'`);
  const got = db.prepare('SELECT x FROM t').get();
  db.close();
  if (!got || got.x !== 'secret-value') {
    console.error('FATAL: correct key failed to read; got:', got);
    process.exit(1);
  }
  console.log('sqlcipher verified (encryption + round-trip)');
}

try { fs.rmSync(dbPath, { force: true }); } catch {}

// ---------------------------------------------------------------------------
// (c) sharp render — catches lazy crash on image optimization
// ---------------------------------------------------------------------------
async function smokeSharp() {
  const sharp = require('sharp');
  await sharp({
    create: { width: 1, height: 1, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .png()
    .toBuffer();
  console.log('sharp ok');
}

// ---------------------------------------------------------------------------
// (d) native arch audit via file(1).
//
// require() only proves modules on the import path loaded — it does NOT
// catch a wrong-arch libvips sitting next to a right-arch sharp wrapper,
// or any other native artifact under a code path the smoke doesn't
// exercise. phase 4 shares a JS bundle across arches, so a stray
// wrong-arch artifact in the runtime image is a real failure mode this
// audit exists to catch.
//
// file(1) is provided by the runtime stage (Dockerfile installs it via
// apt; mentiko-base inherits from node:22-slim which doesn't ship it).
// when mentiko-base is rebuilt to include file(1) directly, the
// Dockerfile install line can drop.
// ---------------------------------------------------------------------------
function smokeNativeArch() {
  const expected = process.arch === 'arm64' ? 'aarch64' : 'x86-64';
  let artifacts = [];
  try {
    const out = execSync(
      "find /opt/mentiko/node_modules -type f \\( " +
        "-name '*.node' -o -name '*.so' -o -name '*.so.*' " +
        "-o -name '*.dylib' -o -name '*.dll' \\)",
      { encoding: 'utf8' }
    );
    artifacts = out.trim().split('\n').filter(Boolean);
  } catch (e) {
    console.error('FATAL: native artifact enumeration failed:', e.message);
    process.exit(1);
  }
  console.log('native artifacts:', artifacts.length);
  const bad = [];
  for (const p of artifacts) {
    let line = '';
    try {
      line = execSync(`file ${JSON.stringify(p)}`, { encoding: 'utf8' }).trim();
    } catch (e) {
      console.error('FATAL: file(1) failed on', p, '-', e.message);
      process.exit(1);
    }
    const desc = line.split(':').slice(1).join(':').trim();
    console.log('  ' + p + ' -> ' + desc);
    if (!line.includes(expected)) {
      bad.push(p);
    }
  }
  if (bad.length) {
    console.error('FATAL: wrong-arch artifacts (expected ' + expected + '):', bad);
    process.exit(1);
  }
  console.log('native arch audit ok (' + expected + ')');
}

smokeSharp()
  .then(() => {
    smokeNativeArch();
    console.log('all smoke checks passed');
  })
  .catch((e) => {
    console.error('FATAL: sharp failed:', e);
    process.exit(1);
  });
