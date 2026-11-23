// All sessions (visual spec §4.6, ux-redesign §3.6): every agent session on
// every device, as Recent (one flat list) or By device (device → workspace →
// session). It is the browse path; work usually starts in the OpenBitFun
// conversation.
//
// Display only. Order, states, roll-ups and folding hints come from the
// backend: the fleet navigator on a fleet entry (`fleet_recent_sessions` when
// the entry serves it), the host's own catalogue otherwise. Nothing here sorts
// rows; the only local state is which rows are folded and the search text.

import { batch, effect, Scroll, Text, View, signal, type JSX, type ViewRef } from "nsh";
import { listSessions, type SessionSummary } from "../api";
import { entryDeviceId, fleetActive, invokeCommand } from "../bridge";
import { fleetDevices, fleetNavigator } from "../fleetStore";
import type { FleetDevice, FleetSession, FleetWorkspace } from "../fleetTypes";
import { formatRelativeTime } from "../format";
import { isCommandUnavailable } from "../hostCommands";
import { localizeHostError, tr } from "../i18n";
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
  stateColor,
  type MarkState,
} from "../ui/fleet";
import { Icon } from "../ui/icons";
import { MOTION_DURATION, paintTransition, pressTransition, rotatingChevronStyle, tactileActiveStyle } from "../ui/motion";
import {
  Button,
  EmptyStateCard,
  IconButton,
  InlineBanner,
  SearchInput,
  SegmentedTabs,
  SkeletonBlock,
  focusRingStyle,
} from "../ui/primitives";
import { DropdownMenu, pushToast, type DropdownMenuItem } from "../ui/overlays";
import { sessionMenuItems, type SessionActionTarget } from "../ui/sessionActions";
import { workspaceMenuItems, type WorkspaceActionTarget } from "../ui/workspaceActions";
import { savedConnections } from "../sshRemoteStore";
import { superAgentUi } from "../productGates"; // wave23-E

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
const recentLoading = signal(false);
const recentError = signal("");
/** Other workspaces' catalogues on a host without the fleet layer. */
const localWorkspaceRows = signal<Record<string, SessionSummary[]>>({});

const NON_RUNTIME_HOST_KINDS = new Set(["cloud", "mobile", "phone", "browser", "web"]);
const LOCAL_HOST_NAMES = new Set(["localhost", "127.0.0.1", "::1"]);

/**
 * Displayable remote SSH host for a workspace. Filters out assistant workspaces
 * and local placeholders (`localhost`, `127.0.0.1`, `::1`), and falls back to
 * `savedConnections()` via `connectionId` / `remoteConnectionId` when `sshHost`
 * is absent.
 */
export function remoteWorkspaceHost(workspace: {
  kind?: string;
  sshHost?: string;
  connectionId?: string;
  remoteConnectionId?: string;
}): string | undefined {
  const kind = (workspace.kind ?? "").toLowerCase();
  if (kind.includes("assistant")) return undefined;
  const host = (workspace.sshHost ?? "").trim();
  if (host && !LOCAL_HOST_NAMES.has(host.toLowerCase())) {
    return host;
  }
  const connId = (workspace.connectionId ?? workspace.remoteConnectionId ?? "").trim();
  if (connId) {
    const saved = savedConnections().find(conn => conn.id === connId);
    const savedHost = (saved?.host ?? saved?.name ?? "").trim();
    if (savedHost && !LOCAL_HOST_NAMES.has(savedHost.toLowerCase())) {
      return savedHost;
    }
  }
  return undefined;
}

/** Runtime devices (includes local desktop with `isClientDevice: true`; excludes cloud & mobile/browser clients). */
function isRuntimeFleetDevice(device: FleetDevice): boolean {
  return !NON_RUNTIME_HOST_KINDS.has(device.hostKind.toLowerCase());
}

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

