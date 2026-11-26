// Draws a GenerativeUI answer inside the transcript with NSH components.
//
// The tool call's OpenUI Lang source (or free HTML document) is read by
// `genuiSource.ts`, parsed and evaluated by `openuiLang.ts`, and drawn here.
// Each GenUI card keeps the values the user changed (`$state`) for as long as
// the transcript holds it; nothing is persisted, the way the desktop's inline
// GenUI was transient. A streamed answer is re-parsed as it grows, so the
// shell appears first and statements fill in as they complete.
//
// What this surface draws differently from the React renderer, on purpose and
// visibly: images and maps are not fetched (this window has no network grant),
// so they show their caption and an Open link; HtmlView and free documents show
// their static HTML with scripts off; YouTube is a link. Unknown components are
// listed under the card rather than dropped silently.

import { Canvas, cleanup, Clipboard, computed, openUrl, Path2D, Scroll, signal, Text, View, WebView } from "nsh";
import type { JSX, Signal } from "nsh";
import { Input, Slider, TextView } from "nsh/base";
import type { ToolCallView } from "../format";
import { tr } from "../i18n";
import { sendTurn } from "../state";
import { compactLayout, controlHeight, fontMono, inputFontSans, layout, palette, radii, space as themeSpace, textLineHeight, textSize, typeScale } from "../theme";
import { Icon, type IconName } from "../ui/icons";
import { LUCIDE_PATHS } from "../ui/lucideIcons";
import { createMarkdownStyles } from "../ui/markdown";
import { MOTION_DURATION, paintTransition, pressTransition, tactileActiveStyle } from "../ui/motion";
import { SelectDropdown } from "../ui/overlays";
import { Button, IconButton, SegmentedTabs, focusRingStyle } from "../ui/primitives";
import type { ToolRunState } from "../ui/toolCards";
import { genuiDocumentOf, type GenUIDocument } from "./genuiSource";
import {
  display,
  Evaluator,
  isGenAction,
  isGenElement,
  parseOpenUi,
  toNumber,
  truthy,
  type GenAction,
  type GenElement,
  type ParsedProgram,
} from "./openuiLang";

// --- Per-card state ------------------------------------------------------------

/** What the user changed in each card (`$name` → value), by card id. */
const cardStates = new Map<string, Signal<Record<string, unknown>>>();
/** The last action failure of each card, shown under it. */
const cardNotices = new Map<string, Signal<string>>();

function cardState(cardId: string): Signal<Record<string, unknown>> {
  let entry = cardStates.get(cardId);
  if (!entry) {
    entry = signal<Record<string, unknown>>({});
    cardStates.set(cardId, entry);
  }
  return entry;
}

function cardNotice(cardId: string): Signal<string> {
  let entry = cardNotices.get(cardId);
  if (!entry) {
    entry = signal("");
    cardNotices.set(cardId, entry);
  }
  return entry;
}

/** Forgets every card's state; the transcript calls it when it is disposed. */
export function resetGenUIState(): void {
  cardStates.clear();
  cardNotices.clear();
}

interface GenContext {
  cardId: string;
  set(name: string, value: unknown): void;
  run(action: GenAction | null, fallbackMessage?: string): void;
  /** Whether presses and edits act (false while the source still streams in). */
  interactive(): boolean;
}

// --- Entry point -------------------------------------------------------------------

/**
 * The transcript item of a GenerativeUI call: the rendered application, a quiet
 * placeholder while its first statements stream, or nothing for a failed
 * candidate (the model repairs it in a later call, as on the desktop).
 */
export function GenUIToolItem(props: { call: ToolCallView; cardId: string; status: ToolRunState; fallback: JSX.Element }) {
  const doc = computed(() => genuiDocumentOf(props.call, props.status === "running"));
  return (
    <If
      when={doc()}
      else={
        <If when={props.status === "running"} else={<If when={props.status !== "failed"}>{props.fallback}</If>}>
          <GenUIPlaceholder />
        </If>
      }
    >
      {current => (
        <If when={current().kind === "openui-lang"} else={<GenUIHtmlDocument doc={current()} />}>
          <GenUIApplication doc={current()} cardId={props.cardId} />
        </If>
      )}
    </If>
  );
}

function GenUIPlaceholder() {
  return (
    <View
      accessibilityLabel="genui-generating"
      style={{
        gap: themeSpace.sm,
        paddingVertical: themeSpace.md,
        paddingHorizontal: themeSpace.lg,
        borderRadius: radii.lg,
        borderCurve: "continuous",
        backgroundColor: palette().surfaceSubtle,
      }}
    >
      <View style={{ width: "40%", height: themeSpace.md, borderRadius: radii.sm, backgroundColor: palette().skeletonBg }} />
      <View style={{ width: "70%", height: themeSpace.sm + themeSpace.hair, borderRadius: radii.sm, backgroundColor: palette().skeletonBg }} />
      <Text style={{ color: palette().textMuted, fontSize: textSize(12), lineHeight: textLineHeight(12, 1.4) }}>
        {tr("genui.generating")}
      </Text>
    </View>
  );
}

function GenUIApplication(props: { doc: GenUIDocument; cardId: string }) {
  const state = cardState(props.cardId);
  const notice = cardNotice(props.cardId);
  const program = computed<ParsedProgram>(() => parseOpenUi(props.doc.content));
  const evaluator = computed(() => new Evaluator(program(), { ...props.doc.values, ...state() }));
  const evaluation = computed(() => evaluator().evaluateRoot());
  const roots = computed(() => {
    const root = evaluation().root;
    return root ? [root] : [];
  });
  const ctx: GenContext = {
    cardId: props.cardId,
    interactive: () => !props.doc.streaming,
    set(name, value) {
      state.update(current => ({ ...current, [name]: value }));
    },
    run(action, fallbackMessage) {
      notice.set("");
      const steps = action
        ? evaluator().resolveAction(action)
        : fallbackMessage
          ? [{ kind: "toAssistant" as const, message: fallbackMessage }]
          : [];
      for (const step of steps) {
        switch (step.kind) {
          case "set":
            ctx.set(step.name, step.value);
            break;
          case "reset": {
            const current = evaluator();
            state.update(values => {
              const next = { ...values };
              for (const name of step.names) next[name] = current.defaultOf(name);
              return next;
            });
            break;
          }
          case "openUrl":
            if (/^https?:\/\//i.test(step.url)) void openUrl(step.url).catch(() => notice.set(tr("genui.openFailed")));
            else notice.set(tr("genui.urlRefused"));
            break;
          case "copy":
            void Clipboard.writeText(step.text);
            break;
          case "toAssistant": {
            const context =
              step.context === undefined || step.context === null ? "" : `\n\n${tr("genui.contextLabel")} ${display(step.context)}`;
            void sendTurn(`${step.message}${context}`).then(outcome => {
              if (outcome === null) notice.set(tr("genui.sendFailed"));
            });
            break;
          }
        }
      }
    },
  };
  return (
    <View accessibilityLabel={`genui-${props.cardId}`} style={{ gap: 8 }}>
      <If when={props.doc.title}>
        <Text
          style={{
            color: palette().textMuted,
            fontSize: textSize(12),
            lineHeight: textLineHeight(12, 1.3),
            fontWeight: "500",
          }}
        >
          {props.doc.title}
        </Text>
      </If>
      <Each of={roots()} key={node => node.key}>
        {node => <GenNode node={node()} ctx={ctx} />}
      </Each>
      <If when={!evaluation().root && !props.doc.streaming}>
        <Text style={{ color: palette().textMuted, fontSize: textSize(13), lineHeight: textLineHeight(13, 1.45) }}>
          {tr("genui.empty")}
        </Text>
      </If>
      <If when={evaluation().unknown.length > 0 ? evaluation().unknown.join(", ") : ""}>
        {names => (
          <Text
            accessibilityLabel="genui-unsupported"
            style={{ color: palette().textMuted, fontSize: textSize(12), lineHeight: textLineHeight(12, 1.4) }}
          >
            {tr("genui.unsupportedParts", { names: names() })}
          </Text>
        )}
      </If>
      <If when={notice()}>
        {text => (
          <Text style={{ color: palette().warning, fontSize: textSize(12), lineHeight: textLineHeight(12, 1.4) }}>
            {text()}
          </Text>
        )}
      </If>
    </View>
  );
}

// --- Children ------------------------------------------------------------------------

type ChildNode = GenElement | { kind: "text"; text: string; key: string };

/** A slot's value as drawable children: elements and text, nested lists flattened, keys unique. */
function childrenOf(value: unknown, parentKey: string): ChildNode[] {
  const out: ChildNode[] = [];
  const seen = new Map<string, number>();
  const unique = (key: string) => {
    const count = seen.get(key) ?? 0;
    seen.set(key, count + 1);
    return count === 0 ? key : `${key}~${count}`;
  };
  const visit = (entry: unknown, index: string) => {
    if (entry === null || entry === undefined || entry === false || isGenAction(entry)) return;
    if (Array.isArray(entry)) {
      entry.forEach((item, position) => visit(item, `${index}.${position}`));
      return;
    }
    if (isGenElement(entry)) {
      out.push({ ...entry, key: unique(entry.key) });
      return;
    }
    const text = display(entry);
    if (text) out.push({ kind: "text", text, key: unique(`${parentKey}/text${index}`) });
  };
  visit(value, "");
  return out;
}

function Children(props: { value: unknown; parentKey: string; ctx: GenContext; inline?: boolean }) {
  return (
    <Each of={childrenOf(props.value, props.parentKey)} key={child => `${child.key}|${child.kind === "text" ? "text" : child.component}`}>
      {child => (
        <If
          when={child().kind === "element"}
          else={<InlineText text={(child() as { text: string }).text} inline={props.inline} />}
        >
          <GenNode node={child() as GenElement} ctx={props.ctx} />
        </If>
      )}
    </Each>
  );
}

// --- Tokens ----------------------------------------------------------------------------

/** OpenUI spacing units (`gap: 2`) in pixels. */
function space(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(64, value * 4));
}

