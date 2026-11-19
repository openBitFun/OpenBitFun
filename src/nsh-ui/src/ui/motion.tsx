// Motion, layout transition, and spinner primitives backed by NSH's native
// LayoutAnimation, createMotion, ShaderTransition, and Canvas animations.
// Follows Emil Kowalski & Apple Fluid Interfaces craft discipline:
// - GPU-composited transitions (`transform`, `opacity`) and color-only paint fades (never `box-shadow`).
// - Strong custom ease-out curves (`cubic-bezier(0.23, 1, 0.32, 1)`) — never `ease-in` on UI.
// - Subtle tactile press feedback (`scale(0.97)` gated off under `reduceMotion()`).
// - Origin-aware popover entrances and non-uniform sub-300ms stagger waves.
// - Instant primary scene switching (100+/day navigation never blocks behind ShaderTransition).

import {
  Canvas,
  LayoutAnimation,
  ShaderTransition,
  View,
  createMotion,
  reduceMotion,
  shadersAvailable,
  type Align,
  type Easing,
  type JSX,
  type LayoutAnimationConfig,
  type Motion,
  type MotionName,
  type MotionSpec,
  type Placement,
  type StyleProp,
  type ViewStyle,
} from "nsh";
import { palette } from "../theme";

/** Standard strong ease-out cubic-bezier tuple for NSH `createMotion` / `Animated`. */
export const MOTION_EASE_STANDARD_BEZIER: [number, number, number, number] = [0.23, 1, 0.32, 1];

/** Smooth symmetrical cubic-bezier tuple for on-screen moves & morphs. */
export const MOTION_EASE_SMOOTH_BEZIER: [number, number, number, number] = [0.77, 0, 0.175, 1];

/** iOS-style drawer / sheet deceleration tuple. */
export const MOTION_EASE_DRAWER_BEZIER: [number, number, number, number] = [0.32, 0.72, 0, 1];

/** Standard decelerating ease-out curve (`--ease-standard`). */
export const MOTION_EASE_STANDARD = "cubic-bezier(0.23, 1, 0.32, 1)" as const;

/** Smooth symmetrical curve for folds, accordions, and on-screen morphs (`--ease-smooth`). */
export const MOTION_EASE_SMOOTH = "cubic-bezier(0.77, 0, 0.175, 1)" as const;

/** iOS-like sheet / drawer deceleration curve (`--ease-drawer`). */
export const MOTION_EASE_DRAWER = "cubic-bezier(0.32, 0.72, 0, 1)" as const;

/** Crisp decelerating exit curve (never `ease-in`; pairs with shorter exit durations). */
export const MOTION_EASE_EXIT = "cubic-bezier(0.23, 1, 0.32, 1)" as const;

/** Critically damped default UI spring (Apple damping ratio ~1.0, no bounce). */
export const MOTION_SPRING_DEFAULT = {
  stiffness: 320,
  damping: 36,
  mass: 1,
} as const;

/** Snappy critically damped UI spring for compact controls. */
export const MOTION_SPRING_SNAPPY = {
  stiffness: 420,
  damping: 41,
  mass: 1,
} as const;

/** Shared duration scale in milliseconds (all regular UI stays under 300ms). */
export const MOTION_DURATION = {
  instant: 80,
  fast: 140,
  popover: 160,
  base: 200,
  contentSwap: 200,
  toast: 320,
  slow: 360,
  loop: 680,
} as const;

export type PaintTransitionStyle = Pick<
  ViewStyle,
  "transitionProperty" | "transitionDuration" | "transitionTimingFunction"
>;

/**
 * Paint-only transition style for sweeping rows, inputs, and non-scaling surfaces.
 * Intentionally excludes `box-shadow` (avoids per-frame shadow repaints) and keeps
 * a calm short color/opacity settle under `reduceMotion()`.
 */
export function paintTransition(
  ms: number = MOTION_DURATION.fast,
  easing: ViewStyle["transitionTimingFunction"] = MOTION_EASE_STANDARD,
): PaintTransitionStyle {
  return {
    transitionProperty: "background-color, border-color, color, opacity",
    transitionDuration: ms <= 0 ? 0 : reduceMotion() ? Math.min(ms, 100) : ms,
    transitionTimingFunction: easing,
  };
}

/**
 * GPU-friendly transition style for discrete pressable controls (`Button`,
 * `IconButton`, `PillChip`, `SegmentedTabs`, etc.) pairing color/opacity fades
 * with tactile `transform` press response (dropping `transform` under `reduceMotion()`).
 */