// wave23-E: the device tree's projection and row actions are shared with the
// sidebar tree (`ui/deviceSidebar.tsx`), so both draw the same backend rows.
export function openSessionRow(sessionId: string, deviceId: string, workspaceId: string): void {
  batch(() => {
    if (fleetActive()) {
      selectSession(sessionId, deviceId, workspaceId || undefined);
    } else {
      if (workspaceId && workspaceId !== activeWorkspaceId()) selectWorkspace(workspaceId);
      selectSession(sessionId);
    }
    navigateScene("sessions");
  });
}

export async function newSessionHere(workspaceId: string, deviceId: string): Promise<void> {
  selectWorkspace(workspaceId, {
    ...(fleetActive() ? { deviceId } : {}),
    loadSessions: false,
  });
  // backend-owned: `create_session` requires an agent type, and the host's
  // default (`default_mode_strategy` / `last_mode_id`, or `Claw` for assistant
  // workspaces) arrives with its mode catalogue, so that is read first.
  const defaultMode = await loadAgentModes(workspaceId);
  await createSessionInWorkspace(tr("nav.newSession"), defaultMode ?? undefined);
  navigateScene("sessions");
}

// ── Sources ──────────────────────────────────────────────────────────────────

const recentUnsupportedEntries = new Set<string>();

/** Whether the active fleet entry is known to serve `fleet_recent_sessions`. */
function entryServesRecent(): boolean {
  if (!fleetActive()) return false;
  const entryKey = entryDeviceId() ?? "default";
  return !recentUnsupportedEntries.has(entryKey);
}

async function loadRecentFromEntry(): Promise<void> {
  const entryKey = entryDeviceId() ?? "default";
  recentLoading.set(true);
  recentError.set("");
  try {
    const answer = await invokeCommand<{ sessions?: ServedRecentSession[] }>("fleet_recent_sessions", {});
    recentFromEntry.set(Array.isArray(answer?.sessions) ? answer.sessions : []);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    recentFromEntry.set(null);
    // An older entry without `fleet_recent_sessions` falls back quietly to the navigator.
    if (isCommandUnavailable(error, "fleet_recent_sessions")) {
      recentUnsupportedEntries.add(entryKey);
    } else {
      console.warn(`fleet_recent_sessions failed: ${message}`);
      recentError.set(message);
    }
  } finally {
    recentLoading.set(false);
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
  const status = statusOfSession();
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
      mark: localSessionMarkState(status(row.sessionId)?.kind),
      ageMs: sessionLastActivityMs(row),
    }));
}

