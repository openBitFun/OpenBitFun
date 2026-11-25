// The sidebar's device tree (wave 23, owner direction): every runtime device
// of the account → its workspaces → their sessions, the way the Tauri client's
// navigation panel laid them out, drawn in the NSH chrome language (visual
// spec §3 "Sidebar row", "Device rows"). A signed-out or single-device user
// sees this device's workspaces with no device header.
//
// Display only. The rows, their order (newest session first), states and the
// action gates are the backend's: the fleet navigator through `deviceTree()`,
// or the host's own catalogue without the fleet layer. The only local state is
// which rows are folded and how many sessions a workspace shows. On a phone the
// same tree is the session list scene, with touch-sized rows.

import { effect, platform, signal, Text, untracked, View, type JSX, type ViewRef } from "nsh";
import { fleetActive } from "../bridge";
import { tr } from "../i18n";
import {
  activeSessionDevice,
  activeSessionId,
  activeWorkspaceId,
  collapsedWorkspaces,
  deviceContext,
  forgetRecentWorkspace,
  openRecentWorkspace,
  recentWorkspaces,
  revealedDevice,
  selectWorkspace,
  secondarySessionDevice,
  secondarySessionId,
  splitPaneOpen,
  workspacesLoaded,
} from "../state";
import {
  SESSION_PAGE,
  deviceTree,
  loadLocalWorkspace,
  loadWorkspaceSessions,
  newSessionHere,
  openSessionRow,
  remoteWorkspaceHost,
  sessionTarget,
  workspaceTarget,
  type DeviceTreeNode,
} from "../deviceTree";
import { deviceCanCreateWorkspace, deviceMenuItems, newWorkspaceOn } from "../deviceActions";
import { compactLayout, controlHeight, layout, palette, radii, space, textStyle } from "../theme";
import { formatRelativeTime } from "../format";
import { StateMark, deviceException, deviceGlyphIcon, stateColor, type MarkState } from "./fleet";
import { Icon, type IconName } from "./icons";
import { MOTION_DURATION, paintTransition, rotatingChevronStyle } from "./motion";
import { DropdownMenu, pushToast, type DropdownMenuItem } from "./overlays";
import { IconButton, focusRingStyle } from "./primitives";
import { sessionMenuItems } from "./sessionActions";
import { workspaceMenuItems } from "./workspaceActions";

type TreeWorkspace = DeviceTreeNode["workspaces"][number];
type TreeSession = TreeWorkspace["sessions"][number];

/** Sessions a workspace shows initially before "Show more". */
const SESSION_PREVIEW = 3;
/** Additional sessions revealed on each "Show more" press. */
const SESSION_MORE_STEP = 5;
/** One indent step: a 16 glyph plus its 8 gap, so a child's glyph sits under its parent's name. */
const INDENT = space.xxl;

/** Devices the user folded or unfolded here; unset follows the device's state. */
const deviceFold = signal<Record<string, boolean>>({});
/** Number of sessions currently revealed per workspace (unset defaults to `SESSION_PREVIEW`). */
const workspaceVisibleCount = signal<Record<string, number>>({});
/** Workspaces whose own catalogue was read once (without the fleet layer). */
const localCatalogueRead = new Set<string>();

/** A tablet or a phone has no hover: the row actions a pointer reveals on hover stay shown there. */
const touchFirst = platform.os === "ios" || platform.os === "android";

function workspaceKey(deviceId: string, workspaceId: string): string {
  return `${deviceId}/${workspaceId}`;
}

function workspaceExpanded(deviceId: string, workspaceId: string): boolean {
  return collapsedWorkspaces()[workspaceKey(deviceId, workspaceId)] !== true;
}

function resetWorkspaceVisibleCount(key: string): void {
  if (!(key in workspaceVisibleCount())) return;
  workspaceVisibleCount.update(all => {
    const next = { ...all };
    delete next[key];
    return next;
  });
}

function resetDeviceVisibleCounts(deviceId: string): void {
  const prefix = `${deviceId}/`;
  const current = workspaceVisibleCount();
  if (!Object.keys(current).some(key => key.startsWith(prefix))) return;
  workspaceVisibleCount.update(all => {
    const next: Record<string, number> = {};
    for (const [key, count] of Object.entries(all)) {
      if (!key.startsWith(prefix)) next[key] = count;
    }
    return next;
  });
}

