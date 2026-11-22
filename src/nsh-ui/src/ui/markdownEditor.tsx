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

import { cleanup, effect, Scroll, signal, Text, untracked, View, WebView, type JSX } from "nsh";
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
import { Icon } from "./icons";
import { createMarkdownCodeActions, createMarkdownStyles, STATIC_MARKDOWN_OPTIONS } from "./markdown";
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
  return normalizeMarkdown(left) === normalizeMarkdown(right);
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
}

const rendererLoads = new Map<IslandKind, Promise<IslandRenderer>>();

async function readAsset(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`asset ${url} answered ${response.status}`);
  return response.text();
}

/** Text that cannot end or comment out the inline `<script>` / `<style>` element it goes into. */
function inlineSafe(text: string): string {
  return text.replace(/<\/(script|style)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");
}

function loadRenderer(kind: IslandKind): Promise<IslandRenderer> {
  let load = rendererLoads.get(kind);
  if (!load) {
    const assets = rendererFiles(kind);
    if (!assets) return Promise.reject(new Error("this app registered no document renderers"));
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

/** A JSON string literal that is safe inside a `<script>` element. */
function scriptLiteral(value: string): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
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
        `mermaid.render('d',${scriptLiteral(source)}).then(function(r){document.getElementById('out').innerHTML=r.svg;done()}).catch(fail)}catch(e){fail()}`;
  return (
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="${ISLAND_CSP}">` +
    `${renderer.style ? `<style>${renderer.style}</style>` : ""}${style}<script>${report}</script>` +
    `<script>${renderer.script}</script></head><body><div id="out"></div>` +
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
  let disposed = false;
  cleanup(() => {
    disposed = true;
  });
  effect(() => {
    void props.kind;
    void props.source;
    height.set(0);
    failed.set(false);
    const timer = setTimeout(() => {
      if (!disposed && height() === 0) failed.set(true);
    }, ISLAND_TIMEOUT_MS);
    cleanup(() => clearTimeout(timer));
  });
  effect(() => {
    const kind = props.kind;
    if (islandsAvailable() !== true) return;
    untracked(() => {
      if (renderer()) return;
      loadRenderer(kind)
        .then(loaded => {
          if (!disposed) renderer.set(loaded);
        })
        .catch(() => {
          if (!disposed) failed.set(true);
        });
    });
  });
  return (
    <If
      when={islandsAvailable() === true && !failed() ? renderer() : null}
      else={<IslandSource kind={props.kind} source={props.source} />}
    >
      {loaded => (
      <WebView
        accessibilityLabel={`doc-${props.kind}-view`}
        html={islandHtml(
          props.kind,
          props.source,
          loaded(),
          { text: palette().text, background: palette().canvas },
          resolvedScheme() === "dark",
        )}
        scrollable={false}
        incognito={true}
        style={{ alignSelf: "stretch", height: Math.max(height(), space.x4l) }}
        onMessage={event => {
          const data = String(event.data ?? "");
          if (data === "error") {
            failed.set(true);
            return;
          }
          const match = /^h:(\d+)/.exec(data);
          if (match) height.set(Math.max(1, Number(match[1])));
        }}
        onError={() => failed.set(true)}
      />
      )}
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

/** A Markdown document as a reader sees it, with Mermaid diagrams and display formulas. */
export function MarkdownPreview(props: MarkdownPreviewProps) {
  return (
    <View accessibilityLabel={props.accessibilityLabel} style={{ alignSelf: "stretch" }}>
    <TextView
      markdown={props.markdown}
      selectable={true}
      links={props.links}
      options={STATIC_MARKDOWN_OPTIONS}
      extensions={MERMAID_EXTENSIONS}
      styles={createMarkdownStyles({ compact: props.compact })}
      codeBlockActions={createMarkdownCodeActions()}
      renderImage={props.renderImage}
      onLinkPress={props.onLinkPress}
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
    root: { color: p.text, fontFamily: fontSans, fontSize: textSize(prose), lineHeight: textLineHeight(prose, 1.6) },
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
      lastEmitted = text;
      session.setContent(text, "markdown");
      quietRevision = session.revision;
    });
  });

  const emit = (revision: number) => {
    if (revision <= quietRevision) return;
    const serialized = session.getMarkdown();
    const text = sameMarkdown(serialized, baseline) ? baseline : serialized;
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
                  {text => <MarkdownPreview markdown={text()} compact={true} accessibilityLabel="doc-ai-answer" />}
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
