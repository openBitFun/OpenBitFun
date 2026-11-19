/**
 * The app owns its visual design in NSH, so the palette lives here rather than
 * in the framework. Values implement OpenBitFun's 5-plane matte architectural
 * hierarchy, high-contrast primary actions, ultra-subtle translucent hairlines,
 * layered contact/ambient shadows, and 9 built-in appearances.
 *
 * `palette` is reactive: components bind `palette().text` inside JSX prop
 * expressions so switching appearance repaints without rebuilding scenes.
 */

import {
  Storage,
  colorScheme,
  computed,
  setColorScheme,
  setTheme,
  signal,
  type TextStyle,
  type Theme,
} from "nsh";
import { Scrollbar } from "nsh/base";

export type AppearanceId =
  | "openbitfun-dark"
  | "openbitfun-light"
  | "openbitfun-monochrome"
  | "openbitfun-slate"
  | "openbitfun-midnight"
  | "openbitfun-china-style"
  | "openbitfun-china-night"
  | "openbitfun-cyber"
  | "openbitfun-tokyo-night";

export type GitLaneColors = readonly [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];

export interface HarnessColors {
  readonly minimal: string;
  readonly standard: string;
  readonly ultimate: string;
  readonly creative: string;
}

export interface Palette {
  /** Left NavArea chrome background (`bgPrimary`). */
  chromeBg: string;
  /** NavArea primary text (distinct from scene text in split themes like Monochrome). */
  chromeText: string;
  /** NavArea secondary/muted text. */
  chromeTextMuted: string;
  /** Hover fill on NavArea chrome surfaces. */
  chromeHover: string;
  /** Active/selected fill on NavArea chrome surfaces. */
  chromeActive: string;
  /** Border/hairline on NavArea chrome surfaces. */
  chromeBorder: string;
  /** Search bar / raised control surface inside NavArea chrome. */
  chromeInputBg: string;
  /** Accent highlight readable on NavArea chrome (e.g. light contrast on dark-chrome Monochrome). */
  chromeAccent: string;
  /** Inset rounded SceneSurface (`bgScene`). */
  canvas: string;
  /** Topbars, footers, secondary panes. */
  canvasSubtle: string;
  /** Recessed pill track surface for SegmentedTabs and inline switchers. */
  segmentedTrackBg: string;
  /** Legacy alias for chrome/sidebar background. Never use inside scene canvas (breaks Monochrome). */
  panel: string;
  /** Lifted matte cards, ConfigSections, studio cards, and active segmented thumbs. */
  panelRaised: string;
  /** Subtle hover surface on lists, rows, and interactive cards. */
  panelHover: string;
  /** Calm low-emphasis inset container (code wells, inner trays, recessed sub-rows). */
  surfaceTertiary: string;
  /** Translucent local hover/inset tint (never a persistent outer panel). */
  surfaceSubtle: string;
  /** Elevated popovers, menus, and dialogs. */
  surfaceElevated: string;
  /** Explicit popover/menu surface alias. */
  popoverBg: string;
  /** Inputs & editors background. */
  inputBg: string;
  /** Translucent overlay surface. */
  glassSurface: string;
  /** Frosted sidebar chrome surface for glass headers/overlays. */
  glassChromeBg: string;
  /** Frosted popover, menu, dialog, and search overlay surface. */
  glassOverlayBg: string;
  /** Modal backdrop scrim tint (paired with backdrop blur). */
  scrimBg: string;
  /** User chat message bubble background. */
  userBubble: string;
  /** User chat message bubble foreground text. */
  userBubbleText: string;
  /** Warm secondary brand accent. */
  brandWarm: string;
  /** High-contrast foreground label/icon color on `brandWarm` fills (AA >= 4.5:1 across all 9 presets). */
  brandWarmFg: string;
  /** High-contrast primary button fill (unmistakable CTA across all 9 presets). */
  actionPrimaryBg: string;
  /** Hover fill for primary buttons. */
  actionPrimaryHover: string;
  /** Pressed fill for primary buttons. */
  actionPrimaryPressed: string;
  /** High-contrast foreground text/icon color on primary buttons. */
  actionPrimaryFg: string;
  /** Border color for primary buttons. */
  actionPrimaryBorder: string;
  /** Calm matte elevated fill for secondary buttons. */
  buttonSecondaryBg: string;
  /** Hover fill for secondary buttons. */
  buttonSecondaryHover: string;
  /** Pressed fill for secondary buttons. */
  buttonSecondaryPressed: string;
  /** Accent-solid button fill for explicit brand-colored CTAs. */
  actionSolid: string;
  /** Hover fill for `actionSolid` (AA >= 4.5:1 with `actionSolidFg`). */
  actionSolidHover: string;
  /** High-contrast foreground label on `actionSolid` (and active accent pills). */
  actionSolidFg: string;
  /** Ultra-subtle translucent hairline card/input border. */
  border: string;
  /** Whisper-thin internal hairline divider border. */
  borderSubtle: string;
  /** Emphasized translucent rim border for hovered controls, menus, popovers, and dialogs. */
  borderStrong: string;
  /** Focus ring / selected outline color (accent-aligned). */
  borderFocus: string;
  /** Theme-harmonized focus border for inputs & composers. */
  fieldFocusBorder: string;
  /** Subtle 1px top inset specular sheen on lifted cards and floating surfaces. */
  innerHighlight: string;
  /** Scene primary foreground text. */
  text: string;
  /** Scene secondary text. */
  textSecondary: string;
  /** Scene muted text (`#5c6672` preserved on light scheme, `#94949c` on dark for AA >= 4.5:1 across raised/tinted surfaces). */
  textMuted: string;
  /** AA-guaranteed muted text on elevated popover/dialog surfaces (`surfaceElevated`). */
  textElevatedMuted: string;
  /** Primary accent color. */
  accent: string;
  /** Hover variant of primary accent. */
  accentHover: string;
  /** Soft translucent accent tint. */
  accentSoft: string;
  /** Translucent hairline accent border for calm chips, badges, and callouts. */
  accentBorder: string;
  /** Subtle pill/chip fill. */
  chip: string;
  warning: string;
  warningSoft: string;
  /** Translucent hairline warning border. */
  warningBorder: string;
  danger: string;
  dangerSoft: string;
  /** Deepened translucent hover wash for danger buttons. */
  dangerHoverBg: string;
  /** Translucent hairline danger border. */
  dangerBorder: string;
  success: string;
  successSoft: string;
  /** Translucent hairline success border. */
  successBorder: string;
  /** Distinct level-0 surface for activity heatmaps across all 9 presets. */
  heatmapZero: string;
  /** Legible loading skeleton shimmer fill across both Light and Dark presets. */
  skeletonBg: string;
  /** Calm recessed ToggleSwitch track fill when OFF. */
  toggleTrackOff: string;
  /** Muted ToggleSwitch thumb fill when OFF (avoids glaring white on dark tracks). */
  toggleThumbOff: string;
  /** Colorblind-safe diff addition line wash. */
  diffAddBg: string;
  /** Colorblind-safe diff addition gutter rail & marker color. */
  diffAddRail: string;
  /** Colorblind-safe diff addition inline word highlight. */
  diffAddWordBg: string;
  /** Colorblind-safe diff deletion line wash. */
  diffDelBg: string;
  /** Colorblind-safe diff deletion gutter rail & marker color. */
  diffDelRail: string;
  /** Colorblind-safe diff deletion inline word highlight. */
  diffDelWordBg: string;
  /** Eight themed commit-graph / chart lane colors. */
  gitLanes: GitLaneColors;
  /** Harness profile identity colors (`minimal`, `standard`, `ultimate`, `creative`). */
  harnessColors: HarnessColors;
  /** Subtle custom scrollbar thumb resting color. */
  scrollbarThumb: string;
  /** Custom scrollbar thumb hovered/active color. */
  scrollbarThumbHover: string;
  /** Crisp micro contact shadow for elevated buttons and active segmented thumbs. */
  shadowButton: string;
  /** Subtle inner depth shadow for recessed inputs and segmented tracks. */
  shadowInset: string;
  shadowCard: string;
  shadowComposer: string;
  shadowComposerFocus: string;
  shadowOverlay: string;
  /** Compact whisper-quiet elevation shadow for micro-tooltips (no outer ring or modal bloom). */
  shadowTooltip: string;
  shadowFloating: string;
  shadowScene: string;
  shadowSceneEdge: string;
}