function toggleWorkspace(deviceId: string, workspaceId: string): void {
  const key = workspaceKey(deviceId, workspaceId);
  const folded = collapsedWorkspaces()[key] === true;
  resetWorkspaceVisibleCount(key);
  collapsedWorkspaces.update(current => {
    const next = { ...current };
    if (folded) delete next[key];
    else next[key] = true;
    return next;
  });
}

/** Devices start open unless they cannot answer (offline, stale, outdated). */
function deviceExpanded(node: DeviceTreeNode): boolean {
  return deviceFold()[node.deviceId] ?? deviceException(node.state) === null;
}

function workspaceIcon(workspace: TreeWorkspace, open: boolean): IconName {
  const kind = (workspace.kind ?? "").toLowerCase();
  if (kind.includes("assistant")) return "bot";
  if (kind.includes("ssh") || kind.includes("remote") || Boolean(remoteWorkspaceHost(workspace))) {
    return "server";
  }
  return open ? "folder-open" : "folder";
}

// ── Building blocks ──────────────────────────────────────────────────────────

/** A chrome row: 32 high (a touch target on a phone), radius 8, hover and selection tints, keyboard focus ring. */
function TreeRow(props: {
  indent: number;
  active?: boolean;
  accessibilityLabel: string;
  testID?: string;
  expanded?: boolean;
  onPress: () => void;
  onHover?: (hovered: boolean) => void;
  /** The 16 px glyph slot; a row without one (a device header) starts at its text. */
  leading?: JSX.Element;
  children: JSX.Element;
  trailing?: JSX.Element;
}) {
  return (
    <View
      onMouseEnter={() => props.onHover?.(true)}
      onMouseLeave={() => props.onHover?.(false)}
      style={{
        height: compactLayout() ? layout.touchTarget : controlHeight.md,
        paddingLeft: space.sm + props.indent,
        paddingRight: space.xs,
        borderRadius: radii.md,
        borderCurve: "continuous",
        backgroundColor: props.active ? palette().chromeActive : "transparent",
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        ...paintTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{ backgroundColor: props.active ? palette().chromeActive : palette().chromeHover }}
    >
      <View
        role="button"
        testID={props.testID}
        accessibilityLabel={props.accessibilityLabel}
        accessibilityState={props.expanded === undefined ? { selected: Boolean(props.active) } : { expanded: props.expanded }}
        onPress={props.onPress}
        focusVisibleStyle={{ ...focusRingStyle("chrome"), outlineOffset: -1 }}
        style={{
          flex: 1,
          minWidth: 0,
          height: "100%",
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          borderRadius: radii.sm,
          cursor: "pointer",
          userSelect: "none",
        }}
      >
        <If when={props.leading !== undefined}>
          <View style={{ width: space.lg, height: space.lg, alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            {props.leading}
          </View>
        </If>
        {props.children}
      </View>
      {props.trailing}
    </View>
  );
}

/**
 * Hover actions: drawn only while the row is hovered or one of its menus is
 * open, so a quiet row gives its whole width to the title.
 */
function HoverActions(props: { visible: boolean; children: JSX.Element }) {
  return (
    <If when={props.visible}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.hair, flexShrink: 0 }}>{props.children}</View>
    </If>
  );
}

/** A row's ⋯ menu on the chrome surface. */
function RowMenuButton(props: {
  items: () => ReadonlyArray<DropdownMenuItem>;
  accessibilityLabel: string;
  tooltip: string;
  onOpenChange: (open: boolean) => void;
}) {
  const open = signal(false);
  const anchor = signal<ViewRef | null>(null);
  const setOpen = (next: boolean) => {
    open.set(next);
    props.onOpenChange(next);
  };
  return (
    <View ref={el => anchor.set(el)} style={{ flexShrink: 0 }}>
      <IconButton
        icon="more"
        size="xs"
        surface="chrome"
        active={open()}
        tooltip={props.tooltip}
        accessibilityLabel={props.accessibilityLabel}
        onPress={() => setOpen(!open())}
      />
      <If when={open()}>
        <DropdownMenu
          open={true}
          anchor={anchor()}
          align="start"
          minWidth={200}
          items={props.items()}
          onClose={() => setOpen(false)}
        />
      </If>
    </View>
  );
}

function RowLabel(props: { text: string; weight?: "400" | "500" | "600"; muted?: boolean }) {
  return (
    <Text
      style={{
        ...textStyle("label", { color: props.muted ? palette().chromeTextMuted : palette().chromeText }),
        fontWeight: props.weight ?? "500",
        flex: 1,
        minWidth: 0,
        numberOfLines: 1,
        textOverflow: "ellipsis",
      }}
    >
      {props.text}
    </Text>
  );
}

/** A quiet row under a workspace ("Show more", "{n} more", "New session"). */
function QuietRow(props: { indent: number; icon?: IconName; label: string; accessibilityLabel: string; onPress: () => void }) {
  return (
    <TreeRow
      indent={props.indent}
      accessibilityLabel={props.accessibilityLabel}
      onPress={props.onPress}
      leading={props.icon ? <Icon name={props.icon} size={12} color={palette().chromeTextMuted} /> : <View />}
    >
      <Text style={{ ...textStyle("caption", { color: palette().chromeTextMuted }), flex: 1, minWidth: 0, numberOfLines: 1 }}>
        {props.label}
      </Text>
    </TreeRow>
  );
}

// ── Rows ─────────────────────────────────────────────────────────────────────

/** A quiet state: idle and stopped sessions draw no mark (one mark per row, only when it says something). */
function shownMark(mark: MarkState): MarkState | null {
  return mark === "idle" || mark === "stopped" ? null : mark;
}

function SessionRow(props: { node: DeviceTreeNode; workspaceId: string; row: TreeSession; indent: number; onNavigate?: () => void }) {
  const hovered = signal(false);
  const menuOpen = signal(false);
  const active = () =>
    (activeSessionId() === props.row.sessionId && (!fleetActive() || activeSessionDevice() === props.node.deviceId)) ||
    (splitPaneOpen() &&
      secondarySessionId() === props.row.sessionId &&
      (!fleetActive() || secondarySessionDevice() === props.node.deviceId));
  return (
    <TreeRow
      indent={props.indent}
      testID={`sidebar-session-${props.row.sessionId}`}
      active={active()}
      accessibilityLabel={props.row.title}
      onHover={value => hovered.set(value)}
      onPress={() => {
        openSessionRow(props.row.sessionId, props.node.deviceId, props.workspaceId);
        props.onNavigate?.();
      }}
      leading={<If when={shownMark(props.row.mark)}>{mark => <StateMark state={mark()} />}</If>}
      trailing={
        <HoverActions visible={hovered() || menuOpen() || touchFirst}>
          <RowMenuButton
            items={() => sessionMenuItems(sessionTarget(props.row, props.node.deviceId, props.workspaceId))}
            accessibilityLabel={`sidebar-session-actions-${props.row.sessionId}`}
            tooltip={tr("session.actions")}
            onOpenChange={open => menuOpen.set(open)}
          />
        </HoverActions>
      }
    >
      <RowLabel text={props.row.title} weight={props.row.mark === "done" ? "600" : "400"} />
    </TreeRow>
  );
}

function WorkspaceBranch(props: { node: DeviceTreeNode; workspace: TreeWorkspace; indent: number; onNavigate?: () => void }) {
  const hovered = signal(false);
  const menuOpen = signal(false);
  const key = () => workspaceKey(props.node.deviceId, props.workspace.workspaceId);
  const open = () => workspaceExpanded(props.node.deviceId, props.workspace.workspaceId);
  const visibleLimit = () => workspaceVisibleCount()[key()] ?? SESSION_PREVIEW;
  const rows = () => props.workspace.sessions.slice(0, visibleLimit());
  const hasMoreLoaded = () => props.workspace.sessions.length > visibleLimit();
  const unlisted = () => Math.max(0, props.workspace.total - props.workspace.sessions.length);
  const hasMore = () => hasMoreLoaded() || unlisted() > 0;
  const canShowLess = () => !hasMore() && visibleLimit() > SESSION_PREVIEW && props.workspace.sessions.length > SESSION_PREVIEW;
  const loadingMore = signal(false);
  /** Shows the next sessions: those already read first, then the next page from the device that owns the workspace. */
  const showMore = async () => {
    const k = key();
    const next = visibleLimit() + SESSION_MORE_STEP;
    if (next > props.workspace.sessions.length && unlisted() > 0) {
      loadingMore.set(true);
      try {
        await loadWorkspaceSessions(props.node.deviceId, props.workspace.workspaceId, Math.max(next, props.workspace.sessions.length + SESSION_PAGE));
      } finally {
        loadingMore.set(false);
      }
    }
    workspaceVisibleCount.update(all => ({ ...all, [k]: next }));
  };
  const current = () =>
    activeWorkspaceId() === props.workspace.workspaceId && (!fleetActive() || deviceContext() === props.node.deviceId);
  const newSession = () => {
    void newSessionHere(props.workspace.workspaceId, props.node.deviceId);
    props.onNavigate?.();
  };
  // Without the fleet layer a workspace other than the selected one reads its
  // own catalogue when it is open; the fleet index already carries the rows.
  effect(() => {
    // After the first workspace read, so the selected workspace (read in full by `loadSessions`) is known.
    if (fleetActive() || !workspacesLoaded() || !open() || current()) return;
    const id = props.workspace.workspaceId;
    if (localCatalogueRead.has(id)) return;
    localCatalogueRead.add(id);
    untracked(() => void loadLocalWorkspace(id));
  });
  // Sessions and quiet rows share the workspace's indent so their 16 px leading
  // slot sits directly under the workspace icon (for any active StateMark) and
  // their labels align vertically with the workspace title without a 24 px gap.
  const childIndent = () => props.indent;
  const host = () => remoteWorkspaceHost(props.workspace);
  return (
    <View accessibilityLabel={`sidebar-workspace-${props.workspace.workspaceId}`}>
      <TreeRow
        indent={props.indent}
        testID={`sidebar-workspace-row-${props.workspace.workspaceId}`}
        accessibilityLabel={`sidebar-workspace-toggle-${props.workspace.workspaceId}`}
        expanded={open()}
        onHover={value => hovered.set(value)}
        onPress={() => {
          const unfolding = !open();
          toggleWorkspace(props.node.deviceId, props.workspace.workspaceId);
          // With no conversation open, unfolding a workspace makes it the place
          // the tools, the Library and a new session use; an open conversation
          // keeps its own workspace (peeking at another one never closes it).
          if (unfolding && activeSessionId() === null) {
            selectWorkspace(props.workspace.workspaceId, fleetActive() ? { deviceId: props.node.deviceId } : undefined);
          }
        }}
        leading={
          <If
            when={hovered()}
            else={<Icon name={workspaceIcon(props.workspace, open())} size={16} color={palette().chromeTextMuted} />}
          >
            <View style={rotatingChevronStyle(open())}>
              <Icon name="chevron-right" size={12} color={palette().chromeTextMuted} />
            </View>
          </If>
        }
        trailing={
          <HoverActions visible={hovered() || menuOpen() || touchFirst}>
            <IconButton
              icon="plus"
              size="xs"
              surface="chrome"
              tooltip={tr("workspace.newSession")}
              accessibilityLabel={`sidebar-new-session-${props.workspace.workspaceId}`}
              onPress={newSession}
            />
            <RowMenuButton
              items={() => workspaceMenuItems(workspaceTarget(props.node, props.workspace), { onNewSession: newSession })}
              accessibilityLabel={`sidebar-workspace-actions-${props.workspace.workspaceId}`}
              tooltip={tr("workspace.actions")}
              onOpenChange={value => menuOpen.set(value)}
            />
          </HoverActions>
        }
      >
        <If
          when={host()}
          else={<RowLabel text={props.workspace.name} weight={current() ? "600" : "500"} />}
        >
          {remoteHost => (
            <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: space.xs }}>
              <Text
                style={{
                  ...textStyle("label", { color: palette().chromeText }),
                  fontWeight: current() ? "600" : "500",
                  flexShrink: 0,
                  maxWidth: "65%",
                  numberOfLines: 1,
                  textOverflow: "ellipsis",
                }}
              >
                {props.workspace.name}
              </Text>
              <Text
                testID={`sidebar-workspace-host-${props.workspace.workspaceId}`}
                style={{
                  ...textStyle("label", { color: palette().chromeTextMuted }),
                  flex: 1,
                  minWidth: 0,
                  numberOfLines: 1,
                  textOverflow: "ellipsis",
                }}
              >
                {`· ${remoteHost()}`}
              </Text>
            </View>
          )}
        </If>
      </TreeRow>
      <If when={open()}>
        <View>
          <Each of={rows()} key={row => row.sessionId}>
            {row => (
              <SessionRow
                node={props.node}
                workspaceId={props.workspace.workspaceId}
                row={row()}
                indent={childIndent()}
                onNavigate={props.onNavigate}
              />
            )}
          </Each>
          <If when={hasMore() || canShowLess()}>
            <QuietRow
              indent={childIndent()}
              label={
                loadingMore()
                  ? tr("common.loading")
                  : hasMore()
                    ? unlisted() > 0 && !hasMoreLoaded()
                      ? tr("allSessions.more", { count: unlisted() })
                      : tr("history.showMore")
                    : tr("common.showLess")
              }
              accessibilityLabel={`sidebar-show-more-${props.workspace.workspaceId}`}
              onPress={() => {
                if (loadingMore()) return;
                if (hasMore()) {
                  void showMore();
                  return;
                }
                const k = key();
                workspaceVisibleCount.update(all => {
                  const next = { ...all };
                  delete next[k];
                  return next;
                });
              }}
            />
          </If>
        </View>
      </If>
    </View>
  );
}