export async function loadLocalWorkspace(workspaceId: string): Promise<void> {
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
export function sessionTarget(row: { sessionId: string; title: string }, deviceId: string, workspaceId: string): SessionActionTarget {
  return { sessionId: row.sessionId, deviceId, workspaceId, title: row.title, archived: false };
}

/** Touch-safe ⋯ button: 24 px on desktop, full 44×44 touch target on phone. */
function CompactMoreMenu(props: {
  items: ReadonlyArray<DropdownMenuItem>;
  accessibilityLabel: string;
  tooltip?: string;
  onOpenChange?: (open: boolean) => void;
}) {
  const open = signal(false);
  const anchor = signal<ViewRef | null>(null);
  const setOpen = (next: boolean) => {
    open.set(next);
    props.onOpenChange?.(next);
  };
  return (
    <View ref={el => anchor.set(el)} style={{ flexShrink: 0 }}>
      <IconButton
        icon="more"
        size={compactLayout() ? "lg" : "xs"}
        active={open()}
        tooltip={props.tooltip}
        accessibilityLabel={props.accessibilityLabel}
        style={compactLayout() ? { width: layout.touchTarget, height: layout.touchTarget } : undefined}
        onPress={() => setOpen(!open())}
      />
      <If when={open()}>
        <DropdownMenu
          open={true}
          anchor={anchor()}
          align="end"
          minWidth={196}
          items={props.items}
          onClose={() => setOpen(false)}
        />
      </If>
    </View>
  );
}

/**
 * A row's ⋯: drawn on hover or while open on desktop (kept mounted so tests and
 * open menus survive the pointer leaving the row) and always 44×44 on phone.
 */
function RowMenu(props: { target: SessionActionTarget; visible: boolean; onOpenChange?: (open: boolean) => void }) {
  return (
    <View
      style={{
        opacity: props.visible || compactLayout() ? 1 : 0,
        flexShrink: 0,
        ...paintTransition(MOTION_DURATION.fast),
      }}
    >
      <CompactMoreMenu
        items={sessionMenuItems(props.target)}
        accessibilityLabel={`session-actions-${props.target.sessionId}`}
        tooltip={tr("session.actions")}
        onOpenChange={props.onOpenChange}
      />
    </View>
  );
}

function RecentSessionRow(props: { row: RecentRow }) {
  const phone = () => compactLayout();
  const hovered = signal(false);
  const menuOpen = signal(false);
  const showMenu = () => hovered() || menuOpen();
  return (
    <View
      testID={`recent-row-${props.row.sessionId}`}
      onMouseEnter={() => hovered.set(true)}
      onMouseLeave={() => hovered.set(false)}
      style={{
        minHeight: phone() ? layout.touchTarget : 36,
        paddingHorizontal: phone() ? 0 : space.sm,
        borderRadius: radii.md,
        flexDirection: "row",
        alignItems: "center",
        gap: phone() ? space.xs : space.sm,
        ...paintTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={phone() ? undefined : rowHover()}
    >
      <If
        when={phone()}
        else={
          <>
            <View
              role="button"
              accessibilityLabel={props.row.title}
              onPress={() => openSessionRow(props.row.sessionId, props.row.deviceId, props.row.workspaceId)}
              hitSlop={touchSlop(36)}
              activeStyle={tactileActiveStyle(0.985)}
              focusVisibleStyle={focusRingStyle()}
              style={{
                flex: 1,
                minWidth: 0,
                minHeight: 36,
                flexDirection: "row",
                alignItems: "center",
                gap: space.sm,
                borderRadius: radii.sm,
                cursor: "pointer",
                userSelect: "none",
                ...pressTransition(MOTION_DURATION.fast),
              }}
            >
              <StateMark state={props.row.mark} />
              <Text style={{ ...textStyle("label"), flex: 1, minWidth: 0, numberOfLines: 1, textOverflow: "ellipsis" }}>
                {props.row.title}
              </Text>
            </View>
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
            <View
              style={{
                position: "relative",
                flexShrink: 0,
                minWidth: 24,
                minHeight: 24,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "flex-end",
              }}
            >
              <View style={{ opacity: showMenu() ? 0 : 1, pointerEvents: showMenu() ? "none" : "auto" }}>
                <Age ms={props.row.ageMs} />
              </View>
              <View style={{ position: "absolute", right: 0 }}>
                <RowMenu
                  target={sessionTarget(props.row, props.row.deviceId, props.row.workspaceId)}
                  visible={showMenu()}
                  onOpenChange={open => menuOpen.set(open)}
                />
              </View>
            </View>
          </>
        }
      >
        <View
          role="button"
          accessibilityLabel={props.row.title}
          onPress={() => openSessionRow(props.row.sessionId, props.row.deviceId, props.row.workspaceId)}
          hitSlop={touchSlop(layout.touchTarget)}
          activeStyle={tactileActiveStyle(0.985)}
          focusVisibleStyle={focusRingStyle()}
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: layout.touchTarget,
            paddingLeft: space.sm,
            paddingVertical: space.xs,
            borderRadius: radii.md,
            flexDirection: "row",
            alignItems: "center",
            gap: space.sm,
            cursor: "pointer",
            userSelect: "none",
            ...pressTransition(MOTION_DURATION.fast),
          }}
        >
          <StateMark state={props.row.mark} />
          <View style={{ flex: 1, minWidth: 0, gap: space.hair }}>
            <Text style={{ ...textStyle("label"), numberOfLines: 1, textOverflow: "ellipsis" }}>{props.row.title}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs, minWidth: 0 }}>
              <DeviceBadge name={props.row.deviceName} kind={props.row.deviceKind} />
              <If when={formatRelativeTime(props.row.ageMs)}>
                {text => <Text style={{ ...textStyle("caption", { tabular: true }), numberOfLines: 1 }}>{`· ${text()}`}</Text>}
              </If>
            </View>
          </View>
        </View>
        <RowMenu
          target={sessionTarget(props.row, props.row.deviceId, props.row.workspaceId)}
          visible={true}
          onOpenChange={open => menuOpen.set(open)}
        />
        <Icon name="chevron-right" size={12} color={palette().textMuted} />
      </If>
    </View>
  );
}