const ALIGN: Record<string, "flex-start" | "center" | "flex-end" | "stretch"> = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  stretch: "stretch",
};
const JUSTIFY: Record<string, "flex-start" | "center" | "flex-end" | "space-between"> = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  between: "space-between",
};

/** A model-named color: a palette role, else the literal CSS color. */
function colorOf(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const p = palette();
  const roles: Record<string, string> = {
    primary: p.accent,
    accent: p.accent,
    secondary: p.textSecondary,
    muted: p.textMuted,
    success: p.success,
    warning: p.warning,
    danger: p.danger,
    error: p.danger,
    info: p.accent,
    neutral: p.textSecondary,
  };
  return roles[value] ?? value;
}

function radiusOf(value: unknown, fallback: number): number {
  if (typeof value === "number") return Math.max(0, value);
  const named: Record<string, number> = { none: 0, sm: radii.sm, md: radii.md, lg: radii.lg, xl: radii.xl, full: radii.pill };
  return typeof value === "string" ? named[value] ?? fallback : fallback;
}

function dimension(value: unknown): number | `${number}%` | undefined {
  if (typeof value === "number" && value > 0) return value;
  if (typeof value === "string" && /^\d+(\.\d+)?%$/.test(value)) return value as `${number}%`;
  return undefined;
}

const TITLE_SIZES: Record<string, number> = {
  sm: typeScale.prose,
  md: typeScale.modalTitle,
  lg: typeScale.pageTitle,
  xl: typeScale.pageTitle,
  "2xl": typeScale.display,
  "3xl": typeScale.display,
};
const TEXT_SIZES: Record<string, number> = {
  xs: typeScale.caption,
  sm: typeScale.label,
  md: typeScale.body,
  lg: typeScale.sectionTitle,
};
const ICON_SIZES: Record<string, number> = { sm: 14, md: 16, lg: 20, xl: 24 };