/** The device's words on its header: an exception ("Offline · 3 h ago", "Update needed"), else its roll-up mark. */
function DeviceState(props: { node: DeviceTreeNode }) {
  const exception = () => deviceException(props.node.state);
  return (
    <If when={exception()} else={<If when={props.node.rollup}>{mark => <StateMark state={mark()} />}</If>}>
      {kind => (
        <Text
          style={{
            ...textStyle("caption", {
              color: stateColor(kind() === "update_required" ? "needs_you" : "idle"),
              tabular: true,
            }),
            flexShrink: 0,
            maxWidth: space.x6l * 2,
            numberOfLines: 1,
            textOverflow: "ellipsis",
          }}
        >
          {kind() === "update_required"
            ? tr("device.updateNeeded")
            : props.node.asOfMs
              ? `${tr("state.offline")} · ${formatRelativeTime(props.node.asOfMs)}`
              : tr("state.offline")}
        </Text>
      )}
    </If>
  );
}

function DeviceSection(props: { node: DeviceTreeNode; onNavigate?: () => void }) {
  const hovered = signal(false);
  const menuOpen = signal(false);
  const open = () => deviceExpanded(props.node);
  const offline = () => deviceException(props.node.state) === "offline";
  const canCreate = () => deviceCanCreateWorkspace(props.node).allowed;
  // A device badge elsewhere asked to see this device: unfold it.
  effect(() => {
    if (revealedDevice() !== props.node.deviceId) return;
    untracked(() => {
      deviceFold.update(all => ({ ...all, [props.node.deviceId]: true }));
      revealedDevice.set(null);
    });
  });
  const id = () => props.node.deviceId || "local";
  return (
    <View accessibilityLabel={`sidebar-device-${id()}`} style={{ gap: space.hair }}>
      <TreeRow
        indent={0}
        testID={`sidebar-device-row-${id()}`}
        accessibilityLabel={`sidebar-device-toggle-${id()}`}
        expanded={open()}
        onHover={value => hovered.set(value)}
        onPress={() => {
          const next = !open();
          if (!next) resetDeviceVisibleCounts(props.node.deviceId);
          deviceFold.update(all => ({ ...all, [props.node.deviceId]: next }));
        }}
        trailing={
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs, flexShrink: 0 }}>
            <If when={!(hovered() || menuOpen() || touchFirst)}>
              <DeviceState node={props.node} />
            </If>
            <If when={hovered() || menuOpen() || touchFirst}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.hair }}>
                <If when={canCreate()}>
                  <IconButton
                    icon="folder-plus"
                    size="xs"
                    surface="chrome"
                    tooltip={tr("nav.newWorkspace")}
                    accessibilityLabel={`sidebar-new-workspace-${id()}`}
                    onPress={() => void newWorkspaceOn(props.node)}
                  />
                </If>
                <RowMenuButton
                  items={() => deviceMenuItems(props.node)}
                  accessibilityLabel={`sidebar-device-actions-${id()}`}
                  tooltip={tr("tree.deviceActions")}
                  onOpenChange={value => menuOpen.set(value)}
                />
              </View>
            </If>
          </View>
        }
      >
        {/* A device reads as the heading of its workspaces: small caps-style caption, no glyph or indent. */}
        <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: space.xs }}>
          <Text
            style={{
              ...textStyle("caption", { uppercase: true, color: palette().chromeTextMuted }),
              fontWeight: "600",
              opacity: offline() ? 0.6 : 1,
              flexShrink: 1,
              minWidth: 0,
              numberOfLines: 1,
              textOverflow: "ellipsis",
            }}
          >
            {props.node.name}
          </Text>
          <If when={props.node.isClient}>
            <Text style={{ ...textStyle("caption", { color: palette().chromeTextMuted }), flexShrink: 0, numberOfLines: 1 }}>
              {tr("device.thisDevice")}
            </Text>
          </If>
          {/* The fold state, shown while pointed at (a folded device always says so). */}
          <If when={hovered() || !open()}>
            <View style={rotatingChevronStyle(open())}>
              <Icon name="chevron-right" size={10} color={palette().chromeTextMuted} />
            </View>
          </If>
        </View>
      </TreeRow>
      <If when={open()}>
        <WorkspaceList node={props.node} indent={0} single={false} onNavigate={props.onNavigate} />
      </If>
    </View>
  );
}

