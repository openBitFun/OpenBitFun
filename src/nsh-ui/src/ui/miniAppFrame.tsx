// The Space page (wave 22, P4; tauri-gap §4.3): a Space opened inside the app
// on every client, "{space} on {device}". The app's document runs in an NSH
// `WebView` (an iframe on the web target) wired to `spaceFrame.ts`, which
// sends every call to the Space's device. The ⋯ menu holds Open in window
// (desktop), Versions…, Customize…, Permissions…, Run on {device} (Spaces
// that use device capabilities), Stop and Close; the agent's "operate this
// Space" requests show as one quiet line above the frame.

import { cleanup, Clipboard, signal, Text, View, WebView, type WebViewRef } from "nsh";
import { localizeHostError, tr } from "../i18n";
import { fleetActive } from "../bridge";
import { fleetDeviceById } from "../fleetStore";
import { openDevicePage } from "../state";
import {
  compactLayout,
  concentricRadius,
  layout,
  palette,
  radii,
  space,
  textStyle,
  touchSlop,
} from "../theme";
import {
  applySpaceDraft,
  attachFrame,
  closeSpacePage,
  discardSpaceDraft,
  grantSpaceWorkspace,
  moveSpaceTo,
  openSpace,
  openSpaceSheet,
  reopenSpace,
  reviewSpaceDraft,
  rollbackSpace,
  spaceAgentRequests,
  spaceDraft,
  spaceDraftDiff,
  spaceSession,
  spaceSheet,
  spaceSheetBusy,
  spaceSheetError,
  spaceVersions,
  spaceWindowAvailable,
  startSpaceDraft,
} from "../spaceViewStore";
import { openSpaceWindow, spaceOpening, spacePermissionBadges, spaces, stopSpaceWorker } from "../spacesStore";
import { SPACE_FRAME_SHIM, type SpaceFrameSession } from "../spaceFrame";
import { DeviceBadge, StateMark, deviceException } from "./fleet";
import { Icon } from "./icons";
import { pressTransition, Spinner, tactileActiveStyle } from "./motion";
import { ModalDialog, pushToast, type DropdownMenuItem } from "./overlays";
import { Button, focusRingStyle, IconButton, InlineBanner } from "./primitives";
import { MoreMenu, studioCompact } from "./studio";

function deviceLabel(deviceId: string): string {
  if (!fleetActive() || !deviceId) return "";
  return fleetDeviceById(deviceId)?.name || deviceId;
}

/** The app's document and its bridge to the device. */
export function MiniAppFrame(props: { session: SpaceFrameSession }) {
  let frame: WebViewRef | null = null;
  return (
    <If when={props.session.bootstrap()}>
      {boot => (
        <WebView
          ref={node => {
            frame = node;
            attachFrame(node ? script => frame?.injectJavaScript(script) : null);
          }}
          accessibilityLabel="space-frame"
          html={boot().html}
          incognito
          injectedJavaScriptBeforeContentLoaded={SPACE_FRAME_SHIM}
          onMessage={event => void props.session.receive(event.data)}
          onLoad={() => void props.session.pageLoaded()}
          onError={event => {
            props.session.status.set("failed");
            props.session.error.set(event.message || "error");
          }}
          style={{
            flex: 1,
            minHeight: 0,
            alignSelf: "stretch",
            borderRadius: concentricRadius(radii.lg, 1),
            overflow: "hidden",
          }}
        />
      )}
    </If>
  );
}

