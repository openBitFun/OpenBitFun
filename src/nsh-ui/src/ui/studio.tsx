// Shared building blocks for the studio scenes (Home, Assistants, Agents,
// Skills, Routines, Spaces, Devices) in the calm, Apple-like visual language:
// a 720 px column, a 26/600 large title with at most one primary action,
// 13/600 sentence-case section headers, inset grouped lists for list-like
// content, flat gallery cards only where items are visual, and a boxless
// empty state. Every palette / text-size read stays inside JSX bindings or
// Canvas `draw`.

import {
  Canvas,
  horizontalSizeClass,
  Path2D,
  signal,
  untracked,
  Text,
  View,
  type Bounds,
  type JSX,
  type StyleProp,
  type ViewRef,
  type ViewStyle,
} from "nsh";
import {
  compactLayout,
  palette,
  radii,
  space,
  textLineHeight,
  textSize,
  textTracking,
  typeScale,
} from "../theme";
import { Icon, type IconName } from "./icons";
import { MOTION_DURATION, paintTransition, pressTransition, tactileActiveStyle } from "./motion";
import { DropdownMenu, type DropdownMenuItem } from "./overlays";
import { EmptyStateCard, IconButton, focusRingStyle } from "./primitives";
import { encodeQr, type QrMatrix } from "./qr";

/** The studio content column (design spec: 720). */
export const STUDIO_CONTENT_MAX = 720;
export const STUDIO_GUTTER = space.xxl;
/** Vertical rhythm between sections on a studio page. */
export const STUDIO_SECTION_GAP = space.xxl;
/** Below this laid-out scene width a studio page switches to its compact (phone) layout. */
export const STUDIO_COMPACT_WIDTH = 600;

// The studio scene's own laid-out width (not the platform, not the window: the
// navigation panel and the aux pane take part of the window on desktop).
const studioWidth = signal(0);

/** `onLayout` handler for a studio scene root; feeds `studioCompact()`. */
export function trackStudioWidth(event: { bounds: Bounds }): void {
  const width = Math.round(event.bounds.size.width);
  if (width > 0 && width !== untracked(() => studioWidth())) studioWidth.set(width);
}

/** True when on compact shell (<720) or when the studio scene itself is narrower than 600 pt. */
export function studioCompact(): boolean {
  if (compactLayout()) return true;
  const width = studioWidth();
  if (width > 0) return width < STUDIO_COMPACT_WIDTH;
  return horizontalSizeClass() === "compact";
}

/** Page horizontal padding: 32 regular, 16 compact. */
export function studioGutter(): number {
  return studioCompact() ? space.lg : STUDIO_GUTTER;
}

/** Page title size on the canonical type scale (visual spec §2.1: 22/600). */
export function studioTitleSize(): number {
  return typeScale.pageTitle;
}

/** Gallery columns: `minmax(min, 1fr)` auto-fill regular, one column compact. */
export function studioGridColumns(minColumn = 300): string {
  return studioCompact() ? "minmax(0, 1fr)" : `repeat(auto-fill, minmax(${minColumn}px, 1fr))`;
}

/** Minimum touch target height for interactive rows in the compact layout. */
export const STUDIO_TOUCH_MIN = 44;

export interface StudioHeaderProps {
  title: string;
  subtitle?: string;
  leading?: JSX.Element;
  actions?: JSX.Element;
  extra?: JSX.Element;
}

/** Large title 26/600, optional one-line 14 px subtitle, trailing actions. */
export function StudioHeader(props: StudioHeaderProps) {
  return (
    <View
      style={{
        width: "100%",
        maxWidth: STUDIO_CONTENT_MAX + studioGutter() * 2,
        alignSelf: "center",
        paddingTop: studioCompact() ? space.lg : space.xl,
        paddingHorizontal: studioGutter(),
        paddingBottom: studioCompact() ? space.lg : space.xl,
        gap: space.lg,
        backgroundColor: palette().canvas,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          flexWrap: studioCompact() ? "wrap" : "nowrap",
          gap: 12,
        }}
      >
        <If when={Boolean(props.leading)}>
          <View style={{ flexShrink: 0, alignItems: "center" }}>{props.leading}</View>
        </If>
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <Text
            role="header"
            style={{
              color: palette().text,
              fontSize: textSize(studioTitleSize()),
              fontWeight: "600",
              letterSpacing: textTracking(studioTitleSize()),
              lineHeight: textLineHeight(studioTitleSize(), 1.2),
              numberOfLines: 1,
              textOverflow: "ellipsis",
            }}
          >
            {props.title}
          </Text>
          <If when={props.subtitle ?? ""}>
            {sub => (
              <Text
                style={{
                  color: palette().textSecondary,
                  fontSize: textSize(14),
                  lineHeight: textLineHeight(14, 1.45),
                  numberOfLines: 1,
                  textOverflow: "ellipsis",
                }}
              >
                {sub()}
              </Text>
            )}
          </If>
        </View>
        <If when={Boolean(props.actions)}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 }}>
            {props.actions}
          </View>
        </If>
      </View>
      <If when={Boolean(props.extra)}>
        <View>{props.extra}</View>
      </If>
    </View>
  );
}

