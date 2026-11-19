// Shared styling and language-inference helpers for NSH rich text & code
// widgets (`TextView`, `DiffView`, `Editor`) aligned with OpenBitFun Tauri
// (`src/web-ui`) typography, code-block chrome, and colorblind-safe diff rails.
//
// Always call `createMarkdownStyles()`, `createDiffViewStyles()`, and
// `createEditorStyles()` inside JSX prop expressions so switching appearance
// presets or font scale repaints immediately. Results use zero-allocation
// hot-slot caches (reading `palette()` and `uiFontBasePx()` directly in the
// caller's reactive scope — never component-owned `computed()` memos that would
// be disposed on unmount) so 60fps streaming updates reuse the exact same style
// object with zero allocation churn.

import type {
  DiffViewStyles,
  EditorStyles,
  MarkdownOptions,
  TextViewCodeAction,
  TextViewStyles,
} from "nsh/base";
import { currentLocale, tr, type AppLocale } from "../i18n";
import {
  fontMono,
  fontSans,
  palette,
  textLineHeight,
  textSize,
  textTracking,
  uiFontBasePx,
  type Palette,
} from "../theme";

/**
 * Standard built-in code block actions for `TextView` (`copy` button on hover).
 * Uses a reactive enumerable getter for `label` so existing callers passing
 * `MARKDOWN_CODE_ACTIONS` automatically localize; prefer
 * `createMarkdownCodeActions()` inside JSX prop expressions for guaranteed
 * array-identity invalidation on live language switches.
 */
export const MARKDOWN_CODE_ACTIONS: TextViewCodeAction[] = [
  {
    id: "copy",
    get label(): string {
      return tr("common.copy");
    },
  },
];

let markdownCodeActionsCache: { locale: AppLocale; actions: TextViewCodeAction[] } | null = null;

/**
 * Memoized reactive `TextViewCodeAction[]` (`copy` button on hover) synced with
 * `currentLocale()`. Reads `currentLocale()` directly in the caller's reactive
 * scope and reuses the exact same array reference until the locale changes.
 */
export function createMarkdownCodeActions(): TextViewCodeAction[] {
  const locale = currentLocale();
  if (markdownCodeActionsCache && markdownCodeActionsCache.locale === locale) {
    return markdownCodeActionsCache.actions;
  }
  const actions: TextViewCodeAction[] = [{ id: "copy", label: tr("common.copy") }];
  markdownCodeActionsCache = { locale, actions };
  return actions;
}

/** Stable frozen options for live streaming `<TextView>` blocks (avoids prop-identity churn). */
export const STREAMING_MARKDOWN_OPTIONS: Readonly<MarkdownOptions> = Object.freeze({
  streaming: true,
});

/** Stable frozen options for finalized persisted `<TextView>` blocks. */
export const STATIC_MARKDOWN_OPTIONS: Readonly<MarkdownOptions> = Object.freeze({
  streaming: false,
});

export interface MarkdownStyleOptions {
  /** Uses denser 13px reading scale for side panels, previews, and cards. */
  compact?: boolean;
  /** Overrides the base reading font size before `textSize()` scaling. */
  baseFontSize?: number;
}

interface StyleCacheSlot<T> {
  palette: Palette;
  fontPx: number;
  styles: T;
}