/** What stands in for the frame while it is not live, with the one way forward. */
function FrameState(props: { session: SpaceFrameSession; name: string; device: string }) {
  const status = () => props.session.status();
  const message = () => {
    switch (status()) {
      case "opening":
        return props.device
          ? tr("spaces.p4.openingOn", { space: props.name, device: props.device })
          : tr("spaces.p4.opening", { space: props.name });
      case "released":
        return tr("spaces.p4.released", { space: props.name });
      case "replaced":
        return tr("spaces.p4.replaced", { space: props.name });
      case "failed":
        return tr("spaces.p4.failed", { error: localizeHostError(props.session.error()) });
      default:
        return "";
    }
  };
  return (
    <If when={status() !== "ready" && status() !== "closed"}>
      <View
        accessibilityLabel={`space-frame-${status()}`}
        style={{
          position: status() === "opening" && props.session.bootstrap() ? "absolute" : "relative",
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          gap: space.md,
          padding: space.xxl,
          backgroundColor: palette().canvas,
        }}
      >
        <If when={status() === "opening"}>
          <Spinner size={16} />
        </If>
        <Text style={{ ...textStyle("body", { color: palette().textSecondary }), textAlign: "center", maxWidth: 360 }}>
          {message()}
        </Text>
        <If when={status() !== "opening"}>
          <Button
            label={status() === "failed" ? tr("spaces.p4.tryAgain") : tr("spaces.p4.openHere")}
            variant="secondary"
            size="md"
            accessibilityLabel="space-frame-reopen"
            onPress={() => reopenSpace()}
          />
        </If>
      </View>
    </If>
  );
}

/** One quiet line while the agent works in this Space; it opens the request list. */
function AgentLine(props: { session: SpaceFrameSession; appId: string; onOpen: () => void }) {
  const entries = () => props.session.agentLog();
  const outside = () => spaceAgentRequests().filter(item => item.appId === props.appId);
  const latest = () => entries()[0] ?? null;
  const pending = () => entries().some(item => item.outcome === "pending") || outside().some(item => item.outcome === "pending");
  const count = () => entries().length + outside().length;
  return (
    <If when={count() > 0}>
      <View
        role="button"
        accessibilityLabel="space-agent-line"
        hitSlop={touchSlop(28)}
        onPress={() => props.onOpen()}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          minHeight: compactLayout() ? layout.touchTarget : 28,
          paddingHorizontal: space.xs,
          borderRadius: radii.sm,
          cursor: "pointer",
          ...pressTransition(),
        }}
        hoverStyle={compactLayout() ? undefined : { backgroundColor: palette().panelHover }}
        activeStyle={tactileActiveStyle(0.99)}
        focusVisibleStyle={focusRingStyle()}
      >
        <StateMark state={pending() ? "working" : "done"} seen size={12} />
        <Text
          style={{
            ...textStyle("caption", { color: palette().textSecondary }),
            flexShrink: 1,
            minWidth: 0,
            numberOfLines: 1,
            textOverflow: "ellipsis",
          }}
        >
          {pending()
            ? tr("spaces.p4.agentWorking", { action: latest()?.action || latest()?.method || "open" })
            : tr("spaces.p4.agentDone")}
        </Text>
        <Icon name="chevron-right" size={12} color={palette().textMuted} />
      </View>
    </If>
  );
}

function AgentSheet(props: { open: boolean; session: SpaceFrameSession; appId: string; onClose: () => void }) {
  const rows = () => [
    ...props.session.agentLog().map(item => ({
      id: item.requestId,
      label: item.action ? `${item.method} · ${item.action}` : item.method,
      outcome: item.outcome,
    })),
    ...spaceAgentRequests()
      .filter(item => item.appId === props.appId)
      .map(item => ({ id: item.requestId, label: item.action, outcome: item.outcome })),
  ];
  return (
    <ModalDialog
      open={props.open}
      title={tr("spaces.p4.agentTitle")}
      subtitle={tr("spaces.p4.agentSubtitle")}
      accessibilityLabel="space-agent-sheet"
      onClose={props.onClose}
    >
      <View style={{ gap: space.xs }}>
        <Each of={rows()} key={row => row.id}>
          {row => (
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 32 }}>
              <StateMark state={row().outcome === "pending" ? "working" : row().outcome === "refused" ? "failed" : "done"} seen size={12} />
              <Text
                style={{
                  ...textStyle("mono", { color: palette().text }),
                  flex: 1,
                  minWidth: 0,
                  numberOfLines: 1,
                  textOverflow: "ellipsis",
                }}
              >
                {row().label}
              </Text>
              <Text style={textStyle("caption", { color: palette().textMuted })}>
                {row().outcome === "pending"
                  ? tr("state.working")
                  : row().outcome === "refused"
                    ? tr("spaces.p4.agentRefused")
                    : tr("spaces.p4.agentAnswered")}
              </Text>
            </View>
          )}
        </Each>
      </View>
    </ModalDialog>
  );
}