/** The page body column under a StudioHeader. */
export function StudioBody(props: { children?: JSX.Element; style?: StyleProp<ViewStyle> }) {
  return (
    <View
      style={[
        {
          width: "100%",
          maxWidth: STUDIO_CONTENT_MAX + studioGutter() * 2,
          alignSelf: "center",
          paddingHorizontal: studioGutter(),
          paddingTop: 0,
          paddingBottom: 48,
          gap: studioCompact() ? 28 : STUDIO_SECTION_GAP,
        },
        props.style,
      ]}
    >
      {props.children}
    </View>
  );
}

export interface StudioSectionProps {
  title?: string;
  /** Trailing quiet control(s) on the header line (ghost buttons, a "+" or "…"). */
  trailing?: JSX.Element;
  /** One muted line under the section content (a footnote, not a subtitle). */
  footnote?: string;
  accessibilityLabel?: string;
  children?: JSX.Element;
  style?: StyleProp<ViewStyle>;
}

/** A plain section on the canvas: a 13/600 sentence-case header, then content. */
export function StudioSection(props: StudioSectionProps) {
  return (
    <View accessibilityLabel={props.accessibilityLabel} style={[{ minWidth: 0 }, props.style]}>
      <If when={Boolean(props.title) || Boolean(props.trailing)}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            minHeight: 24,
            marginBottom: 8,
            paddingHorizontal: 4,
          }}
        >
          <Text
            role="header"
            style={{
              flex: 1,
              minWidth: 0,
              color: palette().textSecondary,
              fontSize: textSize(13),
              fontWeight: "600",
              lineHeight: textLineHeight(13, 1.35),
              numberOfLines: 1,
              textOverflow: "ellipsis",
            }}
          >
            {props.title ?? ""}
          </Text>
          <If when={Boolean(props.trailing)}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0 }}>
              {props.trailing}
            </View>
          </If>
        </View>
      </If>
      {props.children}
      <If when={props.footnote ?? ""}>
        {note => (
          <Text
            style={{
              marginTop: 8,
              paddingHorizontal: 4,
              color: palette().textMuted,
              fontSize: textSize(12),
              lineHeight: textLineHeight(12, 1.45),
            }}
          >
            {note()}
          </Text>
        )}
      </If>
    </View>
  );
}

/** Inset grouped list container: radius 12, panelRaised, one hairline. */
export function InsetGroup(props: {
  children?: JSX.Element;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      accessibilityLabel={props.accessibilityLabel}
      style={[
        {
          borderRadius: radii.lg,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: palette().borderSubtle,
          backgroundColor: palette().panelRaised,
          boxShadow: `${palette().shadowCard}, ${palette().innerHighlight}`,
          overflow: "hidden",
          minWidth: 0,
        },
        props.style,
      ]}
    >
      {props.children}
    </View>
  );
}

export interface InsetRowProps {
  label: string;
  /** Optional second line (13 px secondary text) under the label. */
  detail?: string;
  /** Trailing value (13 px secondary), e.g. a count. */
  value?: string;
  /** Leading icon (16 px, muted). */
  icon?: IconName;
  /** Leading custom element (avatar, status dot); wins over `icon`. */
  leading?: JSX.Element;
  /** Trailing controls, drawn before the value / chevron. */
  trailing?: JSX.Element;
  /** Content under the label line (e.g. a compact sub-list or chips). */
  below?: JSX.Element;
  /** Hide the top separator (the first row of a group). */
  first?: boolean;
  /** Indent the label (a sub-row under a parent row). */
  indent?: boolean;
  selected?: boolean;
  disabled?: boolean;
  tone?: "default" | "danger" | "muted";
  /** Shows a chevron when the row navigates. */
  chevron?: boolean;
  accessibilityLabel?: string;
  onPress?: () => void;
}

