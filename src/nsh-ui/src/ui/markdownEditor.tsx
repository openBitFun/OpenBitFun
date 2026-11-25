// Markdown documents: the rendered preview and the visual (WYSIWYG) editor that
// the Files pane, the assistant persona documents and other Markdown surfaces
// share.
//
// - `MarkdownPreview` is `TextView` with workspace-aware images and links (the
//   caller's), plus Mermaid diagrams and display formulas drawn in a small web
//   view island where this client shows web views. Without one, or when the
//   renderer cannot load, the source stays visible as code: never an empty box.
// - `MarkdownDocumentEditor` is NSH's native `RichEditor` (a ProseMirror/Tiptap
//   kernel) over the file's Markdown: parsed once when it opens, serialized on
//   every change and handed back as text, so the caller saves exactly what it
//   saves for the source editor (`write_file_content` and its conflict check).
// - `visualEditBlock` is the fidelity guard: a file the visual editor cannot
//   write back unchanged (front matter, raw HTML, reference links, ...) opens
//   as source, and the caller says why. It reads only the file's text.
//
// Inline AI asks the document's device through `editorAiStore.ts`.

import { cleanup, effect, openUrl, Scroll, signal, Text, untracked, View, WebView, type JSX } from "nsh";
import {
  createRichEditor,
  RichEditor,
  RichTable,
  RichTableCell,
  RichTableHeader,
  RichTableRow,
  StarterKit,
  TextView,
  type RichEditorSession,
  type RichEditorStyles,
  type TextViewImage,
  type TextViewLinkPressEvent,
} from "nsh/base";
import {
  askInlineAi,
  cancelInlineAi,
  closeInlineAiComposer,
  finishInlineAi,
  inlineAi,
  inlineAiComposer,
  openInlineAiComposer,
} from "../editorAiStore";
import { windowShellId } from "../bridge";
import { currentLocale, localizeHostError, tr } from "../i18n";
import {
  fontMono,
  fontSans,
  palette,
  radii,
  resolvedScheme,
  space,
  textLineHeight,
  textSize,
  textStyle,
  typeScale,
  uiFontBasePx,
  type Palette,
} from "../theme";
import { activeWorkspace, activeWorkspaceRoot, openInAuxPane } from "../state";
import { Icon } from "./icons";
import {
  createMarkdownCodeActions,
  createMarkdownStyles,
  resolveWorkspaceMarkdownLink,
  STATIC_MARKDOWN_OPTIONS,
} from "./markdown";
import { popoverEnterMotion, Spinner } from "./motion";
import { registerEscapeDismiss } from "./overlays";
import { Button, InputBox } from "./primitives";
import { rendererAssets } from "../documentRenderers";

// ── The visual editor's schema and the fidelity guard ──────────────────────

/** Paragraphs, headings, lists, task lists, quotes, code, rules, images, links, marks and tables. */
function markdownExtensions() {
  return [StarterKit, RichTable, RichTableRow, RichTableHeader, RichTableCell];
}

function createMarkdownSession(text: string): RichEditorSession {
  return createRichEditor({ content: text, format: "markdown", extensions: markdownExtensions() });
}

let visualEditorProbe: boolean | null = null;

/** Whether this client has the rich text kernel (checked once). */
export function visualEditorAvailable(): boolean {
  if (visualEditorProbe !== null) return visualEditorProbe;
  try {
    const probe = createMarkdownSession("# probe\n");
    probe.dispose();
    visualEditorProbe = true;
  } catch {
    visualEditorProbe = false;
  }
  return visualEditorProbe;
}

/** Text compared the way the guard compares it: line endings, BOM and trailing whitespace do not count. */
function normalizeMarkdown(text: string): string {
  let value = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  value = value.replace(/\r\n?/g, "\n");
  return value
    .split("\n")
    .map(line => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n+$/, "");
}

/** Whether two Markdown texts are the same document byte for byte, but for whitespace at line ends. */
export function sameMarkdown(left: string, right: string): boolean {
  return left === right || normalizeMarkdown(left) === normalizeMarkdown(right);
}

const fidelityCache = new Map<string, boolean>();

/** Whether the visual editor writes `text` back as it is (modulo trailing whitespace). */
export function visualEditKeepsText(text: string): boolean {
  const cached = fidelityCache.get(text);
  if (cached !== undefined) return cached;
  let keeps = false;
  try {
    const session = createMarkdownSession(text);
    keeps = sameMarkdown(session.getMarkdown(), text);
    session.dispose();
  } catch {
    keeps = false;
  }
  if (fidelityCache.size > 64) fidelityCache.clear();
  fidelityCache.set(text, keeps);
  return keeps;
}