function hasMarkdown(text: string): boolean {
  return /\*\*|\*[^*\s]|`|\[[^\]]+\]\(|^#{1,6}\s|^\s*[-*]\s/m.test(text);
}

function InlineText(props: { text: string; inline?: boolean; size?: number; color?: string; weight?: string }) {
  return (
    <If
      when={hasMarkdown(props.text)}
      else={
        <Text
          style={{
            color: props.color ?? palette().text,
            fontSize: textSize(props.size ?? 14),
            lineHeight: textLineHeight(props.size ?? 14, 1.5),
            fontWeight: (props.weight as "400") ?? "400",
            userSelect: "text",
          }}
        >
          {props.text}
        </Text>
      }
    >
      <TextView
        markdown={props.text}
        selectable
        links="report"
        onLinkPress={event => {
          if (/^https?:/i.test(event.url)) void openUrl(event.url).catch(() => undefined);
        }}
        styles={createMarkdownStyles({ compact: true, baseFontSize: props.size ?? 14 })}
      />
    </If>
  );
}

// --- Components --------------------------------------------------------------------------

/** One element. Its component never changes under one key, so the branch is chosen once. */
function GenNode(props: { node: GenElement; ctx: GenContext }): JSX.Element {
  const component = props.node.component;
  const p = () => props.node.props;
  const key = () => props.node.key;
  const ctx = props.ctx;
  switch (component) {
    case "Col":
    case "Form":
      return (
        <View
          style={{
            flexDirection: "column",
            gap: space(p().gap, 12),
            alignItems: ALIGN[String(p().align)] ?? "stretch",
          }}
        >
          <Children value={p().children} parentKey={key()} ctx={ctx} />
        </View>
      );
    case "Row":
      return (
        <View
          style={{
            flexDirection: "row",
            gap: space(p().gap, 8),
            alignItems: ALIGN[String(p().align)] ?? "center",
            justifyContent: JUSTIFY[String(p().justify)] ?? "flex-start",
            flexWrap: truthy(p().wrap) ? "wrap" : "nowrap",
          }}
        >
          <Children value={p().children} parentKey={key()} ctx={ctx} inline />
        </View>
      );
    case "Box":
      return (
        <View
          style={{
            flexDirection: p().direction === "row" ? "row" : "column",
            gap: space(p().gap, 8),
            padding: space(p().padding, 0),
            backgroundColor: typeof p().background === "string" ? colorOf(p().background, "transparent") : "transparent",
            borderRadius: radiusOf(p().radius, 0),
            borderWidth: truthy(p().border) ? 1 : 0,
            borderColor: palette().borderSubtle,
            width: dimension(p().width),
            height: dimension(p().height),
            flex: typeof p().flex === "number" ? (p().flex as number) : undefined,
            alignItems: ALIGN[String(p().align)] ?? (p().direction === "row" ? "center" : "stretch"),
            justifyContent: JUSTIFY[String(p().justify)] ?? "flex-start",
            flexWrap: truthy(p().wrap) ? "wrap" : "nowrap",
            overflow: p().radius !== undefined ? "hidden" : "visible",
          }}
        >
          <Children value={p().children} parentKey={key()} ctx={ctx} />
        </View>
      );
    case "Grid":
      return <GenGrid node={props.node} ctx={ctx} />;
    case "Card":
      return (
        <View
          style={{
            gap: space(p().gap, themeSpace.md),
            padding: space(p().padding, themeSpace.lg),
            borderRadius: radii.lg,
            borderCurve: "continuous",
            borderWidth: p().variant === "soft" ? 0 : 1,
            borderColor: palette().borderSubtle,
            backgroundColor: p().variant === "soft" ? palette().surfaceSubtle : palette().panelRaised,
          }}
        >
          <Children value={p().children} parentKey={key()} ctx={ctx} />
        </View>
      );
    case "Carousel":
      return (
        <Scroll smoothWheel horizontal style={{ minHeight: 0 }}>
          <View style={{ flexDirection: "row", gap: space(p().gap, 12) }}>
            <Each of={childrenOf(p().children, key())} key={child => `${child.key}|${child.kind}`}>
              {child => (
                <View style={{ width: typeof p().itemWidth === "number" ? (p().itemWidth as number) : 240 }}>
                  <If when={child().kind === "element"} else={<InlineText text={(child() as { text: string }).text} />}>
                    <GenNode node={child() as GenElement} ctx={ctx} />
                  </If>
                </View>
              )}
            </Each>
          </View>
        </Scroll>
      );
    case "Popover":
      return <GenPopover node={props.node} ctx={ctx} />;
    case "Divider":
      return <View style={{ height: 1, alignSelf: "stretch", backgroundColor: palette().borderSubtle }} />;
    case "Spacer":
      return <View style={{ flex: 1 }} />;
    case "Title":
      return (
        <Text
          style={{
            color: colorOf(p().color, palette().text),
            fontSize: textSize(TITLE_SIZES[String(p().size)] ?? 17),
            lineHeight: textLineHeight(TITLE_SIZES[String(p().size)] ?? 17, 1.3),
            fontWeight: "600",
            userSelect: "text",
          }}
        >
          {display(p().text)}
        </Text>
      );
    case "Text":
      return (
        <If
          when={Array.isArray(p().text)}
          else={
            <Text
              style={{
                color: colorOf(p().color, palette().text),
                fontSize: textSize(TEXT_SIZES[String(p().size)] ?? 14),
                lineHeight: textLineHeight(TEXT_SIZES[String(p().size)] ?? 14, 1.5),
                fontWeight: p().weight === "semibold" ? "600" : p().weight === "medium" ? "500" : "400",
                fontStyle: truthy(p().italic) ? "italic" : "normal",
                textDecorationLine: truthy(p().lineThrough) ? "line-through" : "none",
                fontVariant: truthy(p().tabularNums) ? ["tabular-nums"] : undefined,
                numberOfLines: typeof p().maxLines === "number" ? (p().maxLines as number) : undefined,
                textOverflow: typeof p().maxLines === "number" ? "ellipsis" : undefined,
                userSelect: "text",
              }}
            >
              {stripInlineMarkdown(display(p().text))}
            </Text>
          }
        >
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 4 }}>
            <Children value={p().text} parentKey={key()} ctx={ctx} inline />
          </View>
        </If>
      );
    case "Caption":
      return (
        <Text style={{ color: colorOf(p().color, palette().textMuted), fontSize: textSize(12), lineHeight: textLineHeight(12, 1.45) }}>
          {display(p().text)}
        </Text>
      );
    case "Label":
      return (
        <Text style={{ color: palette().textSecondary, fontSize: textSize(13), lineHeight: textLineHeight(13, 1.4), fontWeight: "600" }}>
          {display(p().text)}
        </Text>
      );
    case "Badge":
      return <GenBadge node={props.node} />;
    case "Link":
      return (
        <View
          role="link"
          accessibilityLabel={`genui-link-${display(p().text)}`}
          onPress={() => ctx.run({ kind: "action", steps: [{ kind: "fn", name: "OpenUrl", args: [{ kind: "literal", value: display(p().url) }] }], scope: { vars: {} } })}
          style={{
            minHeight: compactLayout() ? layout.touchTarget : undefined,
            justifyContent: "center",
            borderRadius: radii.xs,
            cursor: "pointer",
            alignSelf: "flex-start",
            userSelect: "none",
            ...pressTransition(MOTION_DURATION.fast),
          }}
          activeStyle={tactileActiveStyle(0.98)}
          focusVisibleStyle={focusRingStyle()}
        >
          <Text style={{ color: palette().accent, fontSize: textSize(14), lineHeight: textLineHeight(14, 1.5) }}>
            {display(p().text) || display(p().url)}
          </Text>
        </View>
      );
    case "List":
      return <GenList node={props.node} ctx={ctx} />;
    case "ListItem":
      return <GenListItem node={props.node} ctx={ctx} marker="" />;
    case "Markdown":
      return <InlineText text={`${display(p().text)}\n`} />;
    case "Quote":
      return (
        <View style={{ paddingLeft: 12, borderLeftWidth: 2, borderColor: palette().borderStrong, gap: 4 }}>
          <InlineText text={display(p().text)} color={palette().textSecondary} />
          <If when={display(p().cite)}>
            {cite => <Text style={{ color: palette().textMuted, fontSize: textSize(12), lineHeight: textLineHeight(12, 1.4) }}>{`— ${cite()}`}</Text>}
          </If>
        </View>
      );
    case "Code":
      return <GenCode node={props.node} />;
    case "Math":
      return (
        <Text style={{ color: palette().text, fontFamily: fontMono(), fontSize: textSize(13), lineHeight: textLineHeight(13, 1.5), userSelect: "text" }}>
          {display(p().tex)}
        </Text>
      );
    case "Button":
      return (
        <View style={{ alignSelf: truthy(p().block) ? "stretch" : "flex-start" }}>
          <Button
            label={display(p().label)}
            variant={p().color === "danger" ? "danger" : p().variant === "solid" || p().color === "primary" ? "primary" : p().variant === "ghost" ? "ghost" : "secondary"}
            size={p().size === "lg" ? "md" : "sm"}
            fullWidth={truthy(p().block)}
            leadingIcon={iconNameOf(p().icon) ?? undefined}
            disabled={truthy(p().disabled) || !ctx.interactive()}
            accessibilityLabel={`genui-button-${display(p().label)}`}
            style={compactLayout() ? { minHeight: layout.touchTarget } : undefined}
            onPress={() => ctx.run(isGenAction(p().action) ? (p().action as GenAction) : null, display(p().label))}
          />
        </View>
      );
    case "IconButton":
      return (
        <IconButton
          icon={iconNameOf(p().icon) ?? "circle-dot"}
          size="sm"
          tooltip={display(p().label) || undefined}
          disabled={!ctx.interactive()}
          accessibilityLabel={`genui-icon-${display(p().label) || display(p().icon)}`}
          style={compactLayout() ? { width: layout.touchTarget, height: layout.touchTarget } : undefined}
          onPress={() => ctx.run(isGenAction(p().action) ? (p().action as GenAction) : null, display(p().label))}
        />
      );
    case "Pressable":
      return (
        <View
          role="button"
          accessibilityLabel={`genui-pressable-${key()}`}
          onPress={() => {
            if (ctx.interactive() && isGenAction(p().action)) ctx.run(p().action as GenAction);
          }}
          style={{
            padding: space(p().padding, 0),
            borderRadius: radiusOf(p().radius, radii.md),
            borderCurve: "continuous",
            backgroundColor: truthy(p().selected) ? palette().accentSoft : typeof p().background === "string" ? colorOf(p().background, "transparent") : "transparent",
            cursor: "pointer",
            userSelect: "none",
            ...pressTransition(MOTION_DURATION.fast),
          }}
          hoverStyle={{ backgroundColor: palette().surfaceSubtle }}
          activeStyle={tactileActiveStyle(0.98)}
          focusVisibleStyle={focusRingStyle()}
        >
          <Children value={p().children} parentKey={key()} ctx={ctx} />
        </View>
      );
    case "Input":
    case "TextArea":
    case "DatePicker":
      return <GenField node={props.node} ctx={ctx} />;
    case "Select":
    case "SegmentedControl":
    case "RadioGroup":
      return <GenChoice node={props.node} ctx={ctx} />;
    case "Slider":
      return <GenSlider node={props.node} ctx={ctx} />;
    case "Checkbox":
      return <GenCheckbox node={props.node} ctx={ctx} />;
    case "Timer":
      return <GenTimer node={props.node} ctx={ctx} />;
    case "Image":
    case "SearchImage":
      return <GenMediaTile icon="image" caption={display(p().alt) || display(p().query)} url={component === "Image" ? display(p().src) : ""} note={tr("genui.imageNotLoaded")} />;
    case "YouTube":
      return (
        <GenMediaTile
          icon="play"
          caption={display(p().title) || tr("genui.video")}
          url={/^https?:/.test(display(p().video)) ? display(p().video) : `https://www.youtube.com/watch?v=${encodeURIComponent(display(p().video))}`}
          note={tr("genui.videoExternal")}
        />
      );
    case "Map":
      return <GenMap node={props.node} />;
    case "MapMarker":
      return <Text style={{ color: palette().textSecondary, fontSize: textSize(13), lineHeight: textLineHeight(13, 1.4) }}>{display(p().label)}</Text>;
    case "Icon":
      return (
        <Icon
          name={iconNameOf(p().name) ?? "circle-dot"}
          size={ICON_SIZES[String(p().size)] ?? 16}
          color={colorOf(p().color, palette().textSecondary)}
        />
      );
    case "Table":
      return <GenTable node={props.node} ctx={ctx} />;
    case "Chart":
      return <GenChart node={props.node} />;
    case "Flashcard":
      return <GenFlashcard node={props.node} ctx={ctx} />;
    case "Celebration":
      return (
        <If when={truthy(p().when)}>
          <View accessibilityLabel="genui-celebration" style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
            <Icon name="sparkles" size={16} color={palette().accent} />
          </View>
        </If>
      );
    case "Svg":
      return <GenSvg node={props.node} />;
    case "HtmlView":
      return <GenHtml html={display(p().html)} title={display(p().title)} height={typeof p().height === "number" ? (p().height as number) : 320} />;
    default:
      // SVG shapes outside an Svg, and anything else this renderer has no drawing for.
      return <View />;
  }
}

function stripInlineMarkdown(text: string): string {
  return text.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1");
}

function iconNameOf(value: unknown): IconName | null {
  if (typeof value !== "string" || !value) return null;
  return Object.prototype.hasOwnProperty.call(LUCIDE_PATHS, value) ? (value as IconName) : null;
}

