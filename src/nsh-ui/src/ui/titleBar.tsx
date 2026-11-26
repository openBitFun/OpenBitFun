import { context, Scroll, View, type JSX, type ViewStyle } from "nsh";

/** Width of this scene header occupied by the host's caption buttons, in layout points. */
export const SceneCaptionInset = context<() => number>(() => 0);

/** Narrow panes let the actions scroll within the space left by the caption. */
export function CaptionActionStrip(props: {
  inset: number;
  gap: number;
  role?: "tablist";
  children?: JSX.Element;
}) {
  const row = (): ViewStyle => ({
    flexDirection: "row",
    alignItems: props.role === "tablist" ? "stretch" : "center",
    gap: props.gap,
  });
  return (
    <If
      when={props.inset > 0}
      else={
        <View role={props.role} style={{ ...row(), minWidth: 0, flexShrink: props.role === "tablist" ? 1 : 0 }}>
          {props.children}
        </View>
      }
    >
      <Scroll horizontal role={props.role} style={{ minWidth: 0, flexShrink: 1 }} contentStyle={row()}>
        {props.children}
      </Scroll>
    </If>
  );
}
