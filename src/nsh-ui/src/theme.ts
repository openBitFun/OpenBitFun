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
  context,
  platform,
  setColorScheme,
  setTheme,
  signal,
  type TextStyle,
  type Theme,
} from "nsh";
import { Scrollbar } from "nsh/base";
import { currentLocale } from "./i18n";

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
  /** ToggleSwitch track when ON (the desktop's control highlight). */
  switchOn: string;
  /** Selected segment of a SegmentedTabs track. */
  segmentedThumbBg: string;
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
  chromeBg: "#0e0e10",
  chromeText: "#e8e8e8",
  chromeTextMuted: "#9e9ea6",
  chromeHover: "rgba(255, 255, 255, 0.06)",
  chromeActive: "rgba(255, 255, 255, 0.1)",
  chromeBorder: "rgba(255, 255, 255, 0.1)",
  chromeInputBg: "#1c1c1f",
  chromeAccent: "#3fb6c4",
  canvas: "#1c1c1f",
  canvasSubtle: "#18181b",
  segmentedTrackBg: "rgba(255, 255, 255, 0.08)",
  panel: "#0e0e10",
  panelRaised: "#232327",
  panelHover: "#2a2a2f",
  surfaceTertiary: "#161618",
  surfaceSubtle: "rgba(255, 255, 255, 0.06)",
  surfaceElevated: "#26262a",
  popoverBg: "#26262a",
  inputBg: "#1c1c1f",
  glassSurface: "rgba(38, 38, 42, 0.92)",
  glassChromeBg: "rgba(14, 14, 16, 0.92)",
  glassOverlayBg: "rgba(38, 38, 42, 0.97)",
  scrimBg: "rgba(0, 0, 0, 0.56)",
  userBubble: "#2c2c31",
  userBubbleText: "#ededf0",
  brandWarm: "#3fb6c4",
  brandWarmFg: "#062a2f",
  // Crisp solid primary CTA aligned with `actionSolid` (visual spec §2.4): 4.85:1 white text.
  actionPrimaryBg: "#0b7d8d",
  actionPrimaryHover: "#0a6f7d",
  actionPrimaryPressed: "#08616e",
  actionPrimaryFg: "#ffffff",
  actionPrimaryBorder: "transparent",
  buttonSecondaryBg: "rgba(255, 255, 255, 0.07)",
  buttonSecondaryHover: "rgba(255, 255, 255, 0.12)",
  buttonSecondaryPressed: "rgba(255, 255, 255, 0.15)",
  actionSolid: "#0b7d8d",
  actionSolidHover: "#0a6f7d",
  actionSolidFg: "#ffffff",
  border: "rgba(255, 255, 255, 0.12)",
  borderSubtle: "rgba(255, 255, 255, 0.08)",
  borderStrong: "rgba(255, 255, 255, 0.2)",
  borderFocus: "#3fb6c4",
  fieldFocusBorder: "rgba(255, 255, 255, 0.34)",
  innerHighlight: "inset 0 1px 0 rgba(255, 255, 255, 0.05)",
  text: "#e8e8e8",
  textSecondary: "#b8b8be",
  // `#9e9ea6` preserves calm matte hierarchy while clearing WCAG AA >= 4.59:1 across
  // `accentSoft`, `segmentedTrackBg`, `buttonSecondaryBg`, `panelRaised`, and `surfaceElevated`.
  textMuted: "#9e9ea6",
  textElevatedMuted: "#a6a6ae",
  // One teal signal in both schemes (visual spec §2.4): 7.04:1 on canvas, 7.99:1 on chrome.
  accent: "#3fb6c4",
  accentHover: "#6fcbd6",
  accentSoft: "rgba(63, 182, 196, 0.12)",
  accentBorder: "rgba(63, 182, 196, 0.28)",
  chip: "#2a2a2f",
  warning: "#ff930f",
  warningSoft: "rgba(255, 140, 0, 0.10)",
  warningBorder: "rgba(255, 140, 0, 0.30)",
  danger: "#f47f7d",
  dangerSoft: "rgba(236, 34, 31, 0.12)",
  dangerHoverBg: "rgba(236, 34, 31, 0.20)",
  dangerBorder: "rgba(236, 34, 31, 0.32)",
  success: "#5fc178",
  successSoft: "rgba(26, 167, 62, 0.12)",
  successBorder: "rgba(26, 167, 62, 0.30)",
  heatmapZero: "rgba(255, 255, 255, 0.065)",
  skeletonBg: "rgba(255, 255, 255, 0.075)",
  toggleTrackOff: "#4a4a50",
  toggleThumbOff: "#d4d4d8",
  // Toggles follow the accent family: white on it is 4.85:1.
  switchOn: "#0b7d8d",
  segmentedThumbBg: "rgba(255, 255, 255, 0.14)",
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
  shadowButton: "0 0 0 0 rgba(0, 0, 0, 0)",
  shadowInset: "0 0 0 0 rgba(0, 0, 0, 0)",
  shadowCard: "0 1px 2px rgba(0, 0, 0, 0.18)",
  shadowComposer: "0 2px 6px rgba(0, 0, 0, 0.32)",
  shadowComposerFocus: "0 2px 10px rgba(0, 0, 0, 0.36), 0 8px 24px rgba(0, 0, 0, 0.28)",
  shadowOverlay: "0 4px 20px rgba(0, 0, 0, 0.48)",
  shadowTooltip: "0 2px 4px rgba(0, 0, 0, 0.40)",
  shadowFloating: "0 4px 10px rgba(0, 0, 0, 0.48)",
  shadowScene: "0 0 0 1px rgba(255, 255, 255, 0.06)",
  shadowSceneEdge: "0 0 0 1px rgba(255, 255, 255, 0.06)",
};