const DARK_GIT_LANES: GitLaneColors = [
  "#60a5fa",
  "#2dd4bf",
  "#a78bfa",
  "#f59e0b",
  "#fb7185",
  "#4ade80",
  "#38bdf8",
  "#e879f9",
];

const LIGHT_GIT_LANES: GitLaneColors = [
  "#1d56d8",
  "#0d9488",
  "#7c3aed",
  "#d97706",
  "#e11d48",
  "#16a34a",
  "#0284c7",
  "#c026d3",
];

const DARK_HARNESS_COLORS: HarnessColors = {
  minimal: "#a78bfa",
  standard: "#4ade80",
  ultimate: "#f59e0b",
  creative: "#60a5fa",
};

const LIGHT_HARNESS_COLORS: HarnessColors = {
  minimal: "#7c3aed",
  standard: "#16a34a",
  ultimate: "#d97706",
  creative: "#1d56d8",
};

const openbitfunDarkPalette: Palette = {
  chromeBg: "#0b0b0e",
  chromeText: "#ededf0",
  chromeTextMuted: "#94949c",
  chromeHover: "rgba(255, 255, 255, 0.055)",
  chromeActive: "rgba(255, 255, 255, 0.105)",
  chromeBorder: "rgba(255, 255, 255, 0.075)",
  chromeInputBg: "#141418",
  chromeAccent: "#60a5fa",
  canvas: "#141418",
  canvasSubtle: "#0f0f13",
  segmentedTrackBg: "#0e0e12",
  panel: "#0b0b0e",
  panelRaised: "#1d1d22",
  panelHover: "#24242b",
  surfaceTertiary: "#19191e",
  surfaceSubtle: "rgba(255, 255, 255, 0.045)",
  surfaceElevated: "#23232a",
  popoverBg: "#23232a",
  inputBg: "#111115",
  glassSurface: "rgba(31, 31, 38, 0.88)",
  glassChromeBg: "rgba(11, 11, 14, 0.90)",
  glassOverlayBg: "rgba(33, 33, 40, 0.94)",
  scrimBg: "rgba(0, 0, 0, 0.58)",
  userBubble: "#222630",
  userBubbleText: "#eef2f8",
  brandWarm: "#60a5fa",
  brandWarmFg: "#0b1220",
  actionPrimaryBg: "#f4f4f5",
  actionPrimaryHover: "#ffffff",
  actionPrimaryPressed: "#e4e4e7",
  actionPrimaryFg: "#111114",
  actionPrimaryBorder: "transparent",
  buttonSecondaryBg: "rgba(255, 255, 255, 0.048)",
  buttonSecondaryHover: "rgba(255, 255, 255, 0.088)",
  buttonSecondaryPressed: "rgba(255, 255, 255, 0.125)",
  actionSolid: "#2563eb",
  actionSolidHover: "#1d4ed8",
  actionSolidFg: "#ffffff",
  border: "rgba(255, 255, 255, 0.075)",
  borderSubtle: "rgba(255, 255, 255, 0.048)",
  borderStrong: "rgba(255, 255, 255, 0.14)",
  borderFocus: "#60a5fa",
  fieldFocusBorder: "rgba(96, 165, 250, 0.55)",
  innerHighlight: "inset 0 1px 0 rgba(255, 255, 255, 0.055)",
  text: "#ededf0",
  textSecondary: "#b5b5c0",
  // `#94949c` preserves calm matte hierarchy while clearing WCAG AA >= 4.65:1 on
  // `accentSoft`, `surfaceSubtle`, `panelHover`, and `surfaceElevated` (#85).
  textMuted: "#94949c",
  textElevatedMuted: "#9c9ca8",
  accent: "#60a5fa",
  accentHover: "#93c5fd",
  accentSoft: "rgba(96, 165, 250, 0.11)",
  accentBorder: "rgba(96, 165, 250, 0.22)",
  chip: "#24242b",
  warning: "#eab052",
  warningSoft: "rgba(234, 176, 82, 0.10)",
  warningBorder: "rgba(234, 176, 82, 0.22)",
  danger: "#f87171",
  dangerSoft: "rgba(248, 113, 113, 0.11)",
  dangerHoverBg: "rgba(248, 113, 113, 0.18)",
  dangerBorder: "rgba(248, 113, 113, 0.24)",
  success: "#4ade80",
  successSoft: "rgba(74, 222, 128, 0.10)",
  successBorder: "rgba(74, 222, 128, 0.22)",
  heatmapZero: "rgba(255, 255, 255, 0.065)",
  skeletonBg: "rgba(255, 255, 255, 0.075)",
  toggleTrackOff: "rgba(255, 255, 255, 0.10)",
  toggleThumbOff: "#9e9ea8",
  diffAddBg: "rgba(45, 212, 191, 0.10)",
  diffAddRail: "#3ee3cd",
  diffAddWordBg: "rgba(45, 212, 191, 0.19)",
  diffDelBg: "rgba(251, 113, 133, 0.10)",
  diffDelRail: "#ff94a8",
  diffDelWordBg: "rgba(251, 113, 133, 0.18)",
  gitLanes: DARK_GIT_LANES,
  harnessColors: DARK_HARNESS_COLORS,
  scrollbarThumb: "rgba(255, 255, 255, 0.20)",
  scrollbarThumbHover: "rgba(255, 255, 255, 0.34)",
  shadowButton: "0 1px 2px rgba(0, 0, 0, 0.28), 0 0.5px 1px rgba(0, 0, 0, 0.18)",
  shadowInset: "inset 0 1px 2px rgba(0, 0, 0, 0.26)",
  shadowCard: "0 1px 2px rgba(0, 0, 0, 0.26), 0 4px 12px rgba(0, 0, 0, 0.18)",
  shadowComposer: "0 2px 8px rgba(0, 0, 0, 0.30), 0 10px 26px rgba(0, 0, 0, 0.28)",
  shadowComposerFocus: "0 2px 10px rgba(0, 0, 0, 0.36), 0 12px 32px rgba(0, 0, 0, 0.34)",
  shadowOverlay: "0 8px 24px rgba(0, 0, 0, 0.44), 0 20px 48px rgba(0, 0, 0, 0.50)",
  shadowTooltip: "0 2px 6px rgba(0, 0, 0, 0.34), 0 4px 12px rgba(0, 0, 0, 0.22)",
  shadowFloating: "0 6px 18px rgba(0, 0, 0, 0.36), 0 16px 38px rgba(0, 0, 0, 0.46)",
  shadowScene: "-1px 0 0 rgba(255, 255, 255, 0.05), -6px 0 22px -8px rgba(0, 0, 0, 0.56)",
  shadowSceneEdge: "-1px 0 0 rgba(255, 255, 255, 0.05), -6px 0 22px -8px rgba(0, 0, 0, 0.56)",
};