function SheetError() {
  return (
    <If when={spaceSheetError()}>
      {error => <InlineBanner tone="danger" message={localizeHostError(error())} />}
    </If>
  );
}

function VersionsSheet() {
  const current = () => spaces().find(item => item.id === openSpace()?.appId)?.version ?? null;
  return (
    <ModalDialog
      open={spaceSheet() === "versions"}
      title={tr("spaces.p4.versionsTitle")}
      subtitle={tr("spaces.p4.versionsSubtitle")}
      accessibilityLabel="space-versions-sheet"
      onClose={() => spaceSheet.set(null)}
    >
      <View style={{ gap: space.xs }}>
        <SheetError />
        <If when={spaceSheetBusy() && spaceVersions().length === 0}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 36 }}>
            <Spinner size={14} />
            <Text style={textStyle("label", { color: palette().textMuted })}>{tr("common.loading")}</Text>
          </View>
        </If>
        <If when={!spaceSheetBusy() && spaceVersions().length === 0 && !spaceSheetError()}>
          <Text style={textStyle("label", { color: palette().textMuted })}>{tr("spaces.p4.noVersions")}</Text>
        </If>
        <Each of={spaceVersions()} key={version => String(version)}>
          {version => (
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 36 }}>
              <Text style={{ ...textStyle("body", { color: palette().text, tabular: true }), flex: 1 }}>
                {tr("spaces.p4.version", { version: version() })}
              </Text>
              <If
                when={current() !== version()}
                else={<Text style={textStyle("caption", { color: palette().textMuted })}>{tr("spaces.p4.current")}</Text>}
              >
                <Button
                  label={tr("spaces.p4.restore")}
                  variant="ghost"
                  size="sm"
                  disabled={spaceSheetBusy()}
                  accessibilityLabel={`space-rollback-${version()}`}
                  onPress={() => void rollbackSpace(version())}
                />
              </If>
            </View>
          )}
        </Each>
      </View>
    </ModalDialog>
  );
}

function DiffLines(props: { label: string; items: string[] }) {
  return (
    <If when={props.items.length > 0}>
      <View style={{ gap: space.hair }}>
        <Text style={textStyle("label", { color: palette().textSecondary })}>{props.label}</Text>
        <Text style={textStyle("mono", { color: palette().text })}>{props.items.join("\n")}</Text>
      </View>
    </If>
  );
}