function insetRowLabelLineHeight(): number {
  return textLineHeight(14, 1.35);
}

/** One row of an inset grouped list: min height 44, 0x16 padding, inset hairline. */
export function InsetRow(props: InsetRowProps) {
  const pressable = () => Boolean(props.onPress) && !props.disabled;
  return (
    <View
      role={props.onPress ? "button" : undefined}
      accessibilityLabel={props.accessibilityLabel}
      accessibilityState={props.onPress ? { disabled: Boolean(props.disabled), selected: Boolean(props.selected) } : undefined}
      disabled={props.onPress ? Boolean(props.disabled) : undefined}
      onPress={props.onPress ? () => { if (pressable()) props.onPress!(); } : undefined}
      style={{
        position: "relative",
        minHeight: STUDIO_TOUCH_MIN,
        paddingLeft: props.indent ? 44 : space.lg,
        paddingRight: space.md,
        paddingVertical: space.sm,
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        minWidth: 0,
        backgroundColor: props.selected ? palette().panelHover : "transparent",
        cursor: pressable() ? "pointer" : undefined,
        userSelect: pressable() ? "none" : undefined,
        opacity: props.disabled ? 0.5 : 1,
        ...(pressable() ? pressTransition(MOTION_DURATION.fast) : paintTransition(MOTION_DURATION.fast)),
      }}
      hoverStyle={pressable() && !compactLayout() ? { backgroundColor: palette().panelHover } : undefined}
      activeStyle={pressable() ? tactileActiveStyle(0.985) : undefined}
      focusVisibleStyle={pressable() ? { ...focusRingStyle(), outlineOffset: -2 } : undefined}
    >
      <If when={!props.first}>
        <View
          style={{
            position: "absolute",
            top: 0,
            left: props.indent ? 44 : space.lg,
            right: 0,
            height: 1,
            backgroundColor: palette().borderSubtle,
            pointerEvents: "none",
          }}
        />
      </If>
      {/* The glyph sits on the label line; the detail hangs under the label. */}
      <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "flex-start", gap: space.md }}>
        <If when={Boolean(props.leading)} else={
          <If when={props.icon ?? ""}>
            {name => (
              <View style={{ height: insetRowLabelLineHeight(), flexShrink: 0, alignItems: "center", justifyContent: "center" }}>
                <Icon
                  name={name() as IconName}
                  size={16}
                  color={palette().textMuted}
                />
              </View>
            )}
          </If>
        }>
          <View style={{ minHeight: insetRowLabelLineHeight(), flexShrink: 0, alignItems: "center", justifyContent: "center" }}>
            {props.leading}
          </View>
        </If>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text
            style={{
              color:
                props.tone === "danger"
                  ? palette().danger
                  : props.tone === "muted"
                    ? palette().textSecondary
                    : palette().text,
              fontSize: textSize(14),
              fontWeight: "400",
              lineHeight: insetRowLabelLineHeight(),
              numberOfLines: 1,
              textOverflow: "ellipsis",
            }}
          >
            {props.label}
          </Text>
          <If when={props.detail ?? ""}>
            {detail => (
              <Text
                style={{
                  color: palette().textMuted,
                  fontSize: textSize(12),
                  lineHeight: textLineHeight(12, 1.4),
                  numberOfLines: 1,
                  textOverflow: "ellipsis",
                }}
              >
                {detail()}
              </Text>
            )}
          </If>
          <If when={Boolean(props.below)}>
            <View style={{ paddingTop: 4, minWidth: 0 }}>{props.below}</View>
          </If>
        </View>
      </View>
      <If when={Boolean(props.trailing)}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0 }}>
          {props.trailing}
        </View>
      </If>
      <If when={props.value ?? ""}>
        {value => (
          <Text
            style={{
              flexShrink: 0,
              maxWidth: 220,
              color: palette().textSecondary,
              fontSize: textSize(13),
              lineHeight: textLineHeight(13, 1.35),
              fontVariant: ["tabular-nums"],
              numberOfLines: 1,
              textOverflow: "ellipsis",
            }}
          >
            {value()}
          </Text>
        )}
      </If>
      <If when={Boolean(props.chevron)}>
        <Icon name="chevron-right" size={12} color={palette().textMuted} />
      </If>
    </View>
  );
}

