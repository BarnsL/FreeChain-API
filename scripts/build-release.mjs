#!/usr/bin/env node
// Builds the release artifacts for one platform:
//
//   dist/freechain-<platform>-<arch>[.exe]   single-file executable
//   dist/freechain-<platform>-<arch>.zip     portable folder, same exe + assets
//   dist/freechain-portable-node.zip         tiny, any OS, needs Node installed
//
// Node's SEA format only accepts a CommonJS entry, so the ESM sources are
// bundled to one CJS file first. esbuild is a devDependency: it runs here at
// build time and is never part of what the server ships.
//
// Cross-compiling is not possible — injecting into another platform's Node
// binary produces something that cannot run or be signed here. CI builds each
// platform on its own runner instead (.github/workflows/release.yml).

import { execFileSync } from 'node:child_process';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { rcedit } from 'rcedit';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const WIN = process.platform === 'win32';
const TARGET = `${process.platform}-${process.arch}`;
const EXE = `freechain-${TARGET}${WIN ? '.exe' : ''}`;

// No shell: the Node executable path contains a space on Windows ("Program
// Files") and a shell would split it.
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit', ...opts });

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

const starterRaw = process.env.FREECHAIN_STARTER_KEY || '';
let starterDefine = 'null';
if (starterRaw) {
  const dk = createHash('sha256').update('freechain\x00v1\x00starter').digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', dk, iv);
  const ct = cipher.update(starterRaw, 'utf8', 'hex') + cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  starterDefine = JSON.stringify(
    Buffer.from(JSON.stringify({ iv: iv.toString('hex'), tag, ct })).toString('base64'),
  );
  console.log('· encrypted starter credential for release bundle');
}