function GenGrid(props: { node: GenElement; ctx: GenContext }) {
  const columns = () => Math.max(1, Math.min(6, Math.floor(toNumber(props.node.props.columns) || 2)));
  const rows = computed(() => {
    const items = childrenOf(props.node.props.children, props.node.key);
    const out: Array<{ key: string; items: ChildNode[] }> = [];
    for (let index = 0; index < items.length; index += columns()) {
      out.push({ key: `${props.node.key}/row${index}`, items: items.slice(index, index + columns()) });
    }
    return out;
  });
  return (
    <View style={{ gap: space(props.node.props.gap, 12) }}>
      <Each of={rows()} key={row => row.key}>
        {row => (
          <View style={{ flexDirection: "row", gap: space(props.node.props.gap, 12), alignItems: "stretch" }}>
            <Each of={row().items} key={child => `${child.key}|${child.kind}`}>
              {child => (
                <View style={{ flex: 1, minWidth: 0 }}>
                  <If when={child().kind === "element"} else={<InlineText text={(child() as { text: string }).text} />}>
                    <GenNode node={child() as GenElement} ctx={props.ctx} />
                  </If>
                </View>
              )}
            </Each>
            <Each of={Array.from({ length: columns() - row().items.length }, (_, index) => index)} key={index => String(index)}>
              {() => <View style={{ flex: 1 }} />}
            </Each>
          </View>
        )}
      </Each>
    </View>
  );
}

function GenPopover(props: { node: GenElement; ctx: GenContext }) {
  const open = signal(false);
  return (
    <View style={{ gap: themeSpace.chip, alignSelf: "flex-start" }}>
      <View
        role="button"
        accessibilityLabel={`genui-popover-${props.node.key}`}
        onPress={() => open.set(!open())}
        style={{
          minHeight: compactLayout() ? layout.touchTarget : undefined,
          borderRadius: radii.sm,
          cursor: "pointer",
          flexDirection: "row",
          alignItems: "center",
          gap: themeSpace.xs,
          userSelect: "none",
          ...pressTransition(MOTION_DURATION.fast),
        }}
        activeStyle={tactileActiveStyle(0.98)}
        focusVisibleStyle={focusRingStyle()}
      >
        <Children value={props.node.props.trigger} parentKey={`${props.node.key}/trigger`} ctx={props.ctx} inline />
      </View>
      <If when={open()}>
        <View
          style={{
            padding: themeSpace.md,
            borderRadius: radii.md,
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: palette().borderSubtle,
            backgroundColor: palette().popoverBg,
            maxWidth: 360,
            gap: themeSpace.chip,
          }}
        >
          <Children value={props.node.props.content} parentKey={`${props.node.key}/content`} ctx={props.ctx} />
        </View>
      </If>
    </View>
  );
}

function GenBadge(props: { node: GenElement }) {
  const tone = () => {
    const p = palette();
    switch (props.node.props.color) {
      case "success":
        return { bg: p.successSoft, fg: p.success };
      case "warning":
        return { bg: p.warningSoft, fg: p.warning };
      case "danger":
        return { bg: p.dangerSoft, fg: p.danger };
      case "info":
      case "purple":
      case "pink":
        return { bg: p.accentSoft, fg: p.accent };
      default:
        return { bg: p.surfaceSubtle, fg: p.textSecondary };
    }
  };
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        alignSelf: "flex-start",
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: radii.pill,
        backgroundColor: tone().bg,
      }}
    >
      <If when={iconNameOf(props.node.props.icon)}>
        {icon => <Icon name={icon()} size={12} color={tone().fg} />}
      </If>
      <Text style={{ color: tone().fg, fontSize: textSize(12), lineHeight: textLineHeight(12, 1.4), fontWeight: "500" }}>
        {display(props.node.props.text)}
      </Text>
    </View>
  );
}

function GenList(props: { node: GenElement; ctx: GenContext }) {
  const items = computed(() => childrenOf(props.node.props.items, props.node.key));
  const marker = (index: number) =>
    props.node.props.marker === "none" ? "" : props.node.props.marker === "number" ? `${index + 1}.` : "•";
  return (
    <View style={{ gap: 6 }}>
      <Each of={items()} key={child => `${child.key}|${child.kind}`}>
        {(child, index) => (
          <If
            when={child().kind === "element" && (child() as GenElement).component === "ListItem"}
            else={
              <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
                <Text style={{ width: 18, color: palette().textMuted, fontSize: textSize(14), lineHeight: textLineHeight(14, 1.5) }}>
                  {marker(index())}
                </Text>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <If when={child().kind === "element"} else={<InlineText text={(child() as { text: string }).text} />}>
                    <GenNode node={child() as GenElement} ctx={props.ctx} />
                  </If>
                </View>
              </View>
            }
          >
            <GenListItem node={child() as GenElement} ctx={props.ctx} marker={marker(index())} />
          </If>
        )}
      </Each>
    </View>
  );
}

function GenListItem(props: { node: GenElement; ctx: GenContext; marker: string }) {
  return (
    <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
      <Text style={{ minWidth: 18, color: palette().textMuted, fontSize: textSize(13), lineHeight: textLineHeight(14, 1.5) }}>
        {display(props.node.props.marker) || props.marker}
      </Text>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={{ color: palette().text, fontSize: textSize(14), lineHeight: textLineHeight(14, 1.5), fontWeight: "500", userSelect: "text" }}>
          {display(props.node.props.title)}
        </Text>
        <If when={display(props.node.props.description)}>
          {text => <Text style={{ color: palette().textSecondary, fontSize: textSize(13), lineHeight: textLineHeight(13, 1.45) }}>{text()}</Text>}
        </If>
        <Children value={props.node.props.children} parentKey={props.node.key} ctx={props.ctx} />
      </View>
    </View>
  );
}

function GenCode(props: { node: GenElement }) {
  const copied = signal(false);
  let copyTimer: ReturnType<typeof setTimeout> | null = null;
  cleanup(() => {
    if (copyTimer) {
      clearTimeout(copyTimer);
      copyTimer = null;
    }
  });
  return (
    <View style={{ borderRadius: radii.md, borderCurve: "continuous", backgroundColor: palette().surfaceSubtle, padding: themeSpace.md, gap: themeSpace.chip }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={{ color: palette().textMuted, fontSize: textSize(12), lineHeight: textLineHeight(12, 1.3) }}>
          {display(props.node.props.language)}
        </Text>
        <IconButton
          icon={copied() ? "check" : "copy"}
          size="xs"
          accessibilityLabel="genui-copy-code"
          tooltip={copied() ? tr("common.copied") : tr("common.copy")}
          style={compactLayout() ? { width: layout.touchTarget, height: layout.touchTarget } : undefined}
          onPress={() => {
            void Clipboard.writeText(display(props.node.props.code)).then(() => {
              copied.set(true);
              if (copyTimer) clearTimeout(copyTimer);
              copyTimer = setTimeout(() => {
                copyTimer = null;
                copied.set(false);
              }, 1600);
            });
          }}
        />
      </View>
      <Scroll smoothWheel horizontal style={{ minHeight: 0 }}>
        <Text style={{ color: palette().text, fontFamily: fontMono(), fontSize: textSize(12), lineHeight: textLineHeight(12, 1.55), userSelect: "text" }}>
          {display(props.node.props.code)}
        </Text>
      </Scroll>
    </View>
  );
}

function fieldLabel(props: { label: unknown }) {
  return (
    <If when={display(props.label)}>
      {text => (
        <Text style={{ color: palette().textSecondary, fontSize: textSize(13), lineHeight: textLineHeight(13, 1.4), fontWeight: "500" }}>
          {text()}
        </Text>
      )}
    </If>
  );
}

function GenField(props: { node: GenElement; ctx: GenContext }) {
  const focused = signal(false);
  const p = () => props.node.props;
  const binding = () => props.node.bindings.value;
  const multiline = props.node.component === "TextArea";
  return (
    <View style={{ gap: themeSpace.chip }}>
      {fieldLabel({ label: p().label })}
      <Input
        value={display(p().value)}
        placeholder={display(p().placeholder) || (props.node.component === "DatePicker" ? "YYYY-MM-DD" : "")}
        multiline={multiline}
        accessibilityLabel={`genui-field-${display(p().label) || binding() || props.node.key}`}
        readonly={!binding() || !props.ctx.interactive()}
        onFocus={() => focused.set(true)}
        onBlur={() => focused.set(false)}
        style={{
          minHeight: multiline
            ? 20 * Math.max(2, toNumber(p().rows) || 3)
            : compactLayout()
              ? layout.touchTarget
              : controlHeight.md,
          paddingHorizontal: themeSpace.md,
          paddingVertical: themeSpace.chip,
          borderRadius: radii.sm,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: focused() ? palette().fieldFocusBorder : palette().border,
          backgroundColor: palette().inputBg,
          fontFamily: inputFontSans(),
          fontSize: compactLayout() ? Math.max(16, textSize(14)) : textSize(14),
          color: palette().text,
          placeholderColor: palette().textMuted,
          caretColor: palette().accent,
          ...paintTransition(MOTION_DURATION.fast),
        }}
        onChange={event => {
          const name = binding();
          if (!name) return;
          if (p().type === "number") {
            const parsed = Number(event.value);
            props.ctx.set(name, event.value.trim() === "" || Number.isNaN(parsed) ? event.value : parsed);
          } else props.ctx.set(name, event.value);
        }}
      />
    </View>
  );
}

interface ChoiceOption {
  value: string;
  label: string;
  description?: string;
}

function optionsOf(value: unknown): ChoiceOption[] {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",").map(part => part.trim()) : [];
  return raw.flatMap(entry => {
    if (typeof entry === "string" && entry) return [{ value: entry, label: entry }];
    if (typeof entry === "number") return [{ value: String(entry), label: String(entry) }];
    if (entry && typeof entry === "object") {
      const record = entry as Record<string, unknown>;
      const optionValue = display(record.value ?? record.label);
      if (!optionValue) return [];
      return [{ value: optionValue, label: display(record.label) || optionValue, ...(record.description ? { description: display(record.description) } : {}) }];
    }
    return [];
  });
}

