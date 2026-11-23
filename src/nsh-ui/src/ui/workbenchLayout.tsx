// Layout helpers shared by the workbench scenes (Files, Git, Terminal): the
// width-driven stacked layout (list first, then a pushed full-width detail with
// a back control) and the quiet toolbar pieces. Every palette / text-size read
// stays inside JSX bindings because NSH component bodies run once.

import { horizontalSizeClass, signal, Text, untracked, View, type Bounds } from "nsh";
import { compactLayout, palette, radii, space, textLineHeight, textSize } from "../theme";
import { Icon } from "./icons";
import { MOTION_DURATION, pressTransition, tactileActiveStyle } from "./motion";
import { focusRingStyle } from "./primitives";

/** Below this laid-out scene width a workbench scene stacks its panes. */
export const WORKBENCH_STACK_WIDTH = 600;
/** Minimum touch target height for rows and controls in the stacked layout. */
export const WORKBENCH_TOUCH_MIN = 44;

export interface SceneWidth {
  /** `onLayout` handler for the scene root. */
  onLayout: (event: { bounds: Bounds }) => void;
  /** Latest laid-out width in points (0 before first layout). */
  width: () => number;
  /** Latest laid-out height in points (0 before first layout). */
  height: () => number;
  /** True when the scene is narrower than 600 pt (phones, narrow windows, narrow side aux pane). */
  stacked: () => boolean;
}

/**
 * Tracks one scene instance's own laid-out dimensions (not the platform, not
 * the window: the navigation panel and the aux pane take part of the window).
 * Call it once in the component body; until the first layout it follows the
 * window's horizontal size class.
 */
export function createSceneWidth(): SceneWidth {
  const width = signal(0);
  const height = signal(0);
  return {
    onLayout: event => {
      const nextW = Math.round(event.bounds.size.width);
      const nextH = Math.round(event.bounds.size.height);
      if (nextW > 0 && nextW !== untracked(() => width())) width.set(nextW);
      if (nextH > 0 && nextH !== untracked(() => height())) height.set(nextH);
    },
    width: () => width(),
    height: () => height(),
    stacked: () => {
      const current = width();
      if (current > 0) return current < WORKBENCH_STACK_WIDTH;
      return horizontalSizeClass() === "compact";
    },
  };
}

/**
 * The back control of a pushed detail view: a chevron and the list's title.
 * Uses 44 pt height on touch/compact viewports and crisp 34–36 pt desktop height.
 * When `flush` is set, sits seamlessly inside a tab strip with a hairline divider.
 */
export function StackBackButton(props: {
  label: string;
  accessibilityLabel: string;
  flush?: boolean;
  onPress: () => void;
}) {
  return (
    <View
      role="button"
      accessibilityLabel={props.accessibilityLabel}
      onPress={() => props.onPress()}
      style={{
        height: compactLayout() ? WORKBENCH_TOUCH_MIN : props.flush ? 36 : 34,
        flexDirection: "row",
        alignItems: "center",
        gap: space.xs,
        paddingLeft: props.flush ? space.sm : space.xs,
        paddingRight: props.flush ? space.md : space.sm,
        flexShrink: 0,
        borderRadius: props.flush ? 0 : radii.sm,
        borderCurve: "continuous",
        borderRightWidth: props.flush ? 1 : 0,
        borderColor: palette().borderSubtle,
        cursor: "pointer",
        userSelect: "none",
        ...pressTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{ backgroundColor: palette().panelHover }}
      activeStyle={tactileActiveStyle(0.98)}
      focusVisibleStyle={{ ...focusRingStyle(), outlineOffset: -2 }}
    >
      <Icon name="chevron-left" size={compactLayout() ? 16 : 14} color={palette().textSecondary} />
      <Text
        style={{
          color: palette().textSecondary,
          fontSize: textSize(compactLayout() ? 14 : 12.5),
          lineHeight: textLineHeight(compactLayout() ? 14 : 12.5, 1.3),
          fontWeight: "500",
          maxWidth: 136,
          numberOfLines: 1,
          textOverflow: "ellipsis",
        }}
      >
        {props.label}
      </Text>
    </View>
  );
}

/** A 1 px hairline between toolbar groups that separate different content. */
export function ToolbarDivider() {
  return (
    <View
      style={{
        width: 1,
        height: 16,
        flexShrink: 0,
        backgroundColor: palette().borderSubtle,
      }}
    />
  );
}