function CustomizeSheet() {
  const diff = () => spaceDraftDiff();
  const noChange = () => {
    const value = diff();
    return Boolean(value && value.added.length === 0 && value.expanded.length === 0 && value.removed.length === 0);
  };
  return (
    <ModalDialog
      open={spaceSheet() === "customize"}
      title={tr("spaces.p4.customizeTitle")}
      subtitle={tr("spaces.p4.customizeSubtitle")}
      accessibilityLabel="space-customize-sheet"
      onClose={() => spaceSheet.set(null)}
      footer={
        <If
          when={spaceDraft()}
          else={
            <Button
              label={tr("spaces.p4.startDraft")}
              variant="primary"
              size="md"
              disabled={spaceSheetBusy()}
              accessibilityLabel="space-draft-start"
              onPress={() => void startSpaceDraft()}
            />
          }
        >
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <Button
              label={tr("spaces.p4.discard")}
              variant="ghost"
              size="md"
              disabled={spaceSheetBusy()}
              accessibilityLabel="space-draft-discard"
              onPress={() => void discardSpaceDraft()}
            />
            <If
              when={diff()}
              else={
                <Button
                  label={tr("spaces.p4.review")}
                  variant="primary"
                  size="md"
                  disabled={spaceSheetBusy()}
                  accessibilityLabel="space-draft-review"
                  onPress={() => void reviewSpaceDraft()}
                />
              }
            >
              <Button
                label={tr("spaces.p4.apply")}
                variant={diff()?.highRisk ? "danger" : "primary"}
                size="md"
                disabled={spaceSheetBusy()}
                accessibilityLabel="space-draft-apply"
                onPress={() => void applySpaceDraft()}
              />
            </If>
          </View>
        </If>
      }
    >
      <View style={{ gap: space.md }}>
        <SheetError />
        <If when={spaceDraft()}>
          {draft => (
            <View style={{ gap: space.sm }}>
              <Text style={textStyle("label", { color: palette().textSecondary })}>{tr("spaces.p4.draftFolder")}</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minWidth: 0 }}>
                <Text
                  accessibilityLabel="space-draft-root"
                  style={{
                    ...textStyle("mono", { color: palette().text }),
                    flex: 1,
                    minWidth: 0,
                    numberOfLines: 1,
                    textOverflow: "ellipsis-middle",
                    backgroundColor: palette().surfaceTertiary,
                    borderRadius: radii.sm,
                    paddingHorizontal: space.chip,
                    paddingVertical: space.hair,
                  }}
                >
                  {draft().draftRoot}
                </Text>
                <IconButton
                  icon="copy"
                  size="sm"
                  tooltip={tr("spaces.p4.copyPath")}
                  accessibilityLabel="space-draft-copy"
                  onPress={() => void Clipboard.writeText(draft().draftRoot).then(() => pushToast(tr("spaces.p4.copied"), "success"))}
                />
              </View>
              <Text style={textStyle("caption", { color: palette().textMuted })}>{tr("spaces.p4.draftHint")}</Text>
            </View>
          )}
        </If>
        <If when={diff()}>
          {value => (
            <View accessibilityLabel="space-draft-diff" style={{ gap: space.sm }}>
              <Text style={textStyle("sectionTitle", { color: palette().text })}>{tr("spaces.p4.permissionChange")}</Text>
              <If when={value().highRisk}>
                <InlineBanner tone="warning" message={tr("spaces.p4.highRisk")} />
              </If>
              <If when={noChange()}>
                <Text style={textStyle("label", { color: palette().textMuted })}>{tr("spaces.p4.noPermissionChange")}</Text>
              </If>
              <DiffLines label={tr("spaces.p4.added")} items={value().added} />
              <DiffLines label={tr("spaces.p4.expanded")} items={value().expanded} />
              <DiffLines label={tr("spaces.p4.removed")} items={value().removed} />
            </View>
          )}
        </If>
      </View>
    </ModalDialog>
  );
}

function PermissionsSheet(props: { permissionLabel: (id: string) => string }) {
  const meta = () => spaces().find(item => item.id === openSpace()?.appId) ?? null;
  const badges = () => {
    const value = meta();
    return value ? spacePermissionBadges(value) : [];
  };
  return (
    <ModalDialog
      open={spaceSheet() === "permissions"}
      title={tr("spaces.p4.permissionsTitle")}
      subtitle={tr("spaces.p4.permissionsSubtitle")}
      accessibilityLabel="space-permissions-sheet"
      onClose={() => spaceSheet.set(null)}
    >
      <View style={{ gap: space.md }}>
        <SheetError />
        <If
          when={badges().length > 0}
          else={<Text style={textStyle("label", { color: palette().textMuted })}>{tr("spaces.p4.permissionsUnknown")}</Text>}
        >
          <View style={{ gap: space.xs }}>
            <Each of={badges()} key={id => id}>
              {id => (
                <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 28 }}>
                  <Icon name="shield" size={14} color={palette().textMuted} />
                  <Text style={textStyle("body", { color: palette().text })}>{props.permissionLabel(id())}</Text>
                </View>
              )}
            </Each>
          </View>
        </If>
        <View style={{ gap: space.xs }}>
          <Text style={textStyle("label", { color: palette().textSecondary })}>{tr("spaces.p4.grantsTitle")}</Text>
          <If
            when={openSpace()?.workspacePath}
            else={<Text style={textStyle("caption", { color: palette().textMuted })}>{tr("spaces.p4.grantNeedsWorkspace")}</Text>}
          >
            {path => (
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minWidth: 0 }}>
                <Text
                  style={{
                    ...textStyle("mono", { color: palette().textSecondary }),
                    flex: 1,
                    minWidth: 0,
                    numberOfLines: 1,
                    textOverflow: "ellipsis-middle",
                  }}
                >
                  {path()}
                </Text>
                <Button
                  label={tr("spaces.p4.grantWorkspace")}
                  variant="secondary"
                  size={compactLayout() ? "md" : "sm"}
                  disabled={spaceSheetBusy()}
                  accessibilityLabel="space-grant-workspace"
                  style={compactLayout() ? { minHeight: layout.touchTarget } : undefined}
                  onPress={() => void grantSpaceWorkspace()}
                />
              </View>
            )}
          </If>
        </View>
      </View>
    </ModalDialog>
  );
}

