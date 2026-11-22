// Layout helpers shared by the workbench scenes (Files, Git, Terminal): the
// width-driven stacked layout (list first, then a pushed full-width detail with
// a back control) and the quiet toolbar pieces. Every palette / text-size read
// stays inside JSX bindings because NSH component bodies run once.

import { horizontalSizeClass, signal, Text, untracked, View, type Bounds } from "nsh";
import { palette, radii, space, textLineHeight, textSize } from "../theme";
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
  /** True when the scene is narrower than 600 pt (phones, narrow windows, the aux pane). */
  stacked: () => boolean;
}

/**
 * Tracks one scene instance's own laid-out width (not the platform, not the
 * window: the navigation panel and the aux pane take part of the window). Call
 * it once in the component body; until the first layout it follows the
 * window's horizontal size class.
 */
export function createSceneWidth(): SceneWidth {
  const width = signal(0);
  return {
    onLayout: event => {
      const next = Math.round(event.bounds.size.width);
      if (next > 0 && next !== untracked(() => width())) width.set(next);
    },
    stacked: () => {
      const current = width();
      if (current > 0) return current < WORKBENCH_STACK_WIDTH;
      return horizontalSizeClass() === "compact";
    },
  };
}

/**
 * The back control of a pushed detail view: a chevron and the list's title,
 * as a native navigation bar draws it. 44 pt tall so it is a full touch target.
 */
export function StackBackButton(props: {
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  return (
    <View
      role="button"
      accessibilityLabel={props.accessibilityLabel}
      onPress={() => props.onPress()}
      style={{
        height: WORKBENCH_TOUCH_MIN,
        flexDirection: "row",
        alignItems: "center",
        gap: space.xs,
        paddingLeft: space.xs,
        paddingRight: space.sm,
        flexShrink: 0,
        borderRadius: radii.sm,
        borderCurve: "continuous",
        cursor: "pointer",
        userSelect: "none",
        ...pressTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{ backgroundColor: palette().panelHover }}
      activeStyle={tactileActiveStyle(0.97)}
      focusVisibleStyle={{ ...focusRingStyle(), outlineOffset: -2 }}
    >
      <Icon name="chevron-left" size={16} color={palette().textSecondary} />
      <Text
        style={{
          color: palette().textSecondary,
          fontSize: textSize(14),
          lineHeight: textLineHeight(14, 1.3),
          maxWidth: 160,
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
