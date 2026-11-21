// Library (visual spec §4.8): one page for what a device keeps — assistants,
// agents, skills, spaces and routines. The page draws the title, the device it
// is looking at ("On {device}", a label set by where you are, never a prompt),
// the five tabs and one subtitle line; the tab's own scene draws its search,
// its one primary button and its rows under that. Which tab is open is
// `libraryTab` in `state.ts`, so the older scene ids open the right tab.

import { Scroll, signal, Text, View, type ViewRef } from "nsh";
import { fleetActive } from "../bridge";
import { fleetDeviceById, fleetDevices } from "../fleetStore";
import type { FleetDevice } from "../fleetTypes";
import { tr } from "../i18n";
import type { MessageKey } from "../locales/en-US";
import { deviceContext, LIBRARY_TABS, libraryTab, selectDeviceContext, type LibraryTab } from "../state";
import { compactLayout, controlHeight, layout, palette, radii, space, textStyle } from "../theme";
import { deviceGlyphIcon } from "../ui/fleet";
import { Icon } from "../ui/icons";
import { MOTION_DURATION, paintTransition } from "../ui/motion";
import { DropdownMenu, type DropdownMenuItem } from "../ui/overlays";
import { SegmentedTabs } from "../ui/primitives";
import { studioCompact, trackStudioWidth } from "../ui/studio";
import { AgentsScene } from "./AgentsScene";
import { AssistantsScene, assistantDetailShown } from "./AssistantsScene";
import { libraryColumnStyle } from "./LibraryChrome";
import { RoutinesScene } from "./RoutinesScene";
import { SkillsScene } from "./SkillsScene";
import { SpacesScene } from "./SpacesScene";

const TAB_LABEL: Record<LibraryTab, MessageKey> = {
  assistants: "library.assistants",
  agents: "library.agents",
  skills: "library.skills",
  spaces: "library.spaces",
  routines: "library.routines",
};

const TAB_SUBTITLE: Record<LibraryTab, MessageKey> = {
  assistants: "assistants.subtitle",
  agents: "agents.subtitle",
  skills: "skills.subtitle",
  spaces: "spaces.subtitle",
  routines: "routines.subtitle",
};

/** Runtime devices the Library can look at (phones and browsers keep no library). */
function scopeDevices(): FleetDevice[] {
  return fleetDevices().filter(device => !device.isClientDevice);
}

/** A device the chip lists but cannot switch to, and the word it shows instead. */
function unavailableWord(device: FleetDevice): string | null {
  if (device.state === "offline" || device.state === "unreachable") return tr("state.offline");
  return null;
}

function scopeMenuItems(): DropdownMenuItem[] {
  const current = deviceContext();
  return scopeDevices().map(device => {
    const word = unavailableWord(device);
    return {
      id: `library-scope-${device.deviceId}`,
      label: device.name,
      icon: deviceGlyphIcon(device.hostKind),
      active: device.deviceId === current,
      disabled: Boolean(word),
      trailingHint: word ?? (device.state === "update_required" ? tr("state.updateNeeded") : undefined),
      accessibilityLabel: `library-scope-${device.deviceId}`,
      onSelect: () => void selectDeviceContext(device.deviceId),
    };
  });
}

/**
 * "On {device}": the device whose library is shown. With the fleet layer it
 * opens a menu of the account's runtime devices (offline ones listed but
 * disabled); without it, this device and no menu. On a phone the shell places
 * it in the top bar.
 */