/** Why a document opens as source instead of in the visual editor, or `null` when it need not. */
export type VisualEditBlock = "unavailable" | "fidelity";

export function visualEditBlock(text: string): VisualEditBlock | null {
  if (!visualEditorAvailable()) return "unavailable";
  return visualEditKeepsText(text) ? null : "fidelity";
}

/** The one muted line a surface shows when a document opens as source on its own. */
export function visualEditBlockMessage(block: VisualEditBlock): string {
  return block === "unavailable" ? tr("doc.visualUnavailable") : tr("doc.sourceFallback");
}

export function VisualEditNotice(props: { block: VisualEditBlock; inset?: number }) {
  return (
    <View
      style={{
        paddingHorizontal: props.inset ?? space.md,
        paddingVertical: space.xs,
        borderBottomWidth: 1,
        borderColor: palette().borderSubtle,
      }}
    >
      <Text accessibilityLabel="doc-source-fallback" style={textStyle("caption")}>
        {visualEditBlockMessage(props.block)}
      </Text>
    </View>
  );
}

// ── Diagrams and formulas ──────────────────────────────────────────────────

/**
 * The renderers ship with the app as assets (`assets/vendor`, pinned and
 * unchanged from their npm packages; KaTeX's fonts are inlined into its
 * stylesheet), registered by the app's entry (`documentRenderers.ts`): read
 * only when a document has a diagram or a formula, then kept for the session.
 * A browser gets the same files through the device's UI bundle. The island's
 * page loads nothing from anywhere (its content security policy allows inline
 * code, inline styles and data: fonts only).
 */
function rendererFiles(kind: IslandKind): { script: string; style: string | null } | null {
  const assets = rendererAssets();
  if (!assets) return null;
  return kind === "math"
    ? { script: assets.katexScript, style: assets.katexStyle }
    : { script: assets.mermaidScript, style: null };
}

interface IslandRenderer {
  script: string;
  style: string;
  /** When set, loaded via `<script src>` against `baseUrl` instead of duplicating the 3.26 MB script string inline. */
  scriptSrc?: string;
  baseUrl?: string;
}

interface CachedDiagramSvg {
  svg: string;
  height: number;
}

const MAX_CACHED_SVG_DIAGRAMS = 32;
const MAX_CONCURRENT_MERMAID_ISLANDS = 2;
const MERMAID_SCRIPT_EVICT_MS = 2000;

const renderedSvgCache = new Map<string, CachedDiagramSvg>();
const rendererLoads = new Map<IslandKind, Promise<IslandRenderer>>();
let activeMermaidCompiles = 0;
let mermaidEvictTimer: ReturnType<typeof setTimeout> | null = null;
const mermaidSlotWaiters: Array<() => void> = [];

function cacheDiagramSvg(key: string, entry: CachedDiagramSvg): void {
  if (renderedSvgCache.has(key)) renderedSvgCache.delete(key);
  renderedSvgCache.set(key, entry);
  if (renderedSvgCache.size > MAX_CACHED_SVG_DIAGRAMS) {
    const oldest = renderedSvgCache.keys().next().value;
    if (oldest !== undefined) renderedSvgCache.delete(oldest);
  }
}

function acquireMermaidSlot(onReady: () => void): () => void {
  if (activeMermaidCompiles < MAX_CONCURRENT_MERMAID_ISLANDS) {
    activeMermaidCompiles += 1;
    if (mermaidEvictTimer) {
      clearTimeout(mermaidEvictTimer);
      mermaidEvictTimer = null;
    }
    onReady();
    return () => releaseMermaidSlot();
  }
  let granted = false;
  const waiter = () => {
    granted = true;
    activeMermaidCompiles += 1;
    if (mermaidEvictTimer) {
      clearTimeout(mermaidEvictTimer);
      mermaidEvictTimer = null;
    }
    onReady();
  };
  mermaidSlotWaiters.push(waiter);
  return () => {
    if (granted) {
      releaseMermaidSlot();
      return;
    }
    const idx = mermaidSlotWaiters.indexOf(waiter);
    if (idx >= 0) mermaidSlotWaiters.splice(idx, 1);
  };
}