const openbitfunLightPalette: Palette = {
  chromeBg: "#f2f3f6",
  chromeText: "#18181b",
  chromeTextMuted: "#5c6672",
  chromeHover: "rgba(15, 23, 42, 0.048)",
  chromeActive: "rgba(15, 23, 42, 0.085)",
  chromeBorder: "rgba(15, 23, 42, 0.075)",
  chromeInputBg: "#ffffff",
  chromeAccent: "#1d56d8",
  canvas: "#f7f8fa",
  canvasSubtle: "#edeff3",
  segmentedTrackBg: "#e9ecf1",
  panel: "#f2f3f6",
  panelRaised: "#ffffff",
  panelHover: "#f1f3f6",
  surfaceTertiary: "#f1f3f6",
  surfaceSubtle: "rgba(15, 23, 42, 0.036)",
  surfaceElevated: "#ffffff",
  popoverBg: "#ffffff",
  inputBg: "#ffffff",
  glassSurface: "rgba(255, 255, 255, 0.92)",
  glassChromeBg: "rgba(242, 243, 246, 0.92)",
  glassOverlayBg: "rgba(255, 255, 255, 0.96)",
  scrimBg: "rgba(15, 23, 42, 0.24)",
  userBubble: "#eaedf2",
  userBubbleText: "#18181b",
  brandWarm: "#1d56d8",
  brandWarmFg: "#ffffff",
  actionPrimaryBg: "#18181b",
  actionPrimaryHover: "#27272a",
  actionPrimaryPressed: "#09090b",
  actionPrimaryFg: "#ffffff",
  actionPrimaryBorder: "transparent",
  buttonSecondaryBg: "#ffffff",
  buttonSecondaryHover: "#f7f8fa",
  buttonSecondaryPressed: "#eef0f4",
  actionSolid: "#1d56d8",
  actionSolidHover: "#1746b8",
  actionSolidFg: "#ffffff",
  border: "rgba(15, 23, 42, 0.085)",
  borderSubtle: "rgba(15, 23, 42, 0.055)",
  borderStrong: "rgba(15, 23, 42, 0.15)",
  borderFocus: "#1d56d8",
  fieldFocusBorder: "rgba(29, 86, 216, 0.48)",
  innerHighlight: "inset 0 1px 0 rgba(255, 255, 255, 0.85)",
  text: "#18181b",
  textSecondary: "#45474f",
  // Keep `#5c6672` for light-mode contrast and App.test.tsx:191 + sessions-ux.test.tsx:358 assertions.
  textMuted: "#5c6672",
  textElevatedMuted: "#5c6672",
  accent: "#1d56d8",
  accentHover: "#1746b8",
  accentSoft: "rgba(29, 86, 216, 0.085)",
  accentBorder: "rgba(29, 86, 216, 0.22)",
  chip: "#eceff4",
  warning: "#945706",
  warningSoft: "rgba(148, 87, 6, 0.09)",
  warningBorder: "rgba(148, 87, 6, 0.22)",
  danger: "#c41d1d",
  dangerSoft: "rgba(196, 29, 29, 0.085)",
  dangerHoverBg: "rgba(196, 29, 29, 0.14)",
  dangerBorder: "rgba(196, 29, 29, 0.22)",
  success: "#116e33",
  successSoft: "rgba(17, 110, 51, 0.085)",
  successBorder: "rgba(17, 110, 51, 0.22)",
  heatmapZero: "rgba(15, 23, 42, 0.065)",
  skeletonBg: "rgba(15, 23, 42, 0.075)",
  toggleTrackOff: "#d5d9e2",
  toggleThumbOff: "#ffffff",
  diffAddBg: "rgba(11, 110, 101, 0.085)",
  diffAddRail: "#0b6e65",
  diffAddWordBg: "rgba(11, 110, 101, 0.19)",
  diffDelBg: "rgba(190, 18, 60, 0.08)",
  diffDelRail: "#be123c",
  diffDelWordBg: "rgba(190, 18, 60, 0.18)",
  gitLanes: LIGHT_GIT_LANES,
  harnessColors: LIGHT_HARNESS_COLORS,
  scrollbarThumb: "rgba(15, 23, 42, 0.16)",
  scrollbarThumbHover: "rgba(15, 23, 42, 0.30)",
  shadowButton: "0 1px 2px rgba(15, 23, 42, 0.055), 0 0.5px 1px rgba(15, 23, 42, 0.035)",
  shadowInset: "inset 0 1px 2px rgba(15, 23, 42, 0.04)",
  shadowCard: "0 1px 2px rgba(15, 23, 42, 0.045), 0 4px 12px rgba(15, 23, 42, 0.03)",
  shadowComposer: "0 1px 3px rgba(15, 23, 42, 0.05), 0 8px 22px rgba(15, 23, 42, 0.06)",
  shadowComposerFocus: "0 1px 4px rgba(15, 23, 42, 0.06), 0 10px 28px rgba(15, 23, 42, 0.10)",
  shadowOverlay: "0 6px 18px rgba(15, 23, 42, 0.08), 0 18px 42px rgba(15, 23, 42, 0.12)",
  shadowTooltip: "0 2px 6px rgba(15, 23, 42, 0.08), 0 4px 12px rgba(15, 23, 42, 0.06)",
  shadowFloating: "0 4px 12px rgba(15, 23, 42, 0.07), 0 14px 32px rgba(15, 23, 42, 0.11)",
  shadowScene: "-1px 0 0 rgba(15, 23, 42, 0.05), -6px 0 18px -8px rgba(15, 23, 42, 0.08)",
  shadowSceneEdge: "-1px 0 0 rgba(15, 23, 42, 0.05), -6px 0 18px -8px rgba(15, 23, 42, 0.08)",
};