export function LibraryScopeChip() {
  const open = signal(false);
  const anchor = signal<ViewRef | null>(null);
  const current = () => fleetDeviceById(deviceContext());
  const label = () => {
    const name = current()?.name;
    return name ? tr("library.on", { device: name }) : tr("library.thisDevice");
  };
  const menuEnabled = () => fleetActive() && scopeDevices().length > 0;

  return (
    <View ref={el => anchor.set(el)} style={{ flexShrink: 1, minWidth: 0 }}>
      <View
        role={menuEnabled() ? "button" : undefined}
        accessibilityLabel="library-scope-chip"
        accessibilityState={{ expanded: open() }}
        onPress={menuEnabled() ? () => open.update(value => !value) : undefined}
        style={{
          boxSizing: "border-box",
          height: controlHeight.sm,
          maxWidth: "100%",
          paddingHorizontal: space.sm,
          borderRadius: radii.md,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: palette().border,
          flexDirection: "row",
          alignItems: "center",
          gap: space.chip,
          cursor: menuEnabled() ? "pointer" : "default",
          ...paintTransition(MOTION_DURATION.fast),
        }}
        hoverStyle={menuEnabled() ? { backgroundColor: palette().panelHover } : undefined}
        focusVisibleStyle={{ outlineWidth: 2, outlineColor: palette().borderFocus, outlineOffset: 1 }}
      >
        <Icon name={deviceGlyphIcon(current()?.hostKind ?? "laptop")} size={14} color={palette().textSecondary} />
        <Text style={{ ...textStyle("label"), flexShrink: 1, minWidth: 0, numberOfLines: 1, textOverflow: "ellipsis" }}>
          {label()}
        </Text>
        <If when={menuEnabled()}>
          <Icon name="chevron-down" size={12} color={palette().textMuted} />
        </If>
      </View>
      <DropdownMenu
        open={open()}
        anchor={anchor()}
        placement="bottom"
        align="end"
        minWidth={220}
        items={scopeMenuItems()}
        onClose={() => open.set(false)}
      />
    </View>
  );
}

function LibraryTabs() {
  return (
    <SegmentedTabs
      size="sm"
      options={LIBRARY_TABS.map(tab => ({
        value: tab,
        label: tr(TAB_LABEL[tab]),
        accessibilityLabel: `library-tab-${tab}`,
      }))}
      value={libraryTab()}
      onChange={next => libraryTab.set(next)}
    />
  );
}

function LibraryHeader() {
  return (
    <View
      style={{
        ...libraryColumnStyle(libraryTab() === "spaces"),
        paddingTop: studioCompact() ? layout.phonePagePaddingTop : layout.pagePaddingTop,
        gap: space.lg,
        flexShrink: 0,
      }}
    >
      {/* On a phone the top bar carries the title and the scope chip. */}
      <If when={!compactLayout()}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, minWidth: 0 }}>
          <Text role="header" style={{ ...textStyle("pageTitle"), flex: 1, minWidth: 0, numberOfLines: 1 }}>
            {tr("library.title")}
          </Text>
          <LibraryScopeChip />
        </View>
      </If>
      <View style={{ gap: space.sm }}>
        <If
          when={studioCompact()}
          else={
            <View style={{ flexDirection: "row" }}>
              <LibraryTabs />
            </View>
          }
        >
          <Scroll horizontal accessibilityLabel="library-tabs-scroll" style={{ flexShrink: 0 }}>
            <LibraryTabs />
          </Scroll>
        </If>
        <Text
          accessibilityLabel="library-subtitle"
          style={{ ...textStyle("label", { color: palette().textSecondary }), fontWeight: "400", numberOfLines: 1, textOverflow: "ellipsis" }}
        >
          {tr(TAB_SUBTITLE[libraryTab()])}
        </Text>
      </View>
    </View>
  );
}

function tabScene() {
  switch (libraryTab()) {
    case "agents":
      return <AgentsScene embedded />;
    case "skills":
      return <SkillsScene embedded />;
    case "spaces":
      return <SpacesScene embedded />;
    case "routines":
      return <RoutinesScene embedded />;
    default:
      return <AssistantsScene embedded />;
  }
}

/** The Library route: header, then the open tab's scene. */
export function LibraryScene() {
  return (
    <View
      onLayout={trackStudioWidth}
      style={{ flex: 1, minWidth: 0, minHeight: 0, flexDirection: "column", backgroundColor: palette().canvas }}
    >
      {/* An open assistant replaces the list with its own editor and header. */}
      <If when={!(libraryTab() === "assistants" && assistantDetailShown())}>
        <LibraryHeader />
      </If>
      <View style={{ flex: 1, minWidth: 0, minHeight: 0, flexDirection: "column" }}>{tabScene()}</View>
    </View>
  );
}
