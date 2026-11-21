// All sessions (visual spec §4.6, ux-redesign §3.6): every agent session on
// every device, as Recent (one flat list) or By device (device → workspace →
// session). It is the browse path; work usually starts in the OpenBitFun
// conversation.
//
// Display only. Order, states, roll-ups and folding hints come from the
// backend: the fleet navigator on a fleet entry (`fleet_recent_sessions` when
// the entry serves it), the host's own catalogue otherwise. Nothing here sorts
// rows; the only local state is which rows are folded and the search text.

import { Scroll, Text, View, signal, type JSX } from "nsh";
import { listSessions, type SessionSummary } from "../api";
import { fleetActive } from "../bridge";
import { fleetDevices, fleetNavigator } from "../fleetStore";
import type { FleetDevice, FleetSession, FleetWorkspace } from "../fleetTypes";
import { formatRelativeTime } from "../format";
import { FLEET_ENTRY_COMMANDS } from "../generated/peerSurface";
import { invokeCommand } from "../bridge";
import { tr } from "../i18n";
import { localDeviceId } from "../devicePrefsStore";
import { statusOfSession } from "../sessionStatusStore";
import { loadAgentModes } from "../agentModeStore";
import {
  allSessionsView,
  activeWorkspaceId,
  createSessionInWorkspace,
  deviceContext,
  forgetRecentWorkspace,
  openRecentWorkspace,
  recentWorkspaces,
  isSessionArchived,
  navigateScene,
  openDevicePage,
  selectSession,
  selectWorkspace,
  sessionLastActivityMs,
  sessions,
  workspaces,
  type AllSessionsView,
} from "../state";
import { compactLayout, controlHeight, layout, palette, radii, space, textStyle, touchSlop } from "../theme";
import {
  DeviceBadge,
  StateMark,
  deviceException,
  deviceGlyphIcon,
  localSessionMarkState,
  rollupMarkState,
  sessionMarkState,
  type MarkState,
} from "../ui/fleet";
import { Icon } from "../ui/icons";
import { MOTION_DURATION, paintTransition } from "../ui/motion";
import { Button, EmptyStateCard, SearchInput, SegmentedTabs } from "../ui/primitives";
import { pushToast } from "../ui/overlays";
import { MoreMenu } from "../ui/studio";
import { sessionMenuItems, type SessionActionTarget } from "../ui/sessionActions";
import { workspaceMenuItems, type WorkspaceActionTarget } from "../ui/workspaceActions";

/** One Recent row, whatever source it came from. */
interface RecentRow {
  key: string;
  deviceId: string;
  deviceName: string;
  deviceKind: string;
  workspaceId: string;
  workspaceName: string;
  sessionId: string;
  title: string;
  mark: MarkState;
  ageMs?: number;
}

/** Above this many devices the By device view offers a filter field. */
const DEVICE_FILTER_THRESHOLD = 8;
/** Sessions a workspace previews before "{count} more". */
const WORKSPACE_PREVIEW = 3;

const searchText = signal("");
const deviceFilter = signal("");
/** Devices the user folded or unfolded here; unset follows the backend's hint. */
const deviceFold = signal<Record<string, boolean>>({});
const workspaceOpen = signal<Record<string, boolean>>({});
const offlineGroupOpen = signal(false);
/** The entry's flat Recent list, when it serves one. */
const recentFromEntry = signal<ServedRecentSession[] | null>(null);
/** Other workspaces' catalogues on a host without the fleet layer. */
const localWorkspaceRows = signal<Record<string, SessionSummary[]>>({});

function matches(text: string, needle: string): boolean {
  const query = needle.trim().toLowerCase();
  return !query || text.toLowerCase().includes(query);
}

