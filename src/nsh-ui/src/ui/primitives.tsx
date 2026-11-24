// Reusable OpenBitFun Tauri-grade UI primitives built from NSH Views and native
// Canvas icons. Every signal and prop is read inside JSX prop expressions because
// NSH component bodies execute once.

import {
  PanResponder,
  Text,
  View,
  cleanup,
  computed,
  context,
  reduceMotion,
  signal,
  type Align,
  type InputRef,
  type JSX,
  type Placement,
  type StyleProp,
  type ViewStyle,
} from "nsh";
import { Input, Tooltip } from "nsh/base";
import { tr, type MessageKey } from "../i18n";
import { activeScene, type SceneId } from "../state";
import {
  SurfaceContext,
  compactLayout,
  concentricRadius,
  controlHeight,
  elevationShadow,
  fontMono,
  layout,
  isLightAppearance,
  motionTiming,
  palette,
  radii,
  space,
  springs,
  surfaceFocusColor,
  surfaceWorkingColor,
  textLineHeight,
  textSize,
  textTracking,
  type ControlSize,
  type SurfacePlane,
  touchSlop,
} from "../theme";
import { ModalFormContext } from "./modalForm";
import { BotCharacter, Icon, type IconName } from "./icons";
import {
  MOTION_DURATION,
  MOTION_EASE_STANDARD,
  Spinner,
  paintTransition,
  popoverOrigin,
  pressTransition,
  tactileActiveStyle,
} from "./motion";

// --- Styled Tooltip Bubble (`nsh/base` <Tooltip>) ---

// Shared warm-window state: once a toolbar tooltip has opened, hovering an
// adjacent tooltip within 380ms opens it immediately with zero entrance delay.
const tooltipWarm = signal(false);
let tooltipWarmTimer: ReturnType<typeof setTimeout> | null = null;
let tooltipCoolTimer: ReturnType<typeof setTimeout> | null = null;

function markTooltipOpened(): void {
  if (tooltipCoolTimer) {
    clearTimeout(tooltipCoolTimer);
    tooltipCoolTimer = null;
  }
  if (tooltipWarm()) return;
  if (tooltipWarmTimer) clearTimeout(tooltipWarmTimer);
  // Defer warming past the first tooltip's 125ms entrance so it completes smoothly.
  tooltipWarmTimer = setTimeout(() => {
    tooltipWarmTimer = null;
    tooltipWarm.set(true);
  }, 140);
}

function markTooltipClosed(): void {
  if (tooltipWarmTimer) {
    clearTimeout(tooltipWarmTimer);
    tooltipWarmTimer = null;
  }
  tooltipWarm.set(true);
  if (tooltipCoolTimer) clearTimeout(tooltipCoolTimer);
  tooltipCoolTimer = setTimeout(() => {
    tooltipCoolTimer = null;
    tooltipWarm.set(false);
  }, 380);
}

function tooltipStartingStyle(placement: Placement, instant: boolean): ViewStyle {
  if (instant || reduceMotion()) return { opacity: 0 };
  if (placement === "bottom") {
    return { opacity: 0, transform: [{ translateY: -3 }, { scale: 0.97 }] };
  }
  if (placement === "left") {
    return { opacity: 0, transform: [{ translateX: 3 }, { scale: 0.97 }] };
  }
  if (placement === "right") {
    return { opacity: 0, transform: [{ translateX: -3 }, { scale: 0.97 }] };
  }
  return { opacity: 0, transform: [{ translateY: 3 }, { scale: 0.97 }] };
}

export interface TooltipBubbleProps {
  text?: string;
  shortcut?: string;
  placement?: Placement;
  align?: Align;
  offset?: number;
  delay?: number;
  children?: JSX.Element;
}

/**
 * Styled floating micro-tooltip backed by `nsh/base` `<Tooltip>`, with
 * trigger-aligned transform origin, warm-window instant subsequent hovers,
 * whisper-quiet hairline framing, compact shadow, and reduced-motion fade.
 * Off while `compactLayout()` is set: on a phone a tap leaves the pointer
 * where it was, so a hover tooltip would stay up after the tap.
 */
export function TooltipBubble(props: TooltipBubbleProps) {
  return (
    <Tooltip
      placement={props.placement ?? "top"}
      align={props.align ?? "center"}
      offset={props.offset ?? 5}
      delay={props.delay !== undefined ? props.delay : tooltipWarm() ? 0 : 420}
      onOpen={markTooltipOpened}
      onClose={markTooltipClosed}
      disabled={compactLayout()}
      startingStyle={tooltipStartingStyle(props.placement ?? "top", tooltipWarm())}
      endingStyle={{
        opacity: 0,
      }}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.xs,
        paddingHorizontal: space.sm,
        paddingVertical: space.xs,
        borderRadius: radii.sm,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: palette().border,
        backgroundColor: palette().popoverBg,
        boxShadow: palette().shadowTooltip,
        maxWidth: 260,
        transformOrigin: popoverOrigin(props.placement ?? "top", props.align ?? "center"),
        transitionProperty: reduceMotion() || tooltipWarm() ? "opacity" : "opacity, transform",
        transitionDuration: tooltipWarm() ? 0 : reduceMotion() ? 90 : 120,
        transitionTimingFunction: MOTION_EASE_STANDARD,
      }}
    >
      <If
        when={Boolean(props.children)}
        else={
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs, minWidth: 0 }}>
            <Text
              style={{
                flexShrink: 1,
                minWidth: 0,
                color: palette().text,
                fontSize: textSize(12),
                fontWeight: "400",
                lineHeight: textLineHeight(12, 16 / 12),
              }}
            >
              {props.text ?? ""}
            </Text>
            <If when={props.shortcut ?? ""}>
              {keys => (
                <Text
                  style={{
                    flexShrink: 0,
                    color: palette().textElevatedMuted,
                    fontFamily: fontMono,
                    fontSize: textSize(11),
                    fontWeight: "500",
                    fontVariant: ["tabular-nums"],
                    lineHeight: textLineHeight(11, 14 / 11),
                  }}
                >
                  {keys()}
                </Text>
              )}
            </If>
          </View>
        }
      >
        {props.children}
      </If>
    </Tooltip>
  );
}

/**
 * Auto-wraps plain string tooltips in a styled `<TooltipBubble>`; passes JSX through.
 * When `redundantLabel` is supplied (e.g. `Button`'s visible label), a plain string
 * tooltip that merely repeats that label is suppressed to avoid noisy echo tooltips.
 */
function resolveTooltip(
  tip?: string | JSX.Element,
  redundantLabel?: string,
): JSX.Element | undefined {
  if (!tip || compactLayout()) return undefined;
  if (typeof tip === "string") {
    const trimmed = tip.trim();
    if (!trimmed) return undefined;
    if (redundantLabel && trimmed === redundantLabel.trim()) return undefined;
    return <TooltipBubble text={trimmed} />;
  }
  return tip;
}

export function focusRingStyle(surface?: SurfacePlane): ViewStyle {
  return {
    outlineWidth: 2,
    outlineColor: surfaceFocusColor(surface ?? SurfaceContext()),
    outlineOffset: 2,
  };
}

// --- Buttons (unmistakable CTA hierarchy, unified controlHeight, tactile 140ms GPU transitions) ---

export type ButtonVariant =
  | "primary"
  | "accent"
  | "secondary"
  | "outline"
  | "ghost"
  | "danger";
export type ButtonSize = ControlSize;
export type ControlSurface = "canvas" | "chrome";

export interface ButtonProps {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  surface?: ControlSurface;
  pill?: boolean;
  /** Stretch horizontally to fill its parent container (default `false`: hugs content). */
  fullWidth?: boolean;
  leadingIcon?: IconName;
  trailingIcon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  tooltip?: string | JSX.Element;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  onPress: () => void;
}

function btnBg(variant: ButtonVariant, surface: ControlSurface = "canvas"): string {
  if (variant === "primary") return palette().actionPrimaryBg;
  if (variant === "accent") return palette().actionSolid;
  if (variant === "danger") return palette().dangerSoft;
  if (variant === "outline" || variant === "ghost") return "transparent";
  return surface === "chrome" ? palette().chromeInputBg : palette().buttonSecondaryBg;
}

function btnHoverBg(variant: ButtonVariant, surface: ControlSurface = "canvas"): string {
  if (variant === "primary") return palette().actionPrimaryHover;
  if (variant === "accent") return palette().actionSolidHover;
  if (variant === "danger") return palette().dangerHoverBg;
  if (variant === "outline" || variant === "ghost") {
    return surface === "chrome" ? palette().chromeHover : palette().surfaceSubtle;
  }
  return surface === "chrome" ? palette().chromeHover : palette().buttonSecondaryHover;
}

function btnPressedBg(variant: ButtonVariant, surface: ControlSurface = "canvas"): string {
  if (variant === "primary") return palette().actionPrimaryPressed;
  if (variant === "accent") return palette().actionSolid;
  if (variant === "danger") return palette().dangerHoverBg;
  if (variant === "outline" || variant === "ghost") {
    return surface === "chrome" ? palette().chromeActive : palette().panelHover;
  }
  return surface === "chrome" ? palette().chromeActive : palette().buttonSecondaryPressed;
}

function btnBorder(variant: ButtonVariant, surface: ControlSurface = "canvas"): string {
  if (variant === "primary") return palette().actionPrimaryBorder;
  if (variant === "accent") return "transparent";
  if (variant === "danger") return palette().dangerBorder;
  if (variant === "ghost") return "transparent";
  if (variant === "secondary") {
    if (surface === "chrome") return palette().chromeBorder;
    return isLightAppearance() ? palette().border : palette().borderSubtle;
  }
  return surface === "chrome" ? palette().chromeBorder : palette().border;
}

function btnHoverBorder(variant: ButtonVariant, surface: ControlSurface = "canvas"): string {
  if (variant === "primary") return palette().actionPrimaryBorder;
  if (variant === "accent") return "transparent";
  if (variant === "danger") return palette().dangerBorder;
  if (variant === "ghost") return "transparent";
  if (variant === "secondary") {
    if (surface === "chrome") return palette().chromeBorder;
    return isLightAppearance() ? palette().borderStrong : palette().border;
  }
  return surface === "chrome" ? palette().chromeBorder : palette().borderStrong;
}

function btnFg(variant: ButtonVariant, surface: ControlSurface = "canvas"): string {
  if (variant === "primary") return palette().actionPrimaryFg;
  if (variant === "accent") return palette().actionSolidFg;
  if (variant === "danger") return palette().danger;
  if (variant === "ghost") {
    return surface === "chrome" ? palette().chromeTextMuted : palette().textSecondary;
  }
  return surface === "chrome" ? palette().chromeText : palette().text;
}

function btnShadow(variant: ButtonVariant): string | undefined {
  if (variant === "primary" || variant === "accent") return palette().innerHighlight;
  return undefined;
}

function btnPadX(size: ButtonSize): number {
  if (size === "xs") return 8;
  if (size === "sm") return 12;
  if (size === "lg") return 20;
  return 16;
}

function btnGap(size: ButtonSize): number {
  if (size === "xs" || size === "sm") return space.xs;
  return space.chip;
}

function btnFontPx(size: ButtonSize): number {
  if (size === "xs") return 12;
  if (size === "lg") return 14;
  return 13;
}

function btnIconPx(size: ButtonSize): number {
  if (size === "xs") return 12;
  if (size === "sm") return 14;
  return 16;
}

function btnRadius(size: ButtonSize, pill?: boolean): number {
  // Visual spec §2.3: buttons are `md` (8), small (24) buttons `sm` (6); `pill` opts into a pill.
  if (pill === true) return radii.pill;
  if (size === "xs") return radii.sm;
  return radii.md;
}