function RecentList() {
  const rows = () => recentRows().filter(row => matches(`${row.title} ${row.deviceName} ${row.workspaceName}`, searchText()));
  return (
    <View style={{ gap: space.md }}>
      <If when={recentError()}>
        {err => (
          <InlineBanner
            tone="danger"
            message={localizeHostError(err())}
            actionLabel={tr("common.tryAgain")}
            onAction={() => void loadRecentFromEntry()}
          />
        )}
      </If>
      <If when={recentLoading() && rows().length === 0}>
        <View style={{ gap: space.sm }}>
          <SkeletonBlock height={36} borderRadius={radii.md} />
          <SkeletonBlock height={36} borderRadius={radii.md} />
          <SkeletonBlock height={36} borderRadius={radii.md} />
        </View>
      </If>
      <If when={!recentLoading() || rows().length > 0}>
        <If
          when={rows().length > 0}
          else={
            <If
              when={searchText().trim()}
              else={<EmptyStateCard icon="layers" title={tr("allSessions.emptyTitle")} subtitle={tr(superAgentUi() ? "allSessions.emptyBody" : "gate.allSessionsEmptyBody")} />}
            >
              {query => (
                <EmptyStateCard
                  icon="search"
                  title={tr("allSessions.noMatch", { query: query() })}
                  action={
                    <Button
                      label={tr("common.clearSearch")}
                      variant="secondary"
                      size="md"
                      accessibilityLabel="all-sessions-clear-search"
                      style={compactLayout() ? { height: layout.touchTarget, minHeight: layout.touchTarget } : undefined}
                      onPress={() => searchText.set("")}
                    />
                  }
                />
              )}
            </If>
          }
        >
          <View accessibilityLabel="all-sessions-recent" style={{ gap: 0 }}>
            <Each of={rows()} key={row => row.key}>
              {row => <RecentSessionRow row={row()} />}
            </Each>
          </View>
        </If>
      </If>
    </View>
  );
}

// ── By device ────────────────────────────────────────────────────────────────