function GenChoice(props: { node: GenElement; ctx: GenContext }) {
  const p = () => props.node.props;
  const options = computed(() => optionsOf(p().options));
  const current = () => display(p().value);
  const choose = (value: string) => {
    const name = props.node.bindings.value;
    if (name && props.ctx.interactive()) props.ctx.set(name, value);
  };
  const kind = () => props.node.component;
  const useSegmented = computed(
    () =>
      kind() === "SegmentedControl" ||
      p().variant === "pills" ||
      (kind() === "RadioGroup" && !p().variant && options().length <= 4 && !options().some(option => option.description)),
  );
  if (props.node.component === "Select") {
    return (
      <View style={{ gap: themeSpace.chip, alignSelf: "flex-start" }}>
        {fieldLabel({ label: p().label })}
        <SelectDropdown
          options={options().map(option => ({ value: option.value, label: option.label }))}
          value={current() || null}
          placeholder={display(p().placeholder) || undefined}
          accessibilityLabel={`genui-select-${display(p().label) || props.node.key}`}
          onChange={value => choose(value)}
        />
      </View>
    );
  }
  return (
    <If
      when={useSegmented()}
      else={
        <View style={{ gap: themeSpace.chip }}>
          {fieldLabel({ label: p().label })}
          <Each of={options()} key={option => option.value}>
            {option => (
              <View
                role="radio"
                accessibilityLabel={`genui-option-${option().value}`}
                accessibilityState={{ selected: current() === option().value }}
                onPress={() => choose(option().value)}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  minHeight: compactLayout() ? layout.touchTarget : undefined,
                  gap: themeSpace.sm,
                  padding: p().variant === "cards" ? themeSpace.md : themeSpace.chip,
                  borderRadius: radii.md,
                  borderCurve: "continuous",
                  borderWidth: p().variant === "cards" ? 1 : 0,
                  borderColor: current() === option().value ? palette().accentBorder : palette().borderSubtle,
                  backgroundColor: current() === option().value && p().variant === "cards" ? palette().accentSoft : "transparent",
                  cursor: "pointer",
                  userSelect: "none",
                  ...pressTransition(MOTION_DURATION.fast),
                }}
                hoverStyle={{ backgroundColor: palette().surfaceSubtle }}
                activeStyle={tactileActiveStyle(0.985)}
                focusVisibleStyle={focusRingStyle()}
              >
                <View
                  style={{
                    width: themeSpace.lg,
                    height: themeSpace.lg,
                    borderRadius: radii.pill,
                    borderWidth: current() === option().value ? 5 : 1.5,
                    borderColor: current() === option().value ? palette().accent : palette().borderStrong,
                  }}
                />
                <View style={{ flex: 1, minWidth: 0, gap: themeSpace.hair }}>
                  <Text style={{ color: palette().text, fontSize: textSize(14), lineHeight: textLineHeight(14, 1.4) }}>{option().label}</Text>
                  <If when={option().description ?? ""}>
                    {text => <Text style={{ color: palette().textSecondary, fontSize: textSize(12), lineHeight: textLineHeight(12, 1.4) }}>{text()}</Text>}
                  </If>
                </View>
              </View>
            )}
          </Each>
        </View>
      }
    >
      <View style={{ gap: themeSpace.chip, alignSelf: truthy(p().block) ? "stretch" : "flex-start" }}>
        {fieldLabel({ label: p().label })}
        <SegmentedTabs
          options={options().map(option => ({ value: option.value, label: option.label }))}
          value={current()}
          size="sm"
          onChange={value => choose(value)}
        />
      </View>
    </If>
  );
}

function GenSlider(props: { node: GenElement; ctx: GenContext }) {
  const p = () => props.node.props;
  const min = () => toNumber(p().min);
  const max = () => (toNumber(p().max) > min() ? toNumber(p().max) : min() + 100);
  const value = () => Math.min(max(), Math.max(min(), toNumber(p().value)));
  const shown = () => {
    const unit = display(p().unit);
    const text = display(value());
    return unit === "$" ? `$${text}` : unit ? `${text}${unit === "%" ? "" : " "}${unit}` : text;
  };
  return (
    <View style={{ gap: themeSpace.chip }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        {fieldLabel({ label: p().label })}
        <Text style={{ color: palette().textSecondary, fontSize: textSize(13), lineHeight: textLineHeight(13, 1.4), fontVariant: ["tabular-nums"] }}>
          {shown()}
        </Text>
      </View>
      <Slider
        value={value()}
        min={min()}
        max={max()}
        step={toNumber(p().step) || 1}
        accessibilityLabel={`genui-slider-${display(p().label) || props.node.key}`}
        disabled={!props.node.bindings.value || !props.ctx.interactive()}
        style={{ height: compactLayout() ? layout.touchTarget : themeSpace.xl, justifyContent: "center" }}
        trackStyle={{ height: compactLayout() ? layout.touchTarget : themeSpace.xl, justifyContent: "center" }}
        indicatorStyle={{ height: themeSpace.xs, borderRadius: radii.pill, backgroundColor: palette().surfaceTertiary }}
        rangeStyle={{ height: themeSpace.xs, borderRadius: radii.pill, backgroundColor: palette().accent }}
        thumbStyle={{ width: themeSpace.lg, height: themeSpace.lg, borderRadius: radii.pill, backgroundColor: palette().panelRaised, borderWidth: 1, borderColor: palette().borderStrong }}
        onChange={event => {
          const name = props.node.bindings.value;
          if (name && typeof event.value === "number") props.ctx.set(name, event.value);
        }}
      />
    </View>
  );
}

function GenCheckbox(props: { node: GenElement; ctx: GenContext }) {
  const checked = () => truthy(props.node.props.checked);
  return (
    <View
      role="checkbox"
      accessibilityLabel={`genui-check-${display(props.node.props.label)}`}
      accessibilityState={{ checked: checked() }}
      onPress={() => {
        const name = props.node.bindings.checked;
        if (name && props.ctx.interactive()) props.ctx.set(name, !checked());
      }}
      style={{
        flexDirection: "row",
        alignItems: "center",
        minHeight: compactLayout() ? layout.touchTarget : undefined,
        gap: themeSpace.sm,
        cursor: "pointer",
        alignSelf: "flex-start",
        paddingVertical: themeSpace.hair,
        borderRadius: radii.xs,
        userSelect: "none",
        ...pressTransition(MOTION_DURATION.fast),
      }}
      activeStyle={tactileActiveStyle(0.98)}
      focusVisibleStyle={focusRingStyle()}
    >
      <View
        style={{
          width: themeSpace.lg,
          height: themeSpace.lg,
          borderRadius: radii.xs,
          borderWidth: checked() ? 0 : 1.5,
          borderColor: palette().borderStrong,
          backgroundColor: checked() ? palette().accent : "transparent",
          alignItems: "center",
          justifyContent: "center",
          ...paintTransition(MOTION_DURATION.fast),
        }}
      >
        <If when={checked()}>
          <Icon name="check" size={12} color={palette().actionSolidFg} />
        </If>
      </View>
      <Text
        style={{
          color: checked() && truthy(props.node.props.lineThrough) ? palette().textMuted : palette().text,
          fontSize: textSize(14),
          lineHeight: textLineHeight(14, 1.4),
          textDecorationLine: checked() && truthy(props.node.props.lineThrough) ? "line-through" : "none",
        }}
      >
        {display(props.node.props.label)}
      </Text>
    </View>
  );
}

function GenTimer(props: { node: GenElement; ctx: GenContext }) {
  const running = signal(false);
  let interval: ReturnType<typeof setInterval> | null = null;
  const initial = toNumber(props.node.props.seconds);
  const local = signal(initial);
  const seconds = () => (props.node.bindings.seconds ? toNumber(props.node.props.seconds) : local());
  const write = (value: number) => {
    const name = props.node.bindings.seconds;
    if (name) props.ctx.set(name, value);
    else local.set(value);
  };
  const stop = () => {
    if (interval !== null) clearInterval(interval);
    interval = null;
    running.set(false);
  };
  cleanup(stop);
  const start = () => {
    if (interval !== null || seconds() <= 0) return;
    running.set(true);
    interval = setInterval(() => {
      const next = Math.max(0, seconds() - 1);
      write(next);
      if (next <= 0) stop();
    }, 1000);
  };
  const clock = () => {
    const total = Math.max(0, Math.floor(seconds()));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
  };
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: themeSpace.sm, alignSelf: "flex-start" }}>
      <View style={{ gap: themeSpace.hair }}>
        <If when={display(props.node.props.label)}>
          {label => <Text style={{ color: palette().textSecondary, fontSize: textSize(12), lineHeight: textLineHeight(12, 1.3) }}>{label()}</Text>}
        </If>
        <Text
          style={{
            color: palette().text,
            fontSize: textSize(typeScale.pageTitle),
            lineHeight: textLineHeight(typeScale.pageTitle, 1.2),
            fontWeight: "600",
            fontVariant: ["tabular-nums"],
          }}
        >
          {clock()}
        </Text>
      </View>
      <IconButton
        icon={running() ? "pause" : "play"}
        size="sm"
        accessibilityLabel="genui-timer-toggle"
        style={compactLayout() ? { width: layout.touchTarget, height: layout.touchTarget } : undefined}
        onPress={() => (running() ? stop() : start())}
      />
      <IconButton
        icon="undo"
        size="sm"
        accessibilityLabel="genui-timer-reset"
        style={compactLayout() ? { width: layout.touchTarget, height: layout.touchTarget } : undefined}
        onPress={() => {
          stop();
          write(initial);
        }}
      />
    </View>
  );
}

