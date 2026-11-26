#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const checkOnly = process.argv.includes('--check');
const contractPath = path.join(root, 'src', 'shared', 'i18n', 'contract', 'locales.json');

const outputs = [
  {
    path: path.join(root, 'src', 'crates', 'assembly', 'core', 'src', 'service', 'i18n', 'generated_locale_contract.rs'),
    generate: generateCoreRustLocaleContract,
  },
  {
    path: path.join(root, 'src', 'apps', 'relay-server', 'static', 'homepage', 'i18n.shared.json'),
    generate: generateRelayHomepageSharedTerms,
  },
];

const RELAY_HOMEPAGE_SHARED_TERM_KEYS = ['features.remoteControl'];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function normalizeGeneratedText(content) {
  return String(content).replace(/\r\n/g, '\n');
}

function readSharedTerms(contract) {
  return Object.fromEntries(
    contract.locales.map((locale) => {
      const file = path.join(root, 'src', 'shared', 'i18n', 'resources', 'shared', locale.id, 'terms.json');
      assert(fs.existsSync(file), `${locale.id} is missing shared terms.json`);
      return [locale.id, readJson(file)];
    }),
  );
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function getLocaleMap(contract) {
  return new Map(contract.locales.map((locale) => [locale.id, locale]));
}

function validateContract(contract) {
  assert(contract.version === 1, 'i18n contract version must be 1');
  assert(Array.isArray(contract.locales), 'contract.locales must be an array');
  assert(contract.locales.length > 0, 'contract.locales must not be empty');

  const ids = contract.locales.map((locale) => locale.id);
  assert(new Set(ids).size === ids.length, 'locale ids must be unique');
  assert(ids.includes(contract.defaultLocale), 'defaultLocale must be a canonical locale id');
  assert(ids.includes(contract.fallbackLocale), 'fallbackLocale must be a canonical locale id');

  for (const locale of contract.locales) {
    assert(locale.id && locale.rustVariant, `locale ${locale.id ?? '<unknown>'} is missing id or rustVariant`);
    assert(Array.isArray(locale.aliases) && locale.aliases.includes(locale.id), `${locale.id} aliases must include its canonical id`);
    assert(Array.isArray(locale.contentFallbacks), `${locale.id} contentFallbacks must be an array`);
    for (const fallback of locale.contentFallbacks) {
      assert(ids.includes(fallback), `${locale.id} contentFallbacks includes unknown locale ${fallback}`);
    }
  }

  for (const [surface, order] of Object.entries(contract.surfaceOrders ?? {})) {
    assert(Array.isArray(order) && order.length > 0, `${surface} surface order must not be empty`);
    for (const localeId of order) {
      assert(ids.includes(localeId), `${surface} surface order includes unknown locale ${localeId}`);
    }
  }

  for (const [surface, localeId] of Object.entries(contract.surfaceDefaults ?? {})) {
    assert(ids.includes(localeId), `${surface} surface default includes unknown locale ${localeId}`);
  }
}

function orderedLocales(contract, surface) {
  const localeMap = getLocaleMap(contract);
  return contract.surfaceOrders[surface].map((localeId) => localeMap.get(localeId));
}

function rustString(value) {
  let output = '"';
  for (const char of String(value)) {
    const codePoint = char.codePointAt(0);
    if (char === '"') {
      output += '\\"';
    } else if (char === '\\') {
      output += '\\\\';
    } else if (char === '\n') {
      output += '\\n';
    } else if (char === '\r') {
      output += '\\r';
    } else if (char === '\t') {
      output += '\\t';
    } else if (codePoint < 0x20) {
      output += `\\u{${codePoint.toString(16)}}`;
    } else {
      output += char;
    }
  }
  return `${output}"`;
}

function rustLocaleId(locale) {
  return `LocaleId::${locale.rustVariant}`;
}

function rustLocaleArray(locales) {
  return `&[${locales.map(rustLocaleId).join(', ')}]`;
}

function rustStringArray(values) {
  return `&[${values.map(rustString).join(', ')}]`;
}

function flattenSharedTerms(value, prefix = '') {
  if (value == null || Array.isArray(value) || typeof value !== 'object') {
    assert(typeof value === 'string', `shared i18n term "${prefix}" must be a string`);
    return [[prefix, value]];
  }

  return Object.entries(value)
    .flatMap(([key, child]) => flattenSharedTerms(child, prefix ? `${prefix}.${key}` : key))
    .sort(([left], [right]) => left.localeCompare(right));
}

function getNestedSharedTerm(terms, key) {
  return key.split('.').reduce((current, part) => (
    current != null && typeof current === 'object' ? current[part] : undefined
  ), terms);
}

function setNestedSharedTerm(target, key, value) {
  const parts = key.split('.');
  let current = target;
  for (const part of parts.slice(0, -1)) {
    current[part] ??= {};
    current = current[part];
  }
  current[parts.at(-1)] = value;
}

function generatedHeader(language) {
  const comment = language === 'rust' ? '//' : '//';
  return [
    `${comment} This file is generated by scripts/generate-i18n-contract.mjs.`,
    `${comment} Do not edit it by hand; edit the shared i18n contract or shared terms instead.`,
    '',
  ].join('\n');
}

function generateCoreRustLocaleContract(contract, sharedTermsByLocale) {
  const localeMap = getLocaleMap(contract);
  const locales = orderedLocales(contract, 'core');
  const defaultLocale = localeMap.get(contract.surfaceDefaults.core);
  const fallbackLocale = localeMap.get(contract.fallbackLocale);
  const unknownFallbacks = contract.unknownLocaleFallbackChain.map((id) => localeMap.get(id));
  const sharedTermEntries = locales.flatMap((locale) =>
    flattenSharedTerms(sharedTermsByLocale[locale.id]).map(([key, value]) => ({
      locale,
      key,
      value,
    })),
  );

  return `${generatedHeader('rust')}use super::types::LocaleId;

#[derive(Debug, Clone, Copy)]
pub struct GeneratedLocaleContractEntry {
    pub id: LocaleId,
    pub code: &'static str,
    pub name: &'static str,
    pub english_name: &'static str,
    pub native_name: &'static str,
    pub rtl: bool,
    pub model_language_name: &'static str,
    pub short_model_instruction: &'static str,
    pub aliases: &'static [&'static str],
    pub content_fallbacks: &'static [LocaleId],
}

#[derive(Debug, Clone, Copy)]
pub struct GeneratedSharedTermEntry {
    pub locale: LocaleId,
    pub key: &'static str,
    pub value: &'static str,
}

pub const GENERATED_DEFAULT_LOCALE: LocaleId = ${rustLocaleId(defaultLocale)};
pub const GENERATED_FALLBACK_LOCALE: LocaleId = ${rustLocaleId(fallbackLocale)};
pub const GENERATED_UNKNOWN_LOCALE_FALLBACK_CHAIN: &[LocaleId] = ${rustLocaleArray(unknownFallbacks)};

pub const GENERATED_LOCALE_CONTRACT: &[GeneratedLocaleContractEntry] = &[
${locales.map((locale) => `    GeneratedLocaleContractEntry {
        id: ${rustLocaleId(locale)},
        code: ${rustString(locale.id)},
        name: ${rustString(locale.name)},
        english_name: ${rustString(locale.englishName)},
        native_name: ${rustString(locale.nativeName)},
        rtl: ${locale.rtl},
        model_language_name: ${rustString(locale.modelLanguageName)},
        short_model_instruction: ${rustString(locale.shortModelInstruction)},
        aliases: ${rustStringArray(locale.aliases)},
        content_fallbacks: ${rustLocaleArray(locale.contentFallbacks.map((id) => localeMap.get(id)))},
    },`).join('\n')}
];

pub const GENERATED_SHARED_TERMS: &[GeneratedSharedTermEntry] = &[
${sharedTermEntries.map((entry) => `    GeneratedSharedTermEntry {
        locale: ${rustLocaleId(entry.locale)},
        key: ${rustString(entry.key)},
        value: ${rustString(entry.value)},
    },`).join('\n')}
];

pub fn generated_locale_entry(id: LocaleId) -> &'static GeneratedLocaleContractEntry {
    GENERATED_LOCALE_CONTRACT
        .iter()
        .find(|entry| entry.id == id)
        .expect("LocaleId missing from generated locale contract")
}

pub fn generated_locale_entry_from_code(
    code: &str,
) -> Option<&'static GeneratedLocaleContractEntry> {
    let normalized = code.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return None;
    }

    GENERATED_LOCALE_CONTRACT
        .iter()
        .find(|entry| entry.code.eq_ignore_ascii_case(&normalized))
        .or_else(|| {
            let mut best_match = None;
            for entry in GENERATED_LOCALE_CONTRACT {
                for alias in entry.aliases {
                    let alias = alias.to_ascii_lowercase();
                    if (normalized == alias || normalized.starts_with(&format!("{alias}-")))
                        && best_match
                            .map(|(_, current_len)| alias.len() > current_len)
                            .unwrap_or(true)
                    {
                        best_match = Some((entry, alias.len()));
                    }
                }
            }
            best_match.map(|(entry, _)| entry)
        })
}

pub fn generated_shared_term(locale: LocaleId, key: &str) -> Option<&'static str> {
    GENERATED_SHARED_TERMS
        .iter()
        .find(|entry| entry.locale == locale && entry.key == key)
        .map(|entry| entry.value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_contract_order_matches_runtime_locale_order() {
        let generated_ids: Vec<_> = GENERATED_LOCALE_CONTRACT
            .iter()
            .map(|entry| entry.id)
            .collect();
        assert_eq!(generated_ids, LocaleId::all());
    }

    #[test]
    fn generated_contract_resolves_aliases_like_runtime_locale_contract() {
        assert_eq!(
            generated_locale_entry_from_code("zh-Hant-TW").map(|entry| entry.id),
            Some(LocaleId::ZhTW)
        );
        assert_eq!(
            generated_locale_entry_from_code("  ZH-hans-CN  ").map(|entry| entry.id),
            Some(LocaleId::ZhCN)
        );
        assert_eq!(
            generated_locale_entry_from_code("en").map(|entry| entry.id),
            Some(LocaleId::EnUS)
        );
        assert_eq!(
            generated_locale_entry_from_code("fr-FR").map(|entry| entry.id),
            None
        );
    }

    #[test]
    fn generated_contract_contains_shared_terms() {
        assert_eq!(
            generated_shared_term(LocaleId::EnUS, "features.deepReview"),
            Some("Review: Strict")
        );
    }
}
`;
}

function generateRelayHomepageSharedTerms(contract, sharedTermsByLocale) {
  const localeMap = getLocaleMap(contract);
  const locales = (contract.surfaceOrders['relay-static-homepage'] ?? contract.locales.map((locale) => locale.id))
    .map((localeId) => localeMap.get(localeId));
  const sharedTerms = {};

  for (const locale of locales) {
    sharedTerms[locale.id] = {};
    for (const key of RELAY_HOMEPAGE_SHARED_TERM_KEYS) {
      const value = getNestedSharedTerm(sharedTermsByLocale[locale.id], key);
      assert(typeof value === 'string', `relay static homepage shared term ${locale.id}:${key} must exist`);
      setNestedSharedTerm(sharedTerms[locale.id], key, value);
    }
  }

  return `${JSON.stringify(sharedTerms, null, 2)}\n`;
}

function main() {
  const contract = readJson(contractPath);
  validateContract(contract);
  const sharedTermsByLocale = readSharedTerms(contract);

  const changedFiles = [];
  for (const output of outputs) {
    const nextContent = output.generate(contract, sharedTermsByLocale);
    if (checkOnly) {
      const currentContent = fs.existsSync(output.path) ? fs.readFileSync(output.path, 'utf8') : null;
      const currentContentForCheck = currentContent == null ? null : normalizeGeneratedText(currentContent);
      if (currentContentForCheck !== normalizeGeneratedText(nextContent)) {
        changedFiles.push(path.relative(root, output.path).split(path.sep).join('/'));
      }
    } else {
      fs.mkdirSync(path.dirname(output.path), { recursive: true });
      fs.writeFileSync(output.path, nextContent, 'utf8');
    }
  }

  if (changedFiles.length > 0) {
    console.error('[i18n:generate] Generated files are out of date:');
    for (const file of changedFiles) {
      console.error(`  - ${file}`);
    }
    console.error('[i18n:generate] Run pnpm run i18n:generate.');
    process.exit(1);
  }

  if (!checkOnly) {
    console.log(`[i18n:generate] Wrote ${outputs.length} generated i18n contract file(s).`);
  }
}

main();