function pageMenuItems(): DropdownMenuItem[] {
  const current = openSpace();
  if (!current) return [];
  const items: DropdownMenuItem[] = [];
  if (spaceWindowAvailable()) {
    items.push({
      id: "window",
      label: tr("spaces.openWindow"),
      icon: "external-link",
      disabled: spaceOpening() !== null,
      accessibilityLabel: "space-page-open-window",
      onSelect: () => void openSpaceWindow(current.appId),
    });
  }
  items.push(
    {
      id: "versions",
      label: tr("spaces.p4.versionsItem"),
      icon: "history",
      accessibilityLabel: "space-page-versions",
      onSelect: () => openSpaceSheet("versions"),
    },
    {
      id: "customize",
      label: tr("spaces.p4.customizeItem"),
      icon: "edit",
      accessibilityLabel: "space-page-customize",
      onSelect: () => openSpaceSheet("customize"),
    },
    {
      id: "permissions",
      label: tr("spaces.p4.permissionsItem"),
      icon: "shield",
      accessibilityLabel: "space-page-permissions",
      onSelect: () => openSpaceSheet("permissions"),
    },
  );
  if (current.needsDevice && fleetActive()) {
    for (const deviceId of current.devices.filter(id => id && id !== current.deviceId)) {
      items.push({
        id: `run-${deviceId}`,
        label: tr("spaces.p4.runOn", { device: deviceLabel(deviceId) || deviceId }),
        icon: "swap",
        accessibilityLabel: `space-page-run-${deviceId}`,
        onSelect: () => moveSpaceTo(deviceId),
      });
    }
  }
  items.push(
    {
      id: "stop",
      label: tr("spaces.stopWorkerTitle"),
      icon: "stop",
      separator: true,
      accessibilityLabel: "space-page-stop",
      onSelect: () => void stopSpaceWorker(current.appId),
    },
    {
      id: "close",
      label: tr("spaces.p4.close"),
      icon: "close",
      accessibilityLabel: "space-page-close",
      onSelect: () => closeSpacePage(),
    },
  );
  return items;
}

