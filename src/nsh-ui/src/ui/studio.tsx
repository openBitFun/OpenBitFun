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
      <If when={Boolean(props.leading)} else={
        <If when={props.icon ?? ""}>
          {name => (
            <Icon
              name={name() as IconName}
              size={16}
              color={palette().textMuted}
            />
          )}
        </If>
      }>
        <View style={{ flexShrink: 0, alignItems: "center", justifyContent: "center" }}>{props.leading}</View>
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
            lineHeight: textLineHeight(14, 1.35),
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
        borderRadius: radii.sm,
        borderCurve: "continuous",
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