export function Button(props: ButtonProps) {
  const isMutedPrimaryDisabled = () =>
    Boolean(props.disabled && !props.loading) &&
    ((props.variant ?? "secondary") === "primary" || (props.variant ?? "secondary") === "accent");

  return (
    <View
      role="button"
      disabled={Boolean(props.disabled || props.loading)}
      hitSlop={touchSlop(controlHeight[props.size ?? "md"], (props.size ?? "md") === "xs" ? 3 : undefined)}
      tooltip={resolveTooltip(props.tooltip, props.label)}
      accessibilityLabel={props.accessibilityLabel}
      accessibilityState={{
        disabled: Boolean(props.disabled || props.loading),
        busy: Boolean(props.loading),
      }}
      onPress={() => {
        if (!props.disabled && !props.loading) props.onPress();
      }}
      style={[
        {
          boxSizing: "border-box",
          height: controlHeight[props.size ?? "md"],
          width: props.fullWidth ? "100%" : "fit-content",
          alignSelf: props.fullWidth ? "stretch" : undefined,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          minWidth: 0,
          maxWidth: "100%",
          gap: btnGap(props.size ?? "md"),
          paddingHorizontal: btnPadX(props.size ?? "md"),
          paddingVertical: 0,
          borderRadius: btnRadius(props.size ?? "md", props.pill),
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: isMutedPrimaryDisabled()
            ? palette().borderSubtle
            : btnBorder(props.variant ?? "secondary", props.surface ?? "canvas"),
          backgroundColor: isMutedPrimaryDisabled()
            ? palette().buttonSecondaryBg
            : btnBg(props.variant ?? "secondary", props.surface ?? "canvas"),
          boxShadow: isMutedPrimaryDisabled() ? undefined : btnShadow(props.variant ?? "secondary"),
          cursor: props.disabled || props.loading ? "not-allowed" : "pointer",
          userSelect: "none",
          ...pressTransition(MOTION_DURATION.fast),
        },
        props.style,
      ]}
      hoverStyle={{
        backgroundColor: btnHoverBg(props.variant ?? "secondary", props.surface ?? "canvas"),
        borderColor: btnHoverBorder(props.variant ?? "secondary", props.surface ?? "canvas"),
      }}
      activeStyle={tactileActiveStyle(0.98, {
        backgroundColor: btnPressedBg(props.variant ?? "secondary", props.surface ?? "canvas"),
      })}
      focusVisibleStyle={focusRingStyle(props.surface ?? SurfaceContext())}
      disabledStyle={{
        opacity: isMutedPrimaryDisabled() ? 0.72 : 0.4,
      }}
    >
      <If when={Boolean(props.loading)}>
        <Spinner
          size={(props.size ?? "md") === "xs" ? 11 : 13}
          color={btnFg(props.variant ?? "secondary", props.surface ?? "canvas")}
        />
      </If>
      <If when={!props.loading && (props.leadingIcon ?? "") ? props.leadingIcon! : ""}>
        {iconName => (
          <Icon
            name={iconName() as IconName}
            size={btnIconPx(props.size ?? "md")}
            color={
              isMutedPrimaryDisabled()
                ? palette().textMuted
                : btnFg(props.variant ?? "secondary", props.surface ?? "canvas")
            }
          />
        )}
      </If>
      <Text
        style={{
          flexShrink: 1,
          minWidth: 0,
          color: isMutedPrimaryDisabled()
            ? palette().textMuted
            : btnFg(props.variant ?? "secondary", props.surface ?? "canvas"),
          fontSize: textSize(btnFontPx(props.size ?? "md")),
          fontWeight:
            (props.variant ?? "secondary") === "primary" ||
            (props.variant ?? "secondary") === "accent"
              ? "600"
              : (props.variant ?? "secondary") === "secondary"
                ? "500"
                : "400",
          lineHeight: textLineHeight(btnFontPx(props.size ?? "md"), 1.2),
          textAlign: "center",
          numberOfLines: 1,
          textOverflow: "ellipsis",
        }}
      >
        {props.label}
      </Text>
      <If when={props.trailingIcon ?? ""}>
        {iconName => (
          <Icon
            name={iconName() as IconName}
            size={btnIconPx(props.size ?? "md")}
            color={
              isMutedPrimaryDisabled()
                ? palette().textMuted
                : btnFg(props.variant ?? "secondary", props.surface ?? "canvas")
            }
          />
        )}
      </If>
    </View>
  );
}

export type IconButtonSize = ControlSize;
export type IconButtonTone = "default" | "danger";

export interface IconButtonProps {
  icon: IconName;
  size?: IconButtonSize;
  surface?: ControlSurface;
  tone?: IconButtonTone;
  iconSize?: number;
  active?: boolean;
  disabled?: boolean;
  tooltip?: string | JSX.Element;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  onPress: () => void;
}

function iconBtnBox(size: IconButtonSize): number {
  return controlHeight[size];
}

function iconBtnGlyph(size: IconButtonSize): number {
  if (size === "xs") return 13;
  if (size === "sm") return 14.5;
  if (size === "lg") return 17.5;
  return 16;
}

export function IconButton(props: IconButtonProps) {
  return (
    <View
      role="button"
      disabled={props.disabled}
      hitSlop={touchSlop(controlHeight[props.size ?? "sm"], (props.size ?? "sm") === "xs" ? 3 : undefined)}
      tooltip={resolveTooltip(props.tooltip)}
      accessibilityLabel={props.accessibilityLabel}
      accessibilityState={{
        disabled: Boolean(props.disabled),
        selected: Boolean(props.active),
      }}
      onPress={() => {
        if (!props.disabled) props.onPress();
      }}
      style={[
        {
          boxSizing: "border-box",
          width: iconBtnBox(props.size ?? "sm"),
          height: iconBtnBox(props.size ?? "sm"),
          flexShrink: 0,
          borderRadius: (props.size ?? "sm") === "xs" ? radii.sm : radii.md,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: props.active
            ? props.tone === "danger"
              ? palette().dangerBorder
              : props.surface === "chrome"
                ? palette().chromeBorder
                : palette().borderSubtle
            : "transparent",
          backgroundColor: props.active
            ? props.tone === "danger"
              ? palette().dangerSoft
              : props.surface === "chrome"
                ? palette().chromeActive
                : palette().panelHover
            : "transparent",
          alignItems: "center",
          justifyContent: "center",
          cursor: props.disabled ? "not-allowed" : "pointer",
          userSelect: "none",
          ...pressTransition(MOTION_DURATION.fast),
        },
        props.style,
      ]}
      hoverStyle={{
        backgroundColor:
          props.tone === "danger"
            ? palette().dangerSoft
            : props.surface === "chrome"
              ? palette().chromeHover
              : palette().buttonSecondaryHover,
      }}
      activeStyle={tactileActiveStyle(0.96, {
        backgroundColor:
          props.tone === "danger"
            ? palette().dangerHoverBg
            : props.surface === "chrome"
              ? palette().chromeActive
              : palette().panelHover,
      })}
      focusVisibleStyle={focusRingStyle(props.surface ?? SurfaceContext())}
      disabledStyle={{
        opacity: 0.44,
      }}
    >
      <Icon
        name={props.icon}
        size={props.iconSize ?? iconBtnGlyph(props.size ?? "sm")}
        color={
          props.tone === "danger"
            ? palette().danger
            : props.surface === "chrome"
              ? props.active
                ? palette().chromeText
                : palette().chromeTextMuted
              : props.active
                ? palette().text
                : palette().textSecondary
        }
      />
    </View>
  );
}

// --- Settings / Editorial Sections (macOS / Linear lifted matte grouped cards) ---

const ConfigSectionInsetContext = context<number>(0);
const ConfigSectionControlWidthContext = context<number | undefined>(undefined);
const ConfigRowInRailContext = context<boolean>(false);

export interface ConfigSectionProps {
  title: string;
  subtitle?: string;
  extra?: JSX.Element;
  /**
   * Inner body padding in px. Defaults to `14` so freeform sections never collide
   * with card borders; `<ConfigRow>` automatically compensates with negative
   * horizontal margin so row dividers stay crisp edge-to-edge. Pass `flush` (or
   * `bodyPadding={0}`) for pure `ConfigRow`-only lists that want tight top/bottom edges.
   */
  bodyPadding?: number;
  /** Removes default card body padding (`bodyPadding = 0`). */
  flush?: boolean;
  /**
   * Optional shared right-side control rail width (e.g. `280` or `300`) inherited
   * by every `<ConfigRow>` inside this section so stacked controls align along
   * one razor-straight vertical rail.
   */
  controlWidth?: number;
  bodyStyle?: StyleProp<ViewStyle>;
  children?: JSX.Element;
  style?: StyleProp<ViewStyle>;
}

export function ConfigSection(props: ConfigSectionProps) {
  const effectiveInset = () => (props.flush ? 0 : (props.bodyPadding ?? 14));
  return (
    <View style={[{ gap: 12 }, props.style]}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingHorizontal: 2,
        }}
      >
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <Text
            style={{
              color: palette().text,
              fontSize: textSize(15),
              fontWeight: "600",
              letterSpacing: textTracking(15),
              fontVariant: ["tabular-nums"],
              lineHeight: textLineHeight(15, 1.28),
            }}
          >
            {props.title}
          </Text>
          <If when={props.subtitle ?? ""}>
            {sub => (
              <Text
                style={{
                  color: palette().textMuted,
                  fontSize: textSize(12),
                  lineHeight: textLineHeight(12, 1.44),
                }}
              >
                {sub()}
              </Text>
            )}
          </If>
        </View>
        <If when={Boolean(props.extra)}>
          <View style={{ flexShrink: 0 }}>{props.extra}</View>
        </If>
      </View>
      <View
        style={[
          {
            borderRadius: radii.lg,
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: palette().border,
            backgroundColor: palette().panelRaised,
            boxShadow: elevationShadow(0),
            padding: effectiveInset(),
            overflow: "hidden",
          },
          props.bodyStyle,
        ]}
      >
        <ConfigSectionInsetContext.Provider value={effectiveInset()}>
          <ConfigSectionControlWidthContext.Provider value={props.controlWidth}>
            {props.children}
          </ConfigSectionControlWidthContext.Provider>
        </ConfigSectionInsetContext.Provider>
      </View>
    </View>
  );
}

export type ConfigRowControlAlign = "end" | "stretch";

export interface ConfigRowProps {
  label: string;
  description?: string;
  /** Renders a bottom hairline divider (default `true`). Pass `false` on the last row. */
  divider?: boolean;
  /** Renders a top hairline divider (useful when list loops separate rows with `!first`). */
  topDivider?: boolean;
  /**
   * Fixed width (in px, e.g. `280` or `300`) for the right-side control column so
   * stacked rows lock to one razor-straight vertical rail. Inherits from
   * `<ConfigSection controlWidth={...}>` when omitted.
   */
  controlWidth?: number;
  /**
   * Alignment of controls inside the right-side column (`"end"` right-aligns
   * switches/badges/pills; `"stretch"` fills `controlWidth` edge-to-edge for
   * inputs, selects, and `InlineFieldSaveGroup`). Defaults to `"end"`.
   */
  controlAlign?: ConfigRowControlAlign;
  /** Enables tabular numerals on `description` (e.g. numeric current values). */
  descriptionTabular?: boolean;
  controlStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
  children?: JSX.Element;
}

export function ConfigRow(props: ConfigRowProps) {
  const resolvedControlWidth = () =>
    props.controlWidth ?? ConfigSectionControlWidthContext();
  const isStretch = () => (props.controlAlign ?? "end") === "stretch";
  const stacked = () => compactLayout();
  return (
    <View
      style={[
        {
          minHeight: stacked() ? undefined : 56,
          marginHorizontal: ConfigSectionInsetContext() > 0 ? -ConfigSectionInsetContext() : 0,
          paddingHorizontal: space.lg,
          paddingVertical: space.md,
          flexDirection: stacked() ? "column" : "row",
          alignItems: stacked() ? "stretch" : "center",
          gap: stacked() ? space.sm : space.xxl,
          borderTopWidth: props.topDivider ? 1 : 0,
          borderBottomWidth: props.divider === false ? 0 : 1,
          borderColor: palette().borderSubtle,
          ...paintTransition(MOTION_DURATION.fast),
        },
        props.style,
      ]}
      hoverStyle={
        stacked()
          ? undefined
          : {
              backgroundColor: palette().surfaceSubtle,
            }
      }
    >
      <View style={{ flex: stacked() ? undefined : 1, minWidth: 0, gap: space.xs }}>
        <Text
          style={{
            color: palette().text,
            fontSize: textSize(13),
            fontWeight: "500",
            lineHeight: textLineHeight(13, 1.35),
          }}
        >
          {props.label}
        </Text>
        <If when={props.description ?? ""}>
          {desc => (
            <Text
              style={{
                color: palette().textMuted,
                fontSize: textSize(12),
                fontVariant: props.descriptionTabular ? ["tabular-nums"] : undefined,
                lineHeight: textLineHeight(12, 1.45),
                maxWidth: 520,
              }}
            >
              {desc()}
            </Text>
          )}
        </If>
      </View>
      <If when={Boolean(props.children)}>
        <View
          style={[
            {
              flexDirection: "row",
              alignItems: "center",
              justifyContent: stacked() ? "flex-start" : isStretch() ? "flex-start" : "flex-end",
              flexShrink: 0,
              minWidth: 0,
              width: stacked() ? "100%" : resolvedControlWidth(),
              maxWidth: stacked() ? "100%" : resolvedControlWidth() !== undefined ? "60%" : undefined,
              gap: space.sm,
            },
            props.controlStyle,
          ]}
        >
          <ConfigRowInRailContext.Provider
            value={stacked() || (resolvedControlWidth() !== undefined && isStretch())}
          >
            {props.children}
          </ConfigRowInRailContext.Provider>
        </View>
      </If>
    </View>
  );
}