function WorkspaceList(props: { node: DeviceTreeNode; indent: number; single: boolean; onNavigate?: () => void }) {
  return (
    <View style={{ gap: space.hair }}>
      <Each of={props.node.workspaces} key={workspace => workspace.workspaceId}>
        {workspace => (
          <WorkspaceBranch node={props.node} workspace={workspace()} indent={props.indent} onNavigate={props.onNavigate} />
        )}
      </Each>
      <RecentlyClosed node={props.node} indent={props.indent} />
      {/* An empty device offers its New workspace row when it is the only one or this device;
          other devices keep the action on their header, so a long device list stays calm. */}
      <If when={props.node.workspaces.length === 0 && (props.single || props.node.isClient)}>
        <QuietRow
          indent={props.indent}
          icon="folder-plus"
          label={tr("nav.newWorkspace")}
          accessibilityLabel={`sidebar-empty-new-workspace-${props.node.deviceId || "local"}`}
          onPress={() => void newWorkspaceOn(props.node)}
        />
      </If>
    </View>
  );
}

const recentlyClosedOpen = signal(false);

function recentLabel(record: { name?: string; rootPath?: string }): string {
  if (record.name) return record.name;
  const parts = (record.rootPath ?? "").split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? record.rootPath ?? "";
}

/**
 * The workspaces this backend closed recently: a folded "Recently closed (n)"
 * row under the device whose workspace list is loaded here (the only backend,
 * or the device context). A row reopens its workspace; its ⋯ removes it from
 * the list.
 */
