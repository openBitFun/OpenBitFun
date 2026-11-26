// The visual foundations of `src/theme.ts` (visual spec §2): the whole-pixel
// type scale with its CJK leading, the spacing and radius scales, elevation,
// the teal accent family with its contrast, and the motion tokens.
import { expect, test } from "nsh/test";
import { currentLocale } from "../src/i18n";
import { createMarkdownStyles } from "../src/ui/markdown";
import {
  APPEARANCE_PRESETS,
  SPACE_SCALE,
  controlHeight,
  fontMono,
  fontSans,
  getAppearancePreset,
  inputFontSans,
  layout,
  motionTiming,
  radii,
  roleSize,
  space,
  springs,
  textLineHeight,
  textStyle,
  textTracking,
  typeScale,
  type Palette,
  type TextRole,
} from "../src/theme";
import { DEFAULT_TOAST_DURATION_MS } from "../src/ui/overlays";

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map(x => x + x).join("") : h.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast of two opaque hex colors. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const dark = getAppearancePreset("openbitfun-dark").palette;
const light = getAppearancePreset("openbitfun-light").palette;

const ROLES: TextRole[] = [
  "display",
  "pageTitle",
  "modalTitle",
  "sectionTitle",
  "prose",
  "body",
  "label",
  "caption",
  "micro",
  "mono",
  "monoBlock",
  "cardTitle",
  "meta",
];

test("the type scale is whole pixels and every role is on it", () => {
  const scale = [28, 22, 17, 16, 15, 14, 13, 12, 11];
  for (const value of Object.values(typeScale)) {
    expect(Number.isInteger(value)).toBe(true);
    expect(scale).toContain(value);
  }
  for (const role of ROLES) {
    const style = textStyle(role);
    expect(Number.isInteger(style.fontSize)).toBe(true);
    expect(Number.isInteger(style.lineHeight)).toBe(true);
    expect(["400", "500", "600"]).toContain(style.fontWeight);
    expect(style.fontSize).toBe(roleSize(role));
  }
  // The deprecated keys read as their replacements, so old call sites compile and land on the scale.
  expect(typeScale.cardTitle).toBe(typeScale.body);
  expect(typeScale.control).toBe(typeScale.label);
  expect(typeScale.meta).toBe(typeScale.caption);
});

test("each role has the spec's size, weight and leading", () => {
  const expected: Array<[TextRole, number, string, number]> = [
    ["display", 28, "600", 34],
    ["pageTitle", 22, "600", 28],
    ["modalTitle", 17, "600", 24],
    ["sectionTitle", 16, "600", 22],
    ["prose", 15, "400", 24],
    ["body", 14, "400", 20],
    ["label", 13, "500", 18],
    ["caption", 12, "400", 16],
    ["micro", 11, "600", 14],
    ["mono", 12, "400", 16],
    ["monoBlock", 13, "400", 20],
  ];
  for (const [role, size, weight, line] of expected) {
    const style = textStyle(role);
    expect([role, style.fontSize, style.fontWeight, style.lineHeight]).toEqual([role, size, weight, line]);
  }
  expect(textStyle("display").letterSpacing).toBe(-0.4);
  expect(textStyle("pageTitle").letterSpacing).toBe(-0.3);
  expect(textStyle("sectionTitle").letterSpacing).toBe(-0.1);
  expect(textStyle("prose").letterSpacing).toBe(0);
});

test("Chinese prose and body take a 1.7 leading and no tracking", () => {
  const before = currentLocale();
  try {
    currentLocale.set("zh-CN");
    expect(textStyle("prose").lineHeight).toBe(26);
    expect(textStyle("body").lineHeight).toBe(24);
    expect(textLineHeight(14, 1.55)).toBe(24);
    // Single-line chrome keeps its own leading.
    expect(textStyle("label").lineHeight).toBe(18);
    expect(textLineHeight(14, 1.2)).toBe(17);
    expect(textStyle("display").letterSpacing).toBe(0);
    expect(textTracking(22)).toBe(0);
    currentLocale.set("zh-TW");
    expect(textStyle("prose").lineHeight).toBe(26);
    currentLocale.set("en-US");
    expect(textStyle("prose").lineHeight).toBe(24);
    expect(textTracking(28)).toBe(-0.4);
  } finally {
    currentLocale.set(before);
  }
});

