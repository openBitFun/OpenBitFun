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
import { formatRelativeTime } from "../format";
import { tr } from "../i18n";
import type { MessageKey } from "../locales/en-US";
import { deviceContext, LIBRARY_TABS, libraryTab, selectDeviceContext, type LibraryTab } from "../state";
import { compactLayout, controlHeight, layout, palette, radii, space, textStyle, touchSlop } from "../theme";
import { deviceException, deviceGlyphIcon } from "../ui/fleet";
import { Icon } from "../ui/icons";
import { MOTION_DURATION, pressTransition, tactileActiveStyle } from "../ui/motion";
import { DropdownMenu, type DropdownMenuItem } from "../ui/overlays";
import { InlineBanner, SegmentedTabs, focusRingStyle } from "../ui/primitives";
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

const NON_RUNTIME_HOST_KINDS = new Set(["cloud", "mobile", "phone", "browser", "web"]);

/**
 * Runtime devices the Library can look at: includes this local desktop
 * (`isClientDevice: true`) and remote desktop/CLI/container runtimes, while
 * excluding the cloud control-plane node and frontend-only phones/browsers.
 */
function scopeDevices(): FleetDevice[] {
  return fleetDevices().filter(device => !NON_RUNTIME_HOST_KINDS.has(device.hostKind.toLowerCase()));
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
        hitSlop={menuEnabled() ? touchSlop(compactLayout() ? layout.touchTarget : controlHeight.sm) : undefined}
        onPress={menuEnabled() ? () => open.update(value => !value) : undefined}
        style={{
          boxSizing: "border-box",
          height: compactLayout() ? layout.touchTarget : controlHeight.sm,
          minHeight: compactLayout() ? layout.touchTarget : controlHeight.sm,
          maxWidth: "100%",
          paddingHorizontal: compactLayout() ? space.md : space.sm,
          borderRadius: radii.md,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: palette().border,
          flexDirection: "row",
          alignItems: "center",
          gap: space.chip,
          cursor: menuEnabled() ? "pointer" : "default",
          userSelect: "none",
          ...pressTransition(MOTION_DURATION.fast),
        }}
        hoverStyle={menuEnabled() && !compactLayout() ? { backgroundColor: palette().panelHover } : undefined}
        activeStyle={menuEnabled() ? tactileActiveStyle(0.97) : undefined}
        focusVisibleStyle={menuEnabled() ? focusRingStyle() : undefined}
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

function LibraryTabs(props: { scrollable?: boolean } = {}) {
  return (
    <SegmentedTabs
      size="sm"
      scrollable={props.scrollable}
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

function scopeOfflineNotice(): string {
  if (!fleetActive()) return "";
  const current = fleetDeviceById(deviceContext());
  if (!current || deviceException(current.state) !== "offline") return "";
  if (current.state === "unreachable") return tr("device.unreachable");
  return tr("device.offline", { ago: formatRelativeTime(current.asOfMs) });
}

function LibraryHeader() {
  return (
    <View
      style={{
        ...libraryColumnStyle(),
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
      <View style={{ gap: space.sm, minWidth: 0 }}>
        <If
          when={studioCompact()}
          else={
            <View style={{ flexDirection: "row" }}>
              <LibraryTabs />
            </View>
          }
        >
          <Scroll
            horizontal
            scrollbar={false}
            accessibilityLabel="library-tabs-scroll"
            style={{ width: "100%", minWidth: 0, flexShrink: 0 }}
            contentStyle={{ flexDirection: "row" }}
          >
            <LibraryTabs scrollable />
          </Scroll>
        </If>
        <Text
          accessibilityLabel="library-subtitle"
          style={{
            ...textStyle("label", { color: palette().textSecondary }),
            fontWeight: "400",
            numberOfLines: compactLayout() ? 2 : 1,
            textOverflow: "ellipsis",
          }}
        >
          {tr(TAB_SUBTITLE[libraryTab()])}
        </Text>
        <If when={scopeOfflineNotice()}>
          {notice => <InlineBanner tone="warning" message={notice()} />}
        </If>
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