function releaseMermaidSlot(): void {
  activeMermaidCompiles = Math.max(0, activeMermaidCompiles - 1);
  const next = mermaidSlotWaiters.shift();
  if (next) {
    next();
    return;
  }
  if (activeMermaidCompiles === 0 && rendererLoads.has("mermaid")) {
    if (mermaidEvictTimer) clearTimeout(mermaidEvictTimer);
    mermaidEvictTimer = setTimeout(() => {
      mermaidEvictTimer = null;
      if (activeMermaidCompiles === 0) rendererLoads.delete("mermaid");
    }, MERMAID_SCRIPT_EVICT_MS);
  }
}

function resolveDirectScriptAsset(scriptUrl: string): { scriptSrc: string; baseUrl: string } | null {
  const loc = typeof globalThis !== "undefined" ? (globalThis as { location?: { href?: string; origin?: string } }).location : undefined;
  if (!loc?.href || !loc?.origin || !/^https?:\/\//i.test(loc.href)) return null;
  try {
    const resolved = new URL(scriptUrl, loc.href);
    if (resolved.origin !== loc.origin) return null;
    return { scriptSrc: resolved.href, baseUrl: loc.origin };
  } catch {
    return null;
  }
}

async function readAsset(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`asset ${url} answered ${response.status}`);
  return response.text();
}

