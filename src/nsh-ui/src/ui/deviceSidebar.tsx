// The sidebar's device tree (wave 23, owner direction): every runtime device
// of the account → its workspaces → their sessions, the way the Tauri client's
// navigation panel laid them out, drawn in the NSH chrome language (visual
// spec §3 "Sidebar row", "Device rows"). A signed-out or single-device user
// sees this device's workspaces with no device header.
//
// Display only. The rows, their order (newest session first), states and the
// action gates are the backend's: the fleet navigator through `deviceTree()`
// (shared with All sessions › By device), or the host's own catalogue without
// the fleet layer. The only local state is which rows are folded.

import { effect, signal, Text, untracked, View, type JSX, type ViewRef } from "nsh";
import { fleetActive } from "../bridge";
import { tr } from "../i18n";
import {
  activeSessionDevice,
  activeSessionId,
  activeWorkspaceId,
  collapsedWorkspaces,
  deviceContext,
  openAllSessions,
  openDevicePage,
  selectDeviceContext,
  workspacesLoaded,
} from "../state";
import { fleetDeviceById } from "../fleetStore";
import {
  deviceTree,
  loadLocalWorkspace,
  newSessionHere,
  openSessionRow,
  remoteWorkspaceHost,
  sessionTarget,
  workspaceTarget,
  type DeviceTreeNode,
} from "../scenes/AllSessionsScene";
import { openNewWorkspaceModal } from "../sshRemoteStore";
import { controlHeight, palette, radii, space, textStyle } from "../theme";
import { formatRelativeTime } from "../format";
import { StateMark, deviceException, deviceGlyphIcon, stateColor, type MarkState } from "./fleet";
import { Icon, type IconName } from "./icons";
import { MOTION_DURATION, paintTransition } from "./motion";
import { DropdownMenu, type DropdownMenuItem } from "./overlays";
import { IconButton, focusRingStyle } from "./primitives";
import { sessionMenuItems } from "./sessionActions";
import { workspaceMenuItems } from "./workspaceActions";

type TreeWorkspace = DeviceTreeNode["workspaces"][number];
type TreeSession = TreeWorkspace["sessions"][number];

/** Sessions a workspace shows before "Show more". */
const SESSION_PREVIEW = 5;
/** One indent step: a 16 glyph plus its 8 gap, so a child's glyph sits under its parent's name. */
const INDENT = space.xxl;

/** Devices the user folded or unfolded here; unset follows the device's state. */
const deviceFold = signal<Record<string, boolean>>({});
/** Workspaces showing every session the backend listed, not only the newest five. */
const workspaceShowAll = signal<Record<string, boolean>>({});
/** Workspaces whose own catalogue was read once (without the fleet layer). */
const localCatalogueRead = new Set<string>();

function workspaceKey(deviceId: string, workspaceId: string): string {
  return `${deviceId}/${workspaceId}`;
}

function workspaceExpanded(deviceId: string, workspaceId: string): boolean {
  return collapsedWorkspaces()[workspaceKey(deviceId, workspaceId)] !== true;
}