export function pressTransition(
  ms: number = MOTION_DURATION.fast,
  easing: ViewStyle["transitionTimingFunction"] = MOTION_EASE_STANDARD,
): PaintTransitionStyle {
  const reduced = reduceMotion();
  return {
    transitionProperty: reduced
      ? "background-color, border-color, color, opacity"
      : "transform, background-color, border-color, color, opacity",
    transitionDuration: ms <= 0 ? 0 : reduced ? Math.min(ms, 100) : ms,
    transitionTimingFunction: easing,
  };
}

/**
 * Tactile `:active` press style (`scale(0.97)` by default) that gracefully
 * degrades to a subtle opacity shift under `reduceMotion()`.
 */
export function tactileActiveStyle(scale = 0.97, extra?: ViewStyle): ViewStyle {
  if (reduceMotion()) {
    return { opacity: 0.88, ...extra };
  }
  return { transform: [{ scale }], ...extra };
}

export type LayoutPresetName = "easeInEaseOut" | "spring" | "linear";

const LAYOUT_EASE_OUT_CONFIG: LayoutAnimationConfig = {
  duration: 180,
  create: { type: "easeOut", property: "opacity", duration: 140 },
  update: { type: "easeOut", duration: 180 },
  delete: { type: "easeOut", property: "opacity", duration: 120 },
};

const LAYOUT_SPRING_CONFIG: LayoutAnimationConfig = {
  duration: 200,
  create: { type: "easeOut", property: "opacity", duration: 140 },
  update: { type: "spring", springDamping: 1.0 },
  delete: { type: "easeOut", property: "opacity", duration: 120 },
};

/** Runs a snappy native layout transition for the next tree commit unless reduced-motion is set. */
export function animateLayout(
  onEnd?: () => void,
  preset: LayoutPresetName = "easeInEaseOut",
): void {
  if (reduceMotion()) {
    onEnd?.();
    return;
  }
  const config =
    preset === "spring"
      ? LAYOUT_SPRING_CONFIG
      : preset === "linear"
        ? LayoutAnimation.create(160, "linear", "opacity")
        : LAYOUT_EASE_OUT_CONFIG;
  LayoutAnimation.configureNext(config, onEnd);
}

export type EnterMotionKind = Extract<
  MotionName,
  "fadeInUp" | "fadeInDown" | "fadeInLeft" | "fadeInRight" | "zoomIn" | "popIn" | "fadeIn"
>;

function buildEnterSpec(
  kind: EnterMotionKind,
  duration: number,
  delay: number,
  easing: Easing = MOTION_EASE_STANDARD_BEZIER,
): MotionSpec {
  if (reduceMotion()) {
    return {
      keyframes: { opacity: [0, 1] },
      duration: duration <= 0 ? 0 : Math.min(duration, 110),
      delay: 0,
      easing: "ease",
      ignoreReduceMotion: true,
    };
  }
  switch (kind) {
    case "zoomIn":
      return {
        keyframes: { opacity: [0, 1], scale: [0.96, 1] },
        duration,
        delay,
        easing,
      };
    case "popIn":
      return {
        keyframes: { opacity: [0, 1], scale: [0.95, 1], translateY: [4, 0] },
        duration,
        delay,
        easing,
      };
    case "fadeInDown":
      return {
        keyframes: { opacity: [0, 1], translateY: [-5, 0], scale: [0.97, 1] },
        duration,
        delay,
        easing,
      };
    case "fadeInUp":
      return {
        keyframes: { opacity: [0, 1], translateY: [6, 0] },
        duration,
        delay,
        easing,
      };
    case "fadeInLeft":
      return {
        keyframes: { opacity: [0, 1], translateX: [-6, 0] },
        duration,
        delay,
        easing,
      };
    case "fadeInRight":
      return {
        keyframes: { opacity: [0, 1], translateX: [6, 0] },
        duration,
        delay,
        easing,
      };
    case "fadeIn":
    default:
      return {
        keyframes: { opacity: [0, 1] },
        duration,
        delay,
        easing,
      };
  }
}

/**
 * Creates a crisp Emil-tuned entrance motion handle (`scale: 0.96→1`, `4–6px`
 * nudge, strong `cubic-bezier(0.23, 1, 0.32, 1)` ease-out), degrading cleanly
 * to an opacity-only cross-fade under `reduceMotion()`.
 */
export function enterMotion(
  kind: EnterMotionKind = "fadeIn",
  duration: number = MOTION_DURATION.fast,
  delay = 0,
): Motion {
  return createMotion({
    enter: buildEnterSpec(kind, duration, delay),
  });
}

