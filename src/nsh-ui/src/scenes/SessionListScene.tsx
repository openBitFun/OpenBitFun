// The phone's session list: the account's devices → workspaces → sessions,
// the same tree a wide window keeps in its sidebar, at full width with touch
// rows. Opening a session pushes the session view; the top bar's back returns
// here. Display only, as the sidebar tree is (`ui/deviceSidebar.tsx`).

import { Scroll, Text, View, type JSX } from "nsh";
import { openGlobalSearch } from "../globalSearchStore";
import { tr } from "../i18n";
import { layout, palette, radii, space, textStyle } from "../theme";
import { DeviceSidebarTree } from "../ui/deviceSidebar";
import { Icon } from "../ui/icons";
import { MOTION_DURATION, pressTransition, tactileActiveStyle } from "../ui/motion";
import { focusRingStyle } from "../ui/primitives";

/** A search field look-alike that opens the global search (sessions, files, commands). */
function SearchEntry(): JSX.Element {
  return (
    <View
      role="button"
      accessibilityLabel="session-list-search"
      onPress={() => openGlobalSearch()}
      activeStyle={tactileActiveStyle(0.985)}
      focusVisibleStyle={focusRingStyle()}
      style={{
        height: layout.touchTarget,
        paddingHorizontal: space.md,
        borderRadius: radii.lg,
        borderCurve: "continuous",
        backgroundColor: palette().chromeInputBg,
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        cursor: "pointer",
        ...pressTransition(MOTION_DURATION.fast),
      }}
    >
      <Icon name="search" size={16} color={palette().chromeTextMuted} />
      <Text style={{ ...textStyle("body", { color: palette().chromeTextMuted }), flex: 1, minWidth: 0, numberOfLines: 1 }}>
        {tr("nav.search")}
      </Text>
    </View>
  );
}

export function SessionListScene(): JSX.Element {
  return (
    <Scroll
      smoothWheel
      accessibilityLabel="session-list-scene"
      scrollbar={true}
      style={{ flex: 1, minHeight: 0, backgroundColor: palette().chromeBg }}
      contentStyle={{
        paddingHorizontal: layout.phoneGutter,
        paddingTop: space.md,
        paddingBottom: space.x5l,
        gap: space.md,
      }}
    >
      <SearchEntry />
      <DeviceSidebarTree />
    </Scroll>
  );
}
