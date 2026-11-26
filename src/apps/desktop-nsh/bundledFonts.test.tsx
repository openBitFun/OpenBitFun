import { expect, test } from "nsh/test";
import "./src/bundledFonts";
import { currentLocale } from "../../nsh-ui/src/i18n";
import { fontSans, inputFontSans } from "../../nsh-ui/src/theme";

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