/**
 * Resolves the trigger-anchored CSS `transformOrigin` for a popover or menu
 * based on its effective `<Overlay>` `placement` and `align`.
 */
export function popoverOrigin(
  placement: Placement = "bottom",
  align: Align = "start",
): string {
  if (placement === "top") {
    if (align === "end") return "bottom right";
    if (align === "center") return "bottom center";
    return "bottom left";
  }
  if (placement === "left") {
    if (align === "end") return "right bottom";
    if (align === "start") return "right top";
    return "right center";
  }
  if (placement === "right") {
    if (align === "end") return "left bottom";
    if (align === "start") return "left top";
    return "left center";
  }
  if (align === "end") return "top right";
  if (align === "center") return "top center";
  return "top left";
}

/**
 * Origin-aware popover/menu entrance (`scale: 0.96→1`, `opacity: 0→1`, subtle
 * 4px directional nudge emerging from the trigger along `placement`).
 */
export function popoverEnterMotion(
  placement: Placement = "bottom",
  _align: Align = "start",
  duration: number = MOTION_DURATION.popover,
): Motion {
  if (reduceMotion()) {
    return createMotion({
      enter: {
        keyframes: { opacity: [0, 1] },
        duration: duration <= 0 ? 0 : Math.min(duration, 100),
        easing: "ease",
        ignoreReduceMotion: true,
      },
    });
  }
  const keyframes: MotionSpec["keyframes"] =
    placement === "top"
      ? { opacity: [0, 1], scale: [0.96, 1], translateY: [4, 0] }
      : placement === "left"
        ? { opacity: [0, 1], scale: [0.96, 1], translateX: [4, 0] }
        : placement === "right"
          ? { opacity: [0, 1], scale: [0.96, 1], translateX: [-4, 0] }
          : { opacity: [0, 1], scale: [0.96, 1], translateY: [-4, 0] };

  return createMotion({
    enter: {
      keyframes,
      duration,
      easing: MOTION_EASE_STANDARD_BEZIER,
    },
  });
}

/** Decelerating non-uniform delay steps (ms) so group entrances feel organic and stay <= 280ms. */
const NON_UNIFORM_STAGGER_DELAYS: ReadonlyArray<number> = [0, 34, 62, 84, 100];

function computeNonUniformDelay(index: number, maxIndex: number, stepMs: number): number {
  const cap = Math.max(0, Math.min(maxIndex, NON_UNIFORM_STAGGER_DELAYS.length - 1));
  const clamped = Math.max(0, Math.min(index, cap));
  const base = NON_UNIFORM_STAGGER_DELAYS[clamped] ?? 100;
  const ratio = stepMs > 0 ? Math.min(1.15, stepMs / 34) : 1;
  return Math.min(100, Math.round(base * ratio));
}

/**
 * Non-uniform staggered entrance for rare / first-run welcome moments (e.g.
 * `WelcomeStudio`). Shrinking delay gaps (`0, 34, 62, 84, 100ms`) with 180ms
 * duration keep total group entrance under 280ms and collapse to a single gentle
 * fade under `reduceMotion()`.
 */
export function nonUniformStaggerMotion(
  index: number,
  maxIndex = 4,
  kind: EnterMotionKind = "fadeInUp",
): Motion {
  const delay = reduceMotion() ? 0 : computeNonUniformDelay(index, maxIndex, 34);
  return createMotion({
    enter: buildEnterSpec(kind, 180, delay),
  });
}

/**
 * Backwards-compatible staggered entrance upgraded to non-uniform decelerating
 * delays (capped at <= 100ms delay + 180ms duration = <= 280ms total).
 */
export function staggerEnterMotion(
  index: number,
  maxIndex = 4,
  kind: EnterMotionKind = "fadeInUp",
  stepMs = 34,
): Motion {
  const delay = reduceMotion() ? 0 : computeNonUniformDelay(index, maxIndex, stepMs);
  return createMotion({
    enter: buildEnterSpec(kind, 180, delay),
  });
}

export interface SceneTransitionProps {
  value: string | number | boolean;
  duration?: number;
  /** Opt-in shader crossfade (off by default: 100+/day route switches stay instant). */
  animated?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: JSX.Element;
}

/**
 * Scene container wrapper. Renders instantaneously by default so high-frequency
 * primary navigation never stalls behind full-viewport shader snapshots; pass
 * `animated` only for rare, deliberate transition surfaces.
 */