/** Filter (segmented control) + search on one quiet line under the title. */
export function StudioToolbar(props: { leading?: JSX.Element; trailing?: JSX.Element }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap", minWidth: 0 }}>
      <If when={Boolean(props.leading)}>
        <View style={{ flexShrink: 0 }}>{props.leading}</View>
      </If>
      <View style={{ flex: 1, minWidth: 0 }} />
      <If when={Boolean(props.trailing)}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1, minWidth: 0 }}>
          {props.trailing}
        </View>
      </If>
    </View>
  );
}

export interface MoreMenuProps {
  items: ReadonlyArray<DropdownMenuItem>;
  accessibilityLabel: string;
  tooltip?: string;
  icon?: IconName;
  size?: "xs" | "sm";
  minWidth?: number;
  disabled?: boolean;
}

/** A quiet "…" IconButton that opens a DropdownMenu of secondary actions. */
export function MoreMenu(props: MoreMenuProps) {
  const open = signal(false);
  const anchor = signal<ViewRef | null>(null);
  return (
    <View ref={el => anchor.set(el)} style={{ flexShrink: 0 }}>
      <IconButton
        icon={props.icon ?? "more"}
        size={props.size ?? "sm"}
        active={open()}
        disabled={props.disabled}
        tooltip={props.tooltip}
        accessibilityLabel={props.accessibilityLabel}
        onPress={() => open.update(value => !value)}
      />
      <If when={open()}>
        <DropdownMenu
          open={true}
          anchor={anchor()}
          align="end"
          minWidth={props.minWidth ?? 196}
          items={props.items}
          onClose={() => open.set(false)}
        />
      </If>
    </View>
  );
}

export interface GalleryGridProps {
  children?: JSX.Element;
  minColumn?: number;
  gap?: number;
  style?: StyleProp<ViewStyle>;
}

/** `repeat(auto-fill, minmax(300px, 1fr))` with a 12 px gap. */
export function GalleryGrid(props: GalleryGridProps) {
  return (
    <View
      style={[
        {
          display: "grid",
          gridTemplateColumns: studioGridColumns(props.minColumn ?? 300),
          gap: props.gap ?? 12,
          alignContent: "start",
        },
        props.style,
      ]}
    >
      {props.children}
    </View>
  );
}

/** Flat gallery card surface: no shadow, radius 12, padding 16, one hairline. */
export function galleryCardStyle(): ViewStyle {
  return {
    borderRadius: radii.lg,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: palette().borderSubtle,
    backgroundColor: palette().panelRaised,
    padding: space.lg,
    gap: space.md,
    minWidth: 0,
  };
}

export function galleryCardHoverStyle(): ViewStyle {
  return { backgroundColor: palette().panelHover };
}

/** Static calm skeleton cards in the gallery grid (visual spec §2.6: no infinite shimmer/pulse). */
export function GallerySkeleton(props: { count?: number; height?: number; minColumn?: number }) {
  const items = Array.from({ length: props.count ?? 4 }, (_, index) => index);
  return (
    <View
      accessibilityLabel="gallery-skeleton"
      style={{
        display: "grid",
        gridTemplateColumns: studioGridColumns(props.minColumn ?? 300),
        gap: space.md,
        pointerEvents: "none",
      }}
    >
      <Each of={items}>
        {() => (
          <View
            style={{
              height: props.height ?? 120,
              borderRadius: radii.lg,
              borderCurve: "continuous",
              backgroundColor: palette().skeletonBg,
            }}
          />
        )}
      </Each>
    </View>
  );
}

export interface StudioEmptyProps {
  icon: IconName;
  message: string;
  detail?: string;
  tone?: "neutral" | "danger";
  action?: JSX.Element;
  accessibilityLabel?: string;
}

/** The empty state of visual spec §3: it renders `EmptyStateCard` (icon 28, title 16/600, one line, one button). */
export function StudioEmpty(props: StudioEmptyProps) {
  return (
    <EmptyStateCard
      accessibilityLabel={props.accessibilityLabel}
      icon={props.icon}
      title={props.message}
      subtitle={props.detail}
      action={props.action}
    />
  );
}