test("spacing, radii and control heights are on their scales", () => {
  expect(SPACE_SCALE).toEqual([2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64]);
  for (const [key, value] of Object.entries(space)) {
    if (key === "chip") expect(value).toBe(6);
    else expect(SPACE_SCALE).toContain(value);
  }
  expect([radii.xs, radii.sm, radii.md, radii.lg, radii.xl, radii.pill]).toEqual([4, 6, 8, 12, 16, 999]);
  // `surface` (20) is retired; the key stays for old call sites at the canvas radius.
  expect(radii.surface).toBe(layout.canvasRadius);
  expect(controlHeight).toEqual({ xs: 24, sm: 28, md: 32, lg: 40 });
  expect(layout.navDefaultWidth).toBe(264);
  expect(layout.conversationWidth).toBe(760);
});

test("motion springs are NSH spring strings and the pulse replaces ping", () => {
  for (const value of Object.values(springs)) {
    expect(/^spring\(\d+, \d+\)$/.test(value)).toBe(true);
  }
  expect(springs.snappy).toBe("spring(420, 41)");
  expect(springs.toggle).toBe("spring(520, 36)");
  expect(motionTiming.pulse).toBe(1600);
  expect(motionTiming.reducedMax).toBeLessThanOrEqual(120);
});

test("the dark preset's accent family is teal and toggles follow it", () => {
  expect(dark.accent).toBe("#3fb6c4");
  expect(dark.chromeAccent).toBe(dark.accent);
  expect(dark.borderFocus).toBe(dark.accent);
  expect(dark.brandWarm).toBe(dark.accent);
  expect(dark.switchOn).toBe(dark.actionSolid);
  expect(light.switchOn).toBe(light.accent);
  // Kept: asserted by App.test.tsx and sessions-ux.test.tsx.
  expect(light.textMuted).toBe("#5c6672");
});

test("the teal accent clears the spec's contrast in both schemes", () => {
  expect(contrast(dark.accent, dark.canvas)).toBeGreaterThanOrEqual(7.0);
  expect(contrast(dark.accent, dark.chromeBg)).toBeGreaterThanOrEqual(7.9);
  expect(contrast(dark.accent, dark.panelRaised)).toBeGreaterThanOrEqual(6.4);
  expect(contrast(dark.accent, dark.surfaceElevated)).toBeGreaterThanOrEqual(6.2);
  expect(contrast(dark.brandWarmFg, dark.brandWarm)).toBeGreaterThanOrEqual(6.3);
  expect(contrast("#ffffff", dark.actionSolid)).toBeGreaterThanOrEqual(4.8);
  expect(contrast("#ffffff", dark.actionSolidHover)).toBeGreaterThanOrEqual(5.8);
  expect(contrast("#ffffff", dark.switchOn)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(light.accent, light.canvas)).toBeGreaterThanOrEqual(5.1);
  expect(contrast(light.accent, light.chromeBg)).toBeGreaterThanOrEqual(4.6);
  expect(contrast("#ffffff", light.actionSolid)).toBeGreaterThanOrEqual(5.1);
  expect(contrast("#ffffff", light.switchOn)).toBeGreaterThanOrEqual(4.5);
});

test("every state color clears 3:1 on the canvas in all 9 presets", () => {
  const tokens: Array<keyof Palette> = ["accent", "warning", "success", "danger", "textMuted"];
  expect(APPEARANCE_PRESETS.length).toBe(9);
  for (const preset of APPEARANCE_PRESETS) {
    for (const token of tokens) {
      const ratio = contrast(preset.palette[token] as string, preset.palette.canvas);
      expect([preset.id, token, ratio >= 3]).toEqual([preset.id, token, true]);
    }
  }
});

test("the other presets keep the accents they had", () => {
  const midnight = getAppearancePreset("openbitfun-midnight").palette;
  expect(midnight.brandWarm).toBe("#60a5fa");
  expect(midnight.actionSolid).toBe("#2563eb");
  for (const preset of APPEARANCE_PRESETS) {
    if (preset.id === "openbitfun-dark" || preset.id === "openbitfun-light") continue;
    expect([preset.id, preset.palette.switchOn]).toEqual([preset.id, "#059cb0"]);
    expect(preset.palette.accent).not.toBe("#3fb6c4");
  }
});