const openbitfunMonochromePalette: Palette = {
  ...openbitfunLightPalette,
  chromeBg: "#121215",
  chromeText: "#f3f3f5",
  chromeTextMuted: "#a1a1aa",
  chromeHover: "rgba(255, 255, 255, 0.08)",
  chromeActive: "rgba(255, 255, 255, 0.13)",
  chromeBorder: "rgba(255, 255, 255, 0.09)",
  chromeInputBg: "#1d1d22",
  chromeAccent: "#f3f3f5",
  glassChromeBg: "rgba(18, 18, 21, 0.92)",
  panel: "#121215",
  canvas: "#f7f7f9",
  canvasSubtle: "#ededf0",
  segmentedTrackBg: "#e8e8ec",
  surfaceTertiary: "#f1f1f4",
  panelRaised: "#ffffff",
  panelHover: "#efeff2",
  userBubble: "#ececef",
  userBubbleText: "#18181b",
  brandWarm: "#18181b",
  brandWarmFg: "#ffffff",
  actionPrimaryBg: "#18181b",
  actionPrimaryHover: "#27272a",
  actionPrimaryPressed: "#000000",
  actionPrimaryFg: "#ffffff",
  actionPrimaryBorder: "transparent",
  actionSolid: "#18181b",
  actionSolidHover: "#27272a",
  actionSolidFg: "#ffffff",
  borderFocus: "#18181b",
  fieldFocusBorder: "rgba(24, 24, 27, 0.34)",
  shadowComposerFocus: "0 1px 4px rgba(24, 24, 27, 0.06), 0 10px 28px rgba(24, 24, 27, 0.11)",
  shadowScene: "0 0 0 1px rgba(255, 255, 255, 0.07), -8px 0 24px -8px rgba(0, 0, 0, 0.44)",
  shadowSceneEdge: "0 0 0 1px rgba(255, 255, 255, 0.07), -8px 0 24px -8px rgba(0, 0, 0, 0.44)",
  accent: "#18181b",
  accentHover: "#27272a",
  accentSoft: "rgba(24, 24, 27, 0.075)",
  accentBorder: "rgba(24, 24, 27, 0.20)",
  heatmapZero: "rgba(24, 24, 27, 0.075)",
  toggleTrackOff: "#d4d4d8",
  toggleThumbOff: "#ffffff",
};

const openbitfunSlatePalette: Palette = {
  ...openbitfunDarkPalette,
  chromeBg: "#13151a",
  chromeTextMuted: "#9ba1ae",
  chromeAccent: "#a3b2c6",
  chromeInputBg: "#1c1f26",
  glassChromeBg: "rgba(19, 21, 26, 0.92)",
  panel: "#13151a",
  canvas: "#1b1d22",
  canvasSubtle: "#15171c",
  segmentedTrackBg: "#13151a",
  surfaceTertiary: "#202228",
  panelRaised: "#25282f",
  panelHover: "#2d3039",
  surfaceElevated: "#2b2e37",
  popoverBg: "#2b2e37",
  glassOverlayBg: "rgba(43, 46, 55, 0.94)",
  inputBg: "#16181d",
  userBubble: "#262b35",
  accent: "#a3b2c6",
  accentHover: "#cbd5e1",
  accentSoft: "rgba(163, 178, 198, 0.12)",
  accentBorder: "rgba(163, 178, 198, 0.24)",
  danger: "#fb8585",
  dangerSoft: "rgba(251, 133, 133, 0.11)",
  dangerHoverBg: "rgba(251, 133, 133, 0.18)",
  dangerBorder: "rgba(251, 133, 133, 0.25)",
  heatmapZero: "rgba(255, 255, 255, 0.07)",
  toggleTrackOff: "rgba(255, 255, 255, 0.11)",
  toggleThumbOff: "#a1a8b5",
  brandWarm: "#94a3b8",
  brandWarmFg: "#0f172a",
  actionPrimaryBg: "#e2e8f0",
  actionPrimaryHover: "#f1f5f9",
  actionPrimaryPressed: "#cbd5e1",
  actionPrimaryFg: "#0f172a",
  actionPrimaryBorder: "transparent",
  actionSolid: "#475569",
  actionSolidHover: "#3b4759",
  actionSolidFg: "#f8fafc",
  borderFocus: "#a3b2c6",
  fieldFocusBorder: "rgba(163, 178, 198, 0.48)",
  textSecondary: "#b8bec8",
  textMuted: "#9ba1ae",
  textElevatedMuted: "#a4aab8",
};

const openbitfunMidnightPalette: Palette = {
  ...openbitfunDarkPalette,
  chromeBg: "#111318",
  chromeText: "#e8ecf4",
  chromeTextMuted: "#9ca4b4",
  chromeInputBg: "#1a1d24",
  glassChromeBg: "rgba(17, 19, 24, 0.92)",
  panel: "#111318",
  canvas: "#1a1d24",
  canvasSubtle: "#14171d",
  segmentedTrackBg: "#12151b",
  surfaceTertiary: "#1f222a",
  panelRaised: "#242831",
  panelHover: "#2c313c",
  surfaceElevated: "#2a2f3a",
  popoverBg: "#2a2f3a",
  glassOverlayBg: "rgba(42, 47, 58, 0.94)",
  inputBg: "#15181f",
  userBubble: "#272e3d",
  accent: "#79b6ff",
  accentHover: "#9cc9ff",
  accentSoft: "rgba(121, 182, 255, 0.11)",
  accentBorder: "rgba(121, 182, 255, 0.24)",
  danger: "#ff9494",
  dangerSoft: "rgba(255, 148, 148, 0.11)",
  dangerHoverBg: "rgba(255, 148, 148, 0.18)",
  dangerBorder: "rgba(255, 148, 148, 0.26)",
  heatmapZero: "rgba(255, 255, 255, 0.075)",
  toggleTrackOff: "rgba(255, 255, 255, 0.11)",
  toggleThumbOff: "#a5a8b2",
  brandWarmFg: "#0b1220",
  actionPrimaryBg: "#edf2ff",
  actionPrimaryHover: "#ffffff",
  actionPrimaryPressed: "#dbe4ff",
  actionPrimaryFg: "#0b1220",
  actionPrimaryBorder: "transparent",
  fieldFocusBorder: "rgba(121, 182, 255, 0.52)",
  text: "#e8ecf4",
  textSecondary: "#b6bfd0",
  textMuted: "#9ca4b4",
  textElevatedMuted: "#a4adc0",
};

