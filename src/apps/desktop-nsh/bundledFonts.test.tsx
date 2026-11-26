import { expect, test } from "nsh/test";
import "./src/bundledFonts";
import { currentLocale } from "../../nsh-ui/src/i18n";
import { fontMono, fontSans, inputFontSans } from "../../nsh-ui/src/theme";
import { createDiffViewStyles, createEditorStyles, createMarkdownStyles } from "../../nsh-ui/src/ui/markdown";

test("the bundled desktop UI switches font families with its display language and keeps Windows inputs sans-serif", () => {
  currentLocale.set("zh-CN");
  expect(fontSans().split(", ").slice(0, 2)).toEqual(['"HarmonyOS Sans SC"', '"HarmonyOS Sans"']);
  expect(inputFontSans("zh-CN", "windows").split(", ")[0]).toBe('"Microsoft YaHei UI"');
  expect(inputFontSans("zh-CN", "linux").split(", ").slice(0, 2)).toEqual(['"HarmonyOS Sans SC"', '"HarmonyOS Sans"']);

  currentLocale.set("en-US");
  expect(fontSans().split(", ").slice(0, 2)).toEqual(['"HarmonyOS Sans"', '"HarmonyOS Sans SC"']);
  expect(inputFontSans("en-US", "windows").split(", ")[0]).toBe('"Microsoft YaHei UI"');

  currentLocale.set("zh-TW");
  expect(fontSans().split(", ")[0]).toBe("system-ui");
  expect(inputFontSans("zh-TW", "windows").split(", ")[0]).toBe('"Microsoft JhengHei UI"');
});

test("code keeps the bundled Latin face and follows the display language for missing glyphs", () => {
  for (const locale of ["zh-CN", "en-US", "zh-TW"] as const) {
    currentLocale.set(locale);
    const family = fontMono();
    expect(family.split(", ")[0]).toBe("'Fira Code'");
    expect(family.includes(fontSans())).toBe(true);
    expect(family.indexOf("Consolas") < family.indexOf(fontSans())).toBe(true);
    for (const options of [undefined, { compact: true }, { baseFontSize: 16 }]) {
      const markdown = createMarkdownStyles(options);
      expect(markdown.code).toMatchObject({ fontFamily: family });
      expect(markdown.codeBlockCode).toMatchObject({ fontFamily: family });
    }
    expect(createEditorStyles().line).toMatchObject({ fontFamily: family });
    expect(createDiffViewStyles().line).toMatchObject({ fontFamily: family });
    if (locale === "zh-TW") expect(family.includes("HarmonyOS")).toBe(false);
  }
  // Both Chinese locales have CJK typography; their font fallback must still invalidate the cache.
  currentLocale.set("zh-CN");
  const simplified = createMarkdownStyles();
  currentLocale.set("zh-TW");
  expect(createMarkdownStyles() === simplified).toBe(false);
});