export interface InlineFieldSaveGroupProps {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  placeholder?: string;
  /** Compact Save button label (defaults to `tr("common.save")`). */
  saveLabel?: string;
  /**
   * Explicit dirty state overriding the default `value.trim().length > 0`.
   * When dirty, the Save button illuminates with `saveVariant` (`"primary"` by default);
   * when pristine, it stays calm and subtly disabled.
   */
  dirty?: boolean;
  /** Allow pressing Save even when pristine/empty (default `false`). */
  allowEmptySave?: boolean;
  /** Unified height aligned to `controlHeight.sm` (28px, default) or `controlHeight.md` (32px). */
  size?: "sm" | "md";
  /** Highlight variant when dirty (default `"primary"`). */
  saveVariant?: "primary" | "accent";
  /**
   * Fixed outer width in px when standalone (default `280`). When placed inside
   * a `<ConfigRow controlWidth={...} controlAlign="stretch">` and omitted, fills
   * the row's rail width edge-to-edge.
   */
  width?: number;
  /** Uniform compact Save button minimum width in px (default `64`) so stacked rows align cleanly. */
  buttonWidth?: number;
  monospace?: boolean;
  masked?: boolean;
  error?: string;
  readonly?: boolean;
  disabled?: boolean;
  loading?: boolean;
  surface?: ControlSurface;
  inputAccessibilityLabel?: string;
  saveAccessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Laser-aligned `[InputBox (flex: 1)] [compact fixed-width Save button]` control
 * group for settings rows and inline forms. Locks stacked rows onto one crisp
 * right-hand vertical rail, highlights unmistakably when dirty, and saves on Enter.
 */
export function InlineFieldSaveGroup(props: InlineFieldSaveGroupProps) {
  const isDirty = () =>
    props.dirty !== undefined ? props.dirty : props.value.trim().length > 0;
  const canSave = () =>
    !props.disabled &&
    !props.readonly &&
    !props.loading &&
    (Boolean(props.allowEmptySave) || isDirty());

  return (
    <View
      style={[
        {
          flexDirection: "row",
          alignItems: props.error ? "flex-start" : "center",
          gap: 8,
          minWidth: 0,
          flex: ConfigRowInRailContext() && props.width === undefined ? 1 : undefined,
          flexShrink: ConfigRowInRailContext() && props.width === undefined ? 1 : 0,
          width:
            props.width !== undefined
              ? props.width
              : ConfigRowInRailContext()
                ? "100%"
                : 280,
          maxWidth: "100%",
        },
        props.style,
      ]}
    >
      <InputBox
        size={props.size ?? "sm"}
        value={props.value}
        placeholder={props.placeholder}
        monospace={props.monospace}
        masked={props.masked}
        error={props.error}
        readonly={props.readonly}
        disabled={props.disabled}
        surface={props.surface}
        accessibilityLabel={props.inputAccessibilityLabel}
        style={{ flex: 1, minWidth: 0 }}
        onChange={props.onChange}
        onSubmit={() => {
          if (canSave()) props.onSave();
        }}
      />
      <Button
        label={props.saveLabel ?? tr("common.save")}
        variant={isDirty() && !props.disabled && !props.readonly ? (props.saveVariant ?? "primary") : "secondary"}
        size={props.size ?? "sm"}
        surface={props.surface}
        loading={props.loading}
        disabled={!canSave()}
        accessibilityLabel={props.saveAccessibilityLabel}
        style={{ minWidth: props.buttonWidth ?? 64 }}
        onPress={() => {
          if (canSave()) props.onSave();
        }}
      />
    </View>
  );
}

export interface KbdHintProps {
  keys: string;
  surface?: ControlSurface;
}

export function KbdHint(props: KbdHintProps) {
  return (
    <View
      style={{
        flexShrink: 0,
        paddingHorizontal: space.xs,
        paddingVertical: 1,
        borderRadius: radii.xs,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: props.surface === "chrome" ? palette().chromeBorder : palette().border,
        backgroundColor:
          props.surface === "chrome" ? palette().chromeBg : palette().surfaceTertiary,
      }}
    >
      <Text
        style={{
          color:
            props.surface === "chrome" ? palette().chromeTextMuted : palette().textMuted,
          fontFamily: fontMono,
          fontSize: textSize(11),
          fontWeight: "500",
          fontVariant: ["tabular-nums"],
          lineHeight: textLineHeight(11, 14 / 11),
          numberOfLines: 1,
        }}
      >
        {props.keys}
      </Text>
    </View>
  );
}

export type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger";
export type BadgeSize = "xs" | "sm";

export interface BadgeProps {
  label: string;
  tone?: BadgeTone;
  size?: BadgeSize;
  surface?: ControlSurface;
  pill?: boolean;
  /** Force a hairline border even on neutral metadata tags (default: borderless for neutral). */
  bordered?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

function badgeColors(
  tone: BadgeTone,
  surface: ControlSurface = "canvas",
): { bg: string; border: string; fg: string; borderless?: boolean } {
  if (tone === "accent") {
    if (surface === "chrome") {
      return {
        bg: palette().chromeActive,
        border: "transparent",
        fg: palette().chromeAccent,
        borderless: true,
      };
    }
    return {
      bg: palette().accentSoft,
      border: palette().accentBorder,
      fg: palette().accent,
    };
  }
  if (tone === "success") {
    return {
      bg: palette().successSoft,
      border: palette().successBorder,
      fg: palette().success,
    };
  }
  if (tone === "warning") {
    return {
      bg: palette().warningSoft,
      border: palette().warningBorder,
      fg: palette().warning,
    };
  }
  if (tone === "danger") {
    return {
      bg: palette().dangerSoft,
      border: palette().dangerBorder,
      fg: palette().danger,
    };
  }
  if (surface === "chrome") {
    return {
      bg: palette().chromeHover,
      border: palette().chromeBorder,
      fg: palette().chromeTextMuted,
      borderless: true,
    };
  }
  return {
    bg: palette().surfaceSubtle,
    border: palette().borderSubtle,
    fg: palette().textSecondary,
    borderless: true,
  };
}

export function Badge(props: BadgeProps) {
  const isXs = () => (props.size ?? "sm") === "xs";
  const hasBorder = () => {
    if (props.bordered !== undefined) return props.bordered;
    return !badgeColors(props.tone ?? "neutral", props.surface ?? "canvas").borderless;
  };
  return (
    <View
      accessibilityLabel={props.accessibilityLabel}
      style={[
        {
          flexShrink: 0,
          alignItems: "center",
          justifyContent: "center",
          maxWidth: "100%",
          paddingHorizontal: isXs() ? 5 : 7,
          paddingVertical: isXs() ? 1 : 2,
          borderRadius: props.pill ? radii.pill : isXs() ? radii.xs : radii.sm,
          borderCurve: "continuous",
          borderWidth: hasBorder() ? 1 : 0,
          borderColor: hasBorder()
            ? badgeColors(props.tone ?? "neutral", props.surface ?? "canvas").border
            : "transparent",
          backgroundColor: badgeColors(props.tone ?? "neutral", props.surface ?? "canvas").bg,
        },
        props.style,
      ]}
    >
      <Text
        style={{
          color: badgeColors(props.tone ?? "neutral", props.surface ?? "canvas").fg,
          fontSize: textSize(11),
          fontWeight: "500",
          fontVariant: ["tabular-nums"],
          lineHeight: textLineHeight(11, 14 / 11),
          numberOfLines: 1,
          textOverflow: "ellipsis",
        }}
      >
        {props.label}
      </Text>
    </View>
  );
}

export interface SplitHandleProps {
  onDelta: (delta: number) => void;
  onDragStateChange?: (dragging: boolean) => void;
  onReset?: () => void;
  /** `"vertical"` (default) resizes side-by-side panes horizontally; `"horizontal"` resizes stacked panes vertically. */
  orientation?: "vertical" | "horizontal";
  surface?: ControlSurface;
  seam?: boolean;
  accessibilityLabel?: string;
  style?: ViewStyle;
}

const activeSplitDragCount = signal(0);

/** True while the user is dragging any `SplitHandle` resize edge. */
export const splitDragging = computed(() => activeSplitDragCount() > 0);

/**
 * Tactile vertical or horizontal split resize handle: optional 1px full-edge
 * seam hairline paired with a centered GPU-scaled pill grip that reveals on hover/drag.
 */
export function SplitHandle(props: SplitHandleProps) {
  const isHorizontal = () => props.orientation === "horizontal";
  const hovered = signal(false);
  const dragging = signal(false);
  let dragCounted = false;
  let lastOffset = 0;

  const setDragging = (next: boolean) => {
    if (next === dragCounted) return;
    dragCounted = next;
    dragging.set(next);
    activeSplitDragCount.update(n => Math.max(0, n + (next ? 1 : -1)));
    props.onDragStateChange?.(next);
  };
  cleanup(() => setDragging(false));

  const responder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => {
      lastOffset = 0;
      setDragging(true);
    },
    onPanResponderMove: (_e, state) => {
      const current = isHorizontal() ? state.dy : state.dx;
      const delta = current - lastOffset;
      lastOffset = current;
      if (delta !== 0) props.onDelta(delta);
    },
    onPanResponderRelease: () => {
      setDragging(false);
    },
    onPanResponderTerminate: () => {
      setDragging(false);
    },
  });

  return (
    <View
      {...responder.panHandlers}
      accessibilityLabel={props.accessibilityLabel ?? "Resize pane"}
      onPress={e => {
        if (e.clickCount >= 2) props.onReset?.();
      }}
      onMouseEnter={() => hovered.set(true)}
      onMouseLeave={() => hovered.set(false)}
      style={[
        {
          position: "relative",
          ...(isHorizontal() ? { height: 9, width: "100%" } : { width: 9 }),
          flexShrink: 0,
          alignItems: "center",
          justifyContent: "center",
          cursor: isHorizontal() ? "ns-resize" : "ew-resize",
          userSelect: "none",
          backgroundColor: "transparent",
        },
        props.style,
      ]}
    >
      <If when={props.seam !== false}>
        <View
          style={{
            position: "absolute",
            ...(isHorizontal()
              ? { left: 0, right: 0, height: 1 }
              : { top: 0, bottom: 0, width: 1 }),
            backgroundColor: dragging()
              ? props.surface === "chrome"
                ? palette().chromeAccent
                : palette().accent
              : hovered()
                ? props.surface === "chrome"
                  ? palette().chromeBorder
                  : palette().borderStrong
                : props.surface === "chrome"
                  ? palette().chromeBorder
                  : palette().borderSubtle,
            ...paintTransition(MOTION_DURATION.fast),
          }}
        />
      </If>
      <View
        style={{
          width: isHorizontal() ? 44 : 3,
          height: isHorizontal() ? 3 : 44,
          borderRadius: radii.pill,
          opacity: dragging() || hovered() ? 1 : 0,
          transform: reduceMotion()
            ? undefined
            : isHorizontal()
              ? [{ scaleX: dragging() ? 1.1 : hovered() ? 0.84 : 0.62 }]
              : [{ scaleY: dragging() ? 1.1 : hovered() ? 0.84 : 0.62 }],
          backgroundColor: dragging()
            ? props.surface === "chrome"
              ? palette().chromeAccent
              : palette().accent
            : props.surface === "chrome"
              ? palette().chromeBorder
              : palette().borderStrong,
          transitionProperty: reduceMotion()
            ? "opacity, background-color"
            : "opacity, transform, background-color",
          transitionDuration: reduceMotion() ? 100 : MOTION_DURATION.fast,
          transitionTimingFunction: MOTION_EASE_STANDARD,
        }}
      />
    </View>
  );
}

// --- Compatibility exports refined for OpenBitFun Tauri aesthetics ---

export type ActionButtonVariant = "primary" | "accent" | "secondary" | "ghost" | "danger";
export type ActionButtonSize = ControlSize;

export interface ActionButtonProps {
  label: string;
  variant?: ActionButtonVariant;
  size?: ActionButtonSize;
  surface?: ControlSurface;
  fullWidth?: boolean;
  leadingIcon?: IconName;
  trailingIcon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  tooltip?: string | JSX.Element;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  onPress: () => void;
}

export function ActionButton(props: ActionButtonProps) {
  return (
    <Button
      label={props.label}
      variant={props.variant ?? "secondary"}
      size={props.size ?? "md"}
      surface={props.surface}
      fullWidth={props.fullWidth}
      leadingIcon={props.leadingIcon}
      trailingIcon={props.trailingIcon}
      loading={props.loading}
      disabled={props.disabled}
      tooltip={props.tooltip}
      accessibilityLabel={props.accessibilityLabel}
      style={props.style}
      onPress={props.onPress}
    />
  );
}

export type SemanticTone = "neutral" | "accent" | "success" | "warning" | "danger";

export interface PillChipProps {
  label: string;
  active?: boolean;
  disabled?: boolean;
  badge?: string | number;
  icon?: IconName;
  tone?: SemanticTone | (string & {});
  maxWidth?: number;
  accessibilityLabel?: string;
  onPress?: () => void;
}

function pillColors(active: boolean, tone?: string): { bg: string; border: string; fg: string } {
  if (active) {
    return { bg: palette().accentSoft, border: palette().accentBorder, fg: palette().accent };
  }
  if (tone === "accent") {
    return { bg: palette().accentSoft, border: palette().accentBorder, fg: palette().accent };
  }
  if (tone === "success") {
    return { bg: palette().successSoft, border: palette().successBorder, fg: palette().success };
  }
  if (tone === "warning") {
    return { bg: palette().warningSoft, border: palette().warningBorder, fg: palette().warning };
  }
  if (tone === "danger") {
    return { bg: palette().dangerSoft, border: palette().dangerBorder, fg: palette().danger };
  }
  if (tone && tone !== "neutral") {
    return { bg: palette().panelRaised, border: palette().border, fg: tone };
  }
  return { bg: palette().panelRaised, border: palette().border, fg: palette().textSecondary };
}

