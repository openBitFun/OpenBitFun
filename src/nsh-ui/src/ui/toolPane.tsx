// The full-width header of the workspace tools (visual spec §4.10): Files,
// Changes, Terminal and Browser opened on their own show "{workspace} on
// {device}" with the device badge on the left and the tool switcher on the
// right. In the inspector beside a session the tools draw no header of their own.

import { Text, View } from "nsh";
import { fleetDeviceById } from "../fleetStore";
import { tr } from "../i18n";
import { activeScene, activeWorkspace, activeWorkspaceKey, navigateScene, openDevicePage } from "../state";
import { compactLayout, layout, palette, space, textStyle } from "../theme";
import { DeviceBadge } from "./fleet";
import { SegmentedTabs, type SegmentedTabOption } from "./primitives";

export type ToolSceneId = "files" | "git" | "terminal" | "browser";

function toolOptions(): ReadonlyArray<SegmentedTabOption<ToolSceneId>> {
  return [
    { value: "files", label: tr("tools.files"), accessibilityLabel: "workbench-switch-files" },
    { value: "git", label: tr("tools.changes"), accessibilityLabel: "workbench-switch-git" },
    { value: "terminal", label: tr("tools.terminal"), accessibilityLabel: "workbench-switch-terminal" },
    { value: "browser", label: tr("tools.browser"), accessibilityLabel: "workbench-switch-browser" },
  ];
}

function currentTool(): ToolSceneId {
  const scene = activeScene();
  return scene === "git" || scene === "terminal" || scene === "browser" ? scene : "files";
}

/** "{workspace} on {device}" (or the workspace alone on a single-device backend). */
function headerText(): string {
  const workspace = activeWorkspace()?.name ?? "";
  const device = fleetDeviceById(activeWorkspaceKey()?.deviceId)?.name ?? "";
  if (workspace && device) return tr("tools.header", { workspace, device });
  return workspace || device;
}

export function ToolPaneHeader() {
  const device = () => fleetDeviceById(activeWorkspaceKey()?.deviceId);
  return (
    <View
      testID="tool-pane-header"
      style={{
        minHeight: layout.topBarHeight,
        paddingHorizontal: compactLayout() ? layout.phoneGutter : space.xxl,
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        borderBottomWidth: 1,
        borderColor: palette().borderSubtle,
        backgroundColor: palette().canvas,
      }}
    >
      <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <Text
          style={{
            ...textStyle("body", { color: palette().text }),
            fontWeight: "600",
            flexShrink: 1,
            minWidth: 0,
            numberOfLines: 1,
            textOverflow: "ellipsis",
          }}
        >
          {headerText()}
        </Text>
        {/* The text names the device; the badge adds only its exception ("Offline", "Update needed"). */}
        <If when={device() && device()!.state !== "online" ? device() : null}>
          {row => (
            <DeviceBadge
              name={row().name}
              kind={row().hostKind}
              exception={row().state === "offline" ? "offline" : row().state === "update_required" ? "update_required" : null}
              onPress={() => openDevicePage(row().deviceId)}
            />
          )}
        </If>
      </View>
      <SegmentedTabs
        options={toolOptions()}
        value={currentTool()}
        size="sm"
        onChange={value => navigateScene(value)}
      />
    </View>
  );
}