export function SceneTransition(props: SceneTransitionProps) {
  return (
    <If
      when={Boolean(props.animated) && shadersAvailable() && !reduceMotion()}
      else={
        <View style={[{ flex: 1, minWidth: 0, minHeight: 0 }, props.style]}>
          {props.children}
        </View>
      }
    >
      <ShaderTransition
        value={props.value}
        fallback="fade"
        duration={props.duration ?? MOTION_DURATION.fast}
        style={[{ flex: 1, minWidth: 0, minHeight: 0 }, props.style]}
      >
        {props.children}
      </ShaderTransition>
    </If>
  );
}

export interface SpinnerProps {
  size?: number;
  color?: string;
  strokeWidth?: number;
}

export function Spinner(props: SpinnerProps) {
  return (
    <View
      style={{
        width: props.size ?? 14,
        height: props.size ?? 14,
        flexShrink: 0,
        alignItems: "center",
        justifyContent: "center",
        animationName: reduceMotion() ? "none" : "spin",
        animationDuration: MOTION_DURATION.loop,
        animationTimingFunction: "linear",
        animationIterationCount: "infinite",
      }}
    >
      <Canvas
        style={{
          width: props.size ?? 14,
          height: props.size ?? 14,
          flexShrink: 0,
          pointerEvents: "none",
        }}
        draw={(cx, size) => {
          if (size.width <= 0 || size.height <= 0) return;
          const color = props.color ?? palette().accent;
          const sw = props.strokeWidth ?? 1.7;
          const cxMid = size.width / 2;
          const cyMid = size.height / 2;
          const r = Math.max(2, Math.min(cxMid, cyMid) - sw);
          cx.save();
          cx.lineCap = "round";
          cx.lineWidth = sw;
          cx.strokeStyle = palette().border;
          cx.beginPath();
          cx.arc(cxMid, cyMid, r, 0, Math.PI * 2);
          cx.stroke();
          cx.strokeStyle = color;
          cx.beginPath();
          cx.arc(cxMid, cyMid, r, -Math.PI / 2, Math.PI * 0.8);
          cx.stroke();
          cx.restore();
        }}
      />
    </View>
  );
}

export interface BrandSpinnerProps {
  size?: number;
  color?: string;
  variant?: "bars" | "matrix";
}

const MATRIX_DELAYS: ReadonlyArray<number> = [
  0, 80, 160,
  80, 160, 240,
  160, 240, 320,
];

/**
 * OpenBitFun brand loading indicator (`bars` 3-bar equalizer pulse or `matrix` 3x3
 * rhythmic mark), matching `src/web-ui`'s ambient runtime spinner.
 */
export function BrandSpinner(props: BrandSpinnerProps) {
  return (
    <If
      when={(props.variant ?? "bars") === "matrix"}
      else={
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            gap: Math.max(2, Math.round((props.size ?? 14) * 0.16)),
            height: props.size ?? 14,
          }}
        >
          <Each of={[0, 1, 2]} key={idx => idx}>
            {idx => (
              <View
                style={{
                  width: Math.max(2, Math.round((props.size ?? 14) * 0.18)),
                  height:
                    idx() === 1
                      ? Math.max(8, Math.round((props.size ?? 14) * 0.85))
                      : Math.max(5, Math.round((props.size ?? 14) * 0.56)),
                  borderRadius: 999,
                  backgroundColor: props.color ?? palette().accent,
                  animationName: reduceMotion() ? "none" : "pulse",
                  animationDuration: MOTION_DURATION.loop,
                  animationDelay: reduceMotion() ? 0 : idx() * 140,
                  animationTimingFunction: "ease-in-out",
                  animationIterationCount: "infinite",
                }}
              />
            )}
          </Each>
        </View>
      }
    >
      <View
        style={{
          width: props.size ?? 16,
          height: props.size ?? 16,
          flexShrink: 0,
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: Math.max(1.5, Math.round((props.size ?? 16) * 0.12)),
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Each of={[0, 1, 2, 3, 4, 5, 6, 7, 8]} key={cell => cell}>
          {cell => (
            <View
              style={{
                width: "100%",
                height: "100%",
                borderRadius: 1.5,
                backgroundColor: props.color ?? palette().accent,
                animationName: reduceMotion() ? "none" : "pulse",
                animationDuration: 920,
                animationDelay: reduceMotion() ? 0 : MATRIX_DELAYS[cell()],
                animationTimingFunction: "ease-in-out",
                animationIterationCount: "infinite",
              }}
            />
          )}
        </Each>
      </View>
    </If>
  );
}