/** The open Space: header, the agent line, the frame and its sheets. */
export function SpacePage(props: { permissionLabel: (id: string) => string }) {
  const agentOpen = signal(false);
  cleanup(() => {
    closeSpacePage();
  });
  return (
    <If when={openSpace()}>
      {current => (
        <View accessibilityLabel="space-page" style={{ flex: 1, minHeight: 0, gap: space.sm }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space.md,
              minHeight: layout.topBarHeight,
              paddingHorizontal: studioCompact() ? layout.phoneGutter : space.xxl,
            }}
          >
            <IconButton
              icon="arrow-left"
              size={compactLayout() ? "md" : "sm"}
              tooltip={tr("spaces.p4.back")}
              accessibilityLabel="space-page-back"
              style={
                compactLayout()
                  ? {
                      width: layout.touchTarget,
                      height: layout.touchTarget,
                      minWidth: layout.touchTarget,
                      minHeight: layout.touchTarget,
                    }
                  : undefined
              }
              onPress={() => closeSpacePage()}
            />
            <Text
              style={{
                ...textStyle("sectionTitle", { color: palette().text }),
                flexShrink: 1,
                minWidth: 0,
                numberOfLines: 1,
                textOverflow: "ellipsis",
              }}
            >
              {current().name}
            </Text>
            <If when={deviceLabel(current().deviceId)}>
              {name => {
                const dev = () => fleetDeviceById(current().deviceId);
                return (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs, flexShrink: 1, minWidth: 0 }}>
                    <Text style={textStyle("caption", { color: palette().textMuted })}>{tr("spaces.p4.on")}</Text>
                    <DeviceBadge
                      name={name()}
                      kind={dev()?.hostKind}
                      exception={dev() ? deviceException(dev()!.state) : undefined}
                      onPress={dev() ? () => openDevicePage(current().deviceId) : undefined}
                    />
                  </View>
                );
              }}
            </If>
            <View style={{ flex: 1 }} />
            <MoreMenu
              accessibilityLabel="space-page-more"
              tooltip={tr("spaces.spaceActions")}
              minWidth={220}
              items={pageMenuItems()}
            />
          </View>
          <If when={spaceSession()}>
            {session => (
              <View
                style={{
                  flex: 1,
                  minHeight: 0,
                  gap: space.sm,
                  paddingHorizontal: studioCompact() ? layout.phoneGutter : space.xxl,
                  paddingBottom: studioCompact() ? layout.phoneGutter : space.xxl,
                }}
              >
                <AgentLine session={session()} appId={current().appId} onOpen={() => agentOpen.set(true)} />
                <View
                  style={{
                    flex: 1,
                    minHeight: 0,
                    position: "relative",
                    borderRadius: radii.lg,
                    borderWidth: 1,
                    borderColor: palette().borderSubtle,
                    overflow: "hidden",
                  }}
                >
                  <If when={session().status() !== "released" && session().status() !== "replaced"}>
                    <MiniAppFrame session={session()} />
                  </If>
                  <FrameState session={session()} name={current().name} device={deviceLabel(current().deviceId)} />
                </View>
                <AgentSheet
                  open={agentOpen()}
                  session={session()}
                  appId={current().appId}
                  onClose={() => agentOpen.set(false)}
                />
              </View>
            )}
          </If>
          <VersionsSheet />
          <CustomizeSheet />
          <PermissionsSheet permissionLabel={props.permissionLabel} />
        </View>
      )}
    </If>
  );
}

/** Apps of the account that live on other devices: open one there. */
export function ElsewhereList(props: {
  apps: Array<{ appId: string; name: string; description: string; devices: Array<{ deviceId: string }>; needsDevice: boolean }>;
  onOpen: (appId: string, deviceId: string) => void;
}) {
  return (
    <View accessibilityLabel="spaces-elsewhere" style={{ gap: 0 }}>
      <Each of={props.apps} key={app => app.appId}>
        {app => {
          const primaryDeviceId = () => app().devices[0]?.deviceId ?? "";
          const dev = () => fleetDeviceById(primaryDeviceId());
          return (
            <View
              role="button"
              accessibilityLabel={`space-elsewhere-${app().appId}`}
              hitSlop={touchSlop(48)}
              onPress={() => props.onOpen(app().appId, primaryDeviceId())}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: space.md,
                minHeight: 48,
                paddingHorizontal: space.sm,
                borderRadius: radii.md,
                cursor: "pointer",
                ...pressTransition(),
              }}
              hoverStyle={compactLayout() ? undefined : { backgroundColor: palette().panelHover }}
              activeStyle={tactileActiveStyle(0.99)}
              focusVisibleStyle={{ ...focusRingStyle(), outlineOffset: -2 }}
            >
              <Icon name="layout-grid" size={16} color={palette().textSecondary} />
              <View style={{ flex: 1, minWidth: 0, gap: space.hair }}>
                <Text
                  style={{
                    ...textStyle("body", { color: palette().text }),
                    fontWeight: "500",
                    numberOfLines: 1,
                    textOverflow: "ellipsis",
                  }}
                >
                  {app().name}
                </Text>
                <Text
                  style={{
                    ...textStyle("caption", { color: palette().textMuted }),
                    numberOfLines: 1,
                    textOverflow: "ellipsis",
                  }}
                >
                  {app().description || tr("common.noDescription")}
                </Text>
              </View>
              <DeviceBadge
                name={deviceLabel(primaryDeviceId()) || tr("spaces.p4.anotherDevice")}
                kind={dev()?.hostKind}
                exception={dev() ? deviceException(dev()!.state) : undefined}
              />
              <Icon name="chevron-right" size={12} color={palette().textMuted} />
            </View>
          );
        }}
      </Each>
    </View>
  );
}