function RecentlyClosed(props: { node: DeviceTreeNode; indent: number }) {
  const rows = () => {
    if (fleetActive() && props.node.deviceId !== deviceContext()) return [];
    const open = new Set(props.node.workspaces.map(workspace => workspace.workspaceId));
    return recentWorkspaces().filter(record => !open.has(record.id));
  };
  return (
    <If when={rows().length > 0}>
      <View style={{ gap: space.hair }}>
        <TreeRow
          indent={props.indent}
          accessibilityLabel="sidebar-recently-closed"
          expanded={recentlyClosedOpen()}
          onPress={() => recentlyClosedOpen.update(open => !open)}
          leading={
            <View style={rotatingChevronStyle(recentlyClosedOpen())}>
              <Icon name="chevron-right" size={12} color={palette().chromeTextMuted} />
            </View>
          }
        >
          <Text style={{ ...textStyle("caption", { color: palette().chromeTextMuted }), flex: 1, minWidth: 0, numberOfLines: 1 }}>
            {tr("allSessions.recentlyClosed", { count: rows().length })}
          </Text>
        </TreeRow>
        <If when={recentlyClosedOpen()}>
          <Each of={rows()} key={record => record.id}>
            {record => {
              const hovered = signal(false);
              const menuOpen = signal(false);
              return (
                <TreeRow
                  indent={props.indent + INDENT}
                  testID={`recent-workspace-${record().id}`}
                  accessibilityLabel={`recent-workspace-reopen-${record().id}`}
                  onHover={value => hovered.set(value)}
                  onPress={() => void openRecentWorkspace(record())}
                  leading={<Icon name="folder" size={14} color={palette().chromeTextMuted} />}
                  trailing={
                    <HoverActions visible={hovered() || menuOpen() || touchFirst}>
                      <RowMenuButton
                        items={() => [
                          {
                            id: `recent-workspace-open-${record().id}`,
                            label: tr("allSessions.reopen"),
                            icon: "folder-open",
                            onSelect: () => void openRecentWorkspace(record()),
                          },
                          {
                            id: `recent-workspace-remove-${record().id}`,
                            label: tr("allSessions.removeRecent"),
                            icon: "close",
                            accessibilityLabel: `recent-workspace-remove-${record().id}`,
                            onSelect: () => {
                              const name = recentLabel(record());
                              void forgetRecentWorkspace(record().id).then(() =>
                                pushToast(tr("allSessions.recentRemoved", { name }), "info"),
                              );
                            },
                          },
                        ]}
                        accessibilityLabel={`recent-workspace-actions-${record().id}`}
                        tooltip={tr("workspace.actions")}
                        onOpenChange={value => menuOpen.set(value)}
                      />
                    </HoverActions>
                  }
                >
                  <RowLabel text={recentLabel(record())} weight="400" muted />
                </TreeRow>
              );
            }}
          </Each>
        </If>
      </View>
    </If>
  );
}