const openbitfunChinaStylePalette: Palette = {
  ...openbitfunLightPalette,
  chromeBg: "#ede9da",
  chromeText: "#1c242e",
  chromeTextMuted: "#525962",
  chromeHover: "rgba(106, 92, 70, 0.07)",
  chromeActive: "rgba(106, 92, 70, 0.12)",
  chromeBorder: "rgba(106, 92, 70, 0.12)",
  chromeInputBg: "#fdfcf7",
  chromeAccent: "#2e5e8a",
  glassChromeBg: "rgba(237, 233, 218, 0.92)",
  panel: "#ede9da",
  canvas: "#f7f4ea",
  canvasSubtle: "#ebe6d8",
  segmentedTrackBg: "#ebe6d8",
  surfaceTertiary: "#f1ede0",
  surfaceSubtle: "rgba(106, 92, 70, 0.05)",
  panelRaised: "#fdfcf7",
  panelHover: "#ece8d8",
  surfaceElevated: "#fdfcf7",
  popoverBg: "#fdfcf7",
  glassOverlayBg: "rgba(253, 252, 247, 0.96)",
  inputBg: "#fdfcf7",
  userBubble: "#e7eef4",
  userBubbleText: "#1c2836",
  border: "rgba(106, 92, 70, 0.12)",
  borderSubtle: "rgba(106, 92, 70, 0.075)",
  borderStrong: "rgba(106, 92, 70, 0.20)",
  actionPrimaryBg: "#1c2836",
  actionPrimaryHover: "#26384b",
  actionPrimaryPressed: "#121b24",
  actionPrimaryFg: "#faf8f0",
  actionPrimaryBorder: "transparent",
  buttonSecondaryBg: "#fdfcf7",
  buttonSecondaryHover: "#f4f1e4",
  buttonSecondaryPressed: "#eae5d6",
  accent: "#2e5e8a",
  accentHover: "#234a6e",
  accentSoft: "rgba(46, 94, 138, 0.10)",
  accentBorder: "rgba(46, 94, 138, 0.24)",
  warning: "#945706",
  warningSoft: "rgba(148, 87, 6, 0.095)",
  warningBorder: "rgba(148, 87, 6, 0.24)",
  danger: "#c41d1d",
  dangerSoft: "rgba(196, 29, 29, 0.085)",
  dangerHoverBg: "rgba(196, 29, 29, 0.14)",
  dangerBorder: "rgba(196, 29, 29, 0.22)",
  diffAddRail: "#09665e",
  diffDelRail: "#b81139",
  heatmapZero: "rgba(106, 92, 70, 0.085)",
  skeletonBg: "rgba(106, 92, 70, 0.09)",
  toggleTrackOff: "#dad4c3",
  toggleThumbOff: "#fdfcf7",
  brandWarm: "#7eb09b",
  brandWarmFg: "#14261f",
  actionSolid: "#2e5e8a",
  actionSolidHover: "#234a6e",
  actionSolidFg: "#ffffff",
  borderFocus: "#2e5e8a",
  fieldFocusBorder: "rgba(46, 94, 138, 0.45)",
  text: "#1c242e",
  textSecondary: "#454a52",
  shadowButton: "0 1px 2px rgba(74, 62, 44, 0.06), 0 0.5px 1px rgba(74, 62, 44, 0.04)",
  shadowInset: "inset 0 1px 2px rgba(74, 62, 44, 0.045)",
  shadowCard: "0 1px 2px rgba(74, 62, 44, 0.055), 0 4px 12px rgba(74, 62, 44, 0.035)",
  shadowComposer: "0 1px 3px rgba(74, 62, 44, 0.06), 0 8px 22px rgba(74, 62, 44, 0.07)",
  shadowComposerFocus: "0 1px 4px rgba(74, 62, 44, 0.07), 0 10px 28px rgba(74, 62, 44, 0.11)",
  shadowOverlay: "0 6px 18px rgba(74, 62, 44, 0.09), 0 18px 42px rgba(74, 62, 44, 0.13)",
  shadowTooltip: "0 2px 6px rgba(74, 62, 44, 0.09), 0 4px 12px rgba(74, 62, 44, 0.07)",
  shadowFloating: "0 4px 12px rgba(74, 62, 44, 0.08), 0 14px 32px rgba(74, 62, 44, 0.12)",
  shadowScene: "-1px 0 0 rgba(74, 62, 44, 0.06), -6px 0 18px -8px rgba(74, 62, 44, 0.10)",
  shadowSceneEdge: "-1px 0 0 rgba(74, 62, 44, 0.06), -6px 0 18px -8px rgba(74, 62, 44, 0.10)",
  chip: "#eae5d5",
};

const openbitfunChinaNightPalette: Palette = {
  ...openbitfunDarkPalette,
  chromeBg: "#131416",
  chromeText: "#eceae4",
  chromeTextMuted: "#9e9e98",
  chromeAccent: "#8ebde0",
  chromeInputBg: "#1b1d20",
  glassChromeBg: "rgba(19, 20, 22, 0.92)",
  panel: "#131416",
  canvas: "#1b1c1f",
  canvasSubtle: "#151619",
  segmentedTrackBg: "#131417",
  surfaceTertiary: "#202226",
  panelRaised: "#25272b",
  panelHover: "#2d3035",
  surfaceElevated: "#2c2e33",
  popoverBg: "#2c2e33",
  glassOverlayBg: "rgba(44, 46, 51, 0.94)",
  inputBg: "#16171a",
  userBubble: "#262b33",
  accent: "#8ebde0",
  accentHover: "#a8cfec",
  accentSoft: "rgba(142, 189, 224, 0.12)",
  accentBorder: "rgba(142, 189, 224, 0.25)",
  danger: "#ff9494",
  dangerSoft: "rgba(255, 148, 148, 0.11)",
  dangerHoverBg: "rgba(255, 148, 148, 0.18)",
  dangerBorder: "rgba(255, 148, 148, 0.26)",
  heatmapZero: "rgba(255, 255, 255, 0.07)",
  toggleTrackOff: "rgba(255, 255, 255, 0.11)",
  toggleThumbOff: "#a1a19c",
  brandWarm: "#96c6b4",
  brandWarmFg: "#0f201a",
  actionPrimaryBg: "#eceae3",
  actionPrimaryHover: "#f7f6f1",
  actionPrimaryPressed: "#dad7cd",
  actionPrimaryFg: "#17181b",
  actionPrimaryBorder: "transparent",
  actionSolid: "#457499",
  actionSolidHover: "#396283",
  actionSolidFg: "#ffffff",
  borderFocus: "#8ebde0",
  fieldFocusBorder: "rgba(142, 189, 224, 0.50)",
  text: "#eceae4",
  textSecondary: "#bcbab2",
  textMuted: "#a4a49e",
  textElevatedMuted: "#acaca6",
};