export interface QrCodeViewProps {
  value: string;
  /** Edge length in points, quiet zone included (the desktop draws 180). */
  size?: number;
  accessibilityLabel?: string;
}

/**
 * A QR code (byte mode, level M, 4-module quiet zone) drawn on a Canvas.
 * Always dark modules on white so phone cameras read it in every appearance.
 */
export function QrCodeView(props: QrCodeViewProps) {
  let cachedValue = "";
  let cached: QrMatrix | null = null;
  const matrix = (): QrMatrix | null => {
    const value = props.value;
    if (value !== cachedValue) {
      cachedValue = value;
      try {
        cached = value ? encodeQr(value) : null;
      } catch {
        cached = null;
      }
    }
    return cached;
  };
  return (
    <Canvas
      accessibilityLabel={props.accessibilityLabel ?? "pairing-qr"}
      role="image"
      style={{
        width: props.size ?? 180,
        height: props.size ?? 180,
        flexShrink: 0,
        borderRadius: radii.md,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: palette().borderSubtle,
        overflow: "hidden",
      }}
      draw={(cx, size) => {
        if (size.width <= 0 || size.height <= 0) return;
        cx.fillStyle = "#ffffff";
        cx.fillRect(0, 0, size.width, size.height);
        const qr = matrix();
        if (!qr) return;
        const margin = 4;
        const cells = qr.size + margin * 2;
        const edge = Math.min(size.width, size.height);
        const cell = edge / cells;
        cx.fillStyle = "#000000";
        for (let y = 0; y < qr.size; y++) {
          const row = qr.modules[y]!;
          let x = 0;
          while (x < qr.size) {
            if (!row[x]) {
              x++;
              continue;
            }
            let end = x + 1;
            while (end < qr.size && row[end]) end++;
            // Overlap by a hair so anti-aliased seams never show between cells.
            cx.fillRect(
              (margin + x) * cell,
              (margin + y) * cell,
              (end - x) * cell + 0.25,
              cell + 0.25,
            );
            x = end;
          }
        }
      }}
    />
  );
}

// --- Assistant avatar (the desktop's AssistantAvatar) ---

/**
 * The desktop's only avatar preset ("joystick-ink-mint", robot-04.svg) drawn
 * as vector paths in its own 251.43 box. Retired preset ids read as it.
 */
const ASSISTANT_PRESET_IDS = new Set([
  "joystick-ink-mint",
  "claw",
  "claw-orbit",
  "signal-pulse",
  "signal-wave",
  "orbit-nova",
  "orbit-loop",
  "mosaic-grid",
  "mosaic-stack",
  "companion-spark",
  "companion-calm",
]);

/** The first user-perceived character of an emoji field (a ZWJ sequence stays whole). */
export function firstAvatarGrapheme(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const Segmenter = (Intl as unknown as {
    Segmenter?: new (
      locale?: string,
      options?: { granularity: "grapheme" },
    ) => { segment: (text: string) => Iterable<{ segment: string }> };
  }).Segmenter;
  if (Segmenter) {
    const first = new Segmenter(undefined, { granularity: "grapheme" }).segment(trimmed)[Symbol.iterator]().next();
    return first.done ? "" : first.value.segment;
  }
  return Array.from(trimmed)[0] ?? "";
}

export interface AssistantAvatarProps {
  /** `identity.avatar`: a preset id. */
  avatar?: string;
  /** `identity.emoji`: shown when no explicit preset is set. */
  emoji?: string;
  name?: string;
  size?: number;
  active?: boolean;
  accessibilityLabel?: string;
}