export interface DeviceTreeNode {
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

export function deviceTree(): DeviceTreeNode[] {
  if (fleetActive()) {
    return fleetDevices()
      // Runtime devices only: keeps this local desktop (`isClientDevice: true`) even with 0 workspaces,
      // while excluding the cloud node and frontend-only phones/browsers.
      .filter(isRuntimeFleetDevice)
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
            sshHost: remoteWorkspaceHost({
              kind: workspace.kind,
              sshHost: workspace.sshHost,
            }),
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
          sshHost: remoteWorkspaceHost({
            kind: workspace.workspaceKind,
            sshHost: workspace.sshHost,
            connectionId: workspace.connectionId,
            remoteConnectionId: (workspace as { remoteConnectionId?: string }).remoteConnectionId,
          }),
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
              color: stateColor(kind() === "update_required" ? "needs_you" : "idle"),
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
  const phone = () => compactLayout();
  return (
    <View
      testID={`device-header-${props.node.deviceId || "local"}`}
      style={{
        minHeight: phone() ? layout.touchTarget : 40,
        flexDirection: "row",
        alignItems: "center",
        gap: phone() ? space.xs : space.sm,
        paddingHorizontal: phone() ? 0 : space.xs,
      }}
    >
      <View
        role="button"
        accessibilityLabel={`device-fold-${props.node.deviceId || "local"}`}
        accessibilityState={{ expanded: open() }}
        hitSlop={touchSlop(phone() ? layout.touchTarget : 24, space.xs)}
        onPress={() => deviceFold.update(all => ({ ...all, [props.node.deviceId]: !open() }))}
        activeStyle={tactileActiveStyle(0.95)}
        focusVisibleStyle={focusRingStyle()}
        style={{
          width: phone() ? layout.touchTarget : 20,
          height: phone() ? layout.touchTarget : 20,
          borderRadius: radii.sm,
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          userSelect: "none",
          ...pressTransition(MOTION_DURATION.fast),
        }}
        hoverStyle={phone() ? undefined : rowHover()}
      >
        <View style={rotatingChevronStyle(open())}>
          <Icon name="chevron-right" size={12} color={palette().textMuted} />
        </View>
      </View>
      <View
        role="button"
        accessibilityLabel={`device-open-${props.node.deviceId || "local"}`}
        hitSlop={touchSlop(phone() ? layout.touchTarget : 36)}
        onPress={() => openDevicePage(props.node.deviceId)}
        activeStyle={tactileActiveStyle(0.985)}
        focusVisibleStyle={focusRingStyle()}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          flex: 1,
          minWidth: 0,
          minHeight: phone() ? layout.touchTarget : 36,
          paddingHorizontal: space.xs,
          borderRadius: radii.md,
          cursor: "pointer",
          userSelect: "none",
          ...pressTransition(MOTION_DURATION.fast),
        }}
        hoverStyle={phone() ? undefined : rowHover()}
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

export function workspaceTarget(node: DeviceTreeNode, workspace: DeviceTreeNode["workspaces"][number]): WorkspaceActionTarget {
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
  const phone = () => compactLayout();
  const hovered = signal(false);
  const menuOpen = signal(false);
  const showMenu = () => hovered() || menuOpen();
  return (
    <View
      onMouseEnter={() => hovered.set(true)}
      onMouseLeave={() => hovered.set(false)}
      style={{
        minHeight: phone() ? layout.touchTarget : controlHeight.md,
        paddingLeft: phone() ? space.xxl : 52,
        paddingRight: phone() ? 0 : space.sm,
        borderRadius: radii.md,
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        ...paintTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={phone() ? undefined : rowHover()}
    >
      <View
        role="button"
        accessibilityLabel={props.row.title}
        hitSlop={touchSlop(phone() ? layout.touchTarget : controlHeight.md)}
        onPress={() => openSessionRow(props.row.sessionId, props.node.deviceId, props.workspaceId)}
        activeStyle={tactileActiveStyle(0.985)}
        focusVisibleStyle={focusRingStyle()}
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: phone() ? layout.touchTarget : controlHeight.md,
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          borderRadius: radii.sm,
          cursor: "pointer",
          userSelect: "none",
          ...pressTransition(MOTION_DURATION.fast),
        }}
      >
        <StateMark state={props.row.mark} />
        <Text style={{ ...textStyle("label"), fontWeight: "400", flex: 1, minWidth: 0, numberOfLines: 1, textOverflow: "ellipsis" }}>
          {props.row.title}
        </Text>
      </View>
      <If
        when={phone()}
        else={
          <View
            style={{
              position: "relative",
              flexShrink: 0,
              minWidth: 24,
              minHeight: 24,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "flex-end",
            }}
          >
            <View style={{ opacity: showMenu() ? 0 : 1, pointerEvents: showMenu() ? "none" : "auto" }}>
              <Age ms={props.row.ageMs} />
            </View>
            <View style={{ position: "absolute", right: 0 }}>
              <RowMenu
                target={sessionTarget(props.row, props.node.deviceId, props.workspaceId)}
                visible={showMenu()}
                onOpenChange={open => menuOpen.set(open)}
              />
            </View>
          </View>
        }
      >
        <Age ms={props.row.ageMs} />
        <RowMenu
          target={sessionTarget(props.row, props.node.deviceId, props.workspaceId)}
          visible={true}
          onOpenChange={open => menuOpen.set(open)}
        />
      </If>
    </View>
  );
}

function WorkspaceBranch(props: { node: DeviceTreeNode; workspace: DeviceTreeNode["workspaces"][number] }) {
  const key = () => `${props.node.deviceId}/${props.workspace.workspaceId}`;
  const open = () => workspaceOpen()[key()] ?? false;
  const phone = () => compactLayout();
  const hovered = signal(false);
  const menuOpen = signal(false);
  const showActions = () => hovered() || menuOpen();
  const host = () => remoteWorkspaceHost(props.workspace);
  const workspaceIconName = () => {
    const kind = (props.workspace.kind ?? "").toLowerCase();
    if (kind.includes("assistant")) return "bot" as const;
    if (kind.includes("ssh") || kind.includes("remote") || Boolean(host())) return "server" as const;
    return "folder" as const;
  };
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
        onMouseEnter={() => hovered.set(true)}
        onMouseLeave={() => hovered.set(false)}
        style={{
          minHeight: phone() ? layout.touchTarget : 36,
          paddingLeft: phone() ? space.lg : 28,
          paddingRight: phone() ? 0 : space.sm,
          borderRadius: radii.md,
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          ...paintTransition(MOTION_DURATION.fast),
        }}
        hoverStyle={phone() ? undefined : rowHover()}
      >
        <View
          role="button"
          accessibilityLabel={`workspace-row-${props.workspace.workspaceId}`}
          accessibilityState={{ expanded: open() }}
          hitSlop={touchSlop(phone() ? layout.touchTarget : 36)}
          onMouseEnter={() => hovered.set(true)}
          onPress={toggle}
          activeStyle={tactileActiveStyle(0.985)}
          focusVisibleStyle={focusRingStyle()}
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: phone() ? layout.touchTarget : 36,
            paddingVertical: phone() ? space.xs : 0,
            borderRadius: radii.sm,
            flexDirection: "row",
            alignItems: "center",
            gap: space.sm,
            cursor: "pointer",
            userSelect: "none",
            ...pressTransition(MOTION_DURATION.fast),
          }}
        >
          <Icon name={workspaceIconName()} size={14} color={palette().textMuted} />
          <If
            when={phone()}
            else={
              <>
                <Text style={{ ...textStyle("label"), flexShrink: 0, maxWidth: "40%", numberOfLines: 1, textOverflow: "ellipsis" }}>
                  {props.workspace.name}
                </Text>
                <If when={host()}>
                  {remoteHost => (
                    <Text
                      testID={`workspace-host-${props.workspace.workspaceId}`}
                      style={{ ...textStyle("caption"), flexShrink: 0, maxWidth: "25%", numberOfLines: 1, textOverflow: "ellipsis" }}
                    >
                      {`· ${remoteHost()}`}
                    </Text>
                  )}
                </If>
                <Text style={{ ...textStyle("caption"), flex: 1, minWidth: 0, numberOfLines: 1, textOverflow: "ellipsis" }}>
                  {preview()}
                </Text>
              </>
            }
          >
            <View style={{ flex: 1, minWidth: 0, gap: space.hair }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs, minWidth: 0 }}>
                <Text style={{ ...textStyle("label"), flexShrink: 0, maxWidth: host() ? "65%" : "100%", numberOfLines: 1, textOverflow: "ellipsis" }}>
                  {props.workspace.name}
                </Text>
                <If when={host()}>
                  {remoteHost => (
                    <Text
                      testID={`workspace-host-${props.workspace.workspaceId}`}
                      style={{ ...textStyle("caption"), flex: 1, minWidth: 0, numberOfLines: 1, textOverflow: "ellipsis" }}
                    >
                      {`· ${remoteHost()}`}
                    </Text>
                  )}
                </If>
              </View>
              <If when={preview()}>
                {text => (
                  <Text style={{ ...textStyle("caption"), numberOfLines: 1, textOverflow: "ellipsis" }}>
                    {text()}
                  </Text>
                )}
              </If>
            </View>
          </If>
        </View>
        <View style={{ opacity: showActions() || phone() ? 1 : 0, flexShrink: 0, ...paintTransition(MOTION_DURATION.fast) }}>
          <CompactMoreMenu
            items={workspaceMenuItems(workspaceTarget(props.node, props.workspace), {
              onNewSession: () => void newSessionHere(props.workspace.workspaceId, props.node.deviceId),
            })}
            accessibilityLabel={`workspace-actions-${props.workspace.workspaceId}`}
            tooltip={tr("workspace.actions")}
            onOpenChange={isOpen => menuOpen.set(isOpen)}
          />
        </View>
        <If when={!phone() && showActions()}>
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
          <If
            when={props.workspace.sessions.length > 0}
            else={
              <View
                style={{
                  minHeight: phone() ? layout.touchTarget : 36,
                  paddingLeft: phone() ? space.xxl : 52,
                  paddingRight: space.sm,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.sm,
                }}
              >
                <Text style={{ ...textStyle("caption"), flex: 1, minWidth: 0 }}>
                  {tr("allSessions.emptyWorkspace")}
                </Text>
                <Button
                  label={tr("allSessions.newHere")}
                  variant="ghost"
                  size={phone() ? "md" : "xs"}
                  style={phone() ? { height: layout.touchTarget, minHeight: layout.touchTarget } : undefined}
                  onPress={() => void newSessionHere(props.workspace.workspaceId, props.node.deviceId)}
                />
              </View>
            }
          >
            <Each of={props.workspace.sessions} key={row => row.sessionId}>
              {row => <TreeSessionRow node={props.node} workspaceId={props.workspace.workspaceId} row={row()} />}
            </Each>
          </If>
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
  const phone = () => compactLayout();
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
          hitSlop={touchSlop(phone() ? layout.touchTarget : 36)}
          onPress={() => recentlyClosedOpen.update(open => !open)}
          activeStyle={tactileActiveStyle(0.985)}
          focusVisibleStyle={focusRingStyle()}
          style={{
            minHeight: phone() ? layout.touchTarget : 36,
            paddingLeft: phone() ? space.lg : 28,
            paddingRight: space.sm,
            borderRadius: radii.md,
            flexDirection: "row",
            alignItems: "center",
            gap: space.sm,
            cursor: "pointer",
            userSelect: "none",
            ...pressTransition(MOTION_DURATION.fast),
          }}
          hoverStyle={phone() ? undefined : rowHover()}
        >
          <View style={rotatingChevronStyle(recentlyClosedOpen())}>
            <Icon name="chevron-right" size={12} color={palette().textMuted} />
          </View>
          <Text style={textStyle("caption")}>{tr("allSessions.recentlyClosed", { count: rows().length })}</Text>
        </View>
        <If when={recentlyClosedOpen()}>
          <View>
            <Each of={rows()} key={record => record.id}>
              {record => (
                <View
                  testID={`recent-workspace-${record().id}`}
                  style={{
                    minHeight: phone() ? layout.touchTarget : 36,
                    paddingLeft: phone() ? space.xxl : 52,
                    paddingRight: phone() ? 0 : space.sm,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space.sm,
                  }}
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
                    size={phone() ? "md" : "xs"}
                    style={phone() ? { height: layout.touchTarget, minHeight: layout.touchTarget } : undefined}
                    accessibilityLabel={`recent-workspace-reopen-${record().id}`}
                    onPress={() => void openRecentWorkspace(record())}
                  />
                  <CompactMoreMenu
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
  const phone = () => compactLayout();
  const hasNotIndexed = () => fleetActive() && fleetDevices().some(device => device.state === "not_indexed");
  const hasPerDeviceTruncation = () => fleetActive() && fleetDevices().some(device => device.sessionsTruncated);
  return (
    <View accessibilityLabel="all-sessions-by-device" style={{ gap: space.xs }}>
      <If when={all().length > DEVICE_FILTER_THRESHOLD}>
        <SearchInput
          value={deviceFilter()}
          onChange={value => deviceFilter.set(value)}
          placeholder={tr("allSessions.filterDevices")}
          accessibilityLabel="all-sessions-device-filter"
          size={phone() ? "lg" : "md"}
          style={phone() ? { height: layout.touchTarget, minHeight: layout.touchTarget } : undefined}
        />
      </If>
      <If when={visible().length === 0 ? deviceFilter().trim() : ""}>
        {query => (
          <EmptyStateCard
            icon="search"
            title={tr("allSessions.noMatch", { query: query() })}
            action={
              <Button
                label={tr("common.clearSearch")}
                variant="secondary"
                size="md"
                style={phone() ? { height: layout.touchTarget, minHeight: layout.touchTarget } : undefined}
                onPress={() => deviceFilter.set("")}
              />
            }
          />
        )}
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
            hitSlop={touchSlop(phone() ? layout.touchTarget : 40)}
            onPress={() => offlineGroupOpen.update(open => !open)}
            activeStyle={tactileActiveStyle(0.985)}
            focusVisibleStyle={focusRingStyle()}
            style={{
              minHeight: phone() ? layout.touchTarget : 40,
              flexDirection: "row",
              alignItems: "center",
              gap: space.sm,
              paddingHorizontal: space.xs,
              borderRadius: radii.md,
              cursor: "pointer",
              userSelect: "none",
              ...pressTransition(MOTION_DURATION.fast),
            }}
            hoverStyle={phone() ? undefined : rowHover()}
          >
            <View style={rotatingChevronStyle(offlineGroupOpen())}>
              <Icon name="chevron-right" size={12} color={palette().textMuted} />
            </View>
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
      <If when={hasNotIndexed()}>
        <Text style={{ ...textStyle("caption"), paddingHorizontal: space.xs, paddingTop: space.sm }}>
          {tr("allSessions.notIndexed")}
        </Text>
      </If>
      <If when={!hasNotIndexed() && hasPerDeviceTruncation()}>
        <Text style={{ ...textStyle("caption"), paddingHorizontal: space.xs, paddingTop: space.sm }}>
          {tr("allSessions.truncatedPerDevice")}
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
  // The navigator revision changes with every index event; a served Recent list follows it reactively.
  let lastRevision: number | null = null;
  effect(() => {
    const active = fleetActive();
    const revision = fleetNavigator()?.revision ?? -1;
    if (!active || !entryServesRecent()) {
      lastRevision = null;
      return;
    }
    if (revision !== lastRevision) {
      lastRevision = revision;
      void loadRecentFromEntry();
    }
  });
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
      <Header />
      <If when={allSessionsView() === "recent"}>
        <View style={{ paddingTop: space.lg }}>
          <SearchInput
            value={searchText()}
            onChange={value => searchText.set(value)}
            placeholder={tr("allSessions.search")}
            accessibilityLabel="all-sessions-search"
            size={compactLayout() ? "lg" : "md"}
            style={compactLayout() ? { height: layout.touchTarget, minHeight: layout.touchTarget } : undefined}
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
