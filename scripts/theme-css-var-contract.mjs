import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  mergeTokenDocuments,
  resolveTokens,
  tokenNameToCssVariable,
} from '../design-system/tooling/token-engine/src/index.mjs';

const contractDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(contractDirectory, '..');

function readDesignSystemTokenDocument(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8'));
}

const designSystemTokens = resolveTokens(readDesignSystemTokenDocument(
  'design-system/packages/design-tokens/src/system.tokens.json',
));
const openbitfunThemeTokens = resolveTokens(mergeTokenDocuments(
  readDesignSystemTokenDocument('design-system/packages/theme-openbitfun/src/reference.tokens.json'),
  readDesignSystemTokenDocument('design-system/packages/theme-openbitfun/src/light.tokens.json'),
));
const publicThemePrefixes = [
  'color.',
  'component.button.',
  'component.empty.',
  'effect.',
  'opacity.',
  'shadow.',
];

export const PACKAGE_CSS_VAR_DEFINITION_CONTRACTS = Object.freeze([
  Object.freeze({
    owner: 'design-system/packages/design-tokens/src/system.tokens.json',
    packageName: '@openbitfun/design-tokens',
    variables: Object.freeze(Object.keys(designSystemTokens).map(name => tokenNameToCssVariable(name))),
  }),
  Object.freeze({
    owner: 'design-system/packages/theme-openbitfun/src/light.tokens.json',
    packageName: '@openbitfun/theme-openbitfun',
    variables: Object.freeze(
      Object.keys(openbitfunThemeTokens)
        .filter(name => publicThemePrefixes.some(prefix => name.startsWith(prefix)))
        .map(name => tokenNameToCssVariable(name)),
    ),
  }),
]);

/**
 * Resolved default-theme values used to detect raw application literals that
 * duplicate a public semantic token. This keeps the governance check tied to
 * the canonical token package rather than any surface-local Sass token owner.
 */
export const CANONICAL_THEME_COLOR_TOKENS = Object.freeze(
  Object.entries(openbitfunThemeTokens)
    .filter(([name, token]) => (
      publicThemePrefixes.some(prefix => name.startsWith(prefix))
      && token.type === 'color'
      && typeof token.value === 'string'
    ))
    .map(([name, token]) => Object.freeze({
      cssVariable: tokenNameToCssVariable(name),
      name,
      value: token.value,
    })),
);

export const PACKAGE_CSS_VAR_IMPORT_CONTRACTS = Object.freeze([
  Object.freeze({
    specifier: '@openbitfun/design-tokens/tokens.css',
    packageNames: Object.freeze(['@openbitfun/design-tokens']),
  }),
  Object.freeze({
    specifier: '@openbitfun/theme-openbitfun/default.css',
    packageNames: Object.freeze(['@openbitfun/design-tokens', '@openbitfun/theme-openbitfun']),
  }),
  Object.freeze({
    specifier: '@openbitfun/theme-openbitfun/themes.css',
    packageNames: Object.freeze(['@openbitfun/theme-openbitfun']),
  }),
]);

export const COLOR_EXTENSIONS = new Set([
  '.css',
  '.html',
  '.js',
  '.jsx',
  '.mjs',
  '.sass',
  '.scss',
  '.svg',
  '.ts',
  '.tsx',
  '.webmanifest',
]);

export const TOKEN_PATH_PARTS = [
  'design-system/packages/design-tokens/src',
  'design-system/packages/theme-openbitfun/src',
];

export const TOKEN_ALIAS_SOURCE_PATH_PARTS = [
  'design-system/packages/theme-openbitfun/src',
];

export const RUNTIME_CONTRACT_VAR_DEFINITION_PATH_PARTS = [
  'themeRuntime.ts',
];

export const CONTRACT_VAR_DEFINITION_PATH_PARTS = [
  ...RUNTIME_CONTRACT_VAR_DEFINITION_PATH_PARTS,
  'design-system/packages/design-tokens/src',
  'design-system/packages/theme-openbitfun/src',
];

export const STATIC_CONTRACT_VAR_DEFINITION_PATH_PARTS = [
  'design-system/packages/design-tokens/src',
  'design-system/packages/theme-openbitfun/src',
];

export const EXCEPTION_PATH_PARTS = [
  'monaco',
  'terminal',
  'mermaid',
  'syntax',
  'CodeEditor',
];

// Specialized color domains. Each rule classifies files by path and needs an owner
// contract below; rules whose only owner was the retired React desktop UI were
// removed with it, so those paths count as ordinary app UI again.
export const COLOR_DOMAIN_RULES = [
  {
    key: 'assetMetadata',
    label: 'Static asset and install metadata',
    pathParts: ['assets', 'public/favicon', 'site.webmanifest', 'src/assets'],
    extensions: ['.svg', '.webmanifest'],
  },
  {
    key: 'tokenContract',
    label: 'Token contracts',
    pathParts: ['design-system/packages/design-tokens', 'design-system/packages/theme-openbitfun'],
  },
];

export const COLOR_DOMAIN_KEYS = [
  ...COLOR_DOMAIN_RULES.map(rule => rule.key),
  'appUi',
];

export const COLOR_DOMAIN_LABELS = Object.fromEntries([
  ...COLOR_DOMAIN_RULES.map(rule => [rule.key, rule.label]),
  ['appUi', 'App UI'],
]);

export const COLOR_DOMAIN_CONTRACTS = [
  {
    key: 'assetMetadata',
    owner: 'src/miniapp-market-web/public; design-system/packages/ui/src/brand/assets',
    reason: 'Favicons, install metadata, and self-contained vector assets cannot consume runtime CSS variables and therefore own their serialized colors at the asset boundary.',
    mergePolicy: 'Keep only identity or platform metadata colors here; any rendered application UI color must move to a canonical theme token.',
  },
  {
    key: 'tokenContract',
    owner: 'design-system/packages/design-tokens/src; design-system/packages/theme-openbitfun/src',
    reason: 'Independent token packages own canonical system scales and semantic theme values for every product surface.',
    mergePolicy: 'Keep token values in their canonical package and reject surface aliases or surface-local duplicate definitions.',
  },
];

export const TOKEN_COMPATIBILITY_ALIAS_CONTRACTS = [];

export const TOKEN_COMPATIBILITY_ALIAS_FAMILY_CONTRACTS = [];

export const FALLBACK_VAR_CONTRACTS = [];

export const SURFACE_TOKEN_RENAME_CONTRACTS = [];

// Dynamic CSS variable families (prefix + owner + reason). All previous families were
// owned by the retired React desktop UI; a new family needs an owner under an audited root.
export const DYNAMIC_VAR_FAMILY_CONTRACTS = [];

export const REGISTERED_DYNAMIC_VAR_PREFIXES = new Set(
  DYNAMIC_VAR_FAMILY_CONTRACTS.map(contract => contract.prefix),
);
