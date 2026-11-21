#!/usr/bin/env node
// Builds the OpenBitFun web controller (the launcher): the NSH web bundle of
// `src/nsh-ui` (the same UI the desktop serves as `nsh-web`) with launch
// parameters that make it a controller (sign in, open a device through the
// server gateway), plus the UI loader that runs each device's own web UI
// (`src/nsh-ui/web/ui-loader.js` at `/ui-loader.js`, its boot page
// `/ui-boot.html`). Deploy the output at the root of `https://<domain>/`
// (`deploy/easytier/README.md`, "Web controller").
//
// The launcher's `uiBundleId` is the bundleId of the untouched `nsh package`
// output (`write-ui-bundle-manifest.mjs`, before `#nsh-params` goes in), the
// id a device of the same build ships, so such a device is driven in place.
//
//   node scripts/build-web-controller.mjs [--domain super.openbitfun.com] [--out target/web-controller/app]

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { writeUiBundleManifest } from './write-ui-bundle-manifest.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const domain = option('domain', 'super.openbitfun.com');
if (!/^[a-z0-9.-]+(:[0-9]+)?$/i.test(domain)) {
  console.error(`Invalid --domain ${domain}`);
  process.exit(2);
}
const out = path.resolve(root, option('out', 'target/web-controller/app'));
const staging = `${out}.staging`;

fs.rmSync(staging, { recursive: true, force: true });
const built = spawnSync('nsh', ['package', 'src/nsh-ui/WebApp.tsx', '--target', 'web', '-o', staging], {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true,
});
if (built.status !== 0) {
  console.error('nsh package --target web failed');
  process.exit(built.status ?? 1);
}
// The manifest of the bundle as a device ships it; the launcher's own copy
// below no longer matches it (its index.html carries parameters), so it is
// not deployed.
const { bundleDir: bundle, bundleId } = writeUiBundleManifest(staging);
fs.rmSync(path.join(bundle, 'ui-bundle.json'), { force: true });
const indexPath = path.join(bundle, 'index.html');
const index = fs.readFileSync(indexPath, 'utf8');
const params = {
  controller: {
    api: `https://${domain}/obp/api/v1`,
    gateway: `wss://${domain}/obp`,
    uiBundleId: bundleId,
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

// The UI loader and its boot page, beside the launcher.
for (const name of ['ui-loader.js', 'ui-boot.html']) {
  const text = fs.readFileSync(path.join(root, 'src/nsh-ui/web', name));
  const target = path.join(bundle, name);
  fs.writeFileSync(target, text);
  fs.writeFileSync(`${target}.gz`, zlib.gzipSync(text, { level: 9 }));
  fs.writeFileSync(`${target}.br`, zlib.brotliCompressSync(text));
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.renameSync(bundle, out);
fs.rmSync(staging, { recursive: true, force: true });
console.log(`Web controller for https://${domain}/ in ${path.relative(root, out)} (uiBundleId ${bundleId})`);
