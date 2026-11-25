// The shortcut recorder keeps typing out of shortcuts: AltGr characters are text.
import { expect, test } from "nsh/test";
import { keystrokeFromKeyEvent } from "../src/shortcutsStore";

const mods = { control: false, alt: false, shift: false, platform: false, altGraph: false };

test("AltGr characters are text, not shortcuts", () => {
  // Windows reports Ctrl+Alt held for an AltGr character such as `@`.
  expect(keystrokeFromKeyEvent({ key: "q", code: "KeyQ", modifiers: { ...mods, control: true, alt: true, altGraph: true } })).toBeNull();
  expect(keystrokeFromKeyEvent({ key: "k", code: "KeyK", modifiers: { ...mods, alt: true } })).toBe("alt+k");
  // Only modifiers, or no primary modifier and no Alt: nothing to record.
  expect(keystrokeFromKeyEvent({ key: "Shift", modifiers: { ...mods, shift: true } })).toBeNull();
  expect(keystrokeFromKeyEvent({ key: "k", code: "KeyK", modifiers: { ...mods, shift: true } })).toBeNull();
});