export function PillChip(props: PillChipProps) {
  return (
    <View
      role={props.onPress ? "button" : undefined}
      disabled={props.disabled}
      accessibilityLabel={props.accessibilityLabel}
      accessibilityState={
        props.active !== undefined || props.disabled !== undefined
          ? {
              selected: props.active !== undefined ? Boolean(props.active) : undefined,
              disabled: props.disabled !== undefined ? Boolean(props.disabled) : undefined,
            }
          : undefined
      }
      onPress={
        props.onPress
          ? () => {
              if (!props.disabled) props.onPress?.();
            }
          : undefined
      }
      hitSlop={props.onPress ? touchSlop(24) : undefined}
      style={{
        flexDirection: "row",
        alignItems: "center",
        flexShrink: 0,
        maxWidth: props.maxWidth ?? "100%",
        gap: space.chip,
        paddingHorizontal: space.sm,
        paddingVertical: space.xs,
        borderRadius: radii.pill,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: pillColors(Boolean(props.active), props.tone).border,
        backgroundColor: pillColors(Boolean(props.active), props.tone).bg,
        cursor: props.onPress ? (props.disabled ? "not-allowed" : "pointer") : "default",
        userSelect: "none",
        ...(props.onPress ? pressTransition(MOTION_DURATION.fast) : paintTransition(MOTION_DURATION.fast)),
      }}
      hoverStyle={
        props.onPress
          ? {
              backgroundColor: props.active ? palette().accentSoft : palette().panelHover,
              borderColor: props.active ? palette().accent : palette().borderStrong,
            }
          : undefined
      }
      activeStyle={props.onPress ? tactileActiveStyle(0.97) : undefined}
      focusVisibleStyle={props.onPress ? focusRingStyle() : undefined}
      disabledStyle={{ opacity: 0.45 }}
    >
      <If when={props.icon ?? ""}>
        {iconName => (
          <Icon
            name={iconName() as IconName}
            size={12}
            color={pillColors(Boolean(props.active), props.tone).fg}
          />
        )}
      </If>
      <Text
        style={{
          flexShrink: 1,
          minWidth: 0,
          color: pillColors(Boolean(props.active), props.tone).fg,
          fontSize: textSize(12),
          fontWeight: props.active ? "600" : "500",
          lineHeight: textLineHeight(12, 1.32),
          numberOfLines: 1,
          textOverflow: "ellipsis",
        }}
      >
        {props.label}
      </Text>
      <If when={props.badge !== undefined && props.badge !== null ? String(props.badge) : ""}>
        {badgeText => (
          <View
            style={{
              flexShrink: 0,
              paddingHorizontal: 5,
              paddingVertical: 1,
              borderRadius: radii.pill,
              backgroundColor: props.active ? palette().actionSolid : palette().panelRaised,
            }}
          >
            <Text
              style={{
                color: props.active ? palette().actionSolidFg : palette().textMuted,
                fontSize: textSize(11),
                fontWeight: "600",
                fontVariant: ["tabular-nums"],
                lineHeight: textLineHeight(11, 1.3),
                numberOfLines: 1,
              }}
            >
              {badgeText()}
            </Text>
          </View>
        )}
      </If>
    </View>
  );
}

export interface SegmentedTabOption<T extends string> {
  value: T;
  label: string;
  badge?: string | number;
  icon?: IconName;
  accessibilityLabel?: string;
}

export interface SegmentedTabsProps<T extends string> {
  options: ReadonlyArray<SegmentedTabOption<T>>;
  value: T;
  size?: "sm" | "md";
  /** When inside a horizontal `<Scroll>`, keep each tab at its intrinsic width instead of truncating. */
  scrollable?: boolean;
  style?: StyleProp<ViewStyle>;
  onChange: (value: T) => void;
}

const SEGMENT_OUTER_RADIUS = radii.md;
const SEGMENT_PADDING = 3;
const SEGMENT_INNER_RADIUS = concentricRadius(SEGMENT_OUTER_RADIUS, SEGMENT_PADDING);

export function SegmentedTabs<T extends string>(props: SegmentedTabsProps<T>) {
  return (
    <View
      role="tablist"
      style={[
        {
          boxSizing: "border-box",
          height: controlHeight[props.size ?? "md"],
          flexDirection: "row",
          alignItems: "center",
          width: "fit-content",
          flexShrink: 0,
          maxWidth: props.scrollable ? undefined : "100%",
          gap: 2,
          padding: SEGMENT_PADDING,
          borderRadius: SEGMENT_OUTER_RADIUS,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: palette().borderSubtle,
          backgroundColor: isLightAppearance()
            ? palette().segmentedTrackBg
            : palette().canvasSubtle,
        },
        props.style,
      ]}
    >
      <Each of={props.options} key={option => option.value}>
        {option => (
          <View
            role="tab"
            hitSlop={touchSlop(controlHeight[props.size ?? "md"])}
            accessibilityLabel={option().accessibilityLabel}
            accessibilityState={{ selected: option().value === props.value }}
            onPress={() => props.onChange(option().value)}
            style={{
              boxSizing: "border-box",
              height: "100%",
              flexDirection: "row",
              alignItems: "center",
              flexShrink: props.scrollable ? 0 : 1,
              minWidth: props.scrollable ? undefined : 0,
              gap: space.xs,
              paddingHorizontal: (props.size ?? "md") === "sm" ? 10 : 14,
              paddingVertical: 0,
              borderRadius: SEGMENT_INNER_RADIUS,
              borderCurve: "continuous",
              borderWidth: option().value === props.value ? 1 : 0,
              borderColor:
                option().value === props.value
                  ? isLightAppearance()
                    ? palette().borderSubtle
                    : palette().border
                  : "transparent",
              backgroundColor:
                option().value === props.value
                  ? isLightAppearance()
                    ? palette().panelRaised
                    : palette().panelHover
                  : "transparent",
              boxShadow:
                option().value === props.value
                  ? isLightAppearance()
                    ? elevationShadow(1)
                    : palette().innerHighlight
                  : undefined,
              cursor: "pointer",
              userSelect: "none",
              ...pressTransition(MOTION_DURATION.fast),
            }}
            hoverStyle={{
              backgroundColor:
                option().value === props.value
                  ? isLightAppearance()
                    ? palette().panelRaised
                    : palette().panelHover
                  : palette().surfaceSubtle,
            }}
            activeStyle={tactileActiveStyle(0.98)}
            focusVisibleStyle={focusRingStyle()}
          >
            <If when={option().icon ?? ""}>
              {iconName => (
                <Icon
                  name={iconName() as IconName}
                  size={12}
                  color={
                    option().value === props.value ? palette().text : palette().textMuted
                  }
                />
              )}
            </If>
            <Text
              style={{
                flexShrink: props.scrollable ? 0 : 1,
                minWidth: props.scrollable ? undefined : 0,
                color:
                  option().value === props.value ? palette().text : palette().textMuted,
                fontSize: textSize((props.size ?? "md") === "sm" ? 12 : 13),
                fontWeight: option().value === props.value ? "600" : "400",
                lineHeight: textLineHeight((props.size ?? "md") === "sm" ? 12 : 13, 1.24),
                numberOfLines: 1,
                textOverflow: props.scrollable ? undefined : "ellipsis",
              }}
            >
              {option().label}
            </Text>
            <If
              when={
                option().badge !== undefined && option().badge !== null
                  ? String(option().badge)
                  : ""
              }
            >
              {badgeText => (
                <Text
                  style={{
                    flexShrink: 0,
                    color:
                      option().value === props.value
                        ? palette().accent
                        : palette().textMuted,
                    fontSize: textSize(11),
                    fontWeight: "600",
                    fontVariant: ["tabular-nums"],
                    lineHeight: textLineHeight(11, 1.24),
                  }}
                >
                  {badgeText()}
                </Text>
              )}
            </If>
          </View>
        )}
      </Each>
    </View>
  );
}

export interface UnderlineTabsProps<T extends string> {
  options: ReadonlyArray<SegmentedTabOption<T>>;
  value: T;
  size?: "sm" | "md";
  scrollable?: boolean;
  /** Optional trailing content rendered cleanly on the right of the tab baseline. */
  extra?: JSX.Element;
  style?: StyleProp<ViewStyle>;
  onChange: (value: T) => void;
}

/**
 * Clean editorial underline tab strip resting on a single hairline divider
 * (Linear / Raycast / Claude style): zero boxed pill chrome, crisp 2px active bar.
 */
export function UnderlineTabs<T extends string>(props: UnderlineTabsProps<T>) {
  const isSm = () => (props.size ?? "md") === "sm";
  return (
    <View
      role="tablist"
      style={[
        {
          width: props.scrollable ? undefined : "100%",
          minWidth: 0,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: space.md,
          borderBottomWidth: 1,
          borderColor: palette().borderSubtle,
        },
        props.style,
      ]}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          flexShrink: props.scrollable ? 0 : 1,
          minWidth: 0,
          gap: isSm() ? space.lg : space.xl,
        }}
      >
        <Each of={props.options} key={option => option.value}>
          {option => {
            const active = () => option().value === props.value;
            return (
              <View
                role="tab"
                hitSlop={touchSlop(controlHeight.sm)}
                accessibilityLabel={option().accessibilityLabel}
                accessibilityState={{ selected: active() }}
                onPress={() => props.onChange(option().value)}
                style={{
                  position: "relative",
                  flexDirection: "row",
                  alignItems: "center",
                  flexShrink: props.scrollable ? 0 : 1,
                  minWidth: 0,
                  gap: space.xs,
                  paddingTop: space.xs,
                  paddingBottom: isSm() ? 9 : 10,
                  cursor: "pointer",
                  userSelect: "none",
                  ...pressTransition(MOTION_DURATION.fast),
                }}
                hoverStyle={{ opacity: 0.92 }}
                activeStyle={tactileActiveStyle(0.98)}
                focusVisibleStyle={focusRingStyle()}
              >
                <If when={option().icon ?? ""}>
                  {iconName => (
                    <Icon
                      name={iconName() as IconName}
                      size={isSm() ? 13 : 14}
                      color={active() ? palette().text : palette().textMuted}
                    />
                  )}
                </If>
                <Text
                  style={{
                    flexShrink: props.scrollable ? 0 : 1,
                    minWidth: 0,
                    color: active() ? palette().text : palette().textMuted,
                    fontSize: textSize(isSm() ? 13 : 14),
                    fontWeight: active() ? "600" : "500",
                    lineHeight: textLineHeight(isSm() ? 13 : 14, 1.3),
                    numberOfLines: 1,
                    textOverflow: props.scrollable ? undefined : "ellipsis",
                  }}
                >
                  {option().label}
                </Text>
                <If
                  when={
                    option().badge !== undefined && option().badge !== null
                      ? String(option().badge)
                      : ""
                  }
                >
                  {badgeText => (
                    <Text
                      style={{
                        flexShrink: 0,
                        color: active() ? palette().textSecondary : palette().textMuted,
                        fontSize: textSize(11),
                        fontWeight: "600",
                        fontVariant: ["tabular-nums"],
                        lineHeight: textLineHeight(11, 1.24),
                      }}
                    >
                      {badgeText()}
                    </Text>
                  )}
                </If>
                <If when={active()}>
                  <View
                    style={{
                      position: "absolute",
                      left: 0,
                      right: 0,
                      bottom: -1,
                      height: 2,
                      borderRadius: radii.pill,
                      backgroundColor: palette().text,
                      pointerEvents: "none",
                    }}
                  />
                </If>
              </View>
            );
          }}
        </Each>
      </View>
      <If when={Boolean(props.extra)}>
        <View style={{ flexShrink: 0, paddingBottom: space.xs }}>{props.extra}</View>
      </If>
    </View>
  );
}

export interface ToggleSwitchProps {
  value?: boolean;
  checked?: boolean;
  label?: string;
  accessibilityLabel?: string;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}