function GenMediaTile(props: { icon: IconName; caption: string; url: string; note: string }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: themeSpace.sm,
        padding: themeSpace.md,
        borderRadius: radii.md,
        borderCurve: "continuous",
        backgroundColor: palette().surfaceSubtle,
      }}
    >
      <Icon name={props.icon} size={18} color={palette().textMuted} />
      <View style={{ flex: 1, minWidth: 0, gap: themeSpace.hair }}>
        <Text style={{ color: palette().text, fontSize: textSize(13), lineHeight: textLineHeight(13, 1.4), numberOfLines: 2, textOverflow: "ellipsis" }}>
          {props.caption || tr("genui.image")}
        </Text>
        <Text style={{ color: palette().textMuted, fontSize: textSize(12), lineHeight: textLineHeight(12, 1.35) }}>{props.note}</Text>
      </View>
      <If when={/^https?:\/\//i.test(props.url) ? props.url : ""}>
        {url => (
          <Button
            label={tr("genui.open")}
            variant="ghost"
            size="xs"
            trailingIcon="external-link"
            style={compactLayout() ? { minHeight: layout.touchTarget } : undefined}
            onPress={() => void openUrl(url()).catch(() => undefined)}
          />
        )}
      </If>
    </View>
  );
}

function GenMap(props: { node: GenElement }) {
  const markers = computed(() =>
    childrenOf(props.node.props.markers, props.node.key).flatMap(child =>
      child.kind === "element" && child.component === "MapMarker"
        ? [{ key: child.key, label: display(child.props.label), lat: toNumber(child.props.lat), lng: toNumber(child.props.lng) }]
        : [],
    ),
  );
  return (
    <View style={{ gap: themeSpace.xs, padding: themeSpace.md, borderRadius: radii.md, borderCurve: "continuous", backgroundColor: palette().surfaceSubtle }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: themeSpace.sm }}>
        <Icon name="compass" size={16} color={palette().textMuted} />
        <Text style={{ flex: 1, color: palette().textSecondary, fontSize: textSize(12), lineHeight: textLineHeight(12, 1.4) }}>
          {tr("genui.mapNotDrawn")}
        </Text>
      </View>
      <Each of={markers()} key={marker => marker.key}>
        {marker => (
          <View style={{ flexDirection: "row", alignItems: "center", gap: themeSpace.sm, minHeight: compactLayout() ? layout.touchTarget : controlHeight.sm }}>
            <Text style={{ flex: 1, minWidth: 0, color: palette().text, fontSize: textSize(13), lineHeight: textLineHeight(13, 1.4) }}>
              {marker().label}
            </Text>
            <Button
              label={tr("genui.open")}
              variant="ghost"
              size="xs"
              trailingIcon="external-link"
              style={compactLayout() ? { minHeight: layout.touchTarget } : undefined}
              onPress={() =>
                void openUrl(`https://www.openstreetmap.org/?mlat=${marker().lat}&mlon=${marker().lng}#map=15/${marker().lat}/${marker().lng}`).catch(
                  () => undefined,
                )
              }
            />
          </View>
        )}
      </Each>
    </View>
  );
}

function GenTable(props: { node: GenElement; ctx: GenContext }) {
  const columns = computed(() => (Array.isArray(props.node.props.columns) ? props.node.props.columns.map(display) : []));
  const rows = computed(() => (Array.isArray(props.node.props.rows) ? props.node.props.rows : []).map((row, index) => ({
    key: `${props.node.key}/r${index}`,
    cells: Array.isArray(row) ? row : [row],
  })));
  const numeric = computed(() =>
    columns().map((_, column) => rows().length > 0 && rows().every(row => typeof row.cells[column] === "number")),
  );
  const cellStyle = (column: number) => ({
    flex: 1,
    minWidth: compactLayout() ? 112 : 96,
    paddingHorizontal: themeSpace.md,
    paddingVertical: themeSpace.sm,
    alignItems: numeric()[column] ? ("flex-end" as const) : ("flex-start" as const),
  });
  return (
    <View style={{ borderRadius: radii.md, borderCurve: "continuous", borderWidth: 1, borderColor: palette().borderSubtle, overflow: "hidden" }}>
      <Scroll smoothWheel horizontal style={{ minHeight: 0 }} contentStyle={{ minWidth: "100%" }}>
        <View style={{ minWidth: "100%" }}>
          <View style={{ flexDirection: "row", backgroundColor: palette().surfaceSubtle }}>
            <Each of={columns().map((name, index) => ({ name, index }))} key={column => `${column.index}`}>
              {column => (
                <View style={cellStyle(column().index)}>
                  <Text style={{ color: palette().textSecondary, fontSize: textSize(12), lineHeight: textLineHeight(12, 1.3), fontWeight: "600" }}>
                    {column().name}
                  </Text>
                </View>
              )}
            </Each>
          </View>
          <Each of={rows()} key={row => row.key}>
            {row => (
              <View style={{ flexDirection: "row", borderTopWidth: 1, borderColor: palette().borderSubtle }}>
                <Each of={columns().map((_, index) => index)} key={index => String(index)}>
                  {index => (
                    <View style={cellStyle(index())}>
                      <If
                        when={isGenElement(row().cells[index()])}
                        else={
                          <Text
                            style={{
                              color: palette().text,
                              fontSize: textSize(13),
                              lineHeight: textLineHeight(13, 1.4),
                              fontVariant: numeric()[index()] ? ["tabular-nums"] : undefined,
                              userSelect: "text",
                            }}
                          >
                            {display(row().cells[index()])}
                          </Text>
                        }
                      >
                        <GenNode node={row().cells[index()] as GenElement} ctx={props.ctx} />
                      </If>
                    </View>
                  )}
                </Each>
              </View>
            )}
          </Each>
        </View>
      </Scroll>
    </View>
  );
}

const SERIES_COLORS = (): string[] => {
  const p = palette();
  return [p.accent, p.success, p.warning, p.danger, p.textSecondary, p.brandWarm];
};