const openbitfunLightPalette: Palette = {
  chromeBg: "#f3f3f5",
  chromeText: "#1f2023",
  chromeTextMuted: "#5c6672",
  chromeHover: "rgba(0, 0, 0, 0.045)",
  chromeActive: "rgba(0, 0, 0, 0.075)",
  chromeBorder: "rgba(16, 26, 39, 0.08)",
  chromeInputBg: "#ffffff",
  chromeAccent: "#101a27",
  canvas: "#ffffff",
  canvasSubtle: "#f8f8f9",
  segmentedTrackBg: "rgba(0, 0, 0, 0.05)",
  panel: "#f3f3f5",
  panelRaised: "#ffffff",
  panelHover: "#f5f5f7",
  surfaceTertiary: "#f7f7f8",
  surfaceSubtle: "rgba(0, 0, 0, 0.04)",
  surfaceElevated: "#ffffff",
  popoverBg: "#ffffff",
  inputBg: "#ffffff",
  glassSurface: "rgba(255, 255, 255, 0.92)",
  glassChromeBg: "rgba(243, 243, 245, 0.92)",
  glassOverlayBg: "rgba(255, 255, 255, 0.96)",
  scrimBg: "rgba(16, 26, 39, 0.22)",
  userBubble: "#f1f1f3",
  userBubbleText: "#1f2023",
  brandWarm: "#08798a",
  brandWarmFg: "#ffffff",
  actionPrimaryBg: "#101a27",
  actionPrimaryHover: "#1c1c1f",
  actionPrimaryPressed: "#000000",
  actionPrimaryFg: "#ffffff",
  actionPrimaryBorder: "transparent",
  buttonSecondaryBg: "rgba(0, 0, 0, 0.05)",
  buttonSecondaryHover: "rgba(0, 0, 0, 0.08)",
  buttonSecondaryPressed: "rgba(0, 0, 0, 0.10)",
  actionSolid: "#08798a",
  actionSolidHover: "#0b6f7f",
  actionSolidFg: "#ffffff",
  border: "rgba(16, 26, 39, 0.11)",
  borderSubtle: "rgba(16, 26, 39, 0.07)",
  borderStrong: "rgba(16, 26, 39, 0.20)",
  borderFocus: "#059cb0",
  fieldFocusBorder: "rgba(16, 26, 39, 0.34)",
  innerHighlight: "inset 0 1px 0 rgba(255, 255, 255, 0.85)",
  text: "#1f2023",
  textSecondary: "#4a4c52",
  // Keep `#5c6672` for light-mode contrast and App.test.tsx:191 + sessions-ux.test.tsx:358 assertions.
  textMuted: "#5c6672",
  textElevatedMuted: "#5c6672",
  accent: "#08798a",
  accentHover: "#0b6f7f",
  accentSoft: "rgba(5, 156, 176, 0.09)",
  accentBorder: "rgba(5, 156, 176, 0.28)",
  chip: "#f1f1f3",
  warning: "#8a5005",
  warningSoft: "rgba(138, 80, 5, 0.09)",
  warningBorder: "rgba(138, 80, 5, 0.22)",
  danger: "#c41d1d",
  dangerSoft: "rgba(196, 29, 29, 0.085)",
  dangerHoverBg: "rgba(196, 29, 29, 0.14)",
  dangerBorder: "rgba(196, 29, 29, 0.22)",
  success: "#116e33",
  successSoft: "rgba(17, 110, 51, 0.085)",
  successBorder: "rgba(17, 110, 51, 0.22)",
  heatmapZero: "rgba(15, 23, 42, 0.065)",
  skeletonBg: "rgba(15, 23, 42, 0.075)",
  toggleTrackOff: "rgba(0, 0, 0, 0.12)",
  toggleThumbOff: "#ffffff",
  switchOn: "#08798a",
  segmentedThumbBg: "#ffffff",
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
  shadowButton: "0 0 0 0 rgba(0, 0, 0, 0)",
  shadowInset: "0 0 0 0 rgba(0, 0, 0, 0)",
  shadowCard: "0 1px 2px rgba(16, 26, 39, 0.04)",
  shadowComposer: "0 1px 3px rgba(15, 23, 42, 0.05), 0 8px 22px rgba(15, 23, 42, 0.06)",
  shadowComposerFocus: "0 1px 4px rgba(15, 23, 42, 0.06), 0 10px 28px rgba(15, 23, 42, 0.10)",
  shadowOverlay: "0 4px 20px rgba(0, 0, 0, 0.12)",
  shadowTooltip: "0 2px 6px rgba(0, 0, 0, 0.10)",
  shadowFloating: "0 4px 14px rgba(0, 0, 0, 0.10)",
  shadowScene: "0 0 0 1px rgba(16, 26, 39, 0.06)",
  shadowSceneEdge: "0 0 0 1px rgba(16, 26, 39, 0.06)",
};

