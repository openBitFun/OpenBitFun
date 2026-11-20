import fs from 'node:fs';
import path from 'node:path';

// Appearance contract audit. The Appearance descriptor registry, scene and DOM
// surface checks belonged to the retired React desktop UI (src/web-ui) and were
// removed with it. What remains guards repository-wide facts that still have
// owners: retired Theme/Skin paths stay deleted, retired final-state contract
// names do not return, and MiniApp/E2E boundaries do not reach into host
// Appearance internals.
const repoRoot = path.resolve(import.meta.dirname, '..');
const crossBoundaryRoots = [
  path.join(repoRoot, 'MiniApp'),
  path.join(repoRoot, 'tests', 'e2e', 'specs'),
  path.join(repoRoot, 'tests', 'e2e', 'helpers'),
  path.join(repoRoot, 'src', 'crates', 'contracts', 'product-domains', 'src', 'miniapp'),
  path.join(repoRoot, 'src', 'crates', 'assembly', 'core', 'builtin_skills', 'miniapp-dev'),
];
const failures = [];

const retiredAppearancePaths = [
  'scripts/generate-startup-theme-bootstrap.mjs',
  'scripts/generate-startup-theme-bootstrap.test.mjs',
  'src/apps/desktop/src/theme.rs',
  'src/apps/desktop/src/generated/startup_theme_bootstrap.json',
  'docs/architecture/skin-package-system.md',
];
for (const retiredPath of retiredAppearancePaths) {
  if (fs.existsSync(path.join(repoRoot, retiredPath))) {
    failures.push(`${retiredPath}: retired Theme/Skin path is forbidden`);
  }
}

const finalStateContractFiles = [
  'package.json',
  'src/apps/desktop/src/appearance.rs',
  'docs/development/ui-testids.md',
  'docs/development/ui-testids-CN.md',
];
const retiredFinalStateContracts = [
  ['generate-startup-theme-bootstrap', /generate-startup-theme-bootstrap/],
  ['startup_theme_bootstrap', /startup_theme_bootstrap/],
  ['STARTUP_THEME_BOOTSTRAP', /STARTUP_THEME_BOOTSTRAP/],
  ['__OPENBITFUN_BOOTSTRAP_THEME', /__OPENBITFUN_BOOTSTRAP_THEME/],
  ['prepare_theme', /prepare_theme/],
  ['prepareThemeDurationMs', /prepareThemeDurationMs/],
  ['theme-switching', /theme-switching/],
  ['MenuTheme', /\bMenuTheme\b/],
  ['appearance-theme-option', /appearance-theme-option/],
  ['data-theme-id', /data-theme-id/],
  ['legacy bootstrap CSS token', /--(?:color-(?:bg|text|accent)|border|element)-/],
];
for (const contractFile of finalStateContractFiles) {
  const absolute = path.join(repoRoot, contractFile);
  if (!fs.existsSync(absolute)) continue;
  const source = fs.readFileSync(absolute, 'utf8');
  for (const [name, pattern] of retiredFinalStateContracts) {
    if (pattern.test(source)) {
      failures.push(`${contractFile}: retired final-state contract ${name} is forbidden`);
    }
  }
}

const ignoredWalkDirectories = new Set(['node_modules', 'dist', 'build']);

function walkContractSources(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (ignoredWalkDirectories.has(entry.name)) return [];
      return walkContractSources(absolute);
    }
    return /\.(?:css|d\.ts|html|js|json|md|rs|scss|ts|tsx)$/.test(entry.name) ? [absolute] : [];
  });
}

const crossBoundaryForbiddenContracts = [
  ['hostTheme', /\bhostTheme\b/],
  ['onThemeChange', /\bonThemeChange\b/],
  ['data-theme-type', /data-theme-type/],
  ['openbitfun/request-theme', /openbitfun\/request-theme/],
  ['ThemeService', /\bThemeService\b/],
  ['SkinService', /\bSkinService\b/],
  ['tools/editor/themes', /tools[\\/]editor[\\/]themes/],
  ['editor.theme', /\beditor\.theme\b/],
  ['terminal.theme', /\bterminal\.theme\b/],
  ['app.theme', /\bapp\.theme\b/],
  ['theme-config', /theme-config/],
  ['--glass-*', /--glass-[a-z0-9-]+/i],
  ['--tool-card-*', /--tool-card-[a-z0-9-]+/i],
];

const crossBoundaryFiles = crossBoundaryRoots.flatMap(walkContractSources);
for (const file of crossBoundaryFiles) {
  const source = fs.readFileSync(file, 'utf8');
  for (const [name, pattern] of crossBoundaryForbiddenContracts) {
    if (pattern.test(source)) failures.push(`${path.relative(repoRoot, file)}: retired cross-boundary contract ${name} is forbidden`);
  }
}

if (failures.length > 0) {
  console.error('Appearance contract audit failed:');
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`Appearance contract audit passed (${retiredAppearancePaths.length} retired paths, ${finalStateContractFiles.length} final-state files, ${crossBoundaryFiles.length} cross-boundary files).`);
