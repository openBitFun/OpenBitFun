#!/usr/bin/env node
// Builds the OpenBitFun web controller: the NSH web bundle of `src/nsh-ui`
// (the same UI the desktop serves as `nsh-web`) with launch parameters that
// make it a controller (sign in, pick a device, connect through the server
// gateway). Deploy the output under `https://<domain>/app/`
// (`deploy/easytier/README.md`, "Web controller").
//
//   node scripts/build-web-controller.mjs [--domain remote.openbitfun.com] [--out target/web-controller/app]

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const domain = option('domain', 'remote.openbitfun.com');
if (!/^[a-z0-9.-]+(:[0-9]+)?$/i.test(domain)) {
  console.error(`Invalid --domain ${domain}`);
  process.exit(2);
}
const out = path.resolve(root, option('out', 'target/web-controller/app'));
const staging = `${out}.staging`;

fs.rmSync(staging, { recursive: true, force: true });
const built = spawnSync('nsh', ['package', 'src/nsh-ui', '--target', 'web', '-o', staging], {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true,
});
if (built.status !== 0) {
  console.error('nsh package --target web failed');
  process.exit(built.status ?? 1);
}
const [bundleName] = fs.readdirSync(staging);
const bundle = path.join(staging, bundleName);
const indexPath = path.join(bundle, 'index.html');
const index = fs.readFileSync(indexPath, 'utf8');
const params = {
  controller: {
    api: `https://${domain}/obp/api/v1`,
    gateway: `wss://${domain}/obp`,
  },
};
// `<` cannot occur in a script's JSON text without ending it early.
const script = `<script type="application/json" id="nsh-params">${JSON.stringify(params).replace(/</g, '\\u003c')}</script>`;
if (index.includes('id="nsh-params"')) {
  console.error('index.html already carries nsh-params');
  process.exit(1);
}
const html = index.replace('</head>', `${script}\n</head>`);
fs.writeFileSync(indexPath, html);
// The precompressed copies must match the edited page.
fs.writeFileSync(`${indexPath}.gz`, zlib.gzipSync(html, { level: 9 }));
fs.writeFileSync(`${indexPath}.br`, zlib.brotliCompressSync(html));

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.renameSync(bundle, out);
fs.rmSync(staging, { recursive: true, force: true });
console.log(`Web controller for https://${domain}/app/ in ${path.relative(root, out)}`);