function toggleWorkspace(deviceId: string, workspaceId: string): void {
  const key = workspaceKey(deviceId, workspaceId);
  const folded = collapsedWorkspaces()[key] === true;
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

/** Opens the new-workspace sheet (folder, SSH, container, WSL) on `deviceId`. */
async function newWorkspaceOn(deviceId: string): Promise<void> {
  if (fleetActive() && deviceId) await selectDeviceContext(deviceId);
  await openNewWorkspaceModal();
}

// ── Building blocks ──────────────────────────────────────────────────────────

/** A chrome row: 32 high, radius 8, hover and selection tints, keyboard focus ring. */
function TreeRow(props: {
  indent: number;
  active?: boolean;
  accessibilityLabel: string;
  testID?: string;
  expanded?: boolean;
  onPress: () => void;
  onHover?: (hovered: boolean) => void;
  leading: JSX.Element;
  children: JSX.Element;
  trailing?: JSX.Element;
}) {
  return (
    <View
      onMouseEnter={() => props.onHover?.(true)}
      onMouseLeave={() => props.onHover?.(false)}
      style={{
        height: controlHeight.md,
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
        <View style={{ width: space.lg, height: space.lg, alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          {props.leading}
        </View>
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
    activeSessionId() === props.row.sessionId && (!fleetActive() || activeSessionDevice() === props.node.deviceId);
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
        <HoverActions visible={hovered() || menuOpen()}>
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
  const showAll = () => workspaceShowAll()[key()] === true;
  const rows = () => (showAll() ? props.workspace.sessions : props.workspace.sessions.slice(0, SESSION_PREVIEW));
  const unlisted = () => Math.max(0, props.workspace.total - props.workspace.sessions.length);
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
        onPress={() => toggleWorkspace(props.node.deviceId, props.workspace.workspaceId)}
        leading={
          <If
            when={hovered()}
            else={<Icon name={workspaceIcon(props.workspace, open())} size={16} color={palette().chromeTextMuted} />}
          >
            <Icon name={open() ? "chevron-down" : "chevron-right"} size={12} color={palette().chromeTextMuted} />
          </If>
        }
        trailing={
          <HoverActions visible={hovered() || menuOpen()}>
            <IconButton
              icon="edit"
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
                  ...textStyle("caption", { color: palette().chromeTextMuted }),
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
          <If when={props.workspace.sessions.length > SESSION_PREVIEW}>
            <QuietRow
              indent={childIndent()}
              label={showAll() ? tr("common.showLess") : tr("history.showMore")}
              accessibilityLabel={`sidebar-show-more-${props.workspace.workspaceId}`}
              onPress={() => workspaceShowAll.update(all => ({ ...all, [key()]: !showAll() }))}
            />
          </If>
          <If when={unlisted() > 0 && (showAll() || props.workspace.sessions.length <= SESSION_PREVIEW)}>
            <QuietRow
              indent={childIndent()}
              label={tr("allSessions.more", { count: unlisted() })}
              accessibilityLabel={`sidebar-more-sessions-${props.workspace.workspaceId}`}
              onPress={() => {
                openAllSessions("by-device");
                props.onNavigate?.();
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
  const canCreate = () => {
    const gate = fleetDeviceById(props.node.deviceId)?.actions?.createWorkspace;
    return gate ? gate.allowed : !offline();
  };
  const id = () => props.node.deviceId || "local";
  return (
    <View accessibilityLabel={`sidebar-device-${id()}`} style={{ gap: space.hair }}>
      <TreeRow
        indent={0}
        testID={`sidebar-device-row-${id()}`}
        accessibilityLabel={`sidebar-device-toggle-${id()}`}
        expanded={open()}
        onHover={value => hovered.set(value)}
        onPress={() => deviceFold.update(all => ({ ...all, [props.node.deviceId]: !open() }))}
        leading={
          <If
            when={hovered()}
            else={<Icon name={deviceGlyphIcon(props.node.kind)} size={16} color={palette().chromeTextMuted} />}
          >
            <Icon name={open() ? "chevron-down" : "chevron-right"} size={12} color={palette().chromeTextMuted} />
          </If>
        }
        trailing={
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs, flexShrink: 0 }}>
            <If when={!(hovered() || menuOpen())}>
              <DeviceState node={props.node} />
            </If>
            <If when={hovered() || menuOpen()}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.hair }}>
                <If when={canCreate()}>
                  <IconButton
                    icon="folder-plus"
                    size="xs"
                    surface="chrome"
                    tooltip={tr("nav.newWorkspace")}
                    accessibilityLabel={`sidebar-new-workspace-${id()}`}
                    onPress={() => void newWorkspaceOn(props.node.deviceId)}
                  />
                </If>
                <RowMenuButton
                  items={() => [
                    {
                      id: `sidebar-device-details-${id()}`,
                      label: tr("tree.deviceDetails"),
                      icon: "info",
                      accessibilityLabel: `sidebar-device-details-${id()}`,
                      onSelect: () => {
                        openDevicePage(props.node.deviceId);
                        props.onNavigate?.();
                      },
                    },
                  ]}
                  accessibilityLabel={`sidebar-device-actions-${id()}`}
                  tooltip={tr("tree.deviceActions")}
                  onOpenChange={value => menuOpen.set(value)}
                />
              </View>
            </If>
          </View>
        }
      >
        <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <Text
            style={{
              ...textStyle("label", { color: offline() ? palette().chromeTextMuted : palette().chromeText }),
              fontWeight: "600",
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
        </View>
      </TreeRow>
      <If when={open()}>
        <WorkspaceList node={props.node} indent={INDENT} onNavigate={props.onNavigate} />
      </If>
    </View>
  );
}

function WorkspaceList(props: { node: DeviceTreeNode; indent: number; onNavigate?: () => void }) {
  return (
    <View style={{ gap: space.hair }}>
      <Each of={props.node.workspaces} key={workspace => workspace.workspaceId}>
        {workspace => (
          <WorkspaceBranch node={props.node} workspace={workspace()} indent={props.indent} onNavigate={props.onNavigate} />
        )}
      </Each>
      {/* An empty device offers its New workspace row when it is the only one or this device;
          other devices keep the action on their header, so a long device list stays calm. */}
      <If when={props.node.workspaces.length === 0 && (props.indent === 0 || props.node.isClient)}>
        <QuietRow
          indent={props.indent}
          icon="folder-plus"
          label={tr("nav.newWorkspace")}
          accessibilityLabel={`sidebar-empty-new-workspace-${props.node.deviceId || "local"}`}
          onPress={() => void newWorkspaceOn(props.node.deviceId)}
        />
      </If>
    </View>
  );
}

/** The section title over the tree: "Workspaces" with one device, "Devices" with several. */
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
 * device is a foldable header that carries its own new-workspace action.
 */
export function DeviceSidebarTree(props: { onNavigate?: () => void }): JSX.Element {
  const nodes = () => deviceTree();
  const single = () => nodes().length <= 1;
  return (
    <View accessibilityLabel="sidebar-device-tree" style={{ gap: space.hair }}>
      <If
        when={single()}
        else={
          <>
            <SectionHeader label={tr("nav.devices")} />
            <Each of={nodes()} key={node => node.deviceId || "local"}>
              {node => <DeviceSection node={node()} onNavigate={props.onNavigate} />}
            </Each>
          </>
        }
      >
        <SectionHeader
          label={tr("tree.workspaces")}
          action={
            <IconButton
              icon="folder-plus"
              size="xs"
              surface="chrome"
              tooltip={tr("nav.newWorkspace")}
              accessibilityLabel="sidebar-new-workspace"
              onPress={() => void newWorkspaceOn(nodes()[0]?.deviceId ?? "")}
            />
          }
        />
        <If when={nodes()[0]}>{node => <WorkspaceList node={node()} indent={0} onNavigate={props.onNavigate} />}</If>
      </If>
    </View>
  );
}
