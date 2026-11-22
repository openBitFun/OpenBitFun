// Fleet atoms shared by every screen (visual spec §2.4 and §3): the state mark
// and its word, the device glyph and the device badge. This file is the only
// place that maps a state to a color; screens compose these atoms and never
// pick a state color of their own. The backend owns every state: these atoms
// draw the value they are given and derive nothing.

import { Text, View, reduceMotion, type StyleProp, type ViewStyle } from "nsh";
import { tr } from "../i18n";
import {
  SurfaceContext,
  isSplitChromePalette,
  layout,
  palette,
  radii,
  space,
  surfaceWorkingColor,
  textStyle,
  touchSlop,
  type Palette,
  type SurfacePlane,
} from "../theme";
import { Icon } from "./icons";
import {
  BrandSpinner,
  MOTION_DURATION,
  MOTION_EASE_STANDARD,
  paintTransition,
  pressTransition,
  tactileActiveStyle,
} from "./motion";
import { DeviceGlyph, StatusDot, deviceGlyphIcon, focusRingStyle, type StatusDotKind } from "./primitives";

export { DeviceGlyph, deviceGlyphIcon };

/**
 * What a mark can show. `done` reads as unread until `seen` is set; an
 * unknown value (a newer backend's state) draws as `idle`, never as an error.
 */
export type MarkState =
  | "working"
  | "needs_you"
  | "done"
  | "failed"
  | "idle"
  | "stopped"
  | "queued"
  | "waiting"
  | "thinking";

type StateGlyph = "dot" | "half" | "ring" | "check" | "close" | "clock" | "matrix";
type StateColorToken = "accent" | "warning" | "success" | "danger" | "textMuted";

interface StateVisual {
  readonly glyph: StateGlyph;
  readonly color: StateColorToken;
  /** Neutral states draw their word 12/400 `textMuted`; the others 12/500 in the state color. */
  readonly neutral: boolean;
}

/** The state map of spec §2.4. Semantic tokens only, so it holds in all 9 presets. */
const STATE_VISUALS: Readonly<Record<MarkState, StateVisual>> = {
  working: { glyph: "dot", color: "accent", neutral: false },
  needs_you: { glyph: "half", color: "warning", neutral: false },
  done: { glyph: "check", color: "success", neutral: false },
  failed: { glyph: "close", color: "danger", neutral: false },
  idle: { glyph: "ring", color: "textMuted", neutral: true },
  stopped: { glyph: "ring", color: "textMuted", neutral: true },
  queued: { glyph: "clock", color: "textMuted", neutral: true },
  waiting: { glyph: "clock", color: "textMuted", neutral: true },
  thinking: { glyph: "matrix", color: "accent", neutral: false },
};

const DOT_KIND: Readonly<Record<StateColorToken, StatusDotKind>> = {
  accent: "accent",
  warning: "warning",
  success: "success",
  danger: "danger",
  textMuted: "muted",
};

/** Narrows any string to a `MarkState`; an unknown value is `idle`. */
export function markState(value: string | null | undefined): MarkState {
  return value && value in STATE_VISUALS ? (value as MarkState) : "idle";
}

/** The palette token a state draws in (`done` + `seen` is `textMuted`). */
export function stateColorToken(state: MarkState, seen = false): keyof Palette {
  if (state === "done" && seen) return "textMuted";
  return STATE_VISUALS[markState(state)].color;
}

/** The state's color in the active palette, adapting automatically on dark split-chrome planes. */
export function stateColor(
  state: MarkState,
  seen = false,
  surface: SurfacePlane = SurfaceContext(),
): string {
  const token = stateColorToken(state, seen);
  if (token === "accent") return surfaceWorkingColor(surface);
  if (token === "textMuted" && surface === "chrome") return palette().chromeTextMuted;
  return palette()[token] as string;
}

/** The state's word (`Working`, `Needs you`, `Waiting for {device}` ...). */
export function stateWord(state: MarkState, device?: string): string {
  switch (markState(state)) {
    case "working":
      return tr("state.working");
    case "needs_you":
      return tr("state.needsYou");
    case "done":
      return tr("state.done");
    case "failed":
      return tr("state.failed");
    case "stopped":
      return tr("state.stopped");
    case "queued":
      return tr("state.queued");
    case "waiting":
      return device ? tr("state.waitingFor", { device }) : tr("state.waiting");
    case "thinking":
      return tr("state.thinking");
    default:
      return tr("state.idle");
  }
}