const openbitfunCyberPalette: Palette = {
  ...openbitfunDarkPalette,
  chromeBg: "#0a0b0f",
  chromeText: "#e0f2ff",
  chromeTextMuted: "#86b4d2",
  chromeBorder: "rgba(0, 230, 255, 0.12)",
  chromeAccent: "#00e6ff",
  chromeInputBg: "#12151e",
  glassChromeBg: "rgba(10, 11, 15, 0.92)",
  panel: "#0a0b0f",
  canvas: "#12141b",
  canvasSubtle: "#0d0f15",
  segmentedTrackBg: "#0c0e14",
  surfaceTertiary: "#171a23",
  surfaceSubtle: "rgba(0, 230, 255, 0.055)",
  panelRaised: "#1c202b",
  panelHover: "#232836",
  surfaceElevated: "#222735",
  popoverBg: "#222735",
  glassOverlayBg: "rgba(32, 37, 50, 0.94)",
  inputBg: "#0f1118",
  userBubble: "#1c2636",
  userBubbleText: "#e0f2ff",
  text: "#e0f2ff",
  textSecondary: "#b0d8f2",
  textMuted: "#86b4d2",
  textElevatedMuted: "#92bedc",
  border: "rgba(0, 230, 255, 0.12)",
  borderSubtle: "rgba(0, 230, 255, 0.075)",
  borderStrong: "rgba(0, 230, 255, 0.24)",
  accent: "#00e6ff",
  accentHover: "#5ceeff",
  accentSoft: "rgba(0, 230, 255, 0.11)",
  accentBorder: "rgba(0, 230, 255, 0.24)",
  danger: "#fb8080",
  dangerSoft: "rgba(251, 128, 128, 0.11)",
  dangerHoverBg: "rgba(251, 128, 128, 0.18)",
  dangerBorder: "rgba(251, 128, 128, 0.26)",
  heatmapZero: "rgba(0, 230, 255, 0.075)",
  skeletonBg: "rgba(0, 230, 255, 0.085)",
  toggleTrackOff: "rgba(0, 230, 255, 0.12)",
  toggleThumbOff: "#86b4d2",
  brandWarm: "#a855f7",
  brandWarmFg: "#0c0416",
  actionPrimaryBg: "#00e6ff",
  actionPrimaryHover: "#5ceeff",
  actionPrimaryPressed: "#00c8df",
  actionPrimaryFg: "#061318",
  actionPrimaryBorder: "transparent",
  buttonSecondaryBg: "rgba(0, 230, 255, 0.065)",
  buttonSecondaryHover: "rgba(0, 230, 255, 0.12)",
  buttonSecondaryPressed: "rgba(0, 230, 255, 0.175)",
  actionSolid: "#00c4dc",
  actionSolidHover: "#00d9f2",
  actionSolidFg: "#061318",
  borderFocus: "#00e6ff",
  fieldFocusBorder: "rgba(0, 230, 255, 0.48)",
  shadowComposerFocus: "0 4px 22px rgba(0, 230, 255, 0.16), 0 2px 10px rgba(0, 0, 0, 0.44)",
};

const openbitfunTokyoNightPalette: Palette = {
  ...openbitfunDarkPalette,
  chromeBg: "#131520",
  chromeText: "#c0caf5",
  chromeTextMuted: "#a2add6",
  chromeBorder: "rgba(192, 202, 245, 0.095)",
  chromeInputBg: "#1b1e2e",
  chromeAccent: "#96b8ff",
  glassChromeBg: "rgba(19, 21, 32, 0.92)",
  panel: "#131520",
  canvas: "#1b1e2e",
  canvasSubtle: "#161926",
  segmentedTrackBg: "#141724",
  surfaceTertiary: "#202436",
  surfaceSubtle: "rgba(192, 202, 245, 0.055)",
  panelRaised: "#262b40",
  panelHover: "#2e344d",
  surfaceElevated: "#2d334c",
  popoverBg: "#2d334c",
  glassOverlayBg: "rgba(42, 47, 72, 0.94)",
  inputBg: "#161926",
  userBubble: "#28304a",
  userBubbleText: "#d5ddf9",
  border: "rgba(192, 202, 245, 0.095)",
  borderSubtle: "rgba(192, 202, 245, 0.06)",
  borderStrong: "rgba(192, 202, 245, 0.18)",
  text: "#c8d1f7",
  textSecondary: "#a9b1d6",
  textMuted: "#a2add6",
  textElevatedMuted: "#a8b3dc",
  actionPrimaryBg: "#c0caf5",
  actionPrimaryHover: "#d8e0ff",
  actionPrimaryPressed: "#a9b6ea",
  actionPrimaryFg: "#131726",
  actionPrimaryBorder: "transparent",
  buttonSecondaryBg: "rgba(192, 202, 245, 0.06)",
  buttonSecondaryHover: "rgba(192, 202, 245, 0.11)",
  buttonSecondaryPressed: "rgba(192, 202, 245, 0.16)",
  accent: "#96b8ff",
  accentHover: "#b4ccff",
  accentSoft: "rgba(150, 184, 255, 0.12)",
  accentBorder: "rgba(150, 184, 255, 0.25)",
  danger: "#ff9494",
  dangerSoft: "rgba(255, 148, 148, 0.11)",
  dangerHoverBg: "rgba(255, 148, 148, 0.18)",
  dangerBorder: "rgba(255, 148, 148, 0.26)",
  heatmapZero: "rgba(192, 202, 245, 0.08)",
  skeletonBg: "rgba(192, 202, 245, 0.09)",
  toggleTrackOff: "rgba(192, 202, 245, 0.13)",
  toggleThumbOff: "#9aa5ce",
  brandWarm: "#bb9af7",
  brandWarmFg: "#120d24",
  actionSolid: "#4668c4",
  actionSolidHover: "#3c5bb2",
  actionSolidFg: "#ffffff",
  borderFocus: "#96b8ff",
  fieldFocusBorder: "rgba(150, 184, 255, 0.48)",
  shadowComposerFocus: "0 2px 10px rgba(15, 18, 32, 0.40), 0 12px 30px rgba(15, 18, 32, 0.50)",
  chip: "#2a3048",
};

export interface AppearancePreset {
  id: AppearanceId;
  label: string;
  isLight: boolean;
  palette: Palette;
}

export const APPEARANCE_PRESETS: ReadonlyArray<AppearancePreset> = [
  { id: "openbitfun-dark", label: "Dark", isLight: false, palette: openbitfunDarkPalette },
  { id: "openbitfun-light", label: "Light", isLight: true, palette: openbitfunLightPalette },
  { id: "openbitfun-monochrome", label: "Monochrome", isLight: true, palette: openbitfunMonochromePalette },
  { id: "openbitfun-slate", label: "Slate", isLight: false, palette: openbitfunSlatePalette },
  { id: "openbitfun-midnight", label: "Midnight", isLight: false, palette: openbitfunMidnightPalette },
  { id: "openbitfun-china-style", label: "Ink & Paper", isLight: true, palette: openbitfunChinaStylePalette },
  { id: "openbitfun-china-night", label: "Night Ink", isLight: false, palette: openbitfunChinaNightPalette },
  { id: "openbitfun-cyber", label: "Cyber", isLight: false, palette: openbitfunCyberPalette },
  { id: "openbitfun-tokyo-night", label: "Tokyo Night", isLight: false, palette: openbitfunTokyoNightPalette },
];