/** Text that cannot end or comment out the inline `<script>` / `<style>` element it goes into. */
function inlineSafe(text: string): string {
  return text.replace(/<\/(script|style)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function loadRenderer(kind: IslandKind): Promise<IslandRenderer> {
  let load = rendererLoads.get(kind);
  if (!load) {
    const assets = rendererFiles(kind);
    if (!assets) return Promise.reject(new Error("this app registered no document renderers"));
    if (kind === "mermaid") {
      const direct = resolveDirectScriptAsset(assets.script);
      if (direct) {
        return Promise.resolve({ script: "", style: "", scriptSrc: direct.scriptSrc, baseUrl: direct.baseUrl });
      }
    }
    load = Promise.all([readAsset(assets.script), assets.style ? readAsset(assets.style) : Promise.resolve("")]).then(
      ([script, style]) => ({ script: inlineSafe(script), style: inlineSafe(style) }),
    );
    // A failed read is tried again by the next island, not remembered.
    load.catch(() => rendererLoads.delete(kind));
    rendererLoads.set(kind, load);
  }
  return load;
}

/** How long an island may take to draw before the source shows instead. */
const ISLAND_TIMEOUT_MS = 8000;

type IslandKind = "mermaid" | "math";

const ISLAND_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src data:; img-src data:";
const ISLAND_SELF_SCRIPT_CSP =
  "default-src 'none'; script-src 'unsafe-inline' 'self'; style-src 'unsafe-inline'; font-src data:; img-src data:";
const STATIC_SVG_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data:";

/** A JSON string literal that is safe inside a `<script>` element. */
function scriptLiteral(value: string): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

function staticSvgIslandHtml(svg: string, colors: { text: string; background: string }): string {
  const style =
    `<style>html,body{margin:0;padding:0;background:${colors.background};color:${colors.text};` +
    `font-family:-apple-system,system-ui,sans-serif;overflow:hidden}#out{display:flex;justify-content:center}` +
    `#out svg{max-width:100%;height:auto}</style>`;
  return (
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="${STATIC_SVG_CSP}">` +
    `${style}</head><body><div id="out">${svg}</div></body></html>`
  );
}

function islandHtml(
  kind: IslandKind,
  source: string,
  renderer: IslandRenderer,
  colors: { text: string; background: string },
  dark: boolean,
): string {
  const style =
    `<style>html,body{margin:0;padding:0;background:${colors.background};color:${colors.text};` +
    `font-family:-apple-system,system-ui,sans-serif;overflow:hidden}#out{display:flex;justify-content:center}` +
    `#out svg{max-width:100%;height:auto}</style>`;
  const report =
    "function post(m){try{window.nsh&&window.nsh.postMessage(m)}catch(e){}}" +
    "function fail(){post('error')}" +
    "function done(){post('h:'+Math.ceil(document.getElementById('out').getBoundingClientRect().height))}" +
    "window.addEventListener('error',function(){fail()});";
  const draw =
    kind === "math"
      ? `try{katex.render(${scriptLiteral(source)},document.getElementById('out'),{displayMode:true,throwOnError:true});done()}catch(e){fail()}`
      : `try{mermaid.initialize({startOnLoad:false,securityLevel:'strict',theme:${scriptLiteral(dark ? "dark" : "default")}});` +
        `mermaid.render('d',${scriptLiteral(source)}).then(function(r){var o=document.getElementById('out');o.innerHTML=r.svg;` +
        `var h=Math.ceil(o.getBoundingClientRect().height);post('svg:'+h+':'+r.svg);post('h:'+h)}).catch(fail)}catch(e){fail()}`;
  const csp = renderer.scriptSrc ? ISLAND_SELF_SCRIPT_CSP : ISLAND_CSP;
  const scriptTag = renderer.scriptSrc
    ? `<script src="${escapeAttr(renderer.scriptSrc)}"></script>`
    : `<script>${renderer.script}</script>`;
  return (
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="${csp}">` +
    `${renderer.style ? `<style>${renderer.style}</style>` : ""}${style}<script>${report}</script>` +
    `${scriptTag}</head><body><div id="out"></div>` +
    `<script>if(typeof ${kind === "math" ? "katex" : "mermaid"}==='undefined'){fail()}else{${draw}}</script></body></html>`
  );
}

/** Whether this client shows web views (checked once; `null` while it checks). */
const islandsAvailable = signal<boolean | null>(null);
let islandsProbe: Promise<void> | null = null;

function probeIslands(): void {
  if (islandsProbe) return;
  // The desktop app grants its web views (`src/apps/desktop-nsh/nsh.json`); a
  // web engine that still fails reports `onError`, and the island falls back.
  if (windowShellId() === "nsh-desktop") {
    islandsProbe = Promise.resolve();
    islandsAvailable.set(true);
    return;
  }
  islandsProbe = WebView.available()
    .then(shows => islandsAvailable.set(Boolean(shows)))
    .catch(() => islandsAvailable.set(false));
}

/** Whether this client shows web views (`null` while it checks): diagrams, HTML and PDF previews need one. */
export function documentWebViewsAvailable(): boolean | null {
  probeIslands();
  return islandsAvailable();
}

/** The source of a diagram or formula, as the code it is (the island's fallback). */
function IslandSource(props: { source: string; kind: IslandKind }) {
  return (
    <View
      accessibilityLabel={`doc-${props.kind}-source`}
      style={{
        alignSelf: "stretch",
        padding: space.md,
        borderRadius: radii.md,
        backgroundColor: palette().surfaceTertiary,
      }}
    >
      <Text style={{ ...textStyle("monoBlock"), userSelect: "text" }}>{props.source}</Text>
    </View>
  );
}

/**
 * A diagram or display formula drawn in a web view, sized to what it drew.
 * Until it draws (the renderer read, the page run) the source shows; after
 * `ISLAND_TIMEOUT_MS` without a drawing, or on any failure, the source stays.
 */
function DiagramIsland(props: { kind: IslandKind; source: string }) {
  probeIslands();
  const height = signal(0);
  const failed = signal(false);
  const renderer = signal<IslandRenderer | null>(null);
  const cachedSvg = signal<CachedDiagramSvg | null>(null);
  let disposed = false;
  let releaseSlot: (() => void) | null = null;
  const freeSlot = () => {
    if (releaseSlot) {
      releaseSlot();
      releaseSlot = null;
    }
  };
  cleanup(() => {
    disposed = true;
    freeSlot();
    renderer.set(null);
  });

  const cacheKey = () => `${props.kind}:${resolvedScheme() === "dark" ? "d" : "l"}:${props.source}`;

  effect(() => {
    const kind = props.kind;
    void props.source;
    const key = cacheKey();
    const hit = kind === "mermaid" ? renderedSvgCache.get(key) ?? null : null;
    if (hit) {
      freeSlot();
      cachedSvg.set(hit);
      height.set(hit.height);
      failed.set(false);
      return;
    }
    cachedSvg.set(null);
    height.set(0);
    failed.set(false);
    const timer = setTimeout(() => {
      if (!disposed && height() === 0 && !cachedSvg()) {
        freeSlot();
        renderer.set(null);
        failed.set(true);
      }
    }, ISLAND_TIMEOUT_MS);
    cleanup(() => clearTimeout(timer));
  });

  effect(() => {
    const kind = props.kind;
    if (islandsAvailable() !== true || cachedSvg()) return;
    untracked(() => {
      if (renderer()) return;
      const startLoad = () => {
        loadRenderer(kind)
          .then(loaded => {
            if (!disposed && !cachedSvg()) renderer.set(loaded);
            else freeSlot();
          })
          .catch(() => {
            freeSlot();
            if (!disposed) failed.set(true);
          });
      };
      if (kind === "mermaid") {
        releaseSlot = acquireMermaidSlot(() => {
          if (!disposed && !cachedSvg()) startLoad();
          else freeSlot();
        });
      } else {
        startLoad();
      }
    });
  });

  return (
    <If
      when={islandsAvailable() === true && !failed() ? (cachedSvg() ?? renderer()) : null}
      else={<IslandSource kind={props.kind} source={props.source} />}
    >
      {() => {
        const hit = cachedSvg();
        if (hit) {
          return (
            <WebView
              accessibilityLabel={`doc-${props.kind}-view`}
              html={staticSvgIslandHtml(hit.svg, { text: palette().text, background: palette().canvas })}
              javaScriptEnabled={false}
              scrollable={false}
              incognito={true}
              style={{ alignSelf: "stretch", height: Math.max(hit.height, space.x4l) }}
              onError={() => {
                cachedSvg.set(null);
                failed.set(true);
              }}
            />
          );
        }
        const loaded = renderer()!;
        return (
          <WebView
            accessibilityLabel={`doc-${props.kind}-view`}
            html={islandHtml(
              props.kind,
              props.source,
              loaded,
              { text: palette().text, background: palette().canvas },
              resolvedScheme() === "dark",
            )}
            baseUrl={loaded.baseUrl}
            scrollable={false}
            incognito={true}
            style={{ alignSelf: "stretch", height: Math.max(height(), space.x4l) }}
            onMessage={event => {
              const data = String(event.data ?? "");
              if (data === "error") {
                freeSlot();
                renderer.set(null);
                failed.set(true);
                return;
              }
              if (props.kind === "mermaid" && data.startsWith("svg:")) {
                const secondColon = data.indexOf(":", 4);
                if (secondColon > 4) {
                  const h = Math.max(1, Number(data.slice(4, secondColon)) || space.x4l);
                  const svg = data.slice(secondColon + 1);
                  if (svg.includes("<svg")) {
                    const entry = { svg, height: h };
                    cacheDiagramSvg(cacheKey(), entry);
                    height.set(h);
                    cachedSvg.set(entry);
                    renderer.set(null);
                    freeSlot();
                    return;
                  }
                }
              }
              const match = /^h:(\d+)/.exec(data);
              if (match) height.set(Math.max(1, Number(match[1])));
            }}
            onError={() => {
              freeSlot();
              renderer.set(null);
              failed.set(true);
            }}
          />
        );
      }}
    </If>
  );
}

const MERMAID_EXTENSIONS = [{ name: "mermaid", language: "mermaid" }];

export interface MarkdownPreviewProps {
  markdown: string;
  compact?: boolean;
  /** Images of the document (workspace-relative paths are the caller's to read). */
  renderImage?: (image: TextViewImage) => JSX.Element;
  onLinkPress?: (event: TextViewLinkPressEvent) => void;
  /** `"open"` lets the view open web links itself. */
  links?: "open" | "report";
  accessibilityLabel?: string;
}

function defaultPreviewLinkPress(event: TextViewLinkPressEvent): void {
  const ws = activeWorkspace() as ({ workspaceKind?: string; sshHost?: string } | null | undefined);
  const isRemote = Boolean(ws && (ws.workspaceKind === "remote" || ws.workspaceKind === "remote_ssh" || ws.sshHost));
  const resolved = resolveWorkspaceMarkdownLink(event.url, activeWorkspaceRoot(), isRemote);
  if (resolved.kind === "external") {
    void openUrl(resolved.url).catch(() => undefined);
  } else if (resolved.kind === "workspace") {
    openInAuxPane("files", resolved.path);
  }
}

/** A Markdown document as a reader sees it, with Mermaid diagrams and display formulas. */
export function MarkdownPreview(props: MarkdownPreviewProps) {
  return (
    <View accessibilityLabel={props.accessibilityLabel} style={{ alignSelf: "stretch" }}>
    <TextView
      markdown={props.markdown}
      selectable={true}
      links={props.onLinkPress ? (props.links ?? "report") : (props.links ?? "report")}
      options={STATIC_MARKDOWN_OPTIONS}
      extensions={MERMAID_EXTENSIONS}
      styles={createMarkdownStyles({ compact: props.compact })}
      codeBlockActions={createMarkdownCodeActions()}
      renderImage={props.renderImage}
      onLinkPress={props.onLinkPress ?? defaultPreviewLinkPress}
      renderCustom={node =>
        node.name === "mermaid" ? (
          <DiagramIsland kind="mermaid" source={node.text ?? ""} />
        ) : (
          <Text style={textStyle("body")}>{node.text ?? ""}</Text>
        )
      }
      renderMath={math =>
        math.display ? (
          <DiagramIsland kind="math" source={math.tex} />
        ) : (
          <Text
            style={{
              fontFamily: fontMono,
              fontSize: textSize(typeScale.label),
              color: palette().text,
              backgroundColor: palette().surfaceTertiary,
              borderRadius: radii.xs,
              paddingHorizontal: space.xs,
            }}
          >
            {math.tex}
          </Text>
        )
      }
    />
    </View>
  );
}

// ── The visual editor ──────────────────────────────────────────────────────

export interface MarkdownDocumentEditorProps {
  /** The document's identity (its path): a new key makes a new editor. */
  documentKey: string;
  /** The Markdown the editor shows; a change from outside (a reload) replaces the document. */
  text: string;
  /** Every edit, as Markdown. */
  onChange: (markdown: string) => void;
  /** The document's name, for the AI prompt. */
  documentName: string;
  accessibilityLabel?: string;
  placeholder?: string;
  compact?: boolean;
  /** The reading column's width. */
  maxWidth?: number;
  /** Inline AI (`editor_ai_stream`) on the device that owns the document. */
  ai?: boolean;
}

/** The sessions of the mounted editors, so a surface's own menu can ask AI about the selection. */
const mountedSessions = new Map<string, RichEditorSession>();

/** Opens the "Ask AI" field over the mounted editor's selection (or at its caret). */
export function askAiInDocument(documentKey: string): void {
  const session = mountedSessions.get(documentKey);
  if (!session) return;
  const { from, to } = selectionRange(session);
  openInlineAiComposer(documentKey, from < to ? session.textBetween(from, to, "\n") : "");
}

function selectionRange(session: RichEditorSession): { from: number; to: number } {
  const selection = session.selection as unknown as { anchor?: number; head?: number };
  const anchor = Number(selection?.anchor ?? 0);
  const head = Number(selection?.head ?? anchor);
  return { from: Math.min(anchor, head), to: Math.max(anchor, head) };
}

let editorStylesCache: {
  palette: Palette;
  fontPx: number;
  loc: string;
  compact: boolean;
  styles: RichEditorStyles;
} | null = null;

function editorStyles(compact: boolean): RichEditorStyles {
  const p = palette();
  const fontPx = uiFontBasePx();
  const loc = currentLocale();
  if (
    editorStylesCache &&
    editorStylesCache.palette === p &&
    editorStylesCache.fontPx === fontPx &&
    editorStylesCache.loc === loc &&
    editorStylesCache.compact === compact
  ) {
    return editorStylesCache.styles;
  }
  const prose = typeScale.prose;
  const styles: RichEditorStyles = {
    root: { color: p.text, fontFamily: fontSans(), fontSize: textSize(prose), lineHeight: textLineHeight(prose, 1.6) },
    content: {
      paddingHorizontal: compact ? space.lg : space.x3l,
      paddingVertical: compact ? space.lg : space.xxl,
    },
    caret: { backgroundColor: p.accent },
    placeholder: { color: p.textMuted },
    nodes: {
      paragraph: { marginBottom: space.md },
      heading: { marginTop: space.lg, marginBottom: space.sm },
      bulletList: { marginBottom: space.md },
      orderedList: { marginBottom: space.md },
      taskList: { marginBottom: space.md },
      table: { marginBottom: space.md },
      "heading[level=1]": { fontSize: textSize(typeScale.pageTitle), fontWeight: "600" as const, lineHeight: textLineHeight(typeScale.pageTitle, 1.3) },
      "heading[level=2]": { fontSize: textSize(typeScale.modalTitle), fontWeight: "600" as const, lineHeight: textLineHeight(typeScale.modalTitle, 1.35) },
      "heading[level=3]": { fontSize: textSize(prose), fontWeight: "600" as const },
      codeBlock: {
        fontFamily: fontMono,
        fontSize: textSize(typeScale.label),
        lineHeight: textLineHeight(typeScale.label, 1.55),
        backgroundColor: p.surfaceTertiary,
        borderRadius: radii.md,
        padding: space.md,
        marginBottom: space.md,
      },
      blockquote: {
        borderLeftWidth: 2,
        borderColor: p.border,
        paddingLeft: space.md,
        marginBottom: space.md,
        color: p.textSecondary,
      },
      horizontalRule: { backgroundColor: p.border, height: 1, marginVertical: space.md },
      tableHeader: { fontWeight: "600" as const, borderWidth: 1, borderColor: p.border, padding: space.sm },
      tableCell: { borderWidth: 1, borderColor: p.borderSubtle, padding: space.sm },
    },
    marks: {
      code: { fontFamily: fontMono, backgroundColor: p.surfaceTertiary, borderRadius: radii.xs },
      link: { color: p.accent },
    },
  };
  editorStylesCache = { palette: p, fontPx, loc, compact, styles };
  return styles;
}

/** One editor over one document; remade when the document changes. */
function VisualEditorBody(props: { owner: MarkdownDocumentEditorProps }) {
  const owner = props.owner;
  const key = untracked(() => owner.documentKey);
  /** The text the document was last set from: an edit that returns to it reads as that text. */
  let baseline = untracked(() => owner.text);
  let lastEmitted = baseline;
  let normalizedBaseline: string | null = null;
  const session = createMarkdownSession(baseline);
  let quietRevision = session.revision;
  const hasSelection = signal(false);
  mountedSessions.set(key, session);
  cleanup(() => {
    if (mountedSessions.get(key) === session) mountedSessions.delete(key);
    if (inlineAi()?.documentKey === key) void cancelInlineAi();
    if (inlineAiComposer()?.documentKey === key) closeInlineAiComposer();
    session.dispose();
  });

  // A reload from disk (or a reset) replaces the text from outside: the
  // document follows it without counting as an edit.
  effect(() => {
    const text = owner.text;
    untracked(() => {
      if (text === lastEmitted) return;
      baseline = text;
      normalizedBaseline = null;
      lastEmitted = text;
      session.setContent(text, "markdown");
      quietRevision = session.revision;
    });
  });

  const emit = (revision: number) => {
    if (revision <= quietRevision) return;
    const serialized = session.getMarkdown();
    // The baseline is normalized once per baseline, not on every keystroke.
    if (normalizedBaseline === null) normalizedBaseline = normalizeMarkdown(baseline);
    const text =
      serialized === baseline || normalizeMarkdown(serialized) === normalizedBaseline ? baseline : serialized;
    if (text === lastEmitted) return;
    lastEmitted = text;
    owner.onChange(text);
  };

  const insertAnswer = () => {
    const answer = inlineAi();
    if (!answer || answer.documentKey !== key || !answer.text.trim()) return;
    session.insertContent(answer.text, "markdown");
    finishInlineAi();
    emit(session.revision);
  };

  return (
    <View style={{ flex: 1, minHeight: 0, minWidth: 0, flexDirection: "column" }}>
      <If when={owner.ai && inlineAiComposer()?.documentKey === key}>
        <InlineAiPanel
          documentKey={key}
          compact={Boolean(owner.compact)}
          onAsk={instruction =>
            void askInlineAi(key, {
              instruction,
              documentName: owner.documentName,
              document: session.getMarkdown(),
              selection: inlineAiComposer()?.selection ?? "",
            })
          }
          onInsert={insertAnswer}
        />
      </If>
      <RichEditor
        editor={session}
        accessibilityLabel={owner.accessibilityLabel}
        placeholder={owner.placeholder}
        styles={editorStyles(Boolean(owner.compact))}
        style={{ flex: 1, minHeight: 0, minWidth: 0, alignSelf: "center", width: "100%", maxWidth: owner.maxWidth }}
        onChange={event => emit(event.change.revision)}
        onSelectionChange={event => hasSelection.set(!event.selection.empty)}
        bubbleMenu={
          owner.ai && hasSelection() ? (
            <View
              {...popoverEnterMotion("top")}
              style={{
                flexDirection: "row",
                padding: space.xs,
                borderRadius: radii.lg,
                borderWidth: 1,
                borderColor: palette().borderSubtle,
                backgroundColor: palette().surfaceElevated,
                boxShadow: palette().shadowOverlay,
              }}
            >
              <Button
                label={tr("doc.askAi")}
                leadingIcon="sparkles"
                variant="ghost"
                size="xs"
                accessibilityLabel="doc-ask-ai-selection"
                onPress={() => askAiInDocument(key)}
              />
            </View>
          ) : undefined
        }
      />
    </View>
  );
}

/** The "Ask AI" field and the answer it streams, above the document. */
function InlineAiPanel(props: {
  documentKey: string;
  compact: boolean;
  onAsk: (instruction: string) => void;
  onInsert: () => void;
}) {
  const instruction = signal("");
  const answer = () => {
    const current = inlineAi();
    return current && current.documentKey === props.documentKey ? current : null;
  };
  const replacing = () => Boolean(inlineAiComposer()?.selection.trim());
  const dismiss = () => {
    void cancelInlineAi();
    closeInlineAiComposer();
  };
  cleanup(registerEscapeDismiss(dismiss));
  const submitAsk = (raw?: string) => {
    const query = (raw ?? instruction()).trim();
    if (!query || answer()?.status === "streaming") return;
    props.onAsk(query);
  };
  return (
    <View
      accessibilityLabel="doc-ai-panel"
      style={{
        gap: space.sm,
        paddingHorizontal: props.compact ? space.lg : space.xxl,
        paddingVertical: space.md,
        borderBottomWidth: 1,
        borderColor: palette().borderSubtle,
        backgroundColor: palette().canvas,
      }}
    >
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm }}>
        <View style={{ flex: 1, minWidth: 160, flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <Icon name="sparkles" size={14} color={palette().textSecondary} />
          <InputBox
            value={instruction()}
            onChange={value => instruction.set(value)}
            onSubmit={text => submitAsk(text)}
            onKeyPress={event => {
              if (event.key === "Escape") dismiss();
            }}
            placeholder={replacing() ? tr("doc.askAiRewritePlaceholder") : tr("doc.askAiPlaceholder")}
            size="sm"
            autoFocus={true}
            accessibilityLabel="doc-ai-input"
            style={{ flex: 1, minWidth: 0 }}
          />
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs, flexShrink: 0 }}>
          <If
            when={answer()?.status === "streaming"}
            else={
              <Button
                label={tr("doc.askAiSend")}
                variant="secondary"
                size="sm"
                disabled={!instruction().trim()}
                accessibilityLabel="doc-ai-send"
                onPress={() => submitAsk()}
              />
            }
          >
            <Button
              label={tr("common.stop")}
              variant="secondary"
              size="sm"
              loading={true}
              accessibilityLabel="doc-ai-stop"
              onPress={() => void cancelInlineAi()}
            />
          </If>
          <Button
            label={tr("common.cancel")}
            variant="ghost"
            size="sm"
            accessibilityLabel="doc-ai-cancel"
            onPress={dismiss}
          />
        </View>
      </View>
      <If when={answer()}>
        {state => (
          <View style={{ gap: space.sm, minHeight: 0 }}>
            <If
              when={state().status !== "failed"}
              else={
                <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm }}>
                  <Text
                    accessibilityLabel="doc-ai-error"
                    style={{ ...textStyle("caption", { color: palette().danger }), flex: 1, minWidth: 0 }}
                  >
                    {tr("doc.aiFailed", { error: localizeHostError(state().error ?? "") })}
                  </Text>
                  <Button
                    label={tr("common.tryAgain")}
                    variant="ghost"
                    size="xs"
                    accessibilityLabel="doc-ai-retry"
                    onPress={() => submitAsk(instruction() || state().instruction)}
                  />
                </View>
              }
            >
              <Scroll
                style={{
                  flexShrink: 1,
                  minHeight: 0,
                  maxHeight: 240,
                  borderRadius: radii.md,
                  backgroundColor: palette().surfaceTertiary,
                }}
                contentStyle={{ padding: space.md }}
              >
                <If
                  when={state().text.trim()}
                  else={
                    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                      <If when={state().status === "streaming"}>
                        <Spinner size={12} color={palette().textMuted} />
                      </If>
                      <Text style={textStyle("caption")}>
                        {state().status === "streaming" ? tr("doc.aiWorking") : tr("doc.aiEmpty")}
                      </Text>
                    </View>
                  }
                >
                  {text => (
                    <MarkdownPreview
                      markdown={text()}
                      compact={true}
                      links="report"
                      onLinkPress={defaultPreviewLinkPress}
                      accessibilityLabel="doc-ai-answer"
                    />
                  )}
                </If>
              </Scroll>
            </If>
            <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: space.sm }}>
              <Button
                label={tr("doc.aiDiscard")}
                variant="ghost"
                size="xs"
                accessibilityLabel="doc-ai-discard"
                onPress={() => void cancelInlineAi()}
              />
              <Button
                label={state().replacesSelection ? tr("doc.aiReplace") : tr("doc.aiInsert")}
                variant="primary"
                size="xs"
                disabled={state().status !== "ready" || !state().text.trim()}
                accessibilityLabel="doc-ai-insert"
                onPress={props.onInsert}
              />
            </View>
          </View>
        )}
      </If>
    </View>
  );
}

/**
 * The visual editor over one Markdown document. The caller decides when it
 * shows (`visualEditBlock`) and keeps the text: this view only edits it.
 */
export function MarkdownDocumentEditor(props: MarkdownDocumentEditorProps) {
  return (
    <Each of={[props.documentKey]} key={key => key}>
      {() => <VisualEditorBody owner={props} />}
    </Each>
  );
}