const openbitfunMonochromePalette: Palette = {
  ...openbitfunLightPalette,
  // Kept from before the openbitfun presets moved to teal (visual spec §2.4).
  switchOn: "#059cb0",
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
  canvas: "#ffffff",
  canvasSubtle: "#f7f7f8",
  segmentedTrackBg: "rgba(0, 0, 0, 0.05)",
  surfaceTertiary: "#f1f1f4",
  panelRaised: "#ffffff",
  panelHover: "#f4f4f5",
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
  // Kept from before the openbitfun presets moved to teal (visual spec §2.4).
  switchOn: "#059cb0",
  chromeBg: "#1c1c1f",
  chromeTextMuted: "#9ba1ae",
  chromeAccent: "#a3b2c6",
  chromeInputBg: "#262626",
  glassChromeBg: "rgba(28, 28, 31, 0.92)",
  panel: "#1c1c1f",
  canvas: "#262626",
  canvasSubtle: "#212121",
  segmentedTrackBg: "#13151a",
  surfaceTertiary: "#222222",
  panelRaised: "#2e2e30",
  panelHover: "#353538",
  surfaceElevated: "#313335",
  popoverBg: "#313335",
  glassOverlayBg: "rgba(49, 51, 53, 0.97)",
  inputBg: "#262626",
  userBubble: "#333438",
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
  actionPrimaryBg: "#475569",
  actionPrimaryHover: "#3b4759",
  actionPrimaryPressed: "#334155",
  actionPrimaryFg: "#f8fafc",
  actionPrimaryBorder: "transparent",
  actionSolid: "#475569",
  actionSolidHover: "#3b4759",
  actionSolidFg: "#f8fafc",
  borderFocus: "#a3b2c6",
  fieldFocusBorder: "rgba(163, 178, 198, 0.48)",
  textSecondary: "#c0c6d0",
  textMuted: "#a4aab6",
  textElevatedMuted: "#acb2be",
};

const openbitfunMidnightPalette: Palette = {
  ...openbitfunDarkPalette,
  // Kept from before the openbitfun presets moved to teal (visual spec §2.4).
  switchOn: "#059cb0",
  brandWarm: "#60a5fa",
  actionSolid: "#2563eb",
  actionSolidHover: "#1d4ed8",
  chromeBg: "#1c1c1f",
  chromeText: "#d4d4d4",
  chromeTextMuted: "#a8a8a8",
  chromeInputBg: "#2b2d30",
  glassChromeBg: "rgba(28, 28, 31, 0.92)",
  panel: "#1c1c1f",
  canvas: "#2b2d30",
  canvasSubtle: "#25272a",
  segmentedTrackBg: "#12151b",
  surfaceTertiary: "#26282b",
  panelRaised: "#313335",
  panelHover: "#383a3d",
  surfaceElevated: "#35373a",
  popoverBg: "#35373a",
  glassOverlayBg: "rgba(53, 55, 58, 0.97)",
  inputBg: "#2b2d30",
  userBubble: "#36383c",
  accent: "#6aa8e8",
  accentHover: "#8fbcf0",
  accentSoft: "rgba(96, 165, 250, 0.12)",
  accentBorder: "rgba(96, 165, 250, 0.26)",
  danger: "#ff9494",
  dangerSoft: "rgba(255, 148, 148, 0.11)",
  dangerHoverBg: "rgba(255, 148, 148, 0.18)",
  dangerBorder: "rgba(255, 148, 148, 0.26)",
  heatmapZero: "rgba(255, 255, 255, 0.075)",
  toggleTrackOff: "rgba(255, 255, 255, 0.11)",
  toggleThumbOff: "#a5a8b2",
  brandWarmFg: "#0b1220",
  actionPrimaryBg: "#2563eb",
  actionPrimaryHover: "#1d4ed8",
  actionPrimaryPressed: "#1e40af",
  actionPrimaryFg: "#ffffff",
  actionPrimaryBorder: "transparent",
  fieldFocusBorder: "rgba(106, 168, 232, 0.50)",
  text: "#d4d4d4",
  textSecondary: "#bababe",
  textMuted: "#b0b0b4",
  textElevatedMuted: "#b4b4b8",
  chip: "#383a3d",
  borderFocus: "#6aa8e8",
  chromeAccent: "#6aa8e8",
};