export function AssistantAvatar(props: AssistantAvatarProps) {
  const size = () => props.size ?? 32;
  const emoji = () => firstAvatarGrapheme(props.emoji ?? "");
  const usesPreset = () => ASSISTANT_PRESET_IDS.has((props.avatar ?? "").trim()) || !emoji();
  return (
    <View
      accessibilityLabel={props.accessibilityLabel}
      style={{
        width: size(),
        height: size(),
        flexShrink: 0,
        borderRadius: radii.pill,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: usesPreset() ? 0 : 1,
        borderColor: props.active ? palette().accentBorder : palette().borderSubtle,
        backgroundColor: usesPreset() ? "transparent" : palette().surfaceSubtle,
      }}
    >
      <If
        when={usesPreset()}
        else={
          <Text
            style={{
              fontSize: Math.round(size() * 0.5),
              lineHeight: Math.round(size() * 0.62),
              textAlign: "center",
            }}
          >
            {emoji()}
          </Text>
        }
      >
        <Canvas
          style={{ width: size(), height: size(), pointerEvents: "none" }}
          draw={(cx, box) => {
            if (box.width <= 0 || box.height <= 0) return;
            const p = palette();
            const scale = Math.min(box.width, box.height) / 251.4286;
            cx.save();
            cx.scale(scale, scale);
            cx.translate(-2.2857, -2.2857);
            cx.fillStyle = p.textMuted;
            const antenna = new Path2D();
            antenna.roundRect(116, 55, 24, 31, 12);
            cx.fill(antenna);
            cx.fillStyle = p.text;
            cx.fill(
              new Path2D(
                "M128 72C188 72 234 88 234 138V178C234 220 218 238 180 238H76C38 238 22 220 22 178V138C22 88 68 72 128 72Z",
              ),
            );
            cx.fillStyle = p.accent;
            const head = new Path2D();
            head.arc(128, 41, 23, 0, Math.PI * 2);
            cx.fill(head);
            cx.fillStyle = p.canvas;
            for (const eyeX of [102, 154]) {
              const eye = new Path2D();
              eye.ellipse(eyeX, 160, 10, 16, 0, 0, Math.PI * 2);
              cx.fill(eye);
            }
            cx.restore();
          }}
        />
      </If>
    </View>
  );
}

/**
 * OpenBitFun's canonical 15-contour fine-line hexagonal brand mark
 * (`assets/brand/source/openbitfun-mark.svg`, 120 × 120 viewBox).
 */
