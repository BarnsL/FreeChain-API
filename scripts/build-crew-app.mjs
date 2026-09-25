import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = process.argv.includes('--host=codex') ? 'codex' : 'kiro';
if (process.argv.slice(2).some(arg => !['--host=kiro', '--host=codex'].includes(arg))) throw new Error('Use --host=kiro (default) or --host=codex.');
const toolRoot = process.env.FREECHAIN_BUILD_TOOL_ROOT || root;
const { build } = createRequire(path.join(toolRoot, 'package.json'))('esbuild');
const dist = path.join(root, 'dist');
const output = path.join(dist, host === 'kiro' ? 'freechain-crew' : 'freechain-codex-crew');
await fs.mkdir(dist, { recursive: true });
// Never rebuild an installed app or follow a linked output outside this checkout.
if (path.resolve(await fs.realpath(dist)).toLowerCase() !== dist.toLowerCase()) throw new Error('Build directory must not be a link.');
try {
  if ((await fs.lstat(output)).isSymbolicLink()) throw new Error('Build output must not be a link.');
  for (const name of ['data', '.env', '.app_secret', 'installed.json']) {
    try { await fs.lstat(path.join(output, name)); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    throw new Error('Refusing to rebuild an app containing private runtime state.');
  }
  await fs.rm(output, { recursive: true });
} catch (error) { if (error.code !== 'ENOENT') throw error; }
await fs.mkdir(output, { recursive: true });
// Explicit source allowlist. No .env, host app secrets, operational logs or
// existing runtime data can enter a distributable through a broad repo copy.
for (const dir of ['backend', 'bin', 'assets', 'skills']) await fs.cp(path.join(root, 'crew-app', dir), path.join(output, dir), { recursive: true });
const manifest = JSON.parse(await fs.readFile(path.join(root, 'crew-app/app.json'), 'utf8'));
if (host === 'codex') { manifest.minCodexCrewVersion = manifest.minKiroCrewVersion; delete manifest.minKiroCrewVersion; }
await fs.writeFile(path.join(output, 'app.json'), JSON.stringify(manifest, null, 2) + '\n');
await fs.copyFile(path.join(root, 'crew-app/README.md'), path.join(output, 'README.md'));
if (host === 'kiro') for (const file of ['Install-FreeChain.cmd', 'install.sh']) await fs.copyFile(path.join(root, 'crew-app', file), path.join(output, file));
await fs.copyFile(path.join(root, 'LICENSE'), path.join(output, 'LICENSE'));
await fs.mkdir(path.join(output, 'engine'), { recursive: true });
await fs.cp(path.join(root, 'src'), path.join(output, 'engine/src'), { recursive: true });
await fs.copyFile(path.join(root, 'chain.config.json'), path.join(output, 'engine/chain.config.json'));
await fs.writeFile(path.join(output, 'engine/package.json'), JSON.stringify({ type: 'module', private: true }));
const read = file => fs.readFile(path.join(root, file), 'utf8');
const html = await read('src/webui/index.html');
const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)[1].replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
let baseCss = await read('src/webui/app.css');
baseCss = baseCss.replace(/:root\b/g, ':scope').replace(/(?<![-\w])(?:html|body)(?![-\w])/g, ':scope');
const css = `@scope (.freechain-crew) {\n${baseCss}\n${await read('crew-app/ui/theme.css')}\n}`;
const params = '{ document, window, location, fetch, localStorage, setInterval, clearInterval, setTimeout, clearTimeout, requestAnimationFrame }';
await build({
  entryPoints: [path.join(root, 'crew-app/ui/entry.mjs')], outfile: path.join(output, 'ui/index.mjs'),
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022', external: ['react', '@codexcrew/app-sdk'],
  plugins: [{ name: 'existing-freechain-dashboard', setup(builder) {
    builder.onResolve({ filter: /^@kirocrew\/app-sdk$/ }, () => ({ path: `@${host}crew/app-sdk`, external: true }));
    builder.onResolve({ filter: /^freechain:/ }, args => ({ path: args.path.slice(10), namespace: 'freechain' }));
    builder.onLoad({ filter: /.*/, namespace: 'freechain' }, async ({ path: name }) => {
      if (name === 'markup' || name === 'css') return { contents: `export default ${JSON.stringify(name === 'markup' ? body : css)}`, loader: 'js' };
      let source = await read(`src/webui/${name === 'guide' ? 'guide-boot' : name}.js`);
      let imports = '';
      if (name === 'guide') { const match = source.match(/import\s*\{[\s\S]*?\}\s*from\s*'\.\/guide-content.js';/); imports = match[0]; source = source.replace(match[0], ''); }
      return { contents: `${imports}\nexport function mount(${params}) {\n${source}\n}`, loader: 'js', resolveDir: path.join(root, 'src/webui') };
    });
    builder.onResolve({ filter: /^\.\/guide-content.js$/, namespace: 'freechain' }, () => ({ path: path.join(root, 'src/webui/guide-content.js') }));
  } }],
});
console.log(`Built self-contained FreeChain Crew app: ${output}`);