const openbitfunChinaStylePalette: Palette = {
  ...openbitfunLightPalette,
  // Kept from before the openbitfun presets moved to teal (visual spec §2.4).
  switchOn: "#059cb0",
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
  warning: "#824b04",
  warningSoft: "rgba(130, 75, 4, 0.095)",
  warningBorder: "rgba(130, 75, 4, 0.24)",
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
  // Kept from before the openbitfun presets moved to teal (visual spec §2.4).
  switchOn: "#059cb0",
  chromeBg: "#1c1c1f",
  chromeText: "#eceae4",
  chromeTextMuted: "#9e9e98",
  chromeAccent: "#8ebde0",
  chromeInputBg: "#262626",
  glassChromeBg: "rgba(28, 28, 31, 0.92)",
  panel: "#1c1c1f",
  canvas: "#262626",
  canvasSubtle: "#212121",
  segmentedTrackBg: "#131417",
  surfaceTertiary: "#222222",
  panelRaised: "#2e2e30",
  panelHover: "#353538",
  surfaceElevated: "#313335",
  popoverBg: "#313335",
  glassOverlayBg: "rgba(49, 51, 53, 0.97)",
  inputBg: "#262626",
  userBubble: "#33363b",
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
  actionPrimaryBg: "#457499",
  actionPrimaryHover: "#396283",
  actionPrimaryPressed: "#2e516d",
  actionPrimaryFg: "#ffffff",
  actionPrimaryBorder: "transparent",
  actionSolid: "#457499",
  actionSolidHover: "#396283",
  actionSolidFg: "#ffffff",
  borderFocus: "#8ebde0",
  fieldFocusBorder: "rgba(142, 189, 224, 0.50)",
  text: "#eceae4",
  textSecondary: "#c2c0b8",
  textMuted: "#acaca6",
  textElevatedMuted: "#b4b4ae",
};

