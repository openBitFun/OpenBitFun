// The full-width header of the workspace tools (visual spec §4.10): Files,
// Changes, Terminal and Browser opened on their own show "{workspace} on
// {device}" with the device badge on the left and the tool switcher on the
// right. In the inspector beside a session the tools draw no header of their own.

import { Scroll, Text, View } from "nsh";
import { fleetDeviceById } from "../fleetStore";
import { tr } from "../i18n";
import { remoteWorkspaceAliasOf } from "../sshRemoteStore";
import { activeScene, activeWorkspace, activeWorkspaceKey, navigateScene, openDevicePage } from "../state";
import { compactLayout, layout, palette, space, textStyle } from "../theme";
import { DeviceBadge, deviceException } from "./fleet";
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

function currentToolLabel(): string {
  switch (currentTool()) {
    case "git":
      return tr("tools.changes");
    case "terminal":
      return tr("tools.terminal");
    case "browser":
      return tr("tools.browser");
    default:
      return tr("tools.files");
  }
}

/** Workspace title (with remote connection alias when remote, or current tool name while loading). */
function headerTitle(): string {
  const ws = activeWorkspace();
  if (!ws?.name) return currentToolLabel();
  const alias = remoteWorkspaceAliasOf(ws);
  return alias ? `${ws.name} · ${alias}` : ws.name;
}

export function ToolPaneHeader() {
  const device = () => fleetDeviceById(activeWorkspaceKey()?.deviceId);
  return (
    <View
      testID="tool-pane-header"
      style={{
        minHeight: layout.topBarHeight,
        paddingHorizontal: compactLayout() ? layout.phoneGutter : space.xxl,
        paddingVertical: compactLayout() ? space.sm : 0,
        flexDirection: compactLayout() ? "column" : "row",
        alignItems: compactLayout() ? "stretch" : "center",
        gap: compactLayout() ? space.sm : space.md,
        borderBottomWidth: 1,
        borderColor: palette().borderSubtle,
        backgroundColor: palette().canvas,
      }}
    >
      <View
        style={{
          flex: compactLayout() ? undefined : 1,
          minWidth: 0,
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
        }}
      >
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
          {headerTitle()}
        </Text>
        <If when={device() ?? null}>
          {row => (
            <DeviceBadge
              name={row().name}
              kind={row().hostKind}
              exception={deviceException(row().state)}
              onPress={() => openDevicePage(row().deviceId)}
            />
          )}
        </If>
      </View>
      <If
        when={compactLayout()}
        else={
          <SegmentedTabs
            options={toolOptions()}
            value={currentTool()}
            size="sm"
            onChange={value => navigateScene(value)}
          />
        }
      >
        <Scroll
          horizontal
          scrollbar={false}
          style={{ flexShrink: 0 }}
          contentStyle={{ flexDirection: "row", alignItems: "center" }}
        >
          <SegmentedTabs
            options={toolOptions()}
            value={currentTool()}
            size="sm"
            onChange={value => navigateScene(value)}
          />
        </Scroll>
      </If>
    </View>
  );
}
