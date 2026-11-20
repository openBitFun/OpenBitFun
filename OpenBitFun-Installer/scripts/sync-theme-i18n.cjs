const fs = require("fs");
const path = require("path");

const INSTALLER_ROOT = path.resolve(__dirname, "..");
// Installer-owned source strings (moved from the retired React desktop UI locale catalogs).
const SOURCES_DIR = path.join(INSTALLER_ROOT, "src", "i18n", "sources");

const THEME_IDS = [
  "openbitfun-dark",
  "openbitfun-light",
  "openbitfun-midnight",
  "openbitfun-china-style",
  "openbitfun-china-night",
  "openbitfun-cyber",
  "openbitfun-slate",
  "openbitfun-tokyo-night",
];

function readJson(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  return JSON.parse(content);
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function extractThemeNames(source, sourceLabel) {
  // Theme preset names live under themeNames (formerly the desktop UI's
  // settings/application.json -> appearance.presets.<id>.name).
  const presets = source?.themeNames;
  if (!presets || typeof presets !== "object") {
    throw new Error(`Invalid themeNames in ${sourceLabel}`);
  }

  const result = {};
  for (const themeId of THEME_IDS) {
    const name = presets?.[themeId];
    if (typeof name !== "string" || name.trim() === "") {
      throw new Error(`Missing theme name for '${themeId}' in ${sourceLabel}`);
    }
    result[themeId] = name;
  }

  return result;
}

function injectThemeNames(target, themeNames) {
  if (!target.themeSetup || typeof target.themeSetup !== "object") {
    target.themeSetup = {};
  }
  target.themeSetup.themeNames = {
    ...(target.themeSetup.themeNames || {}),
    ...themeNames,
  };
  return target;
}

function main() {
  const sourceEnPath = path.join(SOURCES_DIR, "en-US.json");
  const sourceZhPath = path.join(SOURCES_DIR, "zh-CN.json");

  const targetEnPath = path.join(
    INSTALLER_ROOT,
    "src",
    "i18n",
    "locales",
    "en.json"
  );
  const targetZhPath = path.join(
    INSTALLER_ROOT,
    "src",
    "i18n",
    "locales",
    "zh.json"
  );

  const sourceEn = readJson(sourceEnPath);
  const sourceZh = readJson(sourceZhPath);
  const targetEn = readJson(targetEnPath);
  const targetZh = readJson(targetZhPath);

  const enThemeNames = extractThemeNames(sourceEn, sourceEnPath);
  const zhThemeNames = extractThemeNames(sourceZh, sourceZhPath);

  writeJson(targetEnPath, injectThemeNames(targetEn, enThemeNames));
  writeJson(targetZhPath, injectThemeNames(targetZh, zhThemeNames));

  console.log("[sync-theme-i18n] Synced installer theme names from src/i18n/sources.");
}

main();