const PRESET_MAP: Record<AppearanceId, AppearancePreset> = {
  "openbitfun-dark": APPEARANCE_PRESETS[0],
  "openbitfun-light": APPEARANCE_PRESETS[1],
  "openbitfun-monochrome": APPEARANCE_PRESETS[2],
  "openbitfun-slate": APPEARANCE_PRESETS[3],
  "openbitfun-midnight": APPEARANCE_PRESETS[4],
  "openbitfun-china-style": APPEARANCE_PRESETS[5],
  "openbitfun-china-night": APPEARANCE_PRESETS[6],
  "openbitfun-cyber": APPEARANCE_PRESETS[7],
  "openbitfun-tokyo-night": APPEARANCE_PRESETS[8],
};

export function isAppearanceId(value: unknown): value is AppearanceId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(PRESET_MAP, value);
}

export function getAppearancePreset(id: AppearanceId): AppearancePreset {
  return PRESET_MAP[id];
}

export const APPEARANCE_STORAGE_KEY = "openbitfun.nsh.appearance.v1";
export const APPEARANCE_ID_STORAGE_KEY = "openbitfun.nsh.appearance-id.v1";

/** Desktop UI sans-serif font stack aligned with `src/web-ui`. */
export const fontSans =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "HarmonyOS Sans SC", "Inter", "Segoe UI", system-ui, sans-serif';

/** Code / monospace font stack aligned with `src/web-ui`. */
export const fontMono =
  '"Fira Code", "SF Mono", Menlo, Monaco, Consolas, ui-monospace, monospace';

/** The scheme the user chose in this surface: follow the host, or force one. */
export const appearanceMode = signal<"system" | "light" | "dark">("system");

/** Optional specific built-in Tauri appearance preset overriding default light/dark. */
export const appearanceId = signal<AppearanceId | null>(null);

/** The scheme in use, with `system` resolved against the host's appearance. */
export const resolvedScheme = computed<"light" | "dark">(() => {
  const chosenId = appearanceId();
  if (chosenId && PRESET_MAP[chosenId]) {
    return PRESET_MAP[chosenId].isLight ? "light" : "dark";
  }
  const mode = appearanceMode();
  if (mode !== "system") return mode;
  return colorScheme() === "light" ? "light" : "dark";
});

export const isLightAppearance = computed(() => resolvedScheme() === "light");

export const resolvedAppearanceId = computed<AppearanceId>(() => {
  const chosenId = appearanceId();
  if (chosenId && PRESET_MAP[chosenId]) return chosenId;
  return resolvedScheme() === "light" ? "openbitfun-light" : "openbitfun-dark";
});

export const palette = computed(() => {
  const chosenId = appearanceId();
  if (chosenId && PRESET_MAP[chosenId]) {
    return PRESET_MAP[chosenId].palette;
  }
  return resolvedScheme() === "light" ? openbitfunLightPalette : openbitfunDarkPalette;
});

function paletteToCssVars(p: Palette): Record<string, string | number> {
  return {
    background: p.canvas,
    foreground: p.text,
    card: p.panelRaised,
    "card-foreground": p.text,
    popover: p.popoverBg,
    "popover-foreground": p.text,
    primary: p.accent,
    "primary-foreground": p.actionSolidFg,
    secondary: p.surfaceTertiary,
    "secondary-foreground": p.text,
    muted: p.surfaceTertiary,
    "muted-foreground": p.textMuted,
    accent: p.panelHover,
    "accent-foreground": p.text,
    destructive: p.danger,
    border: p.border,
    input: p.borderStrong,
    ring: p.borderFocus,
    "chart-1": p.gitLanes[0],
    "chart-2": p.gitLanes[1],
    "chart-3": p.gitLanes[2],
    "chart-4": p.gitLanes[3],
    "chart-5": p.gitLanes[4],
    sidebar: p.chromeBg,
    "sidebar-foreground": p.chromeText,
    "sidebar-primary": p.chromeAccent,
    "sidebar-primary-foreground": p.chromeBg,
    "sidebar-accent": p.chromeActive,
    "sidebar-accent-foreground": p.chromeText,
    "sidebar-border": p.chromeBorder,
    "sidebar-ring": p.chromeAccent,
  };
}

/**
 * Syncs NSH's global native widget theme (`TextView`, `DiffView`, `Editor`,
 * `Terminal`, `Tree`) and custom hover-fade scrollbars with the active
 * OpenBitFun appearance preset. Safe to invoke in both browser and headless
 * test runtimes.
 */
export function syncGlobalNativeTheme(): void {
  const chosenId = appearanceId();
  const activePreset = chosenId ? PRESET_MAP[chosenId] : null;
  const activePalette = activePreset ? activePreset.palette : palette();

  const nativeTheme: Theme = {
    cssVars: {
      theme: {
        radius: "0.5rem",
        "font-sans": fontSans,
        "font-mono": fontMono,
      },
      light: paletteToCssVars(
        activePreset ? activePreset.palette : openbitfunLightPalette,
      ),
      dark: paletteToCssVars(
        activePreset ? activePreset.palette : openbitfunDarkPalette,
      ),
    },
  };

  try {
    setTheme(nativeTheme);
  } catch {
    // Headless or host environments without native theming keep palette rendering cleanly.
  }

  try {
    Scrollbar.setTheme({
      mode: "hover",
      minThumbLength: 40,
      motion: {
        idle: 1100,
        enter: 140,
        exit: 220,
        entrance: "fade",
        thumbHoverEntrance: "fade",
      },
      vertical: {
        style: {
          width: 10,
          paddingHorizontal: 2,
          paddingVertical: 4,
          backgroundColor: "transparent",
        },
        thumbStyle: {
          borderRadius: 999,
          backgroundColor: activePalette.scrollbarThumb,
        },
      },
      horizontal: {
        style: {
          height: 10,
          paddingVertical: 2,
          paddingHorizontal: 4,
          backgroundColor: "transparent",
        },
        thumbStyle: {
          borderRadius: 999,
          backgroundColor: activePalette.scrollbarThumb,
        },
      },
    });
  } catch {
    // Scrollbar theming is progressive enhancement; never block rendering if unavailable.
  }
}

export function selectAppearancePreset(id: AppearanceId | null): void {
  appearanceId.set(id);
  if (id && PRESET_MAP[id]) {
    const preset = PRESET_MAP[id];
    const scheme: "light" | "dark" = preset.isLight ? "light" : "dark";
    appearanceMode.set(scheme);
    try {
      setColorScheme(scheme);
    } catch {
      // Ignore if host forbids runtime scheme override.
    }
    void Storage.setItem(APPEARANCE_ID_STORAGE_KEY, id).catch(() => {});
    void Storage.setItem(APPEARANCE_STORAGE_KEY, scheme).catch(() => {});
  } else {
    void Storage.removeItem(APPEARANCE_ID_STORAGE_KEY).catch(() => {});
  }
  syncGlobalNativeTheme();
}

export const spacing = {
  rowPaddingX: 12,
  rowPaddingY: 8,
  gap: 8,
  sectionGap: 28,
  cardPaddingX: 16,
  cardPaddingY: 14,
} as const;

/**
 * Unified interactive control height scale locking buttons, inputs, selects,
 * icon buttons, and segmented controls onto one razor-sharp toolbar baseline.
 */