export interface StateMarkProps {
  state: MarkState;
  /** A `done` the user has seen loses its color. */
  seen?: boolean;
  /** Draws the word to the right of the glyph. */
  withWord?: boolean;
  /** The glyph box: 16 (rows, cards) or 12 (toasts, dense meta). */
  size?: 12 | 16;
  /** The device a `waiting` state waits for, named in its word. */
  device?: string;
  testID?: string;
}

/**
 * One state glyph in a 16 (or 12) box, optionally followed by its word. The
 * accessibility label is always the state word, drawn or not.
 */
export function StateMark(props: StateMarkProps) {
  const visual = () => STATE_VISUALS[markState(props.state)];
  const box = () => props.size ?? 16;
  const dotSize = () => (box() === 12 ? 6 : 8);
  const color = () => stateColor(props.state, props.seen);
  return (
    <View
      testID={props.testID}
      accessibilityLabel={stateWord(props.state, props.device)}
      style={{ flexDirection: "row", alignItems: "center", gap: space.xs, flexShrink: 0 }}
    >
      <View
        style={{
          width: box(),
          height: box(),
          flexShrink: 0,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <If when={visual().glyph === "dot"}>
          <StatusDot kind={DOT_KIND[visual().color]} size={dotSize()} pulse={props.state === "working"} />
        </If>
        <If when={visual().glyph === "half"}>
          <StatusDot kind={DOT_KIND[visual().color]} size={dotSize()} variant="half" />
        </If>
        <If when={visual().glyph === "ring"}>
          <StatusDot kind={DOT_KIND[visual().color]} size={dotSize()} variant="ring" />
        </If>
        <If when={visual().glyph === "check" || visual().glyph === "close" || visual().glyph === "clock"}>
          <Icon
            name={visual().glyph === "check" ? "check" : visual().glyph === "close" ? "close" : "clock"}
            size={box() === 12 ? 10 : 12}
            color={color()}
          />
        </If>
        <If when={visual().glyph === "matrix"}>
          <BrandSpinner variant="matrix" size={box() === 12 ? 10 : 12} color={color()} />
        </If>
      </View>
      <If when={Boolean(props.withWord)}>
        <StateLabel state={props.state} seen={props.seen} device={props.device} />
      </If>
    </View>
  );
}

export interface StateLabelProps {
  state: MarkState;
  seen?: boolean;
  device?: string;
  /** Appended after " · " in `textMuted` (an age, a duration), tabular. */
  detail?: string;
  testID?: string;
}

/**
 * The state word, 12/500 in the state color (12/400 `textMuted` for neutral
 * states), with an optional muted detail. A change of word crossfades in
 * place; the element never moves.
 */
export function StateLabel(props: StateLabelProps) {
  const neutral = () => STATE_VISUALS[markState(props.state)].neutral || (props.state === "done" && props.seen);
  return (
    <Text
      testID={props.testID}
      style={{
        ...textStyle("caption", { tabular: true }),
        flexShrink: 1,
        minWidth: 0,
        numberOfLines: 1,
        textOverflow: "ellipsis",
      }}
    >
      <Text
        style={{
          color: stateColor(props.state, props.seen),
          fontWeight: neutral() ? "400" : "500",
          transitionProperty: "color, opacity",
          transitionDuration: reduceMotion() ? 0 : MOTION_DURATION.popover,
          transitionTimingFunction: MOTION_EASE_STANDARD,
        }}
      >
        {stateWord(props.state, props.device)}
      </Text>
      <If when={props.detail ?? ""}>
        {detail => (
          <Text style={{ color: SurfaceContext() === "chrome" ? palette().chromeTextMuted : palette().textMuted }}>
            {` · ${detail()}`}
          </Text>
        )}
      </If>
    </Text>
  );
}

/** A device deviation worth words; a healthy device draws none. */
export type DeviceException = "offline" | "update_required";

export interface DeviceBadgeProps {
  name: string;
  /** The form factor (`hostKind`, `"laptop"`, `"server"` ...); picks the glyph only. */
  kind?: string;
  exception?: DeviceException | null;
  /** Shown after the exception word (a preformatted age: "3 h ago"). */
  exceptionDetail?: string;
  /** Opens the device page. Without it the badge is plain text. */
  onPress?: () => void;
  maxWidth?: number;
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

function exceptionText(props: DeviceBadgeProps): string {
  if (!props.exception) return "";
  const word = props.exception === "offline" ? tr("state.offline") : tr("state.updateNeeded");
  return props.exceptionDetail ? `${word} · ${props.exceptionDetail}` : word;
}

/**
 * A device as a quiet label: glyph 12 `textMuted`, gap 4, name 12/500
 * `textSecondary`, 16 high, no fill, no border, truncating at 160. Only an
 * exception gets words (" · Offline", " · Update needed").
 */
export function DeviceBadge(props: DeviceBadgeProps) {
  return (
    <View
      testID={props.testID}
      role={props.onPress ? "button" : undefined}
      hitSlop={props.onPress ? touchSlop(16) : undefined}
      accessibilityLabel={props.accessibilityLabel ?? props.name}
      onPress={props.onPress ? () => props.onPress?.() : undefined}
      focusVisibleStyle={props.onPress ? focusRingStyle() : undefined}
      activeStyle={props.onPress ? tactileActiveStyle(0.97) : undefined}
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          gap: space.xs,
          height: 16,
          minWidth: 0,
          flexShrink: 1,
          maxWidth: props.maxWidth ?? 160,
          borderRadius: radii.xs,
          cursor: props.onPress ? "pointer" : undefined,
          userSelect: props.onPress ? "none" : undefined,
          ...(props.onPress ? pressTransition(120) : {}),
        },
        props.style,
      ]}
    >
      <Icon name={deviceGlyphIcon(props.kind)} size={12} color={palette().textMuted} />
      <Text
        style={{
          ...textStyle("caption", { color: palette().textSecondary }),
          fontWeight: "500",
          flexShrink: 1,
          minWidth: 0,
          numberOfLines: 1,
          textOverflow: "ellipsis",
          ...paintTransition(120),
        }}
        hoverStyle={props.onPress ? { color: palette().text } : undefined}
      >
        {props.name}
      </Text>
      <If when={exceptionText(props)}>
        {text => (
          <Text
            style={{
              ...textStyle("caption", {
                color: props.exception === "update_required" ? palette().warning : palette().textMuted,
                tabular: true,
              }),
              flexShrink: 0,
              numberOfLines: 1,
            }}
          >
            {`· ${text()}`}
          </Text>
        )}
      </If>
    </View>
  );
}