export function ToggleSwitch(props: ToggleSwitchProps) {
  const isChecked = () => Boolean(props.value ?? props.checked);
  return (
    <View
      role="switch"
      disabled={props.disabled}
      hitSlop={touchSlop(18, props.label ? undefined : 4)}
      accessibilityLabel={props.accessibilityLabel}
      accessibilityState={{
        checked: isChecked(),
        disabled: Boolean(props.disabled),
      }}
      onPress={() => {
        if (!props.disabled) props.onChange(!isChecked());
      }}
      style={{
        flexDirection: "row",
        alignItems: "center",
        flexShrink: props.label ? 1 : 0,
        minWidth: 0,
        gap: space.sm,
        cursor: props.disabled ? "not-allowed" : "pointer",
        userSelect: "none",
        ...pressTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{ opacity: props.disabled ? 0.48 : 0.94 }}
      activeStyle={props.disabled ? undefined : tactileActiveStyle(0.96)}
      focusVisibleStyle={focusRingStyle()}
      disabledStyle={{ opacity: 0.48 }}
    >
      <View
        style={{
          boxSizing: "border-box",
          width: 30,
          height: 18,
          flexShrink: 0,
          borderRadius: radii.pill,
          backgroundColor: isChecked() ? palette().switchOn : palette().toggleTrackOff,
          padding: 2,
          flexDirection: "row",
          alignItems: "center",
          ...paintTransition(MOTION_DURATION.fast),
        }}
      >
        <View
          style={{
            width: 14,
            height: 14,
            borderRadius: radii.pill,
            backgroundColor: isChecked()
              ? isLightAppearance()
                ? palette().panelRaised
                : palette().text
              : palette().toggleThumbOff,
            boxShadow: elevationShadow(1),
            transform: [{ translateX: isChecked() ? 12 : 0 }],
            transitionProperty: reduceMotion() ? "background-color" : "transform",
            transitionDuration: reduceMotion() ? 100 : 160,
            transitionTimingFunction: reduceMotion()
              ? MOTION_EASE_STANDARD
              : springs.toggle,
          }}
        />
      </View>
      <If when={props.label ?? ""}>
        {labelText => (
          <Text
            style={{
              flexShrink: 1,
              minWidth: 0,
              color: palette().text,
              fontSize: textSize(13),
              fontWeight: "500",
              lineHeight: textLineHeight(13, 1.36),
            }}
          >
            {labelText()}
          </Text>
        )}
      </If>
    </View>
  );
}

export interface SectionCardProps {
  title?: string;
  subtitle?: string;
  right?: JSX.Element;
  trailing?: JSX.Element;
  children?: JSX.Element;
  style?: StyleProp<ViewStyle>;
}

export function SectionCard(props: SectionCardProps) {
  return (
    <View
      style={[
        {
          borderRadius: radii.lg,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: palette().border,
          backgroundColor: palette().panelRaised,
          boxShadow: elevationShadow(0),
          padding: 16,
          gap: 14,
        },
        props.style,
      ]}
    >
      <If when={Boolean(props.title || props.subtitle || props.right || props.trailing)}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
            <If when={props.title ?? ""}>
              {titleText => (
                <Text
                  style={{
                    color: palette().text,
                    fontSize: textSize(14),
                    fontWeight: "600",
                    letterSpacing: textTracking(14),
                    fontVariant: ["tabular-nums"],
                    lineHeight: textLineHeight(14, 1.3),
                  }}
                >
                  {titleText()}
                </Text>
              )}
            </If>
            <If when={props.subtitle ?? ""}>
              {subtitleText => (
                <Text
                  style={{
                    color: palette().textMuted,
                    fontSize: textSize(12),
                    lineHeight: textLineHeight(12, 1.44),
                  }}
                >
                  {subtitleText()}
                </Text>
              )}
            </If>
          </View>
          <If when={Boolean(props.right || props.trailing)}>
            <View style={{ flexShrink: 0 }}>{props.right ?? props.trailing}</View>
          </If>
        </View>
      </If>
      {props.children}
    </View>
  );
}

export type StatusDotKind = "accent" | "warning" | "danger" | "success" | "muted";

/** `solid` fills the dot; `ring` is a 1.5 outline (idle, stopped); `half` is the ring with its left half filled (needs you). */
export type StatusDotVariant = "solid" | "ring" | "half";

export interface StatusDotProps {
  kind?: StatusDotKind;
  size?: number;
  /** The working pulse: the dot itself breathes (`pulse`, 1600 ms); frozen at full opacity under reduced motion. */
  pulse?: boolean;
  variant?: StatusDotVariant;
  surface?: ControlSurface;
  accessibilityLabel?: string;
  testID?: string;
}

function dotColor(kind: StatusDotKind, surface: ControlSurface = "canvas"): string {
  if (kind === "success") return palette().success;
  if (kind === "warning") return palette().warning;
  if (kind === "danger") return palette().danger;
  if (kind === "muted") {
    return surface === "chrome" ? palette().chromeTextMuted : palette().textMuted;
  }
  return surfaceWorkingColor(surface);
}

const DOT_RING_WIDTH = 1.5;

/**
 * A state dot (visual spec §2.4). The pulse replaced the old `ping` ripple:
 * the dot breathes in place and never grows past its box.
 */
export function StatusDot(props: StatusDotProps) {
  const size = () => props.size ?? 6;
  const color = () => dotColor(props.kind ?? "accent", props.surface ?? SurfaceContext());
  const variant = () => props.variant ?? "solid";
  const pulsing = () => Boolean(props.pulse) && !reduceMotion();
  return (
    <View
      testID={props.testID}
      accessibilityLabel={props.accessibilityLabel}
      style={{
        boxSizing: "border-box",
        width: size(),
        height: size(),
        flexShrink: 0,
        overflow: "hidden",
        borderRadius: radii.pill,
        borderWidth: variant() === "solid" ? 0 : DOT_RING_WIDTH,
        borderColor: color(),
        backgroundColor: variant() === "solid" ? color() : "transparent",
        flexDirection: "row",
        animationName: pulsing() ? "pulse" : "none",
        animationDuration: motionTiming.pulse,
        animationTimingFunction: "ease-in-out",
        animationIterationCount: pulsing() ? "infinite" : 1,
      }}
    >
      <If when={variant() === "half"}>
        <View style={{ width: "50%", height: "100%", backgroundColor: color() }} />
      </If>
    </View>
  );
}

export type StatusPillKind = "neutral" | "accent" | "success" | "warning" | "danger";

export interface StatusPillProps {
  label: string;
  kind?: StatusPillKind;
  size?: BadgeSize;
  pulse?: boolean;
  style?: StyleProp<ViewStyle>;
}

function statusColors(kind: StatusPillKind): {
  bg: string;
  border: string;
  fg: string;
  borderless?: boolean;
} {
  if (kind === "success") {
    return { bg: palette().successSoft, border: palette().successBorder, fg: palette().success };
  }
  if (kind === "warning") {
    return { bg: palette().warningSoft, border: palette().warningBorder, fg: palette().warning };
  }
  if (kind === "danger") {
    return { bg: palette().dangerSoft, border: palette().dangerBorder, fg: palette().danger };
  }
  if (kind === "accent") {
    return { bg: palette().accentSoft, border: palette().accentBorder, fg: palette().accent };
  }
  return {
    bg: palette().surfaceSubtle,
    border: "transparent",
    fg: palette().textSecondary,
    borderless: true,
  };
}

export function StatusPill(props: StatusPillProps) {
  const isXs = () => (props.size ?? "sm") === "xs";
  const hasBorder = () => !statusColors(props.kind ?? "neutral").borderless;
  return (
    <View
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          flexShrink: 0,
          maxWidth: "100%",
          gap: isXs() ? 4.5 : 5,
          paddingHorizontal: isXs() ? 6.5 : 7.5,
          paddingVertical: isXs() ? 1 : 1.5,
          borderRadius: radii.pill,
          borderCurve: "continuous",
          borderWidth: hasBorder() ? 1 : 0,
          borderColor: hasBorder()
            ? statusColors(props.kind ?? "neutral").border
            : "transparent",
          backgroundColor: statusColors(props.kind ?? "neutral").bg,
        },
        props.style,
      ]}
    >
      <StatusDot
        size={isXs() ? 5 : 5.5}
        kind={props.kind === "neutral" ? "muted" : (props.kind ?? "muted")}
        pulse={props.pulse}
      />
      <Text
        style={{
          flexShrink: 1,
          minWidth: 0,
          color: statusColors(props.kind ?? "neutral").fg,
          fontSize: textSize(11),
          fontWeight: "500",
          fontVariant: ["tabular-nums"],
          lineHeight: textLineHeight(11, 14 / 11),
          numberOfLines: 1,
          textOverflow: "ellipsis",
        }}
      >
        {props.label}
      </Text>
    </View>
  );
}

export type AvatarStatus = "online" | "busy" | "running" | "idle" | "offline" | "error";

export interface AgentAvatarProps {
  label: string;
  emoji?: string;
  size?: number;
  status?: AvatarStatus | (string & {});
  ringColor?: string;
}

export function AgentAvatar(props: AgentAvatarProps) {
  return (
    <BotCharacter
      seed={props.label}
      size={props.size ?? 34}
      status={props.status}
      ringColor={props.ringColor}
    />
  );
}

export interface TapOptionRowProps {
  label: string;
  detail?: string;
  selected?: boolean;
  accessibilityLabel?: string;
  onPress: () => void;
}

export function TapOptionRow(props: TapOptionRowProps) {
  return (
    <View
      role="button"
      hitSlop={touchSlop(36)}
      accessibilityLabel={props.accessibilityLabel}
      accessibilityState={
        props.selected !== undefined ? { selected: Boolean(props.selected) } : undefined
      }
      onPress={props.onPress}
      style={{
        flexDirection: "row",
        alignItems: props.detail ? "flex-start" : "center",
        gap: space.sm,
        paddingHorizontal: space.md,
        paddingVertical: space.sm,
        borderRadius: radii.md,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: props.selected ? palette().accentBorder : palette().border,
        backgroundColor: props.selected ? palette().accentSoft : palette().surfaceSubtle,
        cursor: "pointer",
        userSelect: "none",
        ...pressTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{
        backgroundColor: props.selected ? palette().accentSoft : palette().panelHover,
        borderColor: props.selected ? palette().accent : palette().borderStrong,
      }}
      activeStyle={tactileActiveStyle(0.99, {
        backgroundColor: props.selected ? palette().accentSoft : palette().panelHover,
      })}
      focusVisibleStyle={focusRingStyle()}
    >
      <View style={{ flex: 1, minWidth: 0, gap: space.hair }}>
        <Text
          style={{
            color: palette().text,
            fontSize: textSize(13),
            fontWeight: props.selected ? "600" : "500",
            lineHeight: textLineHeight(13, 1.38),
          }}
        >
          {props.label}
        </Text>
        <If when={props.detail ?? ""}>
          {detailText => (
            <Text
              style={{
                color: palette().textMuted,
                fontSize: textSize(12),
                lineHeight: textLineHeight(12, 1.42),
              }}
            >
              {detailText()}
            </Text>
          )}
        </If>
      </View>
      <If when={Boolean(props.selected)}>
        <View style={{ flexShrink: 0, marginTop: props.detail ? 2 : 0 }}>
          <Icon name="check" size={14} color={palette().accent} />
        </View>
      </If>
    </View>
  );
}

export interface FloatingPillProps {
  children?: JSX.Element;
  onPress?: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

export function FloatingPill(props: FloatingPillProps) {
  return (
    <View
      role={props.onPress ? "button" : undefined}
      hitSlop={props.onPress ? touchSlop(28) : undefined}
      accessibilityLabel={props.accessibilityLabel}
      onPress={props.onPress}
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          maxWidth: "100%",
          gap: space.sm,
          paddingHorizontal: space.md,
          paddingVertical: space.xs,
          borderRadius: radii.pill,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: palette().borderStrong,
          backgroundColor: palette().popoverBg,
          boxShadow: elevationShadow(2),
          cursor: props.onPress ? "pointer" : "default",
          userSelect: props.onPress ? "none" : undefined,
          ...(props.onPress ? pressTransition(MOTION_DURATION.fast) : paintTransition(MOTION_DURATION.fast)),
        },
        props.style,
      ]}
      hoverStyle={
        props.onPress
          ? {
              borderColor: palette().borderFocus,
              backgroundColor: palette().panelHover,
            }
          : undefined
      }
      activeStyle={props.onPress ? tactileActiveStyle(0.97) : undefined}
      focusVisibleStyle={props.onPress ? focusRingStyle() : undefined}
    >
      {props.children}
    </View>
  );
}

export type IconCircleVariant = "primary" | "subtle" | "solid" | "accent" | "warm" | "ghost";

export interface IconCircleButtonProps {
  icon: IconName;
  size?: number;
  iconSize?: number;
  variant?: IconCircleVariant;
  disabled?: boolean;
  tooltip?: string | JSX.Element;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  onPress: () => void;
}

function circleBg(variant: IconCircleVariant): string {
  if (variant === "primary") return palette().actionPrimaryBg;
  if (variant === "solid") return palette().actionPrimaryBg;
  if (variant === "accent") return palette().actionSolid;
  if (variant === "warm") return palette().brandWarm;
  if (variant === "ghost") return "transparent";
  return palette().buttonSecondaryBg;
}

function circleHoverBg(variant: IconCircleVariant): string {
  if (variant === "primary") return palette().actionPrimaryHover;
  if (variant === "solid") return palette().actionPrimaryHover;
  if (variant === "accent") return palette().actionSolidHover;
  if (variant === "warm") return palette().brandWarm;
  if (variant === "ghost") return palette().surfaceSubtle;
  return palette().buttonSecondaryHover;
}