test("session markdown typography uses native 15px prose, distinct heading scale, and tight container-driven list spacing", () => {
  const obj = (style: unknown) => (style ?? {}) as Record<string, number | string | undefined>;
  const before = currentLocale();
  try {
    currentLocale.set("en-US");
    const en = createMarkdownStyles();
    const enRoot = obj(en.root);
    const enParagraph = obj(en.paragraph);
    expect(enRoot.fontSize).toBe(15);
    expect(enRoot.fontFamily).toBe(fontSans());
    expect(Number(obj(en.heading1).fontSize ?? 0) > Number(obj(en.heading2).fontSize ?? 0)).toBe(true);
    expect(Number(obj(en.heading2).fontSize ?? 0) > Number(obj(en.heading3).fontSize ?? 0)).toBe(true);
    expect(Number(obj(en.heading3).fontSize ?? 0) > Number(enRoot.fontSize ?? 0)).toBe(true);
    expect(enParagraph.marginTop).toBe(0);
    expect(enParagraph.marginBottom).toBe(0);
    expect(Number(enRoot.gap ?? 0)).toBeGreaterThanOrEqual(8);
    expect(Number(obj(en.unorderedList).gap ?? 99)).toBeLessThan(Number(obj(en.orderedList).gap ?? 0));

    currentLocale.set("zh-CN");
    const zh = createMarkdownStyles();
    expect(Number(obj(zh.root).lineHeight ?? 0)).toBeGreaterThan(Number(enRoot.lineHeight ?? 0));
  } finally {
    currentLocale.set(before);
  }
});

test("cross-platform font stacks guarantee sans-serif CJK fallbacks and keep Windows inputs off SimSun", () => {
  const before = currentLocale();
  try {
    for (const locale of ["zh-CN", "en-US", "zh-TW"] as const) {
      currentLocale.set(locale);
      const stack = fontSans(locale);
      const families = stack.split(", ");
      expect(families[families.length - 1]).toBe("sans-serif");
      expect(stack).not.toMatch(/\b(SimSun|NSimSun|PMingLiU|MingLiU|Songti|Times New Roman|Georgia)\b/i);
      expect(stack).toContain('"Microsoft YaHei UI"');
      expect(stack).toContain('"PingFang SC"');
      expect(stack).toContain('"Noto Sans CJK SC"');
      expect(stack).toContain('"WenQuanYi Micro Hei"');
      expect(textStyle("body").fontFamily).toBe(stack);
      expect(textStyle("mono").fontFamily).toBe(fontMono);
    }

    // Traditional Chinese prioritizes TC sans-serif faces ahead of SC faces.
    const tcStack = fontSans("zh-TW");
    expect(tcStack.indexOf('"PingFang TC"')).toBeLessThan(tcStack.indexOf('"PingFang SC"'));
    expect(tcStack.indexOf('"Microsoft JhengHei UI"')).toBeLessThan(tcStack.indexOf('"Microsoft YaHei UI"'));

    // Windows `<Input>` leads with Windows' built-in CJK sans-serif UI font so RichEdit
    // stays in DirectWrite mode and never falls back to SimSun for CJK input.
    expect(inputFontSans("zh-CN", "windows").split(", ")[0]).toBe('"Microsoft YaHei UI"');
    expect(inputFontSans("en-US", "windows").split(", ")[0]).toBe('"Microsoft YaHei UI"');
    expect(inputFontSans("zh-TW", "windows").split(", ")[0]).toBe('"Microsoft JhengHei UI"');

    // Web, macOS, Linux, iOS, and Android reuse the full locale-aware sans-serif stack.
    for (const targetOs of ["web", "macos", "linux", "ios", "android"]) {
      expect(inputFontSans("zh-CN", targetOs)).toBe(fontSans("zh-CN"));
    }

    // Monospace code text includes sans-serif CJK fallbacks before generic monospace.
    expect(fontMono).toContain('"Microsoft YaHei UI"');
    expect(fontMono).toContain('"Noto Sans CJK SC"');
    expect(fontMono.endsWith("monospace")).toBe(true);

    // Unified toast auto-dismiss duration is 6 seconds.
    expect(DEFAULT_TOAST_DURATION_MS).toBe(6000);
  } finally {
    currentLocale.set(before);
  }
});