// ── Shell atoms (wave 15 UI-A): session marks, device exceptions, the Inbox
// pill and the phone tab bar. The mappings below are the only place a session's
// backend status or a device's backend state becomes a mark; screens never
// derive one of their own.

/** The fields a session row carries that decide its one mark (fleet row or host row). */
export interface SessionMarkFields {
  status?: string | null;
  unread?: boolean;
  needsAttention?: boolean;
  failed?: boolean;
}

/**
 * A session row's mark from the backend's own fields: needs you, then working,
 * failed, an unread result, else idle.
 */
export function sessionMarkState(row: SessionMarkFields): MarkState {
  if (row.needsAttention || row.status === "waiting") return "needs_you";
  if (row.status === "running") return "working";
  if (row.status === "error" || row.failed) return "failed";
  if (row.unread) return "done";
  return "idle";
}

/** A host-side session status (`sessionStatusStore` kinds) as a mark. */
export function localSessionMarkState(kind: string | null | undefined): MarkState {
  switch (kind) {
    case "running":
      return "working";
    case "approval":
      return "needs_you";
    case "queued":
      return "queued";
    case "failed":
      return "failed";
    case "unread":
      return "done";
    default:
      return "idle";
  }
}

/** A device's state as the exception its badge names; a healthy device has none. */
export function deviceException(state: string | null | undefined): DeviceException | null {
  if (state === "offline" || state === "unreachable" || state === "stale") return "offline";
  if (state === "update_required") return "update_required";
  return null;
}

/** A backend roll-up value (`needs_you | working | unread | none`) as a mark, or none. */
export function rollupMarkState(rollup: string | null | undefined): MarkState | null {
  switch (rollup) {
    case "needs_you":
      return "needs_you";
    case "working":
      return "working";
    case "unread":
      return "done";
    case "failed":
      return "failed";
    default:
      return null;
  }
}

/**
 * The Inbox count: 18 high, min width 18, padding 0 6, `warningSoft`, 11/600
 * `warning`. On split dark-chrome appearances (Monochrome), grounds the soft
 * tint over `canvas` so `warning` ink clears WCAG AA >= 4.5:1.
 */