function buildMarkdownStyles(p: Palette, compact: boolean, base: number): TextViewStyles {
  const codeBase = Math.max(11, base - 1);
  const inlineCodeBase = Math.max(11, base - 1);
  const tableBase = Math.max(12, base - 1);

  return {
    root: {
      color: p.text,
      fontFamily: fontSans,
      fontSize: textSize(base),
      lineHeight: textLineHeight(base, 1.58),
      letterSpacing: textTracking(base),
    },
    paragraph: {
      color: p.text,
      fontSize: textSize(base),
      lineHeight: textLineHeight(base, 1.58),
      marginBottom: compact ? 8 : 12,
    },
    // The desktop's Markdown.scss rhythm: headings sit 20 below the prose they
    // follow and 8 above their own, h1 at +3, the rest at +1 / 600.
    heading: {
      color: p.text,
      fontWeight: "600",
      marginTop: compact ? 14 : 20,
      marginBottom: 8,
      lineHeight: textLineHeight(base + 1, 1.3),
    },
    heading1: {
      fontSize: textSize(base + 3),
      fontWeight: "600",
      lineHeight: textLineHeight(base + 3, 1.28),
      letterSpacing: textTracking(base + 3),
    },
    heading2: {
      fontSize: textSize(base + 1),
      fontWeight: "600",
      lineHeight: textLineHeight(base + 1, 1.3),
      letterSpacing: textTracking(base + 1),
    },
    heading3: {
      fontSize: textSize(base + 1),
      fontWeight: "600",
      lineHeight: textLineHeight(base + 1, 1.32),
      letterSpacing: textTracking(base + 1),
    },
    heading4: {
      fontSize: textSize(base),
      fontWeight: "600",
      letterSpacing: textTracking(base),
    },
    heading5: {
      fontSize: textSize(base),
      fontWeight: "600",
      color: p.textSecondary,
    },
    heading6: {
      fontSize: textSize(Math.max(11, base - 1)),
      fontWeight: "600",
      color: p.textMuted,
    },
    blockquote: {
      borderLeftWidth: 2,
      borderColor: p.borderStrong,
      paddingLeft: 13,
      paddingVertical: 3,
      marginVertical: compact ? 8 : 10,
      color: p.textSecondary,
    },
    alert: {
      borderRadius: 10,
      borderCurve: "continuous",
      borderWidth: 1,
      borderColor: p.borderSubtle,
      backgroundColor: p.surfaceTertiary,
      paddingHorizontal: 13,
      paddingVertical: 10,
      marginVertical: compact ? 8 : 10,
    },
    alertNote: {
      borderColor: p.accentBorder,
      backgroundColor: p.accentSoft,
    },
    alertTip: {
      borderColor: p.successBorder,
      backgroundColor: p.successSoft,
    },
    alertImportant: {
      borderColor: p.accentBorder,
      backgroundColor: p.accentSoft,
    },
    alertWarning: {
      borderColor: p.warningBorder,
      backgroundColor: p.warningSoft,
    },
    alertCaution: {
      borderColor: p.dangerBorder,
      backgroundColor: p.dangerSoft,
    },
    list: {
      marginBottom: compact ? 8 : 12,
      gap: 4,
    },
    listItem: {
      color: p.text,
      lineHeight: textLineHeight(base, 1.58),
    },
    listMarker: {
      color: p.textMuted,
      fontVariant: ["tabular-nums"],
    },
    taskMarker: {
      borderColor: p.borderStrong,
      borderRadius: 4,
    },
    taskMarkerChecked: {
      backgroundColor: p.accent,
      borderColor: p.accent,
      color: p.actionSolidFg,
    },
    codeBlock: {
      borderRadius: 12,
      borderCurve: "continuous",
      borderWidth: 1,
      borderColor: p.borderSubtle,
      backgroundColor: p.surfaceTertiary,
      marginVertical: compact ? 8 : 12,
      overflow: "hidden",
    },
    // The floating action row stays see-through so the copy button reads as part
    // of the block rather than as a bar over its first line.
    codeBlockHeader: {
      backgroundColor: "transparent",
      paddingHorizontal: 8,
      paddingVertical: 4,
    },
    codeBlockCode: {
      fontFamily: fontMono,
      fontSize: textSize(codeBase),
      lineHeight: textLineHeight(codeBase, 1.52),
      color: p.text,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    code: {
      fontFamily: fontMono,
      fontSize: textSize(inlineCodeBase),
      color: p.text,
      backgroundColor: p.surfaceSubtle,
      borderRadius: 4,
      paddingHorizontal: 4,
      paddingVertical: 0,
    },
    keyboard: {
      fontFamily: fontMono,
      fontSize: textSize(11),
      color: p.textSecondary,
      backgroundColor: p.surfaceTertiary,
      borderWidth: 1,
      borderColor: p.border,
      borderRadius: 5,
      paddingHorizontal: 5,
      paddingVertical: 1,
    },
    strong: {
      fontWeight: "600",
      color: p.text,
    },
    emphasis: {
      fontStyle: "italic",
    },
    strikethrough: {
      color: p.textMuted,
    },
    highlight: {
      backgroundColor: p.warningSoft,
      color: p.text,
      borderRadius: 3,
      paddingHorizontal: 3,
    },
    link: {
      color: p.accent,
    },
    mathBlock: {
      borderRadius: 10,
      borderCurve: "continuous",
      borderWidth: 1,
      borderColor: p.borderSubtle,
      backgroundColor: p.surfaceTertiary,
      paddingHorizontal: 14,
      paddingVertical: 10,
      marginVertical: compact ? 8 : 10,
    },
    table: {
      borderRadius: 10,
      borderCurve: "continuous",
      borderWidth: 1,
      borderColor: p.borderSubtle,
      backgroundColor: p.surfaceTertiary,
      marginVertical: compact ? 8 : 12,
      overflow: "hidden",
    },
    tableHead: {
      backgroundColor: p.surfaceSubtle,
    },
    tableRow: {
      borderBottomWidth: 1,
      borderColor: p.borderSubtle,
    },
    tableCell: {
      paddingHorizontal: 16,
      paddingVertical: 6,
      fontSize: textSize(tableBase),
      lineHeight: textLineHeight(tableBase, 1.48),
      color: p.text,
    },
    tableHeaderCell: {
      fontWeight: "600",
      color: p.text,
    },
    rule: {
      borderTopWidth: 1,
      borderColor: p.borderSubtle,
      marginVertical: compact ? 12 : 16,
    },
    details: {
      borderRadius: 10,
      borderCurve: "continuous",
      borderWidth: 1,
      borderColor: p.borderSubtle,
      backgroundColor: p.surfaceTertiary,
      paddingHorizontal: 13,
      paddingVertical: 9,
      marginVertical: compact ? 8 : 10,
    },
    summary: {
      color: p.text,
      fontWeight: "600",
    },
    summaryMarker: {
      color: p.textMuted,
    },
    footnoteLabel: {
      color: p.textMuted,
      fontSize: textSize(11),
      fontVariant: ["tabular-nums"],
    },
    footnoteReference: {
      color: p.accent,
      fontSize: textSize(11),
      fontVariant: ["tabular-nums"],
    },
  };
}

let defaultMarkdownCache: StyleCacheSlot<TextViewStyles> | null = null;
let compactMarkdownCache: StyleCacheSlot<TextViewStyles> | null = null;
const customMarkdownStylesCache = new Map<string, StyleCacheSlot<TextViewStyles>>();

/**
 * Memoized reactive `TextViewStyles` tuned to `src/web-ui`'s `Markdown.scss` craft:
 * calm `14px/1.62` reading prose, optical heading tracking, subtle hairline
 * `surfaceTertiary` code blocks and tables, semantic alerts, and quiet left-rail
 * blockquotes. Reads `palette()` and `uiFontBasePx()` directly in the caller's
 * reactive scope and returns the cached reference with zero allocations until
 * either changes.
 */
export function createMarkdownStyles(options?: MarkdownStyleOptions): TextViewStyles {
  const p = palette();
  const fontPx = uiFontBasePx();

  // Zero-allocation hot paths for default (14px) and compact (13px) styles.
  if (!options || (!options.compact && options.baseFontSize === undefined)) {
    if (
      defaultMarkdownCache &&
      defaultMarkdownCache.palette === p &&
      defaultMarkdownCache.fontPx === fontPx
    ) {
      return defaultMarkdownCache.styles;
    }
    const styles = buildMarkdownStyles(p, false, 14);
    defaultMarkdownCache = { palette: p, fontPx, styles };
    return styles;
  }

  if (options.compact === true && options.baseFontSize === undefined) {
    if (
      compactMarkdownCache &&
      compactMarkdownCache.palette === p &&
      compactMarkdownCache.fontPx === fontPx
    ) {
      return compactMarkdownCache.styles;
    }
    const styles = buildMarkdownStyles(p, true, 13);
    compactMarkdownCache = { palette: p, fontPx, styles };
    return styles;
  }

  const compact = Boolean(options.compact);
  const base = options.baseFontSize ?? (compact ? 13 : 14);
  const key = `${compact ? "c" : "d"}:${base}`;
  const cached = customMarkdownStylesCache.get(key);
  if (cached && cached.palette === p && cached.fontPx === fontPx) {
    return cached.styles;
  }
  const styles = buildMarkdownStyles(p, compact, base);
  if (customMarkdownStylesCache.size > 16) {
    customMarkdownStylesCache.clear();
  }
  customMarkdownStylesCache.set(key, { palette: p, fontPx, styles });
  return styles;
}

let diffViewStylesCache: StyleCacheSlot<DiffViewStyles> | null = null;

function buildDiffViewStyles(p: Palette): DiffViewStyles {
  return {
    side: {
      backgroundColor: p.canvas,
    },
    gutter: {
      backgroundColor: p.surfaceTertiary,
      borderRightWidth: 1,
      borderColor: p.borderSubtle,
      paddingHorizontal: 6,
    },
    lineNumber: {
      color: p.textMuted,
      fontFamily: fontMono,
      fontSize: textSize(11),
      fontVariant: ["tabular-nums"],
    },
    lineNumberAdded: {
      color: p.diffAddRail,
      backgroundColor: p.diffAddBg,
    },
    lineNumberDeleted: {
      color: p.diffDelRail,
      backgroundColor: p.diffDelBg,
    },
    content: {
      backgroundColor: p.canvas,
      paddingHorizontal: 10,
    },
    line: {
      color: p.text,
      fontFamily: fontMono,
      fontSize: textSize(12),
    },
    lineAdded: {
      backgroundColor: p.diffAddBg,
    },
    lineDeleted: {
      backgroundColor: p.diffDelBg,
    },
    filler: {
      backgroundColor: p.surfaceSubtle,
    },
    wordAdded: {
      backgroundColor: p.diffAddWordBg,
      borderRadius: 3,
    },
    wordDeleted: {
      backgroundColor: p.diffDelWordBg,
      borderRadius: 3,
    },
    indicatorAdded: {
      backgroundColor: p.diffAddRail,
      color: p.diffAddRail,
    },
    indicatorDeleted: {
      backgroundColor: p.diffDelRail,
      color: p.diffDelRail,
    },
    separator: {
      backgroundColor: p.surfaceTertiary,
      color: p.textMuted,
      borderTopWidth: 1,
      borderBottomWidth: 1,
      borderColor: p.borderSubtle,
      paddingHorizontal: 10,
      paddingVertical: 4,
      fontFamily: fontMono,
      fontSize: textSize(11),
    },
    fileHeader: {
      backgroundColor: p.surfaceTertiary,
      color: p.text,
      borderBottomWidth: 1,
      borderColor: p.border,
      paddingHorizontal: 12,
      paddingVertical: 7,
      fontSize: textSize(12),
      fontWeight: "600",
    },
    lineSelected: {
      backgroundColor: p.accentSoft,
    },
  };
}

/**
 * Memoized reactive `DiffViewStyles` aligned with `src/web-ui`'s `InlineDiffPreview`:
 * theme-synced gutter (eliminating light/monochrome black-gutter bugs),
 * tabular line numbers, and colorblind-safe turquoise/coral rails and washes.
 */
export function createDiffViewStyles(): DiffViewStyles {
  const p = palette();
  const fontPx = uiFontBasePx();
  if (
    diffViewStylesCache &&
    diffViewStylesCache.palette === p &&
    diffViewStylesCache.fontPx === fontPx
  ) {
    return diffViewStylesCache.styles;
  }
  const styles = buildDiffViewStyles(p);
  diffViewStylesCache = { palette: p, fontPx, styles };
  return styles;
}

let editorStylesCache: StyleCacheSlot<EditorStyles> | null = null;

function buildEditorStyles(p: Palette): EditorStyles {
  return {
    gutter: {
      backgroundColor: p.surfaceTertiary,
      borderRightWidth: 1,
      borderColor: p.borderSubtle,
      paddingHorizontal: 8,
    },
    lineNumber: {
      color: p.textMuted,
      fontFamily: fontMono,
      fontSize: textSize(11),
      fontVariant: ["tabular-nums"],
    },
    activeLineNumber: {
      color: p.text,
      fontWeight: "600",
    },
    foldMarker: {
      color: p.textMuted,
    },
    content: {
      backgroundColor: p.canvas,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    line: {
      color: p.text,
      fontFamily: fontMono,
      fontSize: textSize(12),
    },
    activeLine: {
      backgroundColor: p.surfaceSubtle,
    },
    selection: {
      backgroundColor: p.accentSoft,
    },
    caret: {
      backgroundColor: p.accent,
    },
    indentGuide: {
      backgroundColor: p.borderSubtle,
    },
    matchingBracket: {
      borderWidth: 1,
      borderColor: p.borderFocus,
      backgroundColor: p.accentSoft,
    },
    placeholder: {
      color: p.textMuted,
    },
    searchMatch: {
      backgroundColor: p.warningSoft,
    },
    currentSearchMatch: {
      backgroundColor: p.accentSoft,
    },
    completionMenu: {
      backgroundColor: p.popoverBg,
      borderWidth: 1,
      borderColor: p.borderStrong,
      borderRadius: 10,
      boxShadow: p.shadowOverlay,
    },
    completionItem: {
      color: p.text,
      fontSize: textSize(12),
    },
    selectedCompletionItem: {
      backgroundColor: p.panelHover,
      color: p.text,
    },
  };
}

/**
 * Memoized reactive `EditorStyles` keeping gutter, active line, caret, selection,
 * and monospace rhythm in sync with the active OpenBitFun appearance preset.
 */
export function createEditorStyles(): EditorStyles {
  const p = palette();
  const fontPx = uiFontBasePx();
  if (
    editorStylesCache &&
    editorStylesCache.palette === p &&
    editorStylesCache.fontPx === fontPx
  ) {
    return editorStylesCache.styles;
  }
  const styles = buildEditorStyles(p);
  editorStylesCache = { palette: p, fontPx, styles };
  return styles;
}

const BASENAME_LANGUAGE_MAP: Record<string, string> = {
  dockerfile: "dockerfile",
  makefile: "makefile",
  gnumakefile: "makefile",
  "cmakelists.txt": "cmake",
  "cargo.toml": "toml",
  "cargo.lock": "toml",
  "package.json": "json",
  "tsconfig.json": "jsonc",
  "nsh.json": "json",
  ".gitignore": "gitignore",
  ".gitattributes": "gitignore",
  ".dockerignore": "gitignore",
  ".env": "bash",
  ".zshrc": "bash",
  ".bashrc": "bash",
  ".profile": "bash",
  gemfile: "ruby",
  rakefile: "ruby",
  podfile: "ruby",
  justfile: "makefile",
};

const EXT_LANGUAGE_MAP: Record<string, string> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  rs: "rust",
  py: "python",
  pyi: "python",
  go: "go",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hh: "cpp",
  cs: "csharp",
  rb: "ruby",
  php: "php",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  fish: "bash",
  ps1: "powershell",
  sql: "sql",
  json: "json",
  jsonc: "jsonc",
  jsonl: "json",
  toml: "toml",
  yaml: "yaml",
  yml: "yaml",
  xml: "xml",
  svg: "xml",
  plist: "xml",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  sass: "scss",
  less: "css",
  md: "markdown",
  mdx: "markdown",
  markdown: "markdown",
  graphql: "graphql",
  gql: "graphql",
  proto: "protobuf",
  lua: "lua",
  zig: "zig",
  dart: "dart",
  vue: "html",
  svelte: "html",
  diff: "diff",
  patch: "diff",
  ini: "ini",
  conf: "ini",
  cfg: "ini",
  nix: "nix",
  tf: "hcl",
  hcl: "hcl",
  ex: "elixir",
  exs: "elixir",
  erl: "erlang",
  hs: "haskell",
  r: "r",
  scala: "scala",
  groovy: "groovy",
  gradle: "groovy",
  txt: "text",
  log: "text",
};

/** Infers an `Editor` / `DiffView` syntax language id from a file path or basename. */
export function inferCodeLanguage(filePath?: string | null): string | undefined {
  if (!filePath) return undefined;
  const trimmed = filePath.trim();
  if (!trimmed) return undefined;
  const normalized = trimmed.replace(/\\/g, "/");
  const base = (normalized.split("/").pop() ?? normalized).toLowerCase();
  if (BASENAME_LANGUAGE_MAP[base]) return BASENAME_LANGUAGE_MAP[base];
  if (base.startsWith("dockerfile.")) return "dockerfile";
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return undefined;
  const ext = base.slice(dot + 1);
  return EXT_LANGUAGE_MAP[ext];
}