function circleBorder(variant: IconCircleVariant): string {
  if (variant === "primary") return palette().actionPrimaryBorder;
  if (variant === "solid") return palette().actionPrimaryBorder;
  if (variant === "accent") return "transparent";
  if (variant === "warm") return palette().brandWarm;
  if (variant === "ghost") return "transparent";
  return palette().border;
}

function circleIconColor(variant: IconCircleVariant): string {
  if (variant === "primary") return palette().actionPrimaryFg;
  if (variant === "solid") return palette().actionPrimaryFg;
  if (variant === "accent") return palette().actionSolidFg;
  if (variant === "warm") return palette().brandWarmFg;
  return palette().textSecondary;
}

export function IconCircleButton(props: IconCircleButtonProps) {
  return (
    <View
      role="button"
      disabled={props.disabled}
      hitSlop={touchSlop(props.size ?? 30, (props.size ?? 30) < 26 ? 4 : undefined)}
      tooltip={resolveTooltip(props.tooltip)}
      accessibilityLabel={props.accessibilityLabel}
      accessibilityState={{ disabled: Boolean(props.disabled) }}
      onPress={() => {
        if (!props.disabled) props.onPress();
      }}
      style={[
        {
          boxSizing: "border-box",
          width: props.size ?? 30,
          height: props.size ?? 30,
          flexShrink: 0,
          borderRadius: radii.pill,
          borderWidth: 1,
          borderColor: circleBorder(props.variant ?? "subtle"),
          backgroundColor: circleBg(props.variant ?? "subtle"),
          alignItems: "center",
          justifyContent: "center",
          cursor: props.disabled ? "not-allowed" : "pointer",
          userSelect: "none",
          ...pressTransition(MOTION_DURATION.fast),
        },
        props.style,
      ]}
      hoverStyle={{
        backgroundColor: circleHoverBg(props.variant ?? "subtle"),
        borderColor:
          (props.variant ?? "subtle") === "primary" ||
          (props.variant ?? "subtle") === "solid" ||
          (props.variant ?? "subtle") === "accent" ||
          (props.variant ?? "subtle") === "warm" ||
          (props.variant ?? "subtle") === "ghost"
            ? circleBorder(props.variant ?? "subtle")
            : palette().borderStrong,
        opacity: (props.variant ?? "subtle") === "warm" ? 0.92 : 1,
      }}
      activeStyle={tactileActiveStyle(0.96)}
      focusVisibleStyle={focusRingStyle()}
      disabledStyle={{ opacity: (props.variant ?? "subtle") === "primary" ? 0.34 : 0.44 }}
    >
      <Icon
        name={props.icon}
        size={props.iconSize ?? 15}
        color={circleIconColor(props.variant ?? "subtle")}
      />
    </View>
  );
}

const WORKBENCH_ITEMS: ReadonlyArray<{ id: SceneId; labelKey: MessageKey; icon: IconName }> = [
  { id: "files", labelKey: "nav.files", icon: "folder" },
  { id: "git", labelKey: "nav.git", icon: "git-branch" },
  { id: "terminal", labelKey: "nav.terminal", icon: "terminal-square" },
];

export function WorkbenchSwitcher() {
  return (
    <View
      role="tablist"
      style={{
        boxSizing: "border-box",
        height: controlHeight.md,
        flexDirection: "row",
        alignItems: "center",
        width: "fit-content",
        flexShrink: 0,
        gap: 2,
        padding: SEGMENT_PADDING,
        borderRadius: SEGMENT_OUTER_RADIUS,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: palette().borderSubtle,
        backgroundColor: palette().segmentedTrackBg,
      }}
    >
      <Each of={WORKBENCH_ITEMS} key={item => item.id}>
        {item => (
          <View
            role="tab"
            hitSlop={touchSlop(controlHeight.md)}
            accessibilityLabel={`workbench-switch-${item().id}`}
            accessibilityState={{ selected: activeScene() === item().id }}
            onPress={() => activeScene.set(item().id)}
            style={{
              boxSizing: "border-box",
              height: "100%",
              flexDirection: "row",
              alignItems: "center",
              gap: space.xs,
              paddingHorizontal: space.sm,
              paddingVertical: 0,
              borderRadius: SEGMENT_INNER_RADIUS,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor:
                activeScene() === item().id
                  ? isLightAppearance()
                    ? "transparent"
                    : palette().border
                  : "transparent",
              backgroundColor:
                activeScene() === item().id ? palette().panelRaised : "transparent",
              boxShadow:
                activeScene() === item().id && isLightAppearance()
                  ? elevationShadow(1)
                  : undefined,
              cursor: "pointer",
              userSelect: "none",
              ...pressTransition(MOTION_DURATION.fast),
            }}
            hoverStyle={{
              backgroundColor:
                activeScene() === item().id ? palette().panelRaised : palette().surfaceSubtle,
            }}
            activeStyle={tactileActiveStyle(0.98)}
            focusVisibleStyle={focusRingStyle()}
          >
            <Icon
              name={item().icon}
              size={13}
              color={activeScene() === item().id ? palette().text : palette().textMuted}
            />
            <Text
              style={{
                color: activeScene() === item().id ? palette().text : palette().textMuted,
                fontSize: textSize(12),
                fontWeight: activeScene() === item().id ? "600" : "500",
                lineHeight: textLineHeight(12, 1.24),
                numberOfLines: 1,
              }}
            >
              {tr(item().labelKey)}
            </Text>
          </View>
        )}
      </Each>
    </View>
  );
}

export interface EmptyStateCardProps {
  title: string;
  subtitle?: string;
  icon?: IconName;
  actionLabel?: string;
  onAction?: () => void;
  /** A ready-made action in place of `actionLabel` (`StudioEmpty`'s). */
  action?: JSX.Element;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * The empty state (visual spec §3): centered and never boxed. Icon 28
 * `textMuted`, 12, title 16/600, 4, body 13/20 `textSecondary` (max 360), 16,
 * one md button.
 */
export function EmptyStateCard(props: EmptyStateCardProps) {
  return (
    <View
      accessibilityLabel={props.accessibilityLabel}
      style={[
        {
          paddingHorizontal: space.xxl,
          paddingVertical: space.x3l,
          alignItems: "center",
          justifyContent: "center",
        },
        props.style,
      ]}
    >
      <If when={props.icon ?? ""}>
        {iconName => (
          <View style={{ marginBottom: space.md }}>
            <Icon name={iconName() as IconName} size={28} color={palette().textMuted} />
          </View>
        )}
      </If>
      <Text
        style={{
          color: palette().text,
          fontSize: textSize(16),
          fontWeight: "600",
          letterSpacing: textTracking(16),
          textAlign: "center",
          lineHeight: textLineHeight(16, 22 / 16),
        }}
      >
        {props.title}
      </Text>
      <If when={props.subtitle ?? ""}>
        {subtitleText => (
          <Text
            style={{
              marginTop: space.xs,
              color: palette().textSecondary,
              fontSize: textSize(13),
              textAlign: "center",
              maxWidth: 360,
              lineHeight: textLineHeight(13, 20 / 13),
            }}
          >
            {subtitleText()}
          </Text>
        )}
      </If>
      <If when={props.actionLabel && props.onAction ? props.actionLabel : ""}>
        {labelText => (
          <View style={{ marginTop: space.lg }}>
            <Button
              label={labelText()}
              variant="secondary"
              size="md"
              onPress={() => props.onAction?.()}
            />
          </View>
        )}
      </If>
      <If when={Boolean(props.action)}>
        <View style={{ marginTop: space.lg }}>{props.action}</View>
      </If>
    </View>
  );
}

export interface InlineConfirmBarProps {
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function InlineConfirmBar(props: InlineConfirmBarProps) {
  return (
    <View
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 10,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: radii.md,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: props.danger ? palette().dangerBorder : palette().warningBorder,
        backgroundColor: props.danger ? palette().dangerSoft : palette().warningSoft,
      }}
    >
      <Text
        style={{
          flex: 1,
          minWidth: 140,
          color: palette().text,
          fontSize: textSize(12),
          fontWeight: "500",
          lineHeight: textLineHeight(12, 1.42),
        }}
      >
        {props.message}
      </Text>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          flexShrink: 0,
          gap: 6,
          marginLeft: "auto",
        }}
      >
        <Button
          label={props.cancelLabel ?? tr("common.cancel")}
          variant="ghost"
          size="sm"
          onPress={props.onCancel}
        />
        <Button
          label={props.confirmLabel ?? tr("common.confirm")}
          variant={props.danger ? "danger" : "primary"}
          size="sm"
          onPress={props.onConfirm}
        />
      </View>
    </View>
  );
}

export interface InlineDeleteConfirmProps {
  /** Controlled confirming state; omit to manage state locally. */
  confirming?: boolean;
  onConfirmingChange?: (next: boolean) => void;
  /** Custom idle trigger (receives `startConfirm`); if omitted renders a danger/ghost Button or IconButton. */
  trigger?: (startConfirm: () => void) => JSX.Element;
  label?: string;
  icon?: IconName;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  tooltip?: string;
  accessibilityLabel?: string;
  confirmAccessibilityLabel?: string;
  cancelAccessibilityLabel?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
}

/**
 * In-place delete secondary confirmation: transforms the delete button at its
 * exact location into a compact "Cancel | Confirm" control without opening a
 * detached popup or banner.
 */
export function InlineDeleteConfirm(props: InlineDeleteConfirmProps) {
  const localConfirming = signal(false);
  const isConfirming = () => (props.confirming !== undefined ? props.confirming : localConfirming());
  const setConfirming = (next: boolean) => {
    if (props.confirming === undefined) localConfirming.set(next);
    props.onConfirmingChange?.(next);
  };
  const controlH = () => {
    if (compactLayout()) return layout.touchTarget;
    if (props.size === "xs") return 24;
    if (props.size === "md") return controlHeight.md;
    return controlHeight.sm;
  };
  return (
    <If
      when={isConfirming()}
      else={
        props.trigger ? (
          props.trigger(() => {
            if (!props.disabled && !props.loading) setConfirming(true);
          })
        ) : props.label ? (
          <Button
            label={props.label}
            leadingIcon={props.icon}
            variant={props.variant ?? "danger"}
            size={props.size ?? "sm"}
            disabled={props.disabled}
            loading={props.loading}
            accessibilityLabel={props.accessibilityLabel}
            onPress={() => setConfirming(true)}
          />
        ) : (
          <IconButton
            icon={props.icon ?? "trash"}
            size={props.size === "md" ? "md" : props.size === "xs" ? "xs" : "sm"}
            tone="danger"
            disabled={props.disabled}
            tooltip={props.tooltip}
            accessibilityLabel={props.accessibilityLabel}
            onPress={() => setConfirming(true)}
          />
        )
      }
    >
      <View
        accessibilityLabel={
          props.accessibilityLabel ? `${props.accessibilityLabel}-inline-confirm` : "delete-inline-confirm"
        }
        style={{
          flexDirection: "row",
          alignItems: "center",
          flexShrink: 0,
          height: controlH(),
          paddingHorizontal: 2,
          gap: 3,
          borderRadius: radii.md,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: palette().dangerBorder,
          backgroundColor: palette().dangerSoft,
        }}
      >
        <View
          role="button"
          accessibilityLabel={
            props.cancelAccessibilityLabel ??
            (props.accessibilityLabel ? `${props.accessibilityLabel}-cancel` : "delete-inline-cancel")
          }
          onPress={() => setConfirming(false)}
          style={{
            height: Math.max(20, controlH() - 6),
            paddingHorizontal: space.sm,
            borderRadius: radii.sm,
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            userSelect: "none",
            ...pressTransition(MOTION_DURATION.fast),
          }}
          hoverStyle={{ backgroundColor: palette().panelHover }}
          activeStyle={tactileActiveStyle(0.96)}
          focusVisibleStyle={{ ...focusRingStyle(), outlineOffset: -1 }}
        >
          <Text
            style={{
              color: palette().text,
              fontSize: textSize(12),
              lineHeight: textLineHeight(12, 1.2),
              fontWeight: "500",
            }}
          >
            {props.cancelLabel ?? tr("common.cancel")}
          </Text>
        </View>
        <View style={{ width: 1, height: 12, backgroundColor: palette().borderSubtle }} />
        <View
          role="button"
          accessibilityLabel={
            props.confirmAccessibilityLabel ??
            (props.accessibilityLabel ? `${props.accessibilityLabel}-confirm` : "delete-inline-confirm-ok")
          }
          onPress={() => {
            setConfirming(false);
            props.onConfirm();
          }}
          style={{
            height: Math.max(20, controlH() - 6),
            paddingHorizontal: space.sm,
            borderRadius: radii.sm,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: palette().danger,
            cursor: "pointer",
            userSelect: "none",
            ...pressTransition(MOTION_DURATION.fast),
          }}
          hoverStyle={{ opacity: 0.92 }}
          activeStyle={tactileActiveStyle(0.96)}
          focusVisibleStyle={{ ...focusRingStyle(), outlineOffset: -1 }}
        >
          <Text
            style={{
              color: palette().actionPrimaryFg,
              fontSize: textSize(12),
              lineHeight: textLineHeight(12, 1.2),
              fontWeight: "600",
            }}
          >
            {props.confirmLabel ?? tr("common.confirm")}
          </Text>
        </View>
      </View>
    </If>
  );
}