const OPENBITFUN_LOGO_PATHS: ReadonlyArray<{ d: string; opacity: number; width: number }> = [
  { opacity: 0.9, width: 0.55, d: "M75.6632 20.1038C80.5771 20.1038 84.2626 22.2317 86.7196 26.4874L102.383 53.6164C104.84 57.8721 104.84 62.1279 102.383 66.3837L86.7196 93.5126C84.2626 97.7683 80.5771 99.8962 75.6632 99.8962H44.3368C39.4229 99.8962 35.7374 97.7683 33.2805 93.5126L17.6173 66.3837C15.1603 62.1279 15.1603 57.8721 17.6173 53.6164L33.2805 26.4874C35.7374 22.2317 39.4229 20.1038 44.3368 20.1038H75.6632Z" },
  { opacity: 0.75, width: 0.5, d: "M74.4549 18.7048C79.4676 18.5171 83.3084 20.547 85.9772 24.7946L102.99 51.871C105.659 56.1182 105.821 60.4591 103.477 64.8937L88.5355 93.1662C86.1916 97.6008 82.5134 99.912 77.5007 100.1L45.5451 101.295C40.5324 101.483 36.6916 99.4531 34.0228 95.2054L17.0096 68.129C14.3412 63.8818 14.1789 59.5409 16.5227 55.1063L31.4645 26.8338C33.8084 22.3992 37.4866 20.088 42.4993 19.9003L74.4549 18.7048Z" },
  { opacity: 0.75, width: 0.5, d: "M73.1638 17.3414C78.2675 16.9589 82.261 18.8821 85.1445 23.111L103.525 50.0708C106.409 54.2998 106.74 58.72 104.519 63.3315L90.3618 92.7294C88.1408 97.3409 84.4783 99.8379 79.3743 100.22L46.8361 102.659C41.7325 103.041 37.7389 101.118 34.8555 96.889L16.4749 69.9292C13.5914 65.7002 13.2602 61.28 15.4812 56.6685L29.6381 27.2706C31.8591 22.6591 35.5216 20.1621 40.6257 19.7796L73.1638 17.3414Z" },
  { opacity: 0.75, width: 0.5, d: "M71.7899 16.0183C76.9775 15.4336 81.1215 17.2415 84.2219 21.4421L103.985 48.2194C107.085 52.4199 107.591 56.9126 105.503 61.6975L92.194 92.2017C90.1063 96.9865 86.4687 99.6711 81.2811 100.255L48.2099 103.982C43.0223 104.566 38.8783 102.758 35.7779 98.5579L16.0153 71.7806C12.9153 67.5801 12.4091 63.0873 14.4968 58.3025L27.8058 27.7983C29.8935 23.0135 33.5311 20.3289 38.7187 19.7446L71.7899 16.0183Z" },
  { opacity: 0.75, width: 0.5, d: "M70.3355 14.7389C75.5989 13.9458 79.8898 15.6299 83.2083 19.7912L104.365 46.3207C107.684 50.482 108.371 55.04 106.426 59.9948L94.0291 91.5812C92.0845 96.536 88.4805 99.4101 83.2171 100.204L49.6643 105.261C44.4008 106.054 40.1099 104.37 36.7914 100.209L15.635 73.6793C12.3162 69.518 11.629 64.96 13.5736 60.0053L25.9706 28.4188C27.9152 23.464 31.5192 20.5899 36.7827 19.7965L70.3355 14.7389Z" },
  { opacity: 0.75, width: 0.5, d: "M68.802 13.5084C74.1323 12.5 78.5667 14.0517 82.1052 18.1637L104.664 44.377C108.203 48.489 109.076 53.1051 107.284 58.2255L95.8621 90.8686C94.0703 95.989 90.5092 99.0534 85.1789 100.062L51.1981 106.492C45.8678 107.5 41.4334 105.948 37.8949 101.836L15.336 75.6229C11.7975 71.511 10.9242 66.8949 12.716 61.7745L24.138 29.1314C25.9298 24.011 29.4908 20.9466 34.8211 19.9382L68.802 13.5084Z" },
  { opacity: 0.75, width: 0.5, d: "M67.1902 12.3305C72.5788 11.1009 77.1527 12.5117 80.9121 16.5629L104.878 42.3926C108.637 46.4439 109.703 51.1104 108.074 56.3921L97.6879 90.0615C96.0586 95.3433 92.5498 98.5991 87.1616 99.8292L52.8099 107.67C47.4213 108.899 42.8473 107.488 39.088 103.437L15.122 77.6074C11.3627 73.5561 10.2975 68.8896 11.9264 63.6079L22.3121 29.9385C23.9414 24.6568 27.4502 21.4009 32.8384 20.1708L67.1902 12.3305Z" },
  { opacity: 0.75, width: 0.5, d: "M65.503 11.2091C70.9403 9.75243 75.6491 11.0144 79.6297 14.9949L105.005 40.3703C108.986 44.3508 110.248 49.0597 108.791 54.4969L99.5025 89.1612C98.0455 94.5984 94.5983 98.0455 89.1611 99.5026L54.4968 108.791C49.0596 110.248 44.3507 108.986 40.3702 105.005L14.9948 79.6297C11.0143 75.6492 9.75236 70.9403 11.2091 65.5031L20.4973 30.8388C21.9544 25.4016 25.4016 21.9545 30.8388 20.4974L65.503 11.2091Z" },
  { opacity: 0.75, width: 0.5, d: "M63.7414 10.149C69.2183 8.45941 74.0574 9.56388 78.2588 13.4624L105.043 38.3147C109.244 42.2128 110.707 46.9559 109.432 52.544L101.302 88.1658C100.026 93.7534 96.6501 97.392 91.1736 99.0816L56.2586 109.851C50.7817 111.541 45.9426 110.436 41.7413 106.538L14.957 81.6853C10.7556 77.7872 9.29253 73.0441 10.5677 67.4561L18.6984 31.8343C19.9739 26.2466 23.3499 22.608 28.8264 20.9184L63.7414 10.149Z" },
  { opacity: 0.75, width: 0.5, d: "M61.908 9.15296C67.4144 7.22626 72.3785 8.1655 76.8002 11.9707L104.989 36.2294C109.41 40.0346 111.079 44.8031 109.994 50.535L103.081 87.0758C101.996 92.8077 98.7005 96.637 93.1941 98.5637L58.0919 110.847C52.5855 112.774 47.6214 111.834 43.1996 108.029L15.0111 83.7706C10.5893 79.9654 8.92077 75.1969 10.0054 69.465L16.9191 32.9241C18.0038 27.1922 21.2993 23.363 26.8057 21.4363L61.908 9.15296Z" },
  { opacity: 0.75, width: 0.5, d: "M60.0058 8.22636C65.5312 6.05746 70.6143 6.82351 75.2549 10.5245L104.841 34.1178C109.481 37.8189 111.359 42.6041 110.474 48.4736L104.835 85.8921C103.95 91.7616 100.745 95.7806 95.2194 97.9491L59.9941 111.774C54.4686 113.943 49.3856 113.177 44.7449 109.476L15.1593 85.8822C10.5186 82.1812 8.6407 77.3959 9.52552 71.5264L15.1651 34.1079C16.0499 28.2384 19.255 24.2194 24.7805 22.0509L60.0058 8.22636Z" },
  { opacity: 0.75, width: 0.5, d: "M58.0365 7.37147C63.5709 4.95687 68.7671 5.54235 73.625 9.12789L104.596 31.9853C109.454 35.5708 111.545 40.3637 110.869 46.3638L106.559 84.6138C105.883 90.614 102.778 94.8213 97.244 97.2359L61.9634 112.629C56.429 115.043 51.2328 114.458 46.3748 110.872L15.4042 88.0147C10.5458 84.4292 8.45466 79.6363 9.13071 73.6362L13.4407 35.3862C14.1168 29.386 17.2218 25.1787 22.7558 22.7641L58.0365 7.37147Z" },
  { opacity: 0.75, width: 0.5, d: "M56.0037 6.59297C61.5358 3.92879 66.8385 4.3261 71.9118 7.78491L104.254 29.8353C109.327 33.2941 111.634 38.0852 111.175 44.2085L108.25 83.2429C107.792 89.3659 104.796 93.7594 99.2635 96.4236L63.9963 113.407C58.4642 116.071 53.1615 115.674 48.0882 112.215L15.746 90.1648C10.673 86.706 8.3659 81.9149 8.82464 75.7915L11.7497 36.7571C12.2084 30.6342 15.204 26.2406 20.7365 23.5764L56.0037 6.59297Z" },
  { opacity: 0.75, width: 0.5, d: "M53.9096 5.89378C59.4284 2.97691 64.8307 3.17906 70.1163 6.50025L103.812 27.6724C109.098 30.9936 111.624 35.7732 111.39 42.0112L109.902 81.7786C109.669 88.0167 106.793 92.5941 101.274 95.511L66.0903 114.106C60.5714 117.023 55.1692 116.821 49.8836 113.5L16.1879 92.3276C10.9023 89.0064 8.37614 84.2268 8.60939 77.9888L10.0976 38.2214C10.3308 31.9833 13.2071 27.4059 18.7263 24.489L53.9096 5.89378Z" },
  { opacity: 1.0, width: 1.0, d: "M51.7579 5.27798C57.2526 2.10569 62.7474 2.10569 68.2421 5.27798L103.27 25.5013C108.764 28.6736 111.512 33.4321 111.512 39.7766V80.2233C111.512 86.5679 108.764 91.3264 103.27 94.4987L68.2421 114.722C62.7474 117.894 57.2526 117.894 51.7579 114.722L16.7303 94.4987C11.2355 91.3264 8.48816 86.5679 8.48816 80.2233V39.7766C8.48816 33.4321 11.2355 28.6736 16.7303 25.5013L51.7579 5.27798Z" },
];

export function OpenBitFunLogoMark(props: { size?: number; color?: string; accessibilityLabel?: string }) {
  const size = () => props.size ?? 56;
  return (
    <View
      accessibilityLabel={props.accessibilityLabel ?? "OpenBitFun"}
      style={{ width: size(), height: size(), flexShrink: 0, alignItems: "center", justifyContent: "center" }}
    >
      <Canvas
        style={{ width: size(), height: size(), pointerEvents: "none" }}
        draw={(cx, box) => {
          if (box.width <= 0 || box.height <= 0) return;
          const color = props.color ?? palette().text;
          const scale = Math.min(box.width, box.height) / 120;
          cx.save();
          cx.scale(scale, scale);
          cx.strokeStyle = color;
          cx.lineCap = "round";
          cx.lineJoin = "round";
          for (const contour of OPENBITFUN_LOGO_PATHS) {
            cx.globalAlpha = contour.opacity * 0.82;
            cx.lineWidth = contour.width;
            cx.stroke(new Path2D(contour.d));
          }
          cx.restore();
        }}
      />
    </View>
  );
}