function formatChartValue(value: number, format: unknown, currency: unknown): string {
  if (format === "percent") return `${display(Math.round(value * 10) / 10)}%`;
  if (format === "currency") return `${currency === "EUR" ? "€" : currency === "GBP" ? "£" : "$"}${display(Math.round(value * 100) / 100)}`;
  return display(Math.round(value * 100) / 100);
}

function GenChart(props: { node: GenElement }) {
  const p = () => props.node.props;
  const data = computed(() => (Array.isArray(p().data) ? (p().data as unknown[]) : []).filter(row => row && typeof row === "object") as Record<string, unknown>[]);
  const xKey = () => (typeof p().x === "string" ? (p().x as string) : Object.keys(data()[0] ?? {}).find(key => typeof data()[0]?.[key] !== "number") ?? "");
  const series = computed(() => {
    if (Array.isArray(p().series)) return (p().series as unknown[]).map(display).filter(Boolean);
    const first = data()[0] ?? {};
    return Object.keys(first).filter(key => key !== xKey() && typeof first[key] === "number");
  });
  const type = () => display(p().type) || "bar";
  const height = () => Math.max(120, Math.min(480, toNumber(p().height) || 220));
  const empty = computed(() => data().length === 0 || series().length === 0);
  return (
    <View style={{ gap: themeSpace.sm }} accessibilityLabel={`genui-chart-${type()}`}>
      <If
        when={!empty()}
        else={
          <View
            style={{
              padding: themeSpace.md,
              borderRadius: radii.md,
              backgroundColor: palette().surfaceSubtle,
              alignItems: "center",
            }}
          >
            <Text style={{ color: palette().textMuted, fontSize: textSize(13), lineHeight: textLineHeight(13, 1.45) }}>
              {tr("genui.empty")}
            </Text>
          </View>
        }
      >
        <Canvas
          style={{ height: height(), alignSelf: "stretch" }}
          draw={(cx, size) => {
            const rows = data();
            const keys = series();
            const colors = SERIES_COLORS();
            const pal = palette();
            if (size.width <= 0 || size.height <= 0 || rows.length === 0 || keys.length === 0) return;
            const kind = type();
            if (kind === "pie" || kind === "donut") {
              const values = rows.map(row => Math.max(0, toNumber(row[keys[0]])));
              const total = values.reduce((sum, value) => sum + value, 0) || 1;
              const radius = Math.max(8, Math.min(size.width, size.height) / 2 - 8);
              const centerX = size.width / 2;
              const centerY = size.height / 2;
              let angle = -Math.PI / 2;
              values.forEach((value, index) => {
                const sweep = (value / total) * Math.PI * 2;
                cx.beginPath();
                cx.moveTo(centerX, centerY);
                cx.arc(centerX, centerY, radius, angle, angle + sweep);
                cx.closePath();
                cx.fillStyle = colors[index % colors.length];
                cx.fill();
                angle += sweep;
              });
              if (kind === "donut") {
                cx.beginPath();
                cx.arc(centerX, centerY, radius * 0.58, 0, Math.PI * 2);
                cx.fillStyle = pal.canvas;
                cx.fill();
              }
              return;
            }
            const stacked = truthy(p().stacked);
            const totals = rows.map(row => keys.reduce((sum, key) => sum + Math.max(0, toNumber(row[key])), 0));
            const maxValue = Math.max(1, ...(stacked && kind === "bar" ? totals : rows.flatMap(row => keys.map(key => toNumber(row[key])))));
            const minValue = Math.min(0, ...rows.flatMap(row => keys.map(key => toNumber(row[key]))));
            cx.font = `${textSize(11)}px sans-serif`;
            const yLabels: Array<{ value: number; text: string }> = [];
            let maxLabelWidth = 24;
            for (let step = 0; step <= 4; step += 1) {
              const value = minValue + ((maxValue - minValue) * step) / 4;
              const label = formatChartValue(value, p().format, p().currency);
              yLabels.push({ value, text: label });
              const measured =
                typeof cx.measureText === "function" ? cx.measureText(label).width : label.length * 6.5;
              if (measured > maxLabelWidth) maxLabelWidth = measured;
            }
            const left = Math.max(36, Math.min(Math.round(size.width * 0.35), Math.ceil(maxLabelWidth) + 12));
            const bottom = 20;
            const plotWidth = Math.max(24, size.width - left - 8);
            const plotHeight = Math.max(24, size.height - bottom - 8);
            const yOf = (value: number) => 8 + plotHeight - ((value - minValue) / (maxValue - minValue || 1)) * plotHeight;
            cx.strokeStyle = pal.borderSubtle;
            cx.lineWidth = 1;
            cx.fillStyle = pal.textMuted;
            for (const entry of yLabels) {
              const y = yOf(entry.value);
              cx.beginPath();
              cx.moveTo(left, y);
              cx.lineTo(size.width - 8, y);
              cx.stroke();
              cx.fillText(entry.text, 2, y + 4);
            }
            const slot = plotWidth / rows.length;
            const maxXLabels = Math.max(1, Math.floor(plotWidth / 52));
            const xStep = Math.max(1, Math.ceil(rows.length / maxXLabels));
            rows.forEach((row, index) => {
              const label = display(row[xKey()]);
              if (index % xStep === 0) {
                cx.fillStyle = pal.textMuted;
                cx.fillText(label.slice(0, 10), left + index * slot + 2, size.height - 4);
              }
            });
            if (kind === "bar") {
              rows.forEach((row, index) => {
                let base = 0;
                const groupWidth = Math.max(2, slot * 0.7);
                keys.forEach((key, seriesIndex) => {
                  const value = toNumber(row[key]);
                  cx.fillStyle = colors[seriesIndex % colors.length];
                  if (stacked) {
                    const top = yOf(base + value);
                    cx.fillRect(left + index * slot + slot * 0.15, top, groupWidth, yOf(base) - top);
                    base += value;
                  } else {
                    const width = groupWidth / keys.length;
                    const barWidth = Math.max(2, width - 2);
                    const top = yOf(Math.max(0, value));
                    cx.fillRect(left + index * slot + slot * 0.15 + seriesIndex * width, top, barWidth, Math.abs(yOf(value) - yOf(0)));
                  }
                });
              });
              return;
            }
            keys.forEach((key, seriesIndex) => {
              const color = colors[seriesIndex % colors.length];
              const points = rows.map((row, index) => [left + index * slot + slot / 2, yOf(toNumber(row[key]))] as const);
              if (kind === "scatter") {
                cx.fillStyle = color;
                for (const [x, y] of points) {
                  cx.beginPath();
                  cx.arc(x, y, 3, 0, Math.PI * 2);
                  cx.fill();
                }
                return;
              }
              cx.beginPath();
              points.forEach(([x, y], index) => (index === 0 ? cx.moveTo(x, y) : cx.lineTo(x, y)));
              cx.strokeStyle = color;
              cx.lineWidth = 2;
              cx.stroke();
              if (kind === "area" && points.length > 1) {
                cx.lineTo(points[points.length - 1][0], yOf(0));
                cx.lineTo(points[0][0], yOf(0));
                cx.closePath();
                cx.globalAlpha = 0.15;
                cx.fillStyle = color;
                cx.fill();
                cx.globalAlpha = 1;
              }
            });
          }}
        />
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: themeSpace.md }}>
          <Each
            of={(type() === "pie" || type() === "donut" ? data().map(row => display(row[xKey()])) : series()).map((name, index) => ({ name, index }))}
            key={entry => `${entry.index}`}
          >
            {entry => (
              <View style={{ flexDirection: "row", alignItems: "center", gap: themeSpace.chip }}>
                <View style={{ width: themeSpace.sm, height: themeSpace.sm, borderRadius: radii.pill, backgroundColor: SERIES_COLORS()[entry().index % SERIES_COLORS().length] }} />
                <Text style={{ color: palette().textSecondary, fontSize: textSize(12), lineHeight: textLineHeight(12, 1.3) }}>{entry().name}</Text>
              </View>
            )}
          </Each>
        </View>
      </If>
    </View>
  );
}