export function InboxCountPill(props: { count: number; testID?: string }) {
  const needsCanvasUnderlay = () =>
    SurfaceContext() === "chrome" && isSplitChromePalette();
  return (
    <If when={props.count > 0}>
      <View
        testID={props.testID}
        accessibilityLabel={`inbox-count-${props.count}`}
        style={{
          height: 18,
          minWidth: 18,
          borderRadius: radii.pill,
          backgroundColor: needsCanvasUnderlay() ? palette().canvas : "transparent",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          pointerEvents: "none",
        }}
      >
        <View
          style={{
            height: 18,
            minWidth: 18,
            paddingHorizontal: space.chip,
            borderRadius: radii.pill,
            backgroundColor: palette().warningSoft,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ ...textStyle("micro", { color: palette().warning }), numberOfLines: 1 }}>
            {props.count > 99 ? "99+" : String(props.count)}
          </Text>
        </View>
      </View>
    </If>
  );
}

export interface PhoneTab {
  id: string;
  label: string;
  /** A lucide name, or `"matrix"` for the OpenBitFun mark. */
  icon: string;
  active: boolean;
  badge?: number;
  onPress: () => void;
}

/**
 * The phone tab bar (visual spec §3): 56 plus the safe area, `chromeBg`, a top
 * hairline, equal tabs of icon 20 and label 11/500; the active tab is `accent`,
 * the others `chromeTextMuted`. The Inbox badge is the sidebar pill.
 */
export function PhoneTabBar(props: { tabs: PhoneTab[]; bottomInset?: number }) {
  return (
    <SurfaceContext.Provider value="chrome">
      <View
        accessibilityLabel="phone-tab-bar"
        role="tablist"
        style={{
          flexShrink: 0,
          flexDirection: "row",
          height: layout.phoneTabBarHeight + (props.bottomInset ?? 0),
          paddingBottom: props.bottomInset ?? 0,
          borderTopWidth: 1,
          borderColor: palette().chromeBorder,
          backgroundColor: palette().chromeBg,
        }}
      >
        <Each of={props.tabs} key={tab => tab.id}>
          {tab => {
            const color = () =>
              tab().active ? palette().chromeAccent : palette().chromeTextMuted;
            return (
              <View
                role="tab"
                accessibilityLabel={`phone-tab-${tab().id}`}
                accessibilityState={{ selected: tab().active }}
                onPress={() => tab().onPress()}
                activeStyle={tactileActiveStyle(0.96)}
                focusVisibleStyle={focusRingStyle("chrome")}
                style={{
                  flex: 1,
                  minWidth: 0,
                  paddingHorizontal: space.xs,
                  alignItems: "center",
                  justifyContent: "center",
                  gap: space.hair,
                  cursor: "pointer",
                  userSelect: "none",
                  ...pressTransition(MOTION_DURATION.fast),
                }}
              >
                <View style={{ width: 20, height: 20, alignItems: "center", justifyContent: "center" }}>
                  <If
                    when={tab().icon === "matrix"}
                    else={<Icon name={tab().icon as never} size={20} color={color()} />}
                  >
                    <MatrixMark size={18} color={color()} />
                  </If>
                  <If when={(tab().badge ?? 0) > 0}>
                    <View style={{ position: "absolute", left: space.md, top: -space.xs }}>
                      <InboxCountPill count={tab().badge ?? 0} />
                    </View>
                  </If>
                </View>
                <Text
                  style={{
                    ...textStyle("micro", { color: color() }),
                    fontWeight: "500",
                    fontVariant: undefined,
                    maxWidth: "100%",
                    numberOfLines: 1,
                    textOverflow: "ellipsis",
                  }}
                >
                  {tab().label}
                </Text>
              </View>
            );
          }}
        </Each>
      </View>
    </SurfaceContext.Provider>
  );
}

/** The static Bit Matrix (the OpenBitFun mark): a 3×3 grid, center cell full ink. */
export function MatrixMark(props: { size?: number; color?: string }) {
  const size = () => props.size ?? 16;
  const gap = () => Math.max(1, Math.round(size() * 0.12));
  return (
    <View
      style={{
        width: size(),
        height: size(),
        flexShrink: 0,
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr",
        gap: gap(),
      }}
    >
      <Each of={[0, 1, 2, 3, 4, 5, 6, 7, 8]} key={cell => cell}>
        {cell => (
          <View
            style={{
              width: "100%",
              height: "100%",
              borderRadius: Math.max(1, Math.round(size() * 0.08)),
              backgroundColor: props.color ?? palette().textSecondary,
              opacity: cell() === 4 ? 1 : 0.55,
            }}
          />
        )}
      </Each>
    </View>
  );
}