console.log('· bundling ESM sources to a single CommonJS entry');
await build({
  entryPoints: [path.join(ROOT, 'bin', 'freechain.mjs')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: path.join(DIST, 'freechain.cjs'),
  banner: { js: '// FreeChain — bundled for single-executable packaging.' },
  define: {
    'import.meta.url': JSON.stringify('file:///freechain-sea'),
    '__FREECHAIN_STARTER__': starterDefine,
  },
});

console.log('· writing SEA config');
const seaConfig = path.join(DIST, 'sea-config.json');
fs.writeFileSync(
  seaConfig,
  JSON.stringify(
    {
      main: path.join(DIST, 'freechain.cjs'),
      output: path.join(DIST, 'sea-prep.blob'),
      disableExperimentalSEAWarning: true,
    },
    null,
    2
  )
);

console.log('· generating SEA blob');
run(process.execPath, ['--experimental-sea-config', seaConfig]);

console.log(`· building ${EXE}`);
const exePath = path.join(DIST, EXE);
fs.copyFileSync(process.execPath, exePath);
if (!WIN) fs.chmodSync(exePath, 0o755);

// Node's own exe carries the stock Node.js icon. Stamp FreeChain's icon on
// before postject injects the SEA blob, so the icon edit lands on a plain
// PE resource section rather than one that's already been modified.
if (WIN) {
  console.log('· embedding application icon');
  await rcedit(exePath, { icon: path.join(ROOT, 'assets', 'icon.ico') });
}

// macOS refuses to run a binary whose existing signature no longer matches
// the modified contents, so the old signature is stripped before injecting
// and an ad-hoc one is applied after.
if (process.platform === 'darwin') run('codesign', ['--remove-signature', exePath]);

run(process.execPath, [
  path.join(ROOT, 'node_modules', 'postject', 'dist', 'cli.js'),
  exePath,
  'NODE_SEA_BLOB',
  path.join(DIST, 'sea-prep.blob'),
  '--sentinel-fuse',
  'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  ...(process.platform === 'darwin' ? ['--macho-segment-name', 'NODE_SEA'] : []),
  '--overwrite',
]);

if (process.platform === 'darwin') run('codesign', ['--sign', '-', exePath]);

// The portable folder is the exe plus the files it reads from disk at runtime:
// the dashboard assets and the default chain. .env is created on first run.
//
// Staged under dist/portable/ because off Windows the executable has no
// extension, so a folder named after the same target would collide with it.
console.log('· assembling portable folder');
const STAGE = path.join(DIST, 'portable');
const portable = path.join(STAGE, `freechain-${TARGET}`);
fs.mkdirSync(portable, { recursive: true });
fs.copyFileSync(exePath, path.join(portable, `freechain${WIN ? '.exe' : ''}`));
if (!WIN) fs.chmodSync(path.join(portable, 'freechain'), 0o755);
fs.cpSync(path.join(ROOT, 'src', 'webui'), path.join(portable, 'webui'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'chain.config.json'), path.join(portable, 'chain.config.json'));
fs.copyFileSync(path.join(ROOT, '.env.example'), path.join(portable, '.env.example'));
fs.copyFileSync(path.join(ROOT, 'README.md'), path.join(portable, 'README.md'));
fs.copyFileSync(path.join(ROOT, 'LICENSE'), path.join(portable, 'LICENSE'));
fs.writeFileSync(
  path.join(portable, 'START-HERE.txt'),
  [
    'FreeChain — portable',
    '',
    WIN
      ? 'Double-click freechain.exe, or run it from a terminal in this folder.'
      : 'Run ./freechain from a terminal in this folder.',
    '',
    'Then open http://127.0.0.1:4853/ and add a provider key under',
    '"Model sources". Keys are written to a .env file created right here,',
    'next to the executable, and never leave this machine.',
    '',
    'Nothing else needs installing — Node is already inside the executable.',
    '',
  ].join('\n')
);

console.log('· zipping');
const zipDir = (dir, out) => {
  if (WIN) {
    run('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path "${dir}\\*" -DestinationPath "${out}" -Force`]);
  } else {
    run('zip', ['-qr', out, path.basename(dir)], { cwd: path.dirname(dir) });
  }
};
zipDir(portable, path.join(DIST, `freechain-${TARGET}.zip`));

// Source-only portable: runs anywhere Node 20+ is already installed, and is a
// few hundred kilobytes instead of ~90 MB. Built once, on any platform.
console.log('· assembling source portable (needs Node 20+)');
const nodePortable = path.join(STAGE, 'freechain-portable-node');
fs.mkdirSync(nodePortable, { recursive: true });
for (const entry of ['src', 'bin']) {
  fs.cpSync(path.join(ROOT, entry), path.join(nodePortable, entry), { recursive: true });
}
for (const file of ['chain.config.json', '.env.example', 'README.md', 'LICENSE', 'package.json']) {
  fs.copyFileSync(path.join(ROOT, file), path.join(nodePortable, file));
}
fs.writeFileSync(
  path.join(nodePortable, 'START-HERE.txt'),
  [
    'FreeChain — portable (requires Node.js 20 or newer)',
    '',
    'From a terminal in this folder:',
    '',
    '    node bin/freechain.mjs',
    '',
    'Then open http://127.0.0.1:4853/ and add a provider key under',
    '"Model sources". Keys are written to a .env file created right here.',
    '',
    'Works on Windows, macOS, and Linux. No npm install needed — FreeChain',
    'has no runtime dependencies.',
    '',
  ].join('\n')
);
zipDir(nodePortable, path.join(DIST, 'freechain-portable-node.zip'));

if (WIN) {
  const ISCC_PATHS = [
    'C:\\InnoSetup6\\ISCC.exe',
    'C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe',
    'C:\\Program Files\\Inno Setup 6\\ISCC.exe',
  ];
  const iscc = ISCC_PATHS.find((p) => fs.existsSync(p));
  if (iscc) {
    const pkgVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
    console.log(`· compiling Inno Setup installer (v${pkgVersion})`);
    run(iscc, [
      `/DMyAppVersion=${pkgVersion}`,
      `/DPortableDir=${portable}`,
      `/DSourceDir=${path.join(ROOT, 'scripts')}`,
      path.join(ROOT, 'scripts', 'freechain.iss'),
    ]);
  } else {
    console.log('· Inno Setup not found, skipping installer');
  }
}

console.log('\nBuilt in dist/:');
for (const f of fs.readdirSync(DIST).sort()) {
  const st = fs.statSync(path.join(DIST, f));
  if (st.isFile()) console.log(`  ${f}  ${(st.size / 1_048_576).toFixed(1)} MB`);
}