// --- Canonical Input & Search Primitives (`TextField`, `InputBox`, `SearchInput`) ---

export type InputSize = "sm" | "md" | "lg";

export interface TextFieldProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: (text: string) => void;
  onKeyPress?: (e: { key: string }) => void;
  label?: string;
  hint?: string;
  error?: string;
  placeholder?: string;
  size?: InputSize;
  /** `"soft"` uses a calm borderless filled surface (ideal inside modals). */
  variant?: "default" | "soft";
  leadingIcon?: IconName;
  trailing?: JSX.Element;
  clearable?: boolean;
  clearLabel?: string;
  multiline?: boolean;
  minHeight?: number;
  monospace?: boolean;
  masked?: boolean;
  readonly?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  /** What the field holds, for the phone keyboard and autofill: an email address or a one-time code (no autocorrect, no capitals). */
  content?: "email" | "one-time-code";
  surface?: ControlSurface;
  accessibilityLabel?: string;
  inputRef?: InputRef | ((node: InputRef) => void);
  style?: StyleProp<ViewStyle>;
}

/**
 * Canonical rounded text field aligned to `controlHeight`, with calm recessed
 * depth, hairline border, soft accent focus glow, explicit reactive text &
 * placeholder colors, optional leading icon, trailing slot, and clear action.
 */
export function TextField(props: TextFieldProps) {
  // Inside a dialog: report edits, take the first focus, and let Return run the dialog's action.
  const modalForm = ModalFormContext();
  const editable = !props.readonly && !props.disabled;
  const autoFocus = props.autoFocus
    ? (modalForm?.claimAutoFocus(), true)
    : editable && modalForm
      ? modalForm.claimAutoFocus()
      : false;
  const fieldHeight = () => {
    const base = controlHeight[props.size ?? "md"];
    return compactLayout() ? Math.max(base, 36) : base;
  };
  const inputFontSize = () => {
    const size = props.size ?? "md";
    const base = textSize(props.monospace ? 12 : size === "sm" ? 12 : size === "lg" ? 14 : 13);
    return compactLayout() ? Math.max(16, base) : base;
  };
  const isSoft = () => props.variant === "soft";
  return (
    <View style={[{ gap: space.sm, minWidth: 0 }, props.style]}>
      <If when={props.label ?? ""}>
        {labelText => (
          <Text
            style={{
              color:
                props.surface === "chrome" ? palette().chromeText : palette().textSecondary,
              fontSize: textSize((props.size ?? "md") === "lg" ? 13 : 12),
              fontWeight: "500",
              lineHeight: textLineHeight((props.size ?? "md") === "lg" ? 13 : 12, 1.35),
            }}
          >
            {labelText()}
          </Text>
        )}
      </If>
      <View
        style={{
          boxSizing: "border-box",
          height: props.multiline ? undefined : fieldHeight(),
          minHeight: props.multiline ? (props.minHeight ?? 84) : fieldHeight(),
          minWidth: 0,
          flexDirection: "row",
          alignItems: props.multiline ? "flex-start" : "center",
          gap: space.sm,
          paddingHorizontal: (props.size ?? "md") === "sm" ? space.sm : space.md,
          paddingVertical: props.multiline ? space.sm : 0,
          borderRadius: (props.size ?? "md") === "sm" ? radii.sm : radii.md,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: props.error
            ? palette().danger
            : props.surface === "chrome"
              ? palette().chromeBorder
              : isSoft()
                ? isLightAppearance()
                  ? palette().borderSubtle
                  : "transparent"
                : isLightAppearance()
                  ? palette().border
                  : palette().borderSubtle,
          backgroundColor:
            props.surface === "chrome"
              ? palette().chromeInputBg
              : isSoft()
                ? isLightAppearance()
                  ? palette().canvasSubtle
                  : palette().surfaceSubtle
                : palette().inputBg,
          opacity: props.disabled ? 0.55 : 1,
          ...paintTransition(MOTION_DURATION.fast),
        }}
        hoverStyle={
          props.disabled
            ? undefined
            : {
                borderColor: props.error
                  ? palette().danger
                  : props.surface === "chrome"
                    ? palette().chromeBorder
                    : isSoft()
                      ? palette().borderSubtle
                      : palette().border,
              }
        }
        focusWithinStyle={
          props.disabled
            ? undefined
            : {
                borderColor: props.error
                  ? palette().danger
                  : props.surface === "chrome"
                    ? palette().chromeAccent
                    : palette().borderFocus,
                boxShadow: props.error
                  ? `0 0 0 3px ${palette().dangerSoft}`
                  : `0 0 0 2px ${palette().accentSoft}`,
              }
        }
      >
        <If when={props.leadingIcon ?? ""}>
          {iconName => (
            <View style={{ flexShrink: 0, marginTop: props.multiline ? 2 : 0 }}>
              <Icon
                name={iconName() as IconName}
                size={(props.size ?? "md") === "sm" ? 13 : 14}
                color={
                  props.surface === "chrome"
                    ? palette().chromeTextMuted
                    : palette().textMuted
                }
              />
            </View>
          )}
        </If>
        <Input
          ref={props.inputRef}
          value={props.value}
          placeholder={props.placeholder}
          multiline={props.multiline}
          masked={props.masked}
          readonly={Boolean(props.readonly || props.disabled)}
          autoFocus={autoFocus}
          keyboardType={props.content === "email" ? "email-address" : props.content ? "number-pad" : undefined}
          autoCapitalize={props.content ? "none" : undefined}
          autoCorrect={props.content ? false : undefined}
          autoComplete={props.content}
          accessibilityLabel={props.accessibilityLabel ?? props.label ?? props.placeholder}
          onChange={e => {
            if (props.disabled) return;
            modalForm?.markEdited();
            props.onChange(e.value);
          }}
          onSubmit={e => {
            if (props.onSubmit) props.onSubmit(e.text);
            else if (!props.multiline && modalForm?.hasSubmit()) modalForm.submit();
          }}
          onKeyPress={props.onKeyPress}
          style={{
            flex: 1,
            minWidth: 0,
            height: props.multiline ? undefined : "100%",
            minHeight: props.multiline
              ? Math.max(48, (props.minHeight ?? 84) - 16)
              : Math.max(24, fieldHeight() - 2),
            color: props.surface === "chrome" ? palette().chromeText : palette().text,
            placeholderColor:
              props.surface === "chrome" ? palette().chromeTextMuted : palette().textMuted,
            caretColor: palette().accent,
            fontFamily: props.monospace ? fontMono : undefined,
            fontSize: inputFontSize(),
            lineHeight: props.multiline
              ? textLineHeight(props.monospace ? 12 : 13, 1.5)
              : undefined,
          }}
        />
        <If
          when={Boolean(
            props.clearable && props.value.length > 0 && !props.readonly && !props.disabled,
          )}
        >
          <IconButton
            icon="close"
            size="xs"
            iconSize={11}
            surface={props.surface}
            tooltip={props.clearLabel ?? tr("common.clear")}
            accessibilityLabel={props.clearLabel ?? tr("common.clear")}
            onPress={() => props.onChange("")}
            style={{ width: 20, height: 20 }}
          />
        </If>
        <If when={Boolean(props.trailing)}>
          <View style={{ flexDirection: "row", alignItems: "center", flexShrink: 0, gap: 4 }}>
            {props.trailing}
          </View>
        </If>
      </View>
      <If when={props.error ?? ""}>
        {errText => (
          <Text
            style={{
              color: palette().danger,
              fontSize: textSize(12),
              lineHeight: textLineHeight(12, 1.4),
            }}
          >
            {errText()}
          </Text>
        )}
      </If>
      <If when={!props.error && (props.hint ?? "") ? props.hint! : ""}>
        {hintText => (
          <Text
            style={{
              color: palette().textMuted,
              fontSize: textSize(12),
              lineHeight: textLineHeight(12, 1.4),
            }}
          >
            {hintText()}
          </Text>
        )}
      </If>
    </View>
  );
}

export type InputBoxProps = TextFieldProps;

/**
 * Canonical shared input primitive (alias for `TextField`) giving every scene
 * consistent height, hairline framing, focus glow, and optional leading/trailing
 * affordances without hand-rolling raw `<Input>` boxes.
 */
export function InputBox(props: InputBoxProps) {
  return <TextField {...props} />;
}

export interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: (text: string) => void;
  onKeyPress?: (e: { key: string }) => void;
  placeholder?: string;
  shortcut?: string;
  countLabel?: string;
  clearLabel?: string;
  size?: InputSize;
  pill?: boolean;
  surface?: ControlSurface;
  autoFocus?: boolean;
  accessibilityLabel?: string;
  inputRef?: InputRef | ((node: InputRef) => void);
  style?: StyleProp<ViewStyle>;
}

/**
 * Compact desktop search field aligned to `controlHeight`, with leading search
 * glyph, explicit reactive `<Input>` color, inline clear action, and optional
 * shortcut/match counter.
 */
export function SearchInput(props: SearchInputProps) {
  const fieldHeight = () => {
    const base = controlHeight[props.size ?? "md"];
    return compactLayout() ? Math.max(base, 36) : base;
  };
  const inputFontSize = () => {
    const base = textSize((props.size ?? "md") === "sm" ? 12 : 13);
    return compactLayout() ? Math.max(16, base) : base;
  };
  return (
    <View
      style={[
        {
          boxSizing: "border-box",
          height: fieldHeight(),
          minHeight: fieldHeight(),
          minWidth: 0,
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          paddingHorizontal: space.md,
          paddingVertical: 0,
          borderRadius: props.pill ? radii.pill : (props.size ?? "md") === "sm" ? radii.sm : radii.md,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor:
            props.surface === "chrome"
              ? palette().chromeBorder
              : isLightAppearance()
                ? palette().border
                : palette().borderSubtle,
          backgroundColor:
            props.surface === "chrome" ? palette().chromeInputBg : palette().inputBg,
          ...paintTransition(MOTION_DURATION.fast),
        },
        props.style,
      ]}
      hoverStyle={{
        borderColor:
          props.surface === "chrome" ? palette().chromeBorder : palette().border,
      }}
      focusWithinStyle={{
        borderColor:
          props.surface === "chrome" ? palette().chromeAccent : palette().borderFocus,
        boxShadow: `0 0 0 2px ${palette().accentSoft}`,
      }}
    >
      <Icon
        name="search"
        size={13}
        color={
          props.surface === "chrome" ? palette().chromeTextMuted : palette().textMuted
        }
      />
      <Input
        ref={props.inputRef}
        value={props.value}
        placeholder={props.placeholder ?? `${tr("common.search")}…`}
        autoFocus={props.autoFocus}
        accessibilityLabel={props.accessibilityLabel ?? props.placeholder ?? tr("common.search")}
        onChange={e => props.onChange(e.value)}
        onSubmit={e => props.onSubmit?.(e.text)}
        onKeyPress={props.onKeyPress}
        style={{
          flex: 1,
          minWidth: 0,
          height: "100%",
          minHeight: Math.max(24, fieldHeight() - 2),
          color: props.surface === "chrome" ? palette().chromeText : palette().text,
          placeholderColor:
            props.surface === "chrome" ? palette().chromeTextMuted : palette().textMuted,
          caretColor: palette().accent,
          fontSize: inputFontSize(),
        }}
      />
      <If when={props.countLabel ?? ""}>
        {count => (
          <Text
            style={{
              flexShrink: 0,
              color:
                props.surface === "chrome"
                  ? palette().chromeTextMuted
                  : palette().textMuted,
              fontSize: textSize(11),
              fontWeight: "500",
              fontVariant: ["tabular-nums"],
              lineHeight: textLineHeight(11, 1.3),
            }}
          >
            {count()}
          </Text>
        )}
      </If>
      <If when={props.value.length > 0}>
        <IconButton
          icon="close"
          size="xs"
          iconSize={11}
          surface={props.surface}
          tooltip={props.clearLabel ?? tr("common.clearSearch")}
          accessibilityLabel={props.clearLabel ?? tr("common.clearSearch")}
          onPress={() => props.onChange("")}
          style={{ width: 20, height: 20 }}
        />
      </If>
      <If when={props.value.length === 0 && (props.shortcut ?? "") ? props.shortcut! : ""}>
        {keys => <KbdHint keys={keys()} surface={props.surface} />}
      </If>
    </View>
  );
}

