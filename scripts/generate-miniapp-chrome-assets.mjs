#!/usr/bin/env node
// Generate the static MiniApp window chrome assets in src/shared/miniapp-chrome:
//   icons.generated.json               Lucide SVG markup (no React at runtime)
//   labels.generated.json              window-control labels from the shared terms
//   presentation-labels.generated.json MiniApp presentation copy, validated per locale
// Consumers: src/apps/miniapp-shell/src/shell.rs and the desktop MiniApp host.
// Moved from the retired React desktop UI's generate-lucide-static-icons.mjs.
// Lucide/React resolve from @openbitfun/ui, the owner of the product icon set.
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const chrome = new URL('src/shared/miniapp-chrome/', root);
const check = process.argv.includes('--check');
const requireFromUi = createRequire(new URL('design-system/packages/ui/package.json', root));
const { createElement } = requireFromUi('react');
const { renderToStaticMarkup } = requireFromUi('react-dom/server');
const lucide = requireFromUi('lucide-react');

const svg = (glyph, props = {}) => renderToStaticMarkup(createElement(glyph, { 'aria-hidden': true, ...props }));
const readJson = async url => JSON.parse(await readFile(url, 'utf8'));
const stale = [];

async function update(name, content) {
  const file = new URL(name, chrome);
  const before = await readFile(file, 'utf8').catch(() => null);
  if (before === content) return;
  if (check) stale.push(fileURLToPath(file));
  else await writeFile(file, content);
}

const miniAppIcons = {
  app: 'Box', return: 'PictureInPicture', popout: 'SquareArrowOutUpRight', minimize: 'Minus', maximize: 'Square', restore: 'Copy', close: 'X',
  download: 'Download', save: 'Save', search: 'Search', settings: 'Settings', refresh: 'RefreshCw', plus: 'Plus', play: 'Play', stop: 'Square', check: 'Check', share: 'Share2', help: 'CircleHelp', send: 'ArrowUp', suggestion: 'ArrowUpRight',
};
for (const name of ['Aperture', 'Box', 'Bot', 'Code', 'Database', 'FileText', 'GitPullRequest', 'Grid3x3', 'LayoutGrid', 'Presentation', 'Regex', 'Rocket', 'Workflow', 'Wrench', 'AppWindow', 'Globe', 'Image', 'Settings', 'Sparkles', 'Terminal']) {
  miniAppIcons[name] = name;
  miniAppIcons[name.replace(/[A-Z]/g, (letter, index) => (index ? '-' : '') + letter.toLowerCase())] = name;
}
await update('icons.generated.json', JSON.stringify(Object.fromEntries(
  Object.entries(miniAppIcons).map(([key, name]) => {
    if (!lucide[name]) throw new Error(`Unknown Lucide icon: ${name}`);
    return [key, svg(lucide[name])];
  }),
), null, 2) + '\n');

const localeContract = await readJson(new URL('src/shared/i18n/contract/locales.json', root));
const presentationSource = await readJson(new URL('presentation-labels.source.json', chrome));
const windowLabels = { aliases: {}, fallbackLocale: localeContract.fallbackLocale };
const presentationLabels = {};
const referenceKeys = Object.keys(presentationSource[localeContract.fallbackLocale] ?? {}).sort();
for (const { id: locale, aliases } of localeContract.locales) {
  for (const alias of aliases) windowLabels.aliases[alias.toLowerCase()] = locale;
  const terms = await readJson(new URL(`src/shared/i18n/resources/shared/${locale}/terms.json`, root));
  windowLabels[locale] = terms.window;
  const presentation = presentationSource[locale];
  if (!presentation) throw new Error(`presentation-labels.source.json is missing locale ${locale}`);
  const keys = Object.keys(presentation).sort();
  if (JSON.stringify(keys) !== JSON.stringify(referenceKeys)) {
    throw new Error(`presentation-labels.source.json ${locale} keys differ from ${localeContract.fallbackLocale}`);
  }
  presentationLabels[locale] = presentation;
}
const extra = Object.keys(presentationSource).filter(locale => !localeContract.locales.some(entry => entry.id === locale));
if (extra.length) throw new Error(`presentation-labels.source.json has locales outside the contract: ${extra.join(', ')}`);
await update('labels.generated.json', JSON.stringify(windowLabels, null, 2) + '\n');
await update('presentation-labels.generated.json', JSON.stringify(presentationLabels, null, 2) + '\n');

if (stale.length) {
  console.error(`MiniApp chrome assets are stale; run node scripts/generate-miniapp-chrome-assets.mjs:\n${stale.join('\n')}`);
  process.exit(1);
}
console.log(`MiniApp chrome assets ${check ? 'verified' : 'generated'}.`);