/** The section title over a single device's tree ("Workspaces"); several devices head their own lists. */
function SectionHeader(props: { label: string; action?: JSX.Element }) {
  return (
    <View
      style={{
        height: controlHeight.sm,
        paddingLeft: space.sm,
        paddingRight: space.xs,
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
      }}
    >
      <Text
        role="header"
        style={{
          ...textStyle("caption", { color: palette().chromeTextMuted }),
          fontWeight: "500",
          flex: 1,
          minWidth: 0,
          numberOfLines: 1,
        }}
      >
        {props.label}
      </Text>
      {props.action}
    </View>
  );
}

/**
 * The account's runtime devices → workspaces → sessions. With one device its
 * workspaces sit directly under a "Workspaces" header; with several, each
 * device's name (upper case, no glyph) heads its workspaces at the same indent,
 * folds them, and carries its own new-workspace action and ⋯.
 */
export function DeviceSidebarTree(props: { onNavigate?: () => void }): JSX.Element {
  const nodes = deviceTree;
  const single = () => nodes().length <= 1;
  return (
    <View accessibilityLabel="sidebar-device-tree" style={{ gap: space.hair }}>
      <If
        when={single()}
        else={
          <>
            {/* No "Devices" title: each device row heads its own workspaces, a gap apart. */}
            <View style={{ gap: space.md }}>
              <Each of={nodes()} key={node => node.deviceId || "local"}>
                {node => <DeviceSection node={node()} onNavigate={props.onNavigate} />}
              </Each>
            </View>
          </>
        }
      >
        <SectionHeader
          label={tr("tree.workspaces")}
          action={
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.hair }}>
              <IconButton
                icon="folder-plus"
                size="xs"
                surface="chrome"
                tooltip={tr("nav.newWorkspace")}
                accessibilityLabel="sidebar-new-workspace"
                onPress={() => {
                  const node = nodes()[0];
                  if (node) void newWorkspaceOn(node);
                }}
              />
              {/* The one device has no row of its own: its menu (terminal, SSH, settings) sits here. */}
              <If when={nodes()[0]}>
                {node => (
                  <RowMenuButton
                    items={() => deviceMenuItems(node())}
                    accessibilityLabel={`sidebar-device-actions-${node().deviceId || "local"}`}
                    tooltip={tr("tree.deviceActions")}
                    onOpenChange={() => {}}
                  />
                )}
              </If>
            </View>
          }
        />
        <If when={nodes()[0]}>{node => <WorkspaceList node={node()} indent={0} single={true} onNavigate={props.onNavigate} />}</If>
      </If>
    </View>
  );
}
