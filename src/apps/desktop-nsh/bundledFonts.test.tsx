import { expect, test } from "nsh/test";
import "./src/bundledFonts";
import { currentLocale } from "../../nsh-ui/src/i18n";
import { fontSans } from "../../nsh-ui/src/theme";

test("the bundled desktop UI switches font families with its display language", () => {
  currentLocale.set("zh-CN");
  expect(fontSans().split(", ").slice(0, 2)).toEqual(['"HarmonyOS Sans SC"', '"HarmonyOS Sans"']);
  currentLocale.set("en-US");
  expect(fontSans().split(", ")[0]).toBe('"HarmonyOS Sans"');
  currentLocale.set("zh-TW");
  expect(fontSans().split(", ")[0]).toBe("system-ui");
});