export const controlHeight = {
  xs: 24,
  sm: 28,
  md: 32,
  lg: 38,
} as const;

export type ControlSize = keyof typeof controlHeight;

/**
 * Standardized continuous-curve radius scale for concentric nesting
 * (`innerRadius = concentricRadius(outerRadius, insetPadding)`).
 */
export const radii = {
  xs: 6,
  sm: 8,
  md: 10,
  lg: 12,
  xl: 16,
  surface: 20,
  pill: 999,
} as const;

/** Computes an optically concentric inner border radius for nested rounded surfaces. */
export function concentricRadius(outer: number, inset: number): number {
  return Math.max(4, outer - inset);
}

/**
 * The px every text size in this surface is written against. The host's font
 * preference is a baseline for this value, not a size of its own: the desktop
 * scales the whole type ramp from it, so a scene here asks `textSize` for the
 * size it would draw at 14 and the preference moves all of them together.
 */
export const BASE_FONT_SIZE = 14;

/** What the user's `font` config resolves to, in px (12–20). */
export const uiFontBasePx = signal(BASE_FONT_SIZE);

export const uiFontScale = computed(() => uiFontBasePx() / BASE_FONT_SIZE);

/**
 * Semantic typographic scale (base px at default 14px baseline) establishing
 * unmistakable hierarchy between page titles, section titles, rows, and metadata.
 */
export const typeScale = {
  display: 26,
  pageTitle: 22,
  sectionTitle: 15,
  cardTitle: 13.5,
  body: 14,
  label: 13,
  control: 12.5,
  caption: 12,
  meta: 11.5,
  micro: 10.5,
} as const;

/**
 * One text size, scaled to the preference. Read it inside a style, not into a
 * `const` in a component body: components run once and a scale change then
 * would not repaint.
 */
export function textSize(base: number): number {
  const scale = uiFontScale();
  return scale === 1 ? base : Math.max(8, Math.round(base * scale));
}

/**
 * Scaled line height derived from `textSize(base)` so every multi-line text
 * stays optically balanced across all user font-scale preferences.
 */
export function textLineHeight(base: number, ratio = 1.45): number {
  return Math.round(textSize(base) * ratio);
}

/**
 * Size-specific optical letter-spacing (in points) aligned with Apple typography:
 * tighter negative tracking on large display/scene titles, zero on body copy,
 * and positive tracking on uppercase micro-labels.
 */
export function textTracking(base: number, uppercase = false): number {
  const px = textSize(base);
  if (uppercase) return px <= 11 ? 0.55 : 0.45;
  if (px >= 22) return Number((-px * 0.022).toFixed(2));
  if (px >= 17) return Number((-px * 0.018).toFixed(2));
  if (px >= 14.5) return Number((-px * 0.014).toFixed(2));
  if (px >= 13.5) return Number((-px * 0.008).toFixed(2));
  return 0;
}

export type TextRole =
  | "display"
  | "pageTitle"
  | "sectionTitle"
  | "cardTitle"
  | "body"
  | "label"
  | "caption"
  | "meta"
  | "micro"
  | "mono";

export interface TextStyleOptions {
  color?: string;
  uppercase?: boolean;
  tabular?: boolean;
}

/**
 * Reactive semantic typography preset combining optical size, weight, leading,
 * tracking, and theme color. Call inside JSX style bindings so theme & font
 * baseline switches repaint instantaneously.
 */
export function textStyle(role: TextRole, opts?: TextStyleOptions): TextStyle {
  const uppercase = Boolean(opts?.uppercase);
  const tabular = opts?.tabular ? (["tabular-nums"] as TextStyle["fontVariant"]) : undefined;
  switch (role) {
    case "display":
      return {
        color: opts?.color ?? palette().text,
        fontSize: textSize(typeScale.display),
        fontWeight: "600",
        letterSpacing: textTracking(typeScale.display, uppercase),
        lineHeight: textLineHeight(typeScale.display, 1.18),
        fontVariant: tabular,
      };
    case "pageTitle":
      return {
        color: opts?.color ?? palette().text,
        fontSize: textSize(typeScale.pageTitle),
        fontWeight: "600",
        letterSpacing: textTracking(typeScale.pageTitle, uppercase),
        lineHeight: textLineHeight(typeScale.pageTitle, 1.24),
        fontVariant: tabular,
      };
    case "sectionTitle":
      return {
        color: opts?.color ?? palette().text,
        fontSize: textSize(typeScale.sectionTitle),
        fontWeight: "600",
        letterSpacing: textTracking(typeScale.sectionTitle, uppercase),
        lineHeight: textLineHeight(typeScale.sectionTitle, 1.3),
        fontVariant: tabular,
      };
    case "cardTitle":
      return {
        color: opts?.color ?? palette().text,
        fontSize: textSize(typeScale.cardTitle),
        fontWeight: "600",
        letterSpacing: textTracking(typeScale.cardTitle, uppercase),
        lineHeight: textLineHeight(typeScale.cardTitle, 1.32),
        fontVariant: tabular,
      };
    case "body":
      return {
        color: opts?.color ?? palette().text,
        fontSize: textSize(typeScale.body),
        fontWeight: "400",
        letterSpacing: textTracking(typeScale.body, uppercase),
        lineHeight: textLineHeight(typeScale.body, 1.6),
        fontVariant: tabular,
      };
    case "label":
      return {
        color: opts?.color ?? palette().text,
        fontSize: textSize(typeScale.label),
        fontWeight: "500",
        letterSpacing: textTracking(typeScale.label, uppercase),
        lineHeight: textLineHeight(typeScale.label, 1.36),
        fontVariant: tabular,
      };
    case "caption":
      return {
        color: opts?.color ?? palette().textMuted,
        fontSize: textSize(typeScale.caption),
        fontWeight: "400",
        letterSpacing: textTracking(typeScale.caption, uppercase),
        lineHeight: textLineHeight(typeScale.caption, 1.44),
        fontVariant: tabular,
      };
    case "meta":
      return {
        color: opts?.color ?? palette().textMuted,
        fontSize: textSize(typeScale.meta),
        fontWeight: "500",
        letterSpacing: textTracking(typeScale.meta, uppercase),
        lineHeight: textLineHeight(typeScale.meta, 1.38),
        fontVariant: tabular ?? ["tabular-nums"],
      };
    case "micro":
      return {
        color: opts?.color ?? palette().textMuted,
        fontSize: textSize(typeScale.micro),
        fontWeight: uppercase ? "600" : "500",
        letterSpacing: textTracking(typeScale.micro, uppercase),
        lineHeight: textLineHeight(typeScale.micro, 1.32),
        textTransform: uppercase ? "uppercase" : undefined,
        fontVariant: tabular ?? ["tabular-nums"],
      };
    case "mono":
      return {
        color: opts?.color ?? palette().textSecondary,
        fontFamily: fontMono,
        fontSize: textSize(12),
        fontWeight: "400",
        lineHeight: textLineHeight(12, 1.5),
        fontVariant: ["tabular-nums"],
      };
  }
}