function workspaceLabel(workspace: { name?: string; rootPath?: string }): string {
  if (workspace.name) return workspace.name;
  const path = workspace.rootPath ?? "";
  // Remote roots are POSIX on every client; local roots may be Windows paths.
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function openSessionRow(sessionId: string, deviceId: string, workspaceId: string): void {
  if (fleetActive()) {
    selectSession(sessionId, deviceId, workspaceId || undefined);
  } else {
    if (workspaceId && workspaceId !== activeWorkspaceId()) selectWorkspace(workspaceId);
    selectSession(sessionId);
  }
  navigateScene("sessions");
}

async function newSessionHere(workspaceId: string, deviceId: string): Promise<void> {
  selectWorkspace(workspaceId, fleetActive() ? { deviceId } : undefined);
  // backend-owned: `create_session` requires an agent type, and the host's
  // default (`default_mode_strategy` / `last_mode_id`) arrives with its mode
  // catalogue, so that is read first; a default applied by `create_session`
  // itself would be better.
  await loadAgentModes(workspaceId);
  await createSessionInWorkspace(tr("nav.newSession"));
  navigateScene("sessions");
}

// ── Sources ──────────────────────────────────────────────────────────────────

/** Whether the entry serves the flat, backend-ordered Recent list. */
function entryServesRecent(): boolean {
  return FLEET_ENTRY_COMMANDS.has("fleet_recent_sessions");
}

async function loadRecentFromEntry(): Promise<void> {
  try {
    const answer = await invokeCommand<{ sessions?: ServedRecentSession[] }>("fleet_recent_sessions", {});
    recentFromEntry.set(Array.isArray(answer?.sessions) ? answer.sessions : []);
  } catch (error) {
    console.warn(`fleet_recent_sessions failed: ${error instanceof Error ? error.message : String(error)}`);
    recentFromEntry.set(null);
  }
}

/** A `fleet_recent_sessions` row: the session plus the labels the entry projected (`FleetRecentSession`). */
type ServedRecentSession = FleetSession & {
  deviceName?: string;
  hostKind?: string;
  workspaceName?: string;
};

function fleetRecentRow(device: FleetDevice | undefined, workspace: FleetWorkspace | undefined, row: ServedRecentSession): RecentRow {
  return {
    key: `${row.deviceId}/${row.sessionId}`,
    deviceId: row.deviceId,
    deviceName: row.deviceName || device?.name || row.deviceId,
    deviceKind: row.hostKind || device?.hostKind || "",
    workspaceId: row.workspaceId,
    workspaceName: row.workspaceName || (workspace ? workspaceLabel(workspace) : ""),
    sessionId: row.sessionId,
    title: row.title || tr("allSessions.untitled"),
    mark: sessionMarkState(row),
    ageMs: row.lastActivityMs,
  };
}

/** Recent rows in the backend's order: the entry's list, else the navigator as it lists them. */
function recentRows(): RecentRow[] {
  if (fleetActive()) {
    const devices = fleetDevices();
    const byDevice = new Map(devices.map(device => [device.deviceId, device]));
    const served = recentFromEntry();
    if (served) {
      return served.map(row => {
        const device = byDevice.get(row.deviceId);
        return fleetRecentRow(device, device?.workspaces.find(item => item.workspaceId === row.workspaceId), row);
      });
    }
    return devices.flatMap(device =>
      device.workspaces.flatMap(workspace => workspace.sessions.map(row => fleetRecentRow(device, workspace, row))),
    );
  }
  const workspace = workspaces().find(item => item.id === activeWorkspaceId());
  return sessions()
    .filter(row => !isSessionArchived(row))
    .map(row => ({
      key: `/${row.sessionId}`,
      deviceId: "",
      deviceName: tr("device.thisDevice"),
      deviceKind: "laptop",
      workspaceId: row.workspaceId ?? workspace?.id ?? "",
      workspaceName: workspace ? workspaceLabel(workspace) : "",
      sessionId: row.sessionId,
      title: row.sessionName || tr("allSessions.untitled"),
      mark: localSessionMarkState(statusOfSession()(row.sessionId)?.kind),
      ageMs: sessionLastActivityMs(row),
    }));
}

async function loadLocalWorkspace(workspaceId: string): Promise<void> {
  try {
    const page = await listSessions(workspaceId, 20);
    localWorkspaceRows.update(all => ({
      ...all,
      [workspaceId]: (page.sessions ?? []).filter(row => !isSessionArchived(row)),
    }));
  } catch (error) {
    console.warn(`list sessions for ${workspaceId} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// ── Rows ─────────────────────────────────────────────────────────────────────

function Age(props: { ms?: number }) {
  return (
    <If when={formatRelativeTime(props.ms)}>
      {text => (
        <Text style={{ ...textStyle("caption", { tabular: true }), flexShrink: 0, numberOfLines: 1 }}>{text()}</Text>
      )}
    </If>
  );
}

function rowHover() {
  return { backgroundColor: palette().panelHover };
}

/** The session ⋯ target of a row. */
function sessionTarget(row: { sessionId: string; title: string }, deviceId: string, workspaceId: string): SessionActionTarget {
  return { sessionId: row.sessionId, deviceId, workspaceId, title: row.title, archived: false };
}

/**
 * A row's ⋯: drawn on hover or focus on desktop (kept mounted so an open menu
 * survives the pointer leaving the row) and always on a phone.
 */
function RowMenu(props: { target: SessionActionTarget; visible: boolean }) {
  return (
    <View style={{ opacity: props.visible || compactLayout() ? 1 : 0, flexShrink: 0 }}>
      <MoreMenu
        items={sessionMenuItems(props.target)}
        accessibilityLabel={`session-actions-${props.target.sessionId}`}
        tooltip={tr("session.actions")}
        size="xs"
      />
    </View>
  );
}

function RecentSessionRow(props: { row: RecentRow }) {
  const phone = () => compactLayout();
  const hovered = signal(false);
  return (
    <View
      role="button"
      accessibilityLabel={props.row.title}
      testID={`recent-row-${props.row.sessionId}`}
      onMouseEnter={() => hovered.set(true)}
      onMouseLeave={() => hovered.set(false)}
      onPress={() => openSessionRow(props.row.sessionId, props.row.deviceId, props.row.workspaceId)}
      hitSlop={touchSlop(phone() ? 44 : 36)}
      style={{
        minHeight: phone() ? layout.touchTarget : 36,
        paddingHorizontal: space.sm,
        paddingVertical: phone() ? space.xs : 0,
        borderRadius: radii.md,
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        cursor: "pointer",
        ...paintTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={rowHover()}
    >
      <StateMark state={props.row.mark} />
      <If
        when={phone()}
        else={
          <>
            <Text style={{ ...textStyle("label"), flex: 1, minWidth: 0, numberOfLines: 1, textOverflow: "ellipsis" }}>
              {props.row.title}
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs, flexShrink: 1, minWidth: 0, maxWidth: "40%" }}>
              <DeviceBadge
                name={props.row.deviceName}
                kind={props.row.deviceKind}
                onPress={props.row.deviceId ? () => openDevicePage(props.row.deviceId) : undefined}
              />
              <If when={props.row.workspaceName}>
                {name => (
                  <Text style={{ ...textStyle("caption"), flexShrink: 1, minWidth: 0, numberOfLines: 1, textOverflow: "ellipsis" }}>
                    {`· ${name()}`}
                  </Text>
                )}
              </If>
            </View>
            <Age ms={props.row.ageMs} />
            <RowMenu target={sessionTarget(props.row, props.row.deviceId, props.row.workspaceId)} visible={hovered()} />
          </>
        }
      >
        <View style={{ flex: 1, minWidth: 0, gap: space.hair }}>
          <Text style={{ ...textStyle("label"), numberOfLines: 1, textOverflow: "ellipsis" }}>{props.row.title}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs, minWidth: 0 }}>
            <DeviceBadge name={props.row.deviceName} kind={props.row.deviceKind} />
            <If when={formatRelativeTime(props.row.ageMs)}>
              {text => <Text style={{ ...textStyle("caption", { tabular: true }), numberOfLines: 1 }}>{`· ${text()}`}</Text>}
            </If>
          </View>
        </View>
        <RowMenu target={sessionTarget(props.row, props.row.deviceId, props.row.workspaceId)} visible={true} />
        <Icon name="chevron-right" size={12} color={palette().textMuted} />
      </If>
    </View>
  );
}

function RecentList() {
  const rows = () => recentRows().filter(row => matches(`${row.title} ${row.deviceName} ${row.workspaceName}`, searchText()));
  return (
    <If
      when={rows().length > 0}
      else={
        <If
          when={searchText().trim()}
          else={<EmptyStateCard icon="layers" title={tr("allSessions.emptyTitle")} subtitle={tr("allSessions.emptyBody")} />}
        >
          {query => <EmptyStateCard icon="search" title={tr("allSessions.noMatch", { query: query() })} />}
        </If>
      }
    >
      <View accessibilityLabel="all-sessions-recent" style={{ gap: 0 }}>
        <Each of={rows()} key={row => row.key}>
          {row => <RecentSessionRow row={row()} />}
        </Each>
      </View>
    </If>
  );
}

// ── By device ────────────────────────────────────────────────────────────────

interface DeviceTreeNode {
  deviceId: string;
  name: string;
  kind: string;
  isClient: boolean;
  state: string;
  asOfMs?: number;
  rollup: MarkState | null;
  expandedHint: boolean;
  workspaces: Array<{
    workspaceId: string;
    name: string;
    rootPath: string;
    kind?: string;
    sshHost?: string;
    sessions: Array<{ sessionId: string; title: string; mark: MarkState; ageMs?: number }>;
    total: number;
  }>;
}

function deviceUiHint(device: FleetDevice): { expanded?: boolean; rollup?: string } {
  const ui = (device as unknown as { ui?: { expanded?: boolean; rollup?: string } }).ui;
  return ui ?? {};
}

function deviceTree(): DeviceTreeNode[] {
  if (fleetActive()) {
    return fleetDevices()
      // Runtime devices only: the cloud node and frontends (phones, browsers) keep no sessions here.
      .filter(device => device.hostKind !== "cloud" && (!device.isClientDevice || device.workspaces.length > 0))
      .map(device => {
        const hint = deviceUiHint(device);
        return {
          deviceId: device.deviceId,
          name: device.name,
          kind: device.hostKind,
          isClient: device.isClientDevice,
          state: device.state,
          asOfMs: device.asOfMs,
          rollup: rollupMarkState(hint.rollup),
          // Devices fold except this one and those the backend flags expanded.
          expandedHint: hint.expanded ?? device.isClientDevice,
          workspaces: device.workspaces.map(workspace => ({
            workspaceId: workspace.workspaceId,
            name: workspaceLabel(workspace),
            rootPath: workspace.rootPath,
            kind: workspace.kind,
            sshHost: workspace.sshHost,
            total: workspace.sessionTotal,
            sessions: workspace.sessions.map(row => ({
              sessionId: row.sessionId,
              title: row.title || tr("allSessions.untitled"),
              mark: sessionMarkState(row),
              ageMs: row.lastActivityMs,
            })),
          })),
        };
      });
  }
  // One host, one device: this machine.
  const status = statusOfSession();
  return [
    {
      deviceId: localDeviceId() ?? "",
      name: tr("device.thisDevice"),
      kind: "laptop",
      isClient: false,
      state: "online",
      rollup: null,
      expandedHint: true,
      workspaces: workspaces().map(workspace => {
        const rows =
          workspace.id === activeWorkspaceId()
            ? sessions().filter(row => !isSessionArchived(row))
            : localWorkspaceRows()[workspace.id] ?? [];
        return {
          workspaceId: workspace.id,
          name: workspaceLabel(workspace),
          rootPath: workspace.rootPath,
          kind: workspace.workspaceKind,
          sshHost: workspace.sshHost,
          total: rows.length,
          sessions: rows.map(row => ({
            sessionId: row.sessionId,
            title: row.sessionName || tr("allSessions.untitled"),
            mark: localSessionMarkState(status(row.sessionId)?.kind),
            ageMs: sessionLastActivityMs(row),
          })),
        };
      }),
    },
  ];
}

function deviceExpanded(node: DeviceTreeNode): boolean {
  return deviceFold()[node.deviceId] ?? node.expandedHint;
}

function DeviceStateWords(props: { node: DeviceTreeNode }) {
  const exception = () => deviceException(props.node.state);
  return (
    <If
      when={exception()}
      else={
        <If when={props.node.rollup}>{mark => <StateMark state={mark()} />}</If>
      }
    >
      {kind => (
        <Text
          style={{
            ...textStyle("caption", {
              color: kind() === "update_required" ? palette().warning : palette().textMuted,
              tabular: true,
            }),
            flexShrink: 0,
            numberOfLines: 1,
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

function DeviceHeader(props: { node: DeviceTreeNode }) {
  const open = () => deviceExpanded(props.node);
  return (
    <View
      testID={`device-header-${props.node.deviceId || "local"}`}
      style={{ height: 40, flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.xs }}
    >
      <View
        role="button"
        accessibilityLabel={`device-fold-${props.node.deviceId || "local"}`}
        accessibilityState={{ expanded: open() }}
        hitSlop={touchSlop(24, space.xs)}
        onPress={() => deviceFold.update(all => ({ ...all, [props.node.deviceId]: !open() }))}
        style={{ width: 16, height: 16, alignItems: "center", justifyContent: "center", cursor: "pointer" }}
      >
        <Icon name={open() ? "chevron-down" : "chevron-right"} size={12} color={palette().textMuted} />
      </View>
      <View
        role="button"
        accessibilityLabel={`device-open-${props.node.deviceId || "local"}`}
        onPress={() => openDevicePage(props.node.deviceId)}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          flex: 1,
          minWidth: 0,
          cursor: "pointer",
        }}
      >
        <Icon name={deviceGlyphIcon(props.node.kind)} size={16} color={palette().textSecondary} />
        <Text style={{ ...textStyle("body"), fontWeight: "600", flexShrink: 1, minWidth: 0, numberOfLines: 1, textOverflow: "ellipsis" }}>
          {props.node.name}
        </Text>
        <If when={props.node.isClient}>
          <Text style={{ ...textStyle("caption"), flexShrink: 0 }}>{tr("device.thisDevice")}</Text>
        </If>
      </View>
      <DeviceStateWords node={props.node} />
    </View>
  );
}

function workspaceTarget(node: DeviceTreeNode, workspace: DeviceTreeNode["workspaces"][number]): WorkspaceActionTarget {
  return {
    workspaceId: workspace.workspaceId,
    deviceId: node.deviceId,
    name: workspace.name,
    rootPath: workspace.rootPath,
    kind: workspace.kind,
    sshHost: workspace.sshHost,
  };
}

function TreeSessionRow(props: {
  node: DeviceTreeNode;
  workspaceId: string;
  row: DeviceTreeNode["workspaces"][number]["sessions"][number];
}) {
  const hovered = signal(false);
  return (
    <View
      role="button"
      accessibilityLabel={props.row.title}
      onMouseEnter={() => hovered.set(true)}
      onMouseLeave={() => hovered.set(false)}
      onPress={() => openSessionRow(props.row.sessionId, props.node.deviceId, props.workspaceId)}
      style={{
        height: controlHeight.md,
        paddingLeft: 52,
        paddingRight: space.sm,
        borderRadius: radii.md,
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        cursor: "pointer",
        ...paintTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={rowHover()}
    >
      <StateMark state={props.row.mark} />
      <Text style={{ ...textStyle("label"), fontWeight: "400", flex: 1, minWidth: 0, numberOfLines: 1, textOverflow: "ellipsis" }}>
        {props.row.title}
      </Text>
      <Age ms={props.row.ageMs} />
      <RowMenu target={sessionTarget(props.row, props.node.deviceId, props.workspaceId)} visible={hovered()} />
    </View>
  );
}

function WorkspaceBranch(props: { node: DeviceTreeNode; workspace: DeviceTreeNode["workspaces"][number] }) {
  const key = () => `${props.node.deviceId}/${props.workspace.workspaceId}`;
  const open = () => workspaceOpen()[key()] ?? false;
  const hovered = signal(false);
  const preview = () => {
    const titles = props.workspace.sessions.slice(0, WORKSPACE_PREVIEW).map(row => row.title);
    const rest = props.workspace.total - titles.length;
    return rest > 0 ? [...titles, tr("allSessions.more", { count: rest })].join(" · ") : titles.join(" · ");
  };
  const toggle = () => {
    const next = !open();
    workspaceOpen.update(all => ({ ...all, [key()]: next }));
    if (!next) return;
    // Opening a workspace makes it the place the tools, the Library and a new session use.
    selectWorkspace(props.workspace.workspaceId, fleetActive() ? { deviceId: props.node.deviceId } : undefined);
    if (!fleetActive() && props.workspace.workspaceId !== activeWorkspaceId()) {
      void loadLocalWorkspace(props.workspace.workspaceId);
    }
  };
  return (
    <View>
      <View
        role="button"
        accessibilityLabel={`workspace-row-${props.workspace.workspaceId}`}
        accessibilityState={{ expanded: open() }}
        onPress={toggle}
        onMouseEnter={() => hovered.set(true)}
        onMouseLeave={() => hovered.set(false)}
        style={{
          minHeight: 36,
          paddingLeft: 28,
          paddingRight: space.sm,
          borderRadius: radii.md,
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          cursor: "pointer",
          ...paintTransition(MOTION_DURATION.fast),
        }}
        hoverStyle={rowHover()}
      >
        <Icon name="folder" size={14} color={palette().textMuted} />
        <Text style={{ ...textStyle("label"), flexShrink: 0, maxWidth: "40%", numberOfLines: 1, textOverflow: "ellipsis" }}>
          {props.workspace.name}
        </Text>
        <Text style={{ ...textStyle("caption"), flex: 1, minWidth: 0, numberOfLines: 1, textOverflow: "ellipsis" }}>
          {preview()}
        </Text>
        <View style={{ opacity: hovered() || compactLayout() ? 1 : 0, flexShrink: 0 }}>
          <MoreMenu
            items={workspaceMenuItems(workspaceTarget(props.node, props.workspace), {
              onNewSession: () => void newSessionHere(props.workspace.workspaceId, props.node.deviceId),
            })}
            accessibilityLabel={`workspace-actions-${props.workspace.workspaceId}`}
            tooltip={tr("workspace.actions")}
            size="xs"
          />
        </View>
        <If when={hovered() || compactLayout()}>
          <Button
            label={tr("allSessions.newHere")}
            variant="ghost"
            size="xs"
            accessibilityLabel={`new-session-here-${props.workspace.workspaceId}`}
            onPress={() => void newSessionHere(props.workspace.workspaceId, props.node.deviceId)}
          />
        </If>
      </View>
      <If when={open()}>
        <View>
          <Each of={props.workspace.sessions} key={row => row.sessionId}>
            {row => <TreeSessionRow node={props.node} workspaceId={props.workspace.workspaceId} row={row()} />}
          </Each>
        </View>
      </If>
    </View>
  );
}

const recentlyClosedOpen = signal(false);

/**
 * The workspaces this backend closed recently (the old sidebar's Recent
 * group): reopen one, or remove it from the list. Drawn under the device whose
 * workspace list is loaded here (the only backend, or the device context).
 */
function RecentlyClosed(props: { node: DeviceTreeNode }) {
  const rows = () => {
    if (fleetActive() && props.node.deviceId !== deviceContext()) return [];
    const open = new Set(props.node.workspaces.map(workspace => workspace.workspaceId));
    return recentWorkspaces().filter(record => !open.has(record.id));
  };
  return (
    <If when={rows().length > 0}>
      <View>
        <View
          role="button"
          accessibilityLabel="all-sessions-recently-closed"
          accessibilityState={{ expanded: recentlyClosedOpen() }}
          onPress={() => recentlyClosedOpen.update(open => !open)}
          style={{ minHeight: 36, paddingLeft: 28, paddingRight: space.sm, flexDirection: "row", alignItems: "center", gap: space.sm, cursor: "pointer" }}
        >
          <Icon name={recentlyClosedOpen() ? "chevron-down" : "chevron-right"} size={12} color={palette().textMuted} />
          <Text style={textStyle("caption")}>{tr("allSessions.recentlyClosed", { count: rows().length })}</Text>
        </View>
        <If when={recentlyClosedOpen()}>
          <View>
            <Each of={rows()} key={record => record.id}>
              {record => (
                <View
                  testID={`recent-workspace-${record().id}`}
                  style={{ minHeight: 36, paddingLeft: 52, paddingRight: space.sm, flexDirection: "row", alignItems: "center", gap: space.sm }}
                >
                  <Icon name="folder" size={14} color={palette().textMuted} />
                  <Text style={{ ...textStyle("label"), fontWeight: "400", flexShrink: 0, maxWidth: "40%", numberOfLines: 1, textOverflow: "ellipsis" }}>
                    {workspaceLabel(record())}
                  </Text>
                  <Text style={{ ...textStyle("caption"), flex: 1, minWidth: 0, numberOfLines: 1, textOverflow: "ellipsis-middle" }}>
                    {record().rootPath}
                  </Text>
                  <Button
                    label={tr("allSessions.reopen")}
                    variant="ghost"
                    size="xs"
                    accessibilityLabel={`recent-workspace-reopen-${record().id}`}
                    onPress={() => void openRecentWorkspace(record())}
                  />
                  <MoreMenu
                    items={[
                      {
                        id: `recent-workspace-remove-${record().id}`,
                        label: tr("allSessions.removeRecent"),
                        icon: "close",
                        accessibilityLabel: `recent-workspace-remove-${record().id}`,
                        onSelect: () => {
                          const name = workspaceLabel(record());
                          void forgetRecentWorkspace(record().id).then(() =>
                            pushToast(tr("allSessions.recentRemoved", { name }), "info"),
                          );
                        },
                      },
                    ]}
                    accessibilityLabel={`recent-workspace-actions-${record().id}`}
                    size="xs"
                  />
                </View>
              )}
            </Each>
          </View>
        </If>
      </View>
    </If>
  );
}

function DeviceSection(props: { node: DeviceTreeNode }) {
  return (
    <View accessibilityLabel={`device-section-${props.node.deviceId || "local"}`}>
      <DeviceHeader node={props.node} />
      <If when={deviceExpanded(props.node)}>
        <View>
          <Each of={props.node.workspaces} key={workspace => workspace.workspaceId}>
            {workspace => <WorkspaceBranch node={props.node} workspace={workspace()} />}
          </Each>
          <RecentlyClosed node={props.node} />
        </View>
      </If>
    </View>
  );
}

function ByDeviceList() {
  const all = () => deviceTree();
  const visible = () => all().filter(node => matches(node.name, deviceFilter()));
  /**
   * Offline devices the backend lists last fold into one group. The order is
   * the backend's: only a trailing run of offline devices is grouped.
   */
  const split = () => {
    const nodes = visible();
    let cut = nodes.length;
    while (cut > 0 && nodes[cut - 1]!.state === "offline") cut -= 1;
    const tail = nodes.slice(cut);
    return tail.length >= 2 ? { head: nodes.slice(0, cut), offline: tail } : { head: nodes, offline: [] };
  };
  return (
    <View accessibilityLabel="all-sessions-by-device" style={{ gap: space.xs }}>
      <If when={all().length > DEVICE_FILTER_THRESHOLD}>
        <SearchInput
          value={deviceFilter()}
          onChange={value => deviceFilter.set(value)}
          placeholder={tr("allSessions.filterDevices")}
          accessibilityLabel="all-sessions-device-filter"
          size="md"
        />
      </If>
      <Each of={split().head} key={node => node.deviceId || "local"}>
        {node => <DeviceSection node={node()} />}
      </Each>
      <If when={split().offline.length > 0}>
        <View>
          <View
            role="button"
            accessibilityLabel="all-sessions-offline-group"
            accessibilityState={{ expanded: offlineGroupOpen() }}
            onPress={() => offlineGroupOpen.update(open => !open)}
            style={{ height: 40, flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.xs, cursor: "pointer" }}
          >
            <Icon name={offlineGroupOpen() ? "chevron-down" : "chevron-right"} size={12} color={palette().textMuted} />
            <Text style={{ ...textStyle("label", { color: palette().textSecondary }), fontWeight: "600" }}>
              {tr("allSessions.offlineGroup", { count: split().offline.length })}
            </Text>
          </View>
          <If when={offlineGroupOpen()}>
            <View>
              <Each of={split().offline} key={node => node.deviceId}>
                {node => <DeviceSection node={node()} />}
              </Each>
            </View>
          </If>
        </View>
      </If>
      <If when={fleetActive() && fleetDevices().some(device => device.sessionsTruncated)}>
        <Text style={{ ...textStyle("caption"), paddingHorizontal: space.xs, paddingTop: space.sm }}>
          {tr("allSessions.notIndexed")}
        </Text>
      </If>
    </View>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

function Header() {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, minWidth: 0, flexWrap: "wrap" }}>
      <If when={!compactLayout()}>
        <Text role="header" style={{ ...textStyle("pageTitle"), flex: 1, minWidth: 0, numberOfLines: 1 }}>
          {tr("allSessions.title")}
        </Text>
      </If>
      <SegmentedTabs<AllSessionsView>
        size="sm"
        options={[
          { value: "recent", label: tr("allSessions.recent"), accessibilityLabel: "all-sessions-tab-recent" },
          { value: "by-device", label: tr("allSessions.byDevice"), accessibilityLabel: "all-sessions-tab-by-device" },
        ]}
        value={allSessionsView()}
        onChange={value => allSessionsView.set(value)}
      />
    </View>
  );
}

/** The All sessions route. */
export function AllSessionsScene(): JSX.Element {
  if (fleetActive() && entryServesRecent()) void loadRecentFromEntry();
  // The navigator revision changes with every index event; a served Recent list follows it.
  let lastRevision = -1;
  const followRevision = () => {
    const revision = fleetNavigator()?.revision ?? -1;
    if (revision !== lastRevision && fleetActive() && entryServesRecent()) {
      lastRevision = revision;
      void loadRecentFromEntry();
    }
    return null;
  };
  return (
    <Scroll
      accessibilityLabel="all-sessions-scene"
      scrollbar={true}
      style={{ flex: 1, minHeight: 0, backgroundColor: palette().canvas }}
      contentStyle={{
        width: "100%",
        maxWidth: layout.pageWidth + (compactLayout() ? layout.phoneGutter : layout.pageGutter) * 2,
        alignSelf: "center",
        paddingHorizontal: compactLayout() ? layout.phoneGutter : layout.pageGutter,
        paddingTop: compactLayout() ? layout.phonePagePaddingTop : layout.pagePaddingTop,
        paddingBottom: space.x5l,
      }}
    >
      {followRevision()}
      <Header />
      <If when={allSessionsView() === "recent"}>
        <View style={{ paddingTop: space.lg }}>
          <SearchInput
            value={searchText()}
            onChange={value => searchText.set(value)}
            placeholder={tr("allSessions.search")}
            accessibilityLabel="all-sessions-search"
            size="md"
          />
        </View>
      </If>
      <View style={{ paddingTop: layout.titleToSection }}>
        <If when={allSessionsView() === "recent"} else={<ByDeviceList />}>
          <RecentList />
        </If>
      </View>
    </Scroll>
  );
}