function GenFlashcard(props: { node: GenElement; ctx: GenContext }) {
  const flipped = signal(false);
  return (
    <View
      role="button"
      accessibilityLabel={`genui-flashcard-${props.node.key}`}
      onPress={() => flipped.set(!flipped())}
      style={{
        minHeight: 120,
        padding: themeSpace.xl,
        gap: themeSpace.sm,
        borderRadius: radii.lg,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: palette().borderSubtle,
        backgroundColor: flipped() ? palette().surfaceSubtle : palette().panelRaised,
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        userSelect: "none",
        ...pressTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{ borderColor: palette().border }}
      activeStyle={tactileActiveStyle(0.985)}
      focusVisibleStyle={focusRingStyle()}
    >
      <If when={flipped()} else={<Children value={props.node.props.front} parentKey={`${props.node.key}/front`} ctx={props.ctx} />}>
        <Children value={props.node.props.back} parentKey={`${props.node.key}/back`} ctx={props.ctx} />
      </If>
      <If when={!flipped() && display(props.node.props.hint)}>
        <Text style={{ color: palette().textMuted, fontSize: textSize(12), lineHeight: textLineHeight(12, 1.3) }}>{display(props.node.props.hint)}</Text>
      </If>
    </View>
  );
}

// --- SVG drawings ----------------------------------------------------------------------------

function applyTransform(cx: CanvasRenderingContext2DLike, transform: string): void {
  const pattern = /(translate|rotate|scale)\(([^)]*)\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(transform))) {
    const values = match[2].split(/[\s,]+/).filter(Boolean).map(Number);
    if (match[1] === "translate") cx.translate(values[0] ?? 0, values[1] ?? 0);
    else if (match[1] === "scale") cx.scale(values[0] ?? 1, values[1] ?? values[0] ?? 1);
    else {
      const angle = ((values[0] ?? 0) * Math.PI) / 180;
      if (values.length >= 3) {
        cx.translate(values[1], values[2]);
        cx.rotate(angle);
        cx.translate(-values[1], -values[2]);
      } else cx.rotate(angle);
    }
  }
}

type CanvasRenderingContext2DLike = Parameters<NonNullable<Parameters<typeof Canvas>[0]["draw"]>>[0];

function paint(cx: CanvasRenderingContext2DLike, shape: GenElement, fallbackColor: string): void {
  const p = shape.props;
  const fill = typeof p.fill === "string" && p.fill !== "none" ? p.fill : null;
  const stroke = typeof p.stroke === "string" && p.stroke !== "none" ? p.stroke : null;
  cx.save();
  if (typeof p.opacity === "number") cx.globalAlpha = Math.max(0, Math.min(1, p.opacity));
  cx.lineWidth = typeof p.strokeWidth === "number" ? p.strokeWidth : 1;
  const finish = (path: InstanceType<typeof Path2D>, defaultFill: boolean) => {
    if (fill || (defaultFill && !stroke)) {
      cx.fillStyle = fill ?? fallbackColor;
      cx.fill(path);
    }
    if (stroke) {
      cx.strokeStyle = stroke;
      cx.stroke(path);
    }
  };
  switch (shape.component) {
    case "G": {
      if (typeof p.transform === "string") applyTransform(cx, p.transform);
      for (const child of childrenOf(p.children, shape.key)) if (child.kind === "element") paint(cx, child, fallbackColor);
      break;
    }
    case "Circle": {
      const path = new Path2D();
      path.arc(toNumber(p.cx), toNumber(p.cy), Math.max(0, toNumber(p.r)), 0, Math.PI * 2);
      finish(path, true);
      break;
    }
    case "Ellipse": {
      const path = new Path2D();
      path.ellipse(toNumber(p.cx), toNumber(p.cy), Math.max(0, toNumber(p.rx)), Math.max(0, toNumber(p.ry)), 0, 0, Math.PI * 2);
      finish(path, true);
      break;
    }
    case "Rect": {
      const path = new Path2D();
      const rx = toNumber(p.rx);
      if (rx > 0) path.roundRect(toNumber(p.x), toNumber(p.y), toNumber(p.width), toNumber(p.height), rx);
      else path.rect(toNumber(p.x), toNumber(p.y), toNumber(p.width), toNumber(p.height));
      finish(path, true);
      break;
    }
    case "Line": {
      const path = new Path2D();
      path.moveTo(toNumber(p.x1), toNumber(p.y1));
      path.lineTo(toNumber(p.x2), toNumber(p.y2));
      cx.strokeStyle = stroke ?? fallbackColor;
      cx.stroke(path);
      break;
    }
    case "Path":
      finish(new Path2D(display(p.d)), true);
      break;
    case "Polyline":
    case "Polygon": {
      const points = display(p.points)
        .trim()
        .split(/\s+/)
        .map(pair => pair.split(",").map(Number));
      const path = new Path2D();
      points.forEach(([x, y], index) => (index === 0 ? path.moveTo(x, y) : path.lineTo(x, y)));
      if (shape.component === "Polygon") path.closePath();
      if (shape.component === "Polyline" && !fill) {
        cx.strokeStyle = stroke ?? fallbackColor;
        cx.stroke(path);
      } else finish(path, true);
      break;
    }
    case "SvgText": {
      cx.fillStyle = fill ?? fallbackColor;
      cx.font = `${p.weight === "semibold" ? "600 " : p.weight === "medium" ? "500 " : ""}${toNumber(p.size) || 12}px sans-serif`;
      cx.textAlign = p.anchor === "middle" ? "center" : p.anchor === "end" ? "right" : "left";
      cx.fillText(display(p.text), toNumber(p.x), toNumber(p.y));
      break;
    }
  }
  cx.restore();
}

function GenSvg(props: { node: GenElement }) {
  const box = () => {
    const parts = display(props.node.props.viewBox).split(/[\s,]+/).map(Number);
    return parts.length === 4 && parts.every(Number.isFinite) && parts[2] > 0 && parts[3] > 0 ? parts : [0, 0, 100, 100];
  };
  const width = () => dimension(props.node.props.width) ?? "100%";
  return (
    <Canvas
      accessibilityLabel={`genui-svg-${props.node.key}`}
      style={{ width: width(), aspectRatio: box()[2] / box()[3], maxWidth: "100%" }}
      draw={(cx, size) => {
        if (size.width <= 0 || size.height <= 0) return;
        const [x, y, w, h] = box();
        const scale = Math.min(size.width / w, size.height / h);
        cx.save();
        cx.scale(scale, scale);
        cx.translate(-x, -y);
        for (const child of childrenOf(props.node.props.children, props.node.key)) {
          if (child.kind === "element") paint(cx, child, palette().text);
        }
        cx.restore();
      }}
    />
  );
}

// --- Free HTML ---------------------------------------------------------------------------------

/** Static HTML: scripts off, no network (a strict CSP), its own website data. */
function sandboxedHtml(html: string, css?: string): string {
  const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:">`;
  const style = css ? `<style>${css}</style>` : "";
  const body = /<html[\s>]/i.test(html) ? html.replace(/<head(\s[^>]*)?>/i, match => `${match}${policy}${style}`) : `<!doctype html><html><head>${policy}${style}</head><body>${html}</body></html>`;
  return /<head(\s[^>]*)?>/i.test(html) || !/<html[\s>]/i.test(html) ? body : body.replace(/<html([^>]*)>/i, `<html$1><head>${policy}${style}</head>`);
}

function GenHtml(props: { html: string; css?: string; title?: string; height: number }) {
  const failed = signal("");
  return (
    <View style={{ gap: themeSpace.chip }}>
      <If
        when={failed()}
        else={
          <WebView
            html={sandboxedHtml(props.html, props.css)}
            javaScriptEnabled={false}
            incognito
            style={{
              height: Math.min(props.height, compactLayout() ? 320 : props.height),
              alignSelf: "stretch",
              borderRadius: radii.md,
              overflow: "hidden",
            }}
            onError={(event: { message: string }) => failed.set(event.message || "error")}
          />
        }
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: themeSpace.sm }}>
          <Text style={{ color: palette().textMuted, fontSize: textSize(12), lineHeight: textLineHeight(12, 1.4), flex: 1, minWidth: 0 }}>
            {tr("genui.htmlUnavailable")}
          </Text>
          <Button
            label={tr("common.tryAgain")}
            variant="ghost"
            size="sm"
            style={compactLayout() ? { minHeight: layout.touchTarget } : undefined}
            onPress={() => failed.set("")}
          />
        </View>
      </If>
      <Text style={{ color: palette().textMuted, fontSize: textSize(12), lineHeight: textLineHeight(12, 1.35) }}>
        {tr("genui.scriptsOff")}
      </Text>
    </View>
  );
}

function GenUIHtmlDocument(props: { doc: GenUIDocument }) {
  return (
    <View style={{ gap: 6 }}>
      <If when={props.doc.title}>
        <Text style={{ color: palette().textMuted, fontSize: textSize(12), lineHeight: textLineHeight(12, 1.3), fontWeight: "500" }}>
          {props.doc.title}
        </Text>
      </If>
      <GenHtml html={props.doc.content} css={props.doc.css} height={420} />
    </View>
  );
}