export interface SceneHeaderProps {
  title: string;
  subtitle?: string;
  icon?: IconName;
  badge?: string;
  leading?: JSX.Element;
  trailing?: JSX.Element;
  compact?: boolean;
  borderBottom?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * Standardized scene header always grounded on `palette().canvas` (never
 * `palette().panel`), guaranteeing readable contrast across all 9 presets
 * including split-polarity Monochrome.
 */
export function SceneHeader(props: SceneHeaderProps) {
  return (
    <View
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          gap: space.md,
          paddingHorizontal: props.compact ? space.md : space.xl,
          paddingVertical: props.compact ? space.sm : space.lg,
          backgroundColor: palette().canvas,
          borderBottomWidth: props.borderBottom ? 1 : 0,
          borderColor: palette().borderSubtle,
        },
        props.style,
      ]}
    >
      <If when={Boolean(props.leading)}>
        <View style={{ flexShrink: 0 }}>{props.leading}</View>
      </If>
      <If when={props.icon ?? ""}>
        {iconName => (
          <View style={{ flexShrink: 0, alignItems: "center", justifyContent: "center" }}>
            <Icon
              name={iconName() as IconName}
              size={props.compact ? 16 : 20}
              color={palette().textSecondary}
            />
          </View>
        )}
      </If>
      <View style={{ flex: 1, minWidth: 0, gap: space.xs }}>
        <View style={{ flexDirection: "row", alignItems: "center", minWidth: 0, gap: space.sm }}>
          <Text
            style={{
              flexShrink: 1,
              minWidth: 0,
              color: palette().text,
              fontSize: textSize(props.compact ? 16 : 22),
              fontWeight: "600",
              letterSpacing: textTracking(props.compact ? 16 : 22),
              lineHeight: textLineHeight(props.compact ? 16 : 22, 1.22),
              numberOfLines: 1,
              textOverflow: "ellipsis",
            }}
          >
            {props.title}
          </Text>
          <If when={props.badge ?? ""}>
            {label => <Badge label={label()} tone="neutral" />}
          </If>
        </View>
        <If when={props.subtitle ?? ""}>
          {sub => (
            <Text
              style={{
                color: palette().textMuted,
                fontSize: textSize(13),
                maxWidth: 620,
                lineHeight: textLineHeight(13, 1.44),
                numberOfLines: 2,
                textOverflow: "ellipsis",
              }}
            >
              {sub()}
            </Text>
          )}
        </If>
      </View>
      <If when={Boolean(props.trailing)}>
        <View style={{ flexDirection: "row", alignItems: "center", flexShrink: 0, gap: 8 }}>
          {props.trailing}
        </View>
      </If>
    </View>
  );
}

export type InlineBannerTone = "info" | "success" | "warning" | "danger" | "neutral";

export interface InlineBannerProps {
  tone?: InlineBannerTone;
  title?: string;
  message: string;
  icon?: IconName;
  /** Optional custom trailing CTA slot aligned cleanly to the right (e.g. Sign In button). */
  action?: JSX.Element;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss?: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

function bannerStyleTokens(tone: InlineBannerTone): {
  bg: string;
  border: string;
  fg: string;
  defaultIcon: IconName;
} {
  if (tone === "danger") {
    return {
      bg: palette().dangerSoft,
      border: palette().dangerBorder,
      fg: palette().danger,
      defaultIcon: "alert-circle",
    };
  }
  if (tone === "warning") {
    return {
      bg: palette().warningSoft,
      border: palette().warningBorder,
      fg: palette().warning,
      defaultIcon: "warning",
    };
  }
  if (tone === "success") {
    return {
      bg: palette().successSoft,
      border: palette().successBorder,
      fg: palette().success,
      defaultIcon: "check-circle",
    };
  }
  if (tone === "info") {
    return {
      bg: palette().accentSoft,
      border: palette().accentBorder,
      fg: palette().accent,
      defaultIcon: "info",
    };
  }
  return {
    bg: palette().surfaceTertiary,
    border: palette().border,
    fg: palette().textSecondary,
    defaultIcon: "info",
  };
}

/**
 * Dismissible semantic inline banner for error alerts, warnings, and notices.
 */
export function InlineBanner(props: InlineBannerProps) {
  return (
    <View
      role="alert"
      accessibilityLabel={props.accessibilityLabel}
      style={[
        {
          flexDirection: "row",
          alignItems: props.title ? "flex-start" : "center",
          gap: 10,
          paddingHorizontal: 14,
          paddingVertical: 10,
          borderRadius: radii.md,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: bannerStyleTokens(props.tone ?? "info").border,
          backgroundColor: bannerStyleTokens(props.tone ?? "info").bg,
        },
        props.style,
      ]}
    >
      <View
        style={{
          flexShrink: 0,
          height: textLineHeight(13, 1.38),
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon
          name={props.icon ?? bannerStyleTokens(props.tone ?? "info").defaultIcon}
          size={15}
          color={bannerStyleTokens(props.tone ?? "info").fg}
        />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <If when={props.title ?? ""}>
          {t => (
            <Text
              style={{
                color: palette().text,
                fontSize: textSize(13),
                fontWeight: "600",
                lineHeight: textLineHeight(13, 1.38),
              }}
            >
              {t()}
            </Text>
          )}
        </If>
        <Text
          style={{
            color: props.title ? palette().textSecondary : palette().text,
            fontSize: textSize(props.title ? 12 : 13),
            lineHeight: textLineHeight(props.title ? 12 : 13, 1.44),
          }}
        >
          {props.message}
        </Text>
      </View>
      <If
        when={Boolean(
          props.action ||
            (props.actionLabel && props.onAction) ||
            props.onDismiss,
        )}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            alignSelf: "center",
            flexShrink: 0,
            gap: 8,
          }}
        >
          <If when={Boolean(props.action)}>{props.action}</If>
          <If when={props.actionLabel && props.onAction ? props.actionLabel : ""}>
            {label => (
              <Button
                label={label()}
                size="xs"
                variant="secondary"
                onPress={() => props.onAction?.()}
              />
            )}
          </If>
          <If when={Boolean(props.onDismiss)}>
            <IconButton
              icon="close"
              size="xs"
              iconSize={12}
              tooltip={tr("common.dismiss")}
              accessibilityLabel={tr("common.dismissNotice")}
              onPress={() => props.onDismiss?.()}
            />
          </If>
        </View>
      </If>
    </View>
  );
}

export interface SkeletonBlockProps {
  width?: ViewStyle["width"];
  height?: number;
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
}

/** Static calm loading placeholder (visual spec §2.6: no infinite shimmer/pulse). */
export function SkeletonBlock(props: SkeletonBlockProps) {
  return (
    <View
      style={[
        {
          width: props.width ?? "100%",
          height: props.height ?? 14,
          borderRadius: props.borderRadius ?? radii.xs,
          borderCurve: "continuous",
          backgroundColor: palette().skeletonBg,
        },
        props.style,
      ]}
    />
  );
}

export interface KpiCellProps {
  label: string;
  value: string | number;
  detail?: string;
  icon?: IconName;
  tone?: SemanticTone;
  /** Renders muted calmer typography for unavailable / sentinel values. */
  valueMuted?: boolean;
  borderLeft?: boolean;
  align?: "start" | "center";
  valueFirst?: boolean;
  style?: StyleProp<ViewStyle>;
}

function kpiValueColor(tone?: SemanticTone, muted?: boolean): string {
  if (muted) return palette().textMuted;
  if (tone === "accent") return palette().accent;
  if (tone === "success") return palette().success;
  if (tone === "warning") return palette().warning;
  if (tone === "danger") return palette().danger;
  return palette().text;
}

function KpiLabelRow(props: { label: string; icon?: IconName; centered: boolean }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: props.centered ? "center" : "flex-start",
        gap: 5,
        minWidth: 0,
        maxWidth: "100%",
      }}
    >
      <If when={props.icon ?? ""}>
        {iconName => (
          <View style={{ flexShrink: 0 }}>
            <Icon name={iconName() as IconName} size={12} color={palette().textMuted} />
          </View>
        )}
      </If>
      <Text
        style={{
          flex: props.centered ? undefined : 1,
          flexShrink: 1,
          minWidth: 0,
          maxWidth: "100%",
          color: palette().textMuted,
          fontSize: textSize(11),
          fontWeight: "500",
          lineHeight: textLineHeight(11, 1.35),
          textAlign: props.centered ? "center" : "left",
          numberOfLines: 1,
          textOverflow: "ellipsis",
        }}
      >
        {props.label}
      </Text>
    </View>
  );
}

function KpiValueText(props: {
  value: string | number;
  tone?: SemanticTone;
  muted?: boolean;
  centered: boolean;
}) {
  return (
    <Text
      adjustsFontSizeToFit
      minimumFontScale={0.72}
      style={{
        maxWidth: "100%",
        color: kpiValueColor(props.tone, props.muted),
        fontSize: textSize(props.muted ? 14 : 22),
        fontWeight: props.muted ? "500" : "600",
        letterSpacing: props.muted ? 0 : textTracking(22),
        fontVariant: ["tabular-nums"],
        lineHeight: textLineHeight(props.muted ? 14 : 22, 1.2),
        textAlign: props.centered ? "center" : "left",
        numberOfLines: 1,
      }}
    >
      {String(props.value)}
    </Text>
  );
}

/**
 * Calm tabular-numerals KPI telemetry cell matching `src/web-ui`'s
 * PersonalOverview 5-column metric strip. Uses native `adjustsFontSizeToFit` so
 * numbers shrink gracefully instead of ellipsizing on narrow panes or large font scales.
 */
export function KpiCell(props: KpiCellProps) {
  return (
    <View
      style={[
        {
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          alignItems: props.align === "center" ? "center" : "stretch",
          paddingHorizontal: space.md,
          paddingVertical: space.md,
          gap: space.xs,
          borderLeftWidth: props.borderLeft ? 1 : 0,
          borderColor: palette().borderSubtle,
        },
        props.style,
      ]}
    >
      <If
        when={Boolean(props.valueFirst)}
        else={
          <KpiLabelRow
            label={props.label}
            icon={props.icon}
            centered={props.align === "center"}
          />
        }
      >
        <KpiValueText
          value={props.value}
          tone={props.tone}
          muted={props.valueMuted}
          centered={props.align === "center"}
        />
      </If>
      <If
        when={Boolean(props.valueFirst)}
        else={
          <KpiValueText
            value={props.value}
            tone={props.tone}
            muted={props.valueMuted}
            centered={props.align === "center"}
          />
        }
      >
        <KpiLabelRow
          label={props.label}
          icon={props.icon}
          centered={props.align === "center"}
        />
      </If>
      <If when={props.detail ?? ""}>
        {detail => (
          <Text
            style={{
              maxWidth: "100%",
              color: palette().textMuted,
              fontSize: textSize(11),
              fontVariant: ["tabular-nums"],
              lineHeight: textLineHeight(11, 1.35),
              textAlign: props.align === "center" ? "center" : "left",
              numberOfLines: 1,
              textOverflow: "ellipsis",
            }}
          >
            {detail()}
          </Text>
        )}
      </If>
    </View>
  );
}

export type DeviceKind =
  | "laptop"
  | "desktop"
  | "server"
  | "container"
  | "mobile"
  | "cloud"
  | "remote";

export interface DeviceGlyphProps {
  kind?: DeviceKind | (string & {});
  /** 16 (rows, badges) or 20 (phone bars, the device page header); other values snap to the nearer one. */
  size?: number;
  /** Overrides `textSecondary`. */
  color?: string;
  /** @deprecated Ignored: a device glyph draws no status (visual spec §3). Use a `StateMark` beside it. */
  status?: string;
  /** @deprecated Ignored: a device is never a selected tile. */
  active?: boolean;
  /** @deprecated Ignored: there is no status ring. */
  ringColor?: string;
}

/**
 * The lucide glyph of a device's form factor (visual spec §2.5): `laptop`
 * (laptops, macOS clients, the default), `monitor` (desktops), `server` (CLI,
 * headless), `container`, `smartphone` (phones), `globe` (browsers). It reads
 * whatever kind the caller has (a form factor, a `hostKind`, an OS name) and
 * only picks a glyph; it never decides a state.
 */
export function deviceGlyphIcon(kind?: string): IconName {
  const k = (kind ?? "").trim().toLowerCase();
  if (k === "cli" || k.includes("server") || k.includes("ssh") || k.includes("linux") || k.includes("build") || k.includes("headless")) {
    return "server";
  }
  if (k.includes("docker") || k.includes("container")) return "container";
  if (k.includes("mobile") || k.includes("phone") || k.includes("ios") || k.includes("android") || k.includes("harmony")) {
    return "smartphone";
  }
  if (k.includes("browser") || k === "web") return "globe";
  if (k.includes("cloud") || k.includes("relay")) return "cloud";
  if (k.includes("desktop") || k.includes("workstation") || k.includes("monitor") || k.includes("tower")) {
    return "monitor";
  }
  return "laptop";
}

/**
 * A device's form factor as a plain lucide glyph, 16 or 20, `textSecondary`:
 * no tile, no border, no status overlay. Devices are labels, not places.
 */
export function DeviceGlyph(props: DeviceGlyphProps) {
  const size = () => ((props.size ?? 16) >= 18 ? 20 : 16);
  return (
    <View
      style={{
        width: size(),
        height: size(),
        flexShrink: 0,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Icon name={deviceGlyphIcon(props.kind)} size={size()} color={props.color ?? palette().textSecondary} />
    </View>
  );
}