const openbitfunCyberPalette: Palette = {
  ...openbitfunDarkPalette,
  // Kept from before the openbitfun presets moved to teal (visual spec §2.4).
  switchOn: "#059cb0",
  chromeBg: "#0b0d12",
  chromeText: "#e0f2ff",
  chromeTextMuted: "#86b4d2",
  chromeBorder: "rgba(0, 230, 255, 0.12)",
  chromeAccent: "#00e6ff",
  chromeInputBg: "#161a22",
  glassChromeBg: "rgba(11, 13, 18, 0.92)",
  panel: "#0b0d12",
  canvas: "#161a22",
  canvasSubtle: "#12151c",
  segmentedTrackBg: "#0c0e14",
  surfaceTertiary: "#141820",
  surfaceSubtle: "rgba(0, 230, 255, 0.055)",
  panelRaised: "#1d222c",
  panelHover: "#242a36",
  surfaceElevated: "#222835",
  popoverBg: "#222835",
  glassOverlayBg: "rgba(34, 40, 53, 0.97)",
  inputBg: "#161a22",
  userBubble: "#1c2636",
  userBubbleText: "#e0f2ff",
  text: "#e0f2ff",
  textSecondary: "#b0d8f2",
  textMuted: "#86b4d2",
  textElevatedMuted: "#92bedc",
  border: "rgba(0, 230, 255, 0.14)",
  borderSubtle: "rgba(0, 230, 255, 0.09)",
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
  actionPrimaryBg: "#00c4dc",
  actionPrimaryHover: "#00d9f2",
  actionPrimaryPressed: "#00acc2",
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
  // Kept from before the openbitfun presets moved to teal (visual spec §2.4).
  switchOn: "#059cb0",
  chromeBg: "#1a1b26",
  chromeText: "#c0caf5",
  chromeTextMuted: "#a2add6",
  chromeBorder: "rgba(169, 177, 214, 0.12)",
  chromeInputBg: "#24283b",
  chromeAccent: "#96b8ff",
  glassChromeBg: "rgba(26, 27, 38, 0.92)",
  panel: "#1a1b26",
  canvas: "#24283b",
  canvasSubtle: "#1f2233",
  segmentedTrackBg: "#141724",
  surfaceTertiary: "#202436",
  surfaceSubtle: "rgba(192, 202, 245, 0.055)",
  panelRaised: "#2b3048",
  panelHover: "#323852",
  surfaceElevated: "#2f334d",
  popoverBg: "#2f334d",
  glassOverlayBg: "rgba(47, 51, 77, 0.97)",
  inputBg: "#24283b",
  userBubble: "#30364f",
  userBubbleText: "#d5ddf9",
  border: "rgba(169, 177, 214, 0.16)",
  borderSubtle: "rgba(169, 177, 214, 0.10)",
  borderStrong: "rgba(169, 177, 214, 0.26)",
  text: "#c8d1f7",
  textSecondary: "#a9b1d6",
  textMuted: "#a2add6",
  textElevatedMuted: "#a8b3dc",
  actionPrimaryBg: "#4668c4",
  actionPrimaryHover: "#3c5bb2",
  actionPrimaryPressed: "#334d99",
  actionPrimaryFg: "#ffffff",
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
  chip: "#323852",
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

type UiLocale = ReturnType<typeof currentLocale>;

/**
 * Native-first sans-serif stacks covering macOS, iOS, Windows, Linux, Android,
 * and browser hosts without bundling a heavy CJK font on web/Apple/mobile.
 * Explicit CJK sans-serif families precede `sans-serif` so neither browsers on
 * Linux/Windows nor native text engines ever fall back to serif faces (e.g.
 * SimSun, PMingLiU, AR PL UMing).
 */
const systemFontSansSC =
  'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans SC", "Source Han Sans SC", "WenQuanYi Micro Hei", "PingFang TC", "Microsoft JhengHei UI", "Microsoft JhengHei", "Noto Sans CJK TC", "Noto Sans TC", sans-serif';

const systemFontSansTC =
  'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "PingFang TC", "Hiragino Sans CNS", "Microsoft JhengHei UI", "Microsoft JhengHei", "Noto Sans CJK TC", "Noto Sans TC", "Source Han Sans TC", "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans SC", "WenQuanYi Micro Hei", sans-serif';

/**
 * Windows native `<Input>` uses windowless RichEdit (`ITextServices2`), whose
 * hardware-accelerated DirectWrite mode (`TXTBIT_D2DDWRITE`) only sees system
 * fonts and whose single `CHARFORMAT2W.szFaceName` falls back to SimSun (serif)
 * for CJK whenever the face lacks CJK glyphs (such as Segoe UI or Latin-only
 * HarmonyOS Sans) or GDI rejects/mismatches an in-memory variable font. Naming
 * Windows' built-in CJK sans-serif UI face first keeps RichEdit in DirectWrite
 * mode and prevents SimSun fallback for both Latin and CJK input.
 */
const windowsInputFontSansSC =
  '"Microsoft YaHei UI", "Microsoft YaHei", "Segoe UI", sans-serif';

const windowsInputFontSansTC =
  '"Microsoft JhengHei UI", "Microsoft JhengHei", "Microsoft YaHei UI", "Microsoft YaHei", "Segoe UI", sans-serif';

type BundledUiFonts = { base: string; simplifiedChinese: string };
let bundledUiFonts: BundledUiFonts | undefined;

/** A desktop entry supplies the family names returned by NSH's font imports before mount. */
export function installBundledUiFonts(fonts: BundledUiFonts): void {
  bundledUiFonts = fonts;
}

export function hasBundledUiFonts(): boolean {
  return bundledUiFonts !== undefined;
}

export function fontSans(locale: UiLocale = currentLocale()): string {
  const fallback = locale === "zh-TW" ? systemFontSansTC : systemFontSansSC;
  if (!bundledUiFonts || locale === "zh-TW") return fallback;
  if (locale === "zh-CN") {
    return `"${bundledUiFonts.simplifiedChinese}", "${bundledUiFonts.base}", ${fallback}`;
  }
  // Keep the bundled SC face right behind the Latin face so CJK text shown in
  // an English UI still renders in HarmonyOS Sans instead of degrading.
  return `"${bundledUiFonts.base}", "${bundledUiFonts.simplifiedChinese}", ${fallback}`;
}

export function inputFontSans(
  locale: UiLocale = currentLocale(),
  targetOs: string = platform.os,
): string {
  if (targetOs === "windows") {
    return locale === "zh-TW" ? windowsInputFontSansTC : windowsInputFontSansSC;
  }
  return fontSans(locale);
}

/** Latin stays monospaced; missing glyphs follow the localized UI font, as in the former web UI. */
export function fontMono(): string {
  return `'Fira Code', 'Cascadia Mono', 'Cascadia Code', Consolas, 'Liberation Mono', SFMono-Regular, 'SF Mono', Menlo, Monaco, 'Courier New', ${fontSans()}, monospace`;
}

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

/**
 * The visual plane a control sits on. Split-plane appearances such as
 * Monochrome pair a dark navigation chrome (`chromeBg`) with a light canvas
 * (`canvas`), so shared controls (focus rings, state marks, badges) read
 * `SurfaceContext()` to pick chrome-plane tokens automatically.
 */
export type SurfacePlane = "canvas" | "chrome";

export const SurfaceContext = context<SurfacePlane>("canvas");

function hexRelativeLuminance(hex: string): number | null {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** True when the active palette pairs a light canvas with dark navigation chrome (Monochrome). */
export function isSplitChromePalette(p: Palette = palette()): boolean {
  const canvasLum = hexRelativeLuminance(p.canvas);
  const chromeLum = hexRelativeLuminance(p.chromeBg);
  if (canvasLum === null || chromeLum === null) return false;
  return canvasLum > 0.5 && chromeLum < 0.15;
}

/**
 * Working/running signal color for a given surface plane. Preserves brand teal
 * on uniform light/dark chrome, and switches to `chromeAccent` when dark chrome
 * sits beside a light canvas (Monochrome, where canvas `accent` is `#18181b`).
 */
export function surfaceWorkingColor(surface: SurfacePlane = SurfaceContext(), p: Palette = palette()): string {
  if (surface === "chrome" && isSplitChromePalette(p)) {
    return p.chromeAccent;
  }
  return p.accent;
}

/** Focus-ring color that stays high-contrast on both canvas and dark chrome planes. */
export function surfaceFocusColor(surface: SurfacePlane = SurfaceContext(), p: Palette = palette()): string {
  return surface === "chrome" ? p.chromeAccent : p.borderFocus;
}

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
export function syncGlobalNativeTheme(family = fontSans()): void {
  const chosenId = appearanceId();
  const activePreset = chosenId ? PRESET_MAP[chosenId] : null;
  const activePalette = activePreset ? activePreset.palette : palette();

  const nativeTheme: Theme = {
    cssVars: {
      theme: {
        radius: "0.5rem",
        "font-sans": family,
        "font-mono": fontMono(),
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

/**
 * @deprecated Use `space` (the 4-based scale) and `layout` (the shell
 * rhythm). Kept so existing call sites compile; values unchanged.
 */
export const spacing = {
  rowPaddingX: 12,
  rowPaddingY: 8,
  gap: 8,
  sectionGap: 28,
  cardPaddingX: 16,
  cardPaddingY: 14,
} as const;

/**
 * The spacing scale (visual spec §2.2): 2, 4, 8, 12, 16, 20, 24, 32, 40, 48,
 * 64. Off-scale values (3, 5, 7, 9, 10, 14, 18, 22) are retired; `chip` (6)
 * survives only as the inset inside chips and code wells.
 */
export const space = {
  hair: 2,
  xs: 4,
  chip: 6,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  x3l: 32,
  x4l: 40,
  x5l: 48,
  x6l: 64,
} as const;

export type SpaceStep = keyof typeof space;

/** The scale as numbers, for tests and for snapping a measured value. */
export const SPACE_SCALE: ReadonlyArray<number> = [2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64];

/** Shell, width and rhythm constants of visual spec §2.2. */
export const layout = {
  /** Wide (>= 1200): the sidebar docks at 264 (drag 232–360). */
  wideMinWidth: 1200,
  /** Medium (960–1199): the sidebar docks at 240. */
  mediumDockMinWidth: 960,
  /** Below 720 the phone layout (`compactLayout`) applies. */
  phoneMaxWidth: 719,
  navDefaultWidth: 264,
  navMinWidth: 232,
  navMaxWidth: 360,
  navMediumWidth: 240,
  /** 720–959: the sidebar is an overlay drawer this wide. */
  navDrawerWidth: 264,
  canvasInset: 8,
  canvasRadius: 12,
  inspectorWidth: 420,
  inspectorMinWidth: 360,
  inspectorMaxWidth: 640,
  inspectorSheetWidth: 400,
  /** The inspector becomes a sheet when the canvas would drop below this. */
  canvasMinWidth: 560,
  topBarHeight: 44,
  phoneTopBarHeight: 56,
  /** Left space kept for the macOS traffic lights while the sidebar is hidden. */
  trafficLightInset: 76,
  phoneTabBarHeight: 56,
  phoneGutter: 16,
  touchTarget: 44,
  /** The conversation and session column default (`contentWidth()`). */
  conversationWidth: 760,
  pageWidth: 720,
  settingsWidth: 680,
  signInWidth: 360,
  modalConfirmWidth: 400,
  modalFormWidth: 480,
  modalContentWidth: 640,
  pagePaddingTop: 32,
  phonePagePaddingTop: 16,
  pageGutter: 32,
  titleToSection: 24,
  sectionGap: 32,
  sectionHeaderGap: 8,
} as const;

/**
 * Unified interactive control height scale locking buttons, inputs, selects,
 * icon buttons, and segmented controls onto one toolbar baseline.
 */
export const controlHeight = {
  xs: 24,
  sm: 28,
  md: 32,
  lg: 40,
} as const;

export type ControlSize = keyof typeof controlHeight;

/**
 * The radius scale (visual spec §2.3). Nested shapes use
 * `concentricRadius(outer, inset)`; no raw `borderRadius` numbers.
 * - `xs` 4: inline code, key caps, diff word marks, focus inset
 * - `sm` 6: chips, badges, small (24) buttons, code wells inside cards
 * - `md` 8: buttons, inputs, menu items, row hover and selection
 * - `lg` 12: cards, inset groups, menus, popovers, toasts, the canvas
 * - `xl` 16: the composer, modals, phone sheets (top corners)
 * - `pill`: status dots, avatars, segmented track and thumb, toggles, counts
 */
export const radii = {
  xs: 4,
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  pill: 999,
  /** @deprecated Retired (was 20). Reads as the canvas radius; use `layout.canvasRadius` or `radii.lg`. */
  surface: 12,
} as const;

/** Computes an optically concentric inner border radius for nested rounded surfaces. */
export function concentricRadius(outer: number, inset: number): number {
  return Math.max(radii.xs, outer - inset);
}

/**
 * The three lifted levels (visual spec §2.3); everything else is level 0,
 * flat with 1 px hairlines (`borderSubtle`).
 * - 0: canvas, cards, rows, settings groups: no shadow
 * - 1: the composer, the only lifted in-page surface (`shadowComposer`, focused `shadowComposerFocus`)
 * - 2: menus, popovers, toasts (`shadowOverlay`); tooltips (`shadowTooltip`)
 * - 3: modals and phone sheets (`shadowOverlay` over a `scrimBg` scrim)
 */
export type ElevationLevel = 0 | 1 | 2 | 3;

export interface ElevationOptions {
  /** Level 1: the composer has focus. */
  focused?: boolean;
  /** Level 2: a tooltip, which takes the compact shadow. */
  tooltip?: boolean;
}

/** The `boxShadow` of a level in the active palette (`undefined` at level 0). */
export function elevationShadow(level: ElevationLevel, opts?: ElevationOptions): string | undefined {
  const p = palette();
  if (level === 1) return opts?.focused ? p.shadowComposerFocus : p.shadowComposer;
  if (level === 2) return opts?.tooltip ? p.shadowTooltip : p.shadowOverlay;
  if (level === 3) return p.shadowOverlay;
  return undefined;
}

/** The scrim drawn under a level-3 surface. */
export function elevationScrim(): string {
  return palette().scrimBg;
}

/**
 * Motion tokens (visual spec §2.6). Springs are NSH's
 * `transitionTimingFunction: "spring(stiffness, damping)"`, which times
 * itself (no duration). Durations are milliseconds.
 */
export const springs = {
  /** Job card enter, Inbox and history row insert/remove, modal entrance. */
  snappy: "spring(420, 41)",
  /** Toggle thumb. */
  toggle: "spring(520, 36)",
  /** Critically damped default for larger moves. */
  standard: "spring(320, 36)",
} as const;

export const motionTiming = {
  /** Hover and press tint (`paintTransition(120)`). */
  hover: 120,
  /** A state word, mark, count or diffstat change crossfades in place. */
  crossfade: 160,
  /** Sheets, drawers, the ⌘I Inbox sheet: in at 220 (drawer ease), out at 180. */
  sheetIn: 220,
  sheetOut: 180,
  /** Menus and popovers: fade + 4 px rise. */
  popover: 160,
  popoverRise: 4,
  /** Toasts: fade + 8 px rise in, faster out. */
  toastIn: 220,
  toastOut: 160,
  toastRise: 8,
  /** The working pulse: `animationName: "pulse"`, infinite. */
  pulse: 1600,
  /** OpenBitFun thinking: the matrix ring cells pulse with this stagger, looping. */
  matrixStagger: 140,
  matrixLoop: 680,
  /** An answered prompt fades to `textMuted`, holds, then collapses (snappy spring). */
  answeredFade: 160,
  answeredHold: 1600,
  /** A cited card's `accentSoft` fades out. */
  citationFade: 600,
  /** `SceneTransition` fade. */
  scene: 160,
  /** Under `reduceMotion()` only opacity crossfades this short remain. */
  reducedMax: 120,
} as const;

/**
 * What never animates (visual spec §2.6). Under `reduceMotion()` only opacity
 * crossfades of `motionTiming.reducedMax` or less remain, and the pulse and
 * the matrix ring freeze at full opacity.
 */
export const NEVER_ANIMATE: ReadonlyArray<string> = [
  "scrolling, or anything driven by scroll",
  "streamed text reflow (no per-token fade, no caret)",
  "list reorder (rows swap in place with a crossfade)",
  "number tickers",
  "sidebar drag",
  "window resize",
  "skeleton shimmer (static skeletonBg)",
  "anything looping while the window is hidden",
];

/**
 * The px every text size in this surface is written against. The host's font
 * preference is a baseline for this value, not a size of its own: the desktop
 * scales the whole type ramp from it, so a scene here asks `textSize` for the
 * size it would draw at 14 and the preference moves all of them together.
 */
export const BASE_FONT_SIZE = 14;

/** What the user's `font` config resolves to, in px (12–20). */
export const uiFontBasePx = signal(BASE_FONT_SIZE);

/**
 * True while the window is phone-sized (the shell measures it). Controls keep
 * their look but grow their touch target to the 44 pt minimum, and hover
 * tooltips are off (a tap must not leave one behind).
 */
export const compactLayout = signal(false);

/** Extra press area around a control `height` tall so a finger gets 44 pt. */
export function touchSlop(height: number, desktopSlop?: number): number | undefined {
  if (compactLayout()) return Math.max(0, Math.ceil((44 - height) / 2)) || desktopSlop;
  return desktopSlop;
}

export const uiFontScale = computed(() => uiFontBasePx() / BASE_FONT_SIZE);

/** True while the UI reads in Chinese: prose and body take a 1.7 leading and no tracking. */
export const cjkTypography = computed(() => {
  const locale = currentLocale();
  return locale === "zh-CN" || locale === "zh-TW";
});

/**
 * The type scale in whole pixels at the 14 px baseline (visual spec §2.1).
 * Weights are 400, 500 and 600 only.
 */
export const typeScale = {
  /** 28/600/34: one hero per screen. */
  display: 28,
  /** 22/600/28: page titles. */
  pageTitle: 22,
  /** 17/600/24: modal titles. */
  modalTitle: 17,
  /** 16/600/22: session and conversation titles in their header. */
  sectionTitle: 16,
  /** 15/400/24: transcript prose, the user bubble, composer text. */
  prose: 15,
  /** 14/400/20: rows, settings labels, card titles (500). */
  body: 14,
  /** 13/500/18: sidebar rows, buttons, section headers (600), secondary lines (400). */
  label: 13,
  /** 12/400/16: meta (device badge, age, branch, descriptions). */
  caption: 12,
  /** 11/600/14: counts in badges and key caps only, never sentences. */
  micro: 11,
  /** @deprecated Was 13.5; card titles are `body` at weight 500. */
  cardTitle: 14,
  /** @deprecated Was 12.5; controls are `label`. */
  control: 13,
  /** @deprecated Was 11.5; meta is `caption`. */
  meta: 12,
} as const;

/** Whole-pixel line heights of each size of the scale (Latin; CJK prose and body use 1.7). */
const LINE_HEIGHTS: Readonly<Record<number, number>> = {
  28: 34,
  22: 28,
  17: 24,
  16: 22,
  15: 24,
  14: 20,
  13: 18,
  12: 16,
  11: 14,
};

/** The leading ratio of CJK prose and body copy. */
export const CJK_LINE_HEIGHT_RATIO = 1.7;

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
 * Scaled line height derived from `textSize(base)`, rounded to whole pixels.
 * In Chinese, multi-line prose and body copy (15 and 14 at a ratio of 1.4 or
 * more) take the CJK leading of 1.7 (15 → 26, 14 → 24).
 */
export function textLineHeight(base: number, ratio = 1.45): number {
  const cjkCopy = (base === typeScale.prose || base === typeScale.body) && ratio >= 1.4 && cjkTypography();
  return Math.round(textSize(base) * (cjkCopy ? Math.max(ratio, CJK_LINE_HEIGHT_RATIO) : ratio));
}

/** The line height a scale size takes in its role (`LINE_HEIGHTS`), scaled; other sizes use 1.45. */
function roleLineHeight(base: number, line?: number): number {
  const fixed = line ?? LINE_HEIGHTS[base];
  return textLineHeight(base, fixed ? fixed / base : 1.45);
}

/**
 * Optical letter-spacing in points: display −0.4, page titles −0.3, section
 * titles −0.1, zero for running text, and zero for every size in Chinese.
 * Uppercase keeps a small positive tracking for the key caps that still use it.
 */
export function textTracking(base: number, uppercase = false): number {
  if (cjkTypography()) return 0;
  const px = textSize(base);
  if (uppercase) return px <= 11 ? 0.55 : 0.45;
  if (base >= 26) return -0.4;
  if (base >= 20) return -0.3;
  if (base >= 16) return -0.1;
  return 0;
}

export type TextRole =
  | "display"
  | "pageTitle"
  | "modalTitle"
  | "sectionTitle"
  | "prose"
  | "body"
  | "label"
  | "caption"
  | "micro"
  | "mono"
  | "monoBlock"
  /** @deprecated Use `body` at weight 500. */
  | "cardTitle"
  /** @deprecated Use `caption`. */
  | "meta";

export interface TextStyleOptions {
  color?: string;
  uppercase?: boolean;
  tabular?: boolean;
}

interface RoleSpec {
  size: number;
  weight: "400" | "500" | "600";
  color: (p: Palette) => string;
  mono?: boolean;
  /** Tabular figures even when `tabular` is not asked for. */
  tabular?: boolean;
  /** A line height other than the size's own (`LINE_HEIGHTS`). */
  line?: number;
}

const ROLE_SPECS: Readonly<Record<TextRole, RoleSpec>> = {
  display: { size: typeScale.display, weight: "600", color: p => p.text },
  pageTitle: { size: typeScale.pageTitle, weight: "600", color: p => p.text },
  modalTitle: { size: typeScale.modalTitle, weight: "600", color: p => p.text },
  sectionTitle: { size: typeScale.sectionTitle, weight: "600", color: p => p.text },
  prose: { size: typeScale.prose, weight: "400", color: p => p.text },
  body: { size: typeScale.body, weight: "400", color: p => p.text },
  label: { size: typeScale.label, weight: "500", color: p => p.text },
  caption: { size: typeScale.caption, weight: "400", color: p => p.textMuted },
  micro: { size: typeScale.micro, weight: "600", color: p => p.textMuted, tabular: true },
  mono: { size: 12, weight: "400", color: p => p.textSecondary, mono: true, tabular: true },
  monoBlock: { size: 13, weight: "400", color: p => p.text, mono: true, tabular: true, line: 20 },
  cardTitle: { size: typeScale.body, weight: "500", color: p => p.text },
  meta: { size: typeScale.caption, weight: "400", color: p => p.textMuted, tabular: true },
};

/** The size (at the 14 px baseline) a role draws at. */
export function roleSize(role: TextRole): number {
  return ROLE_SPECS[role].size;
}

/**
 * Reactive semantic typography preset combining size, weight, leading,
 * tracking, and theme color. Call inside JSX style bindings so theme, locale
 * and font baseline switches repaint at once.
 */
export function textStyle(role: TextRole, opts?: TextStyleOptions): TextStyle {
  const spec = ROLE_SPECS[role];
  const uppercase = Boolean(opts?.uppercase);
  const tabular = opts?.tabular || spec.tabular ? (["tabular-nums"] as TextStyle["fontVariant"]) : undefined;
  const style: TextStyle = {
    color: opts?.color ?? spec.color(palette()),
    fontSize: textSize(spec.size),
    fontWeight: spec.weight,
    lineHeight: roleLineHeight(spec.size, spec.line),
    fontVariant: tabular,
  };
  if (spec.mono) {
    style.fontFamily = fontMono();
  } else {
    style.fontFamily = fontSans();
    style.letterSpacing = textTracking(spec.size, uppercase);
  }
  if (uppercase) style.textTransform = "uppercase";
  return style;
}
