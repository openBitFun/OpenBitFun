// The device page (visual spec §4.7, ux-redesign §3.7): one device of the
// account, opened from a device badge, a breadcrumb or All sessions › By
// device. It states what the device is, how it is reached, what runs and waits
// there, and offers the device's own actions. A healthy device draws no
// status; only exceptions get words.
//
// Display only: every fact is the backend's (the fleet navigator row, and
// `fleet_device_detail` when the entry serves it). On a host without the fleet
// layer the page shows this device.

import { cleanup, Clipboard, effect, Scroll, signal, Text, View, type JSX, type ViewRef } from "nsh";
import { entryDeviceId, fleetActive, invokeCommand } from "../bridge";
import { localDeviceId } from "../devicePrefsStore";
import { fleetDeviceById } from "../fleetStore";
import type { FleetDevice, FleetWorkspace } from "../fleetTypes";
import { formatPlural, formatRelativeTime, formatTime } from "../format";
import { isCommandUnavailable } from "../hostCommands";
import { tr } from "../i18n";
import type { MessageKey } from "../locales/en-US";
import { savedConnections, openNewWorkspaceModal, openSshConnectionModal } from "../sshRemoteStore";
import {
  activeWorkspace,
  devicePageId,
  navigateScene,
  openAllSessions,
  selectDeviceContext,
  workspaces,
} from "../state";
import { openTerminal } from "../terminalStore";
import { compactLayout, layout, palette, radii, space, textStyle, touchSlop } from "../theme";
import { deviceException, deviceGlyphIcon, stateColor } from "../ui/fleet";
import { Icon } from "../ui/icons";
import { MOTION_DURATION, pressTransition, tactileActiveStyle } from "../ui/motion";
import { DropdownMenu, ModalDialog, pushToast, type DropdownMenuItem } from "../ui/overlays";
import { Button, IconButton, TextField, focusRingStyle } from "../ui/primitives";
import { InsetGroup, InsetRow } from "../ui/studio";
import { controllerPort } from "../controller/controllerPort";
import { DeviceJobsEntry } from "./DeviceJobsPanel";
import { removeAccountDevice, saveDeviceAlias } from "../accountDevicesStore";

/** One job of `fleet_device_detail` (`FleetDeviceJob`); every field optional here. */
interface DeviceDetailJob {
  jobId?: string;
  title?: string;
  state?: string;
  /** A stable snake_case code this page words (`waiting_for_device`, `needs_answer`, …). */
  stateReason?: string;
}

/** `fleet_device_detail {deviceId}` (served by newer entries; every field optional here). */
interface DeviceDetail {
  runningSessions?: number;
  runningJobs?: number;
  waitingJobs?: number;
  running?: { sessions?: unknown[]; jobs?: DeviceDetailJob[] };
  waiting?: { jobs?: DeviceDetailJob[] };
  /** User-facing capability ids (`terminal`, `git`, `browser`, `desktop`, `jobs`) in display order. */
  capabilities?: string[];
  /** Not sent by current entries; the saved SSH connections of this device stand in. */
  sshConnectionCount?: number;
  update?: { available?: boolean; version?: string; canUpdateRemotely?: boolean; command?: string; reason?: string };
}

/** The words of a waiting job's reason code; an unknown code draws only the count. */
const WAITING_REASON_WORDS: Readonly<Record<string, MessageKey>> = {
  waiting_for_device: "device.reason.waitingForDevice",
  needs_answer: "device.reason.needsAnswer",
  prompt_not_indexed: "device.reason.promptNotIndexed",
};

function count(value: number | undefined, list: unknown[] | undefined): number {
  return typeof value === "number" ? value : Array.isArray(list) ? list.length : 0;
}

/** "1 job · Starts when it's online": the count, then the first waiting job's reason in words. */
function waitingValue(served: DeviceDetail): string {
  const jobs = served.waiting?.jobs ?? [];
  const total = count(served.waitingJobs, jobs);
  const parts = [formatPlural(total, "device.jobsOne", "device.jobsOther")];
  const code = jobs.find(job => job.stateReason)?.stateReason ?? "";
  const key = WAITING_REASON_WORDS[code];
  if (key) parts.push(tr(key));
  return parts.join(" · ");
}

/** What the page draws, whatever the source. */
interface DeviceView {
  deviceId: string;
  name: string;
  kind: string;
  isThisDevice: boolean;
  state: string;
  stateReason?: string;
  asOfMs?: number;
  version?: string;
  route?: FleetDevice["route"];
  capabilities: string[];
  workspaceNames: string[];
  canCreateWorkspace: { allowed: boolean; reason?: string };
  fleet: boolean;
}

const detail = signal<DeviceDetail | null>(null);
const detailFor = signal("");
const renameOpen = signal(false);
const renameDraft = signal("");
const removeOpen = signal(false);
const copiedCommand = signal(false);

const CAPABILITY_WORDS: Readonly<Record<string, MessageKey>> = {
  terminal: "device.cap.terminal",
  git: "device.cap.git",
  browser: "device.cap.browser",
  browser_control: "device.cap.browser",
  desktop: "device.cap.desktop",
  desktop_control: "device.cap.desktop",
  computer_use: "device.cap.desktop",
  jobs: "device.cap.jobs",
  superagent_jobs: "device.cap.jobs",
  dispatch: "device.cap.jobs",
};

function workspaceName(workspace: Pick<FleetWorkspace, "name" | "rootPath">): string {
  if (workspace.name) return workspace.name;
  const parts = workspace.rootPath.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? workspace.rootPath;
}

function currentView(): DeviceView | null {
  const id = devicePageId();
  if (fleetActive()) {
    const device = fleetDeviceById(id);
    if (!device) return null;
    return {
      deviceId: device.deviceId,
      name: device.name,
      kind: device.hostKind,
      isThisDevice: device.isClientDevice,
      state: device.state,
      stateReason: device.stateReason,
      asOfMs: device.asOfMs,
      version: device.version,
      route: device.route,
      capabilities: device.hostCapabilities,
      workspaceNames: device.workspaces.map(workspaceName),
      canCreateWorkspace: device.actions?.createWorkspace ?? { allowed: false },
      fleet: true,
    };
  }
  // One host: this device.
  return {
    deviceId: id || localDeviceId() || "",
    name: tr("device.thisDevice"),
    kind: "laptop",
    isThisDevice: true,
    state: "online",
    capabilities: [],
    workspaceNames: workspaces().map(item => item.name || item.rootPath.split(/[\\/]/).filter(Boolean).pop() || item.rootPath),
    canCreateWorkspace: { allowed: true },
    fleet: false,
  };
}

const detailUnsupportedEntries = new Set<string>();

async function loadDetail(deviceId: string): Promise<void> {
  const entryKey = entryDeviceId() ?? "default";
  if (!fleetActive() || detailUnsupportedEntries.has(entryKey)) {
    detail.set(null);
    return;
  }
  detailFor.set(deviceId);
  try {
    const answer = await invokeCommand<DeviceDetail>("fleet_device_detail", { deviceId });
    if (detailFor() === deviceId) detail.set(answer ?? null);
  } catch (error) {
    if (isCommandUnavailable(error, "fleet_device_detail")) {
      detailUnsupportedEntries.add(entryKey);
    } else {
      console.warn(`fleet_device_detail failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (detailFor() === deviceId) detail.set(null);
  }
}

function kindWord(kind: string): string {
  if (kind === "cli") return tr("device.kind.server");
  if (kind === "container") return tr("device.kind.container");
  return tr("device.kind.computer");
}

/** "Linux server · OpenBitFun 1.3.0", or the exception that replaces it. */
function subtitle(view: DeviceView): string {
  const parts = [kindWord(view.kind)];
  if (view.version) parts.push(tr("device.version", { version: view.version }));
  return parts.join(" · ");
}

/** The route line; a local or unknown route draws nothing. */
function routeLine(view: DeviceView): string {
  const route = view.route;
  if (!route) return "";
  const ms = typeof route.latencyMs === "number" ? Math.round(route.latencyMs) : null;
  switch (route.kind) {
    case "direct_lan":
    case "direct_ipv4":
    case "direct_ipv6":
      return ms === null ? tr("device.routeDirectOnly") : tr("device.routeDirect", { ms });
    case "relayed_peer":
      return ms === null
        ? tr("device.routeViaOnly", { device: route.relayVia ?? "" })
        : tr("device.routeVia", { device: route.relayVia ?? "", ms });
    case "relayed_server":
      return tr("device.routeServer");
    default:
      return "";
  }
}

/** The exception line that replaces the subtitle, or `""` for a healthy device. */
function stateLine(view: DeviceView): string {
  switch (view.state) {
    case "offline":
      return tr("device.offline", { ago: formatRelativeTime(view.asOfMs) });
    case "stale":
      return tr("device.stale", { time: formatTime(view.asOfMs) });
    case "unreachable":
      return tr("device.unreachable");
    default:
      return "";
  }
}

function copyDeviceId(view: DeviceView): void {
  void Clipboard.writeText(view.deviceId).then(
    () => pushToast(tr("device.idCopied"), "success"),
    () => pushToast(tr("error.unsupported"), "error"),
  );
}

function openSettingsFor(view: DeviceView): void {
  if (view.fleet) void selectDeviceContext(view.deviceId);
  navigateScene("settings");
}

function newTerminal(view: DeviceView): void {
  const run = async () => {
    if (view.fleet) await selectDeviceContext(view.deviceId);
    const workspace = activeWorkspace();
    await openTerminal(workspace?.id ?? null, workspace?.rootPath ?? "");
    navigateScene("terminal");
  };
  void run();
}

function newWorkspace(view: DeviceView): void {
  const run = async () => {
    if (view.fleet) await selectDeviceContext(view.deviceId);
    // The sheet offers a folder, SSH, a container or WSL (ux-redesign §2).
    await openNewWorkspaceModal();
  };
  void run();
}

function DeviceOverflowMenu(props: { items: ReadonlyArray<DropdownMenuItem>; accessibilityLabel: string }) {
  const open = signal(false);
  const anchor = signal<ViewRef | null>(null);
  return (
    <View ref={el => anchor.set(el)} style={{ flexShrink: 0 }}>
      <IconButton
        icon="more"
        size={compactLayout() ? "lg" : "sm"}
        active={open()}
        accessibilityLabel={props.accessibilityLabel}
        style={compactLayout() ? { width: layout.touchTarget, height: layout.touchTarget } : undefined}
        onPress={() => open.update(value => !value)}
      />
      <If when={open()}>
        <DropdownMenu
          open={true}
          anchor={anchor()}
          align="end"
          minWidth={196}
          items={props.items}
          onClose={() => open.set(false)}
        />
      </If>
    </View>
  );
}

function UpdateBlock(props: { view: DeviceView; menuItems: ReadonlyArray<DropdownMenuItem> }) {
  const update = () => detail()?.update;
  let copyTimer: ReturnType<typeof setTimeout> | null = null;
  cleanup(() => {
    if (copyTimer) clearTimeout(copyTimer);
  });
  const copyCommand = (cmd: string) => {
    void Clipboard.writeText(cmd).then(
      () => {
        copiedCommand.set(true);
        pushToast(tr("device.commandCopied"), "success");
        if (copyTimer) clearTimeout(copyTimer);
        copyTimer = setTimeout(() => {
          copyTimer = null;
          copiedCommand.set(false);
        }, 1800);
      },
      () => pushToast(tr("error.unsupported"), "error"),
    );
  };
  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <Text style={{ ...textStyle("label", { color: stateColor("needs_you") }), fontWeight: "400", flex: 1, minWidth: 0 }}>
          {update()?.version
            ? tr("device.needsVersion", { version: update()!.version! })
            : props.view.stateReason || tr("device.updateNeeded")}
        </Text>
        <If when={compactLayout()}>
          <DeviceOverflowMenu items={props.menuItems} accessibilityLabel="device-menu-phone" />
        </If>
      </View>
      <If when={update()?.command ?? ""}>
        {command => (
          <View style={{ gap: space.xs }}>
            <Text style={textStyle("caption")}>{tr("device.runCommand")}</Text>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: space.sm,
                paddingVertical: space.chip,
                paddingHorizontal: space.sm,
                borderRadius: radii.sm,
                backgroundColor: palette().surfaceTertiary,
              }}
            >
              <Text style={{ ...textStyle("mono"), flex: 1, minWidth: 0, userSelect: "text" }}>{command()}</Text>
              <Button
                label={tr("common.copy")}
                leadingIcon={copiedCommand() ? "check" : "copy"}
                variant="ghost"
                size={compactLayout() ? "md" : "xs"}
                accessibilityLabel="device-copy-update-command"
                style={compactLayout() ? { height: layout.touchTarget, minHeight: layout.touchTarget } : undefined}
                onPress={() => copyCommand(command())}
              />
            </View>
          </View>
        )}
      </If>
    </View>
  );
}

function Header(props: { view: DeviceView }) {
  const menuItems = () => [
    {
      id: "device-rename",
      label: tr("device.menuRename"),
      accessibilityLabel: "device-menu-rename",
      disabled: !props.view.deviceId,
      onSelect: () => {
        renameDraft.set(props.view.name);
        renameOpen.set(true);
      },
    },
    {
      id: "device-copy-id",
      label: tr("device.copyId"),
      accessibilityLabel: "device-menu-copy-id",
      disabled: !props.view.deviceId,
      onSelect: () => copyDeviceId(props.view),
    },
    {
      id: "device-remove",
      label: tr("device.remove"),
      danger: true,
      separator: true,
      accessibilityLabel: "device-menu-remove",
      disabled: !props.view.deviceId || props.view.isThisDevice,
      onSelect: () => removeOpen.set(true),
    },
  ];
  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", minHeight: 28, display: compactLayout() ? "none" : "flex" }}>
        {/* On a phone the top bar's ‹ goes back; the page keeps only its ⋯. */}
        <If when={!compactLayout()}>
          <View
            role="button"
            accessibilityLabel="device-back"
            hitSlop={touchSlop(28)}
            onPress={() => openAllSessions("by-device")}
            hoverStyle={{ backgroundColor: palette().panelHover }}
            activeStyle={tactileActiveStyle(0.97)}
            focusVisibleStyle={focusRingStyle()}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space.xs,
              minHeight: 28,
              paddingHorizontal: space.xs,
              marginLeft: -space.xs,
              borderRadius: radii.sm,
              cursor: "pointer",
              userSelect: "none",
              ...pressTransition(MOTION_DURATION.fast),
            }}
          >
            <Icon name="chevron-left" size={12} color={palette().textSecondary} />
            <Text style={textStyle("label", { color: palette().textSecondary })}>{tr("allSessions.title")}</Text>
          </View>
        </If>
        <View style={{ flex: 1 }} />
        <DeviceOverflowMenu items={menuItems()} accessibilityLabel="device-menu" />
      </View>
      {/* A phone's top bar already names the device. */}
      <View style={{ display: compactLayout() ? "none" : "flex", flexDirection: "row", alignItems: "center", gap: space.sm, minWidth: 0 }}>
        <Icon name={deviceGlyphIcon(props.view.kind)} size={20} color={palette().textSecondary} />
        <Text role="header" style={{ ...textStyle("pageTitle"), flexShrink: 1, minWidth: 0, numberOfLines: 1, textOverflow: "ellipsis" }}>
          {props.view.name}
        </Text>
        <If when={props.view.isThisDevice && props.view.fleet}>
          <Text style={textStyle("caption")}>{tr("device.thisDevice")}</Text>
        </If>
      </View>
      <If
        when={deviceException(props.view.state) === "update_required"}
        else={
          <View style={{ gap: space.xs }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
              <Text style={{ ...textStyle("label", { color: palette().textSecondary }), fontWeight: "400", flex: 1, minWidth: 0 }}>
                {stateLine(props.view) || subtitle(props.view)}
              </Text>
              <If when={compactLayout()}>
                <DeviceOverflowMenu items={menuItems()} accessibilityLabel="device-menu-phone" />
              </If>
            </View>
            <If when={!stateLine(props.view) && routeLine(props.view)}>
              {line => <Text style={textStyle("caption", { tabular: true })}>{line()}</Text>}
            </If>
          </View>
        }
      >
        <UpdateBlock view={props.view} menuItems={menuItems()} />
      </If>
    </View>
  );
}

function capabilityWords(view: DeviceView): string {
  const served = detail()?.capabilities;
  const ids = served && served.length > 0 ? served : view.capabilities;
  const words: string[] = [];
  for (const id of ids) {
    const key = CAPABILITY_WORDS[id];
    if (key && !words.includes(tr(key))) words.push(tr(key));
  }
  return words.join(" · ");
}

function Sections(props: { view: DeviceView }) {
  const sshCount = () =>
    typeof detail()?.sshConnectionCount === "number"
      ? detail()!.sshConnectionCount!
      : props.view.isThisDevice
        ? savedConnections().length
        : null;
  return (
    <View style={{ gap: layout.sectionGap }}>
      <InsetGroup accessibilityLabel="device-activity">
        <If when={detail()}>
          {served => (
            <>
              <InsetRow
                first
                label={tr("device.running")}
                value={tr("device.runningValue", {
                  sessions: count(served().runningSessions, served().running?.sessions),
                  jobs: count(served().runningJobs, served().running?.jobs),
                })}
                chevron
                onPress={() => openAllSessions("by-device")}
              />
              <If when={count(served().waitingJobs, served().waiting?.jobs) > 0}>
                <InsetRow
                  label={tr("device.waiting")}
                  value={waitingValue(served())}
                  accessibilityLabel="device-waiting"
                  chevron
                  onPress={() => navigateScene("openbitfun")}
                />
              </If>
            </>
          )}
        </If>
        <InsetRow
          first={!detail()}
          label={tr("device.workspaces")}
          value={props.view.workspaceNames.join(" · ")}
          chevron
          accessibilityLabel="device-workspaces"
          onPress={() => openAllSessions("by-device")}
        />
      </InsetGroup>
      <View style={{ gap: space.lg }}>
        <InsetGroup accessibilityLabel="device-capabilities">
          <If when={capabilityWords(props.view)}>
            {words => <InsetRow first label={tr("device.available")} value={words()} />}
          </If>
          <If when={sshCount() !== null}>
            <InsetRow
              first={!capabilityWords(props.view)}
              label={tr("device.ssh")}
              value={String(sshCount() ?? 0)}
              chevron
              accessibilityLabel="device-ssh"
              onPress={() => {
                const run = async () => {
                  if (props.view.fleet) await selectDeviceContext(props.view.deviceId);
                  await openSshConnectionModal();
                };
                void run();
              }}
            />
          </If>
          <InsetRow
            first={!capabilityWords(props.view) && sshCount() === null}
            label={tr("device.settingsFor", { device: props.view.name })}
            chevron
            accessibilityLabel="device-settings"
            disabled={deviceException(props.view.state) === "offline"}
            onPress={() => openSettingsFor(props.view)}
          />
        </InsetGroup>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
          <Button
            label={tr("device.newTerminal")}
            variant="secondary"
            size="md"
            accessibilityLabel="device-new-terminal"
            disabled={deviceException(props.view.state) !== null}
            style={compactLayout() ? { height: layout.touchTarget, minHeight: layout.touchTarget } : undefined}
            onPress={() => newTerminal(props.view)}
          />
          <Button
            label={tr("device.newWorkspace")}
            variant="secondary"
            size="md"
            accessibilityLabel="device-new-workspace"
            disabled={!props.view.canCreateWorkspace.allowed}
            tooltip={props.view.canCreateWorkspace.reason}
            style={compactLayout() ? { height: layout.touchTarget, minHeight: layout.touchTarget } : undefined}
            onPress={() => newWorkspace(props.view)}
          />
        </View>
      </View>
      {/* P-UI (wave 17): the direct path to Detached Dispatch, on this computer's own page only
          (the commands are controller local, so a browser or a phone never draws it). */}
      <If when={props.view.isThisDevice && !controllerPort()}>
        <DeviceJobsEntry />
      </If>
    </View>
  );
}

function DeviceDialogs(props: { view: DeviceView }) {
  const canSaveRename = () => {
    const trimmed = renameDraft().trim();
    return trimmed.length > 0 && trimmed !== props.view.name;
  };
  const submitRename = () => {
    if (!canSaveRename()) return;
    renameOpen.set(false);
    void saveDeviceAlias(props.view.deviceId, renameDraft().trim());
  };
  return (
    <>
      <ModalDialog
        open={renameOpen()}
        size="sm"
        title={tr("device.menuRename")}
        onClose={() => renameOpen.set(false)}
        footer={
          <>
          <Button label={tr("common.cancel")} variant="secondary" size="md" onPress={() => renameOpen.set(false)} />
          <Button
            label={tr("common.save")}
            variant="primary"
            size="md"
            disabled={!canSaveRename()}
            accessibilityLabel="device-rename-save"
            onPress={submitRename}
          />
          </>
        }
      >
        <RenameField onSubmit={submitRename} />
      </ModalDialog>
      <ModalDialog
        open={removeOpen()}
        size="sm"
        title={tr("device.removeTitle", { device: props.view.name })}
        onClose={() => removeOpen.set(false)}
        footer={
          <>
          <Button label={tr("common.cancel")} variant="secondary" size="md" onPress={() => removeOpen.set(false)} />
          <Button
            label={tr("common.remove")}
            variant="danger"
            size="md"
            accessibilityLabel="device-remove-confirm"
            onPress={() => {
              removeOpen.set(false);
              void removeAccountDevice(props.view.deviceId, props.view.name).then(() => openAllSessions("by-device"));
            }}
          />
          </>
        }
      >
        <Text style={textStyle("body", { color: palette().textSecondary })}>{tr("device.removeBody")}</Text>
      </ModalDialog>
    </>
  );
}

function RenameField(props: { onSubmit: () => void }): JSX.Element {
  return (
    <TextField
      value={renameDraft()}
      onChange={value => renameDraft.set(value)}
      onSubmit={props.onSubmit}
      accessibilityLabel="device-rename-field"
      autoFocus
    />
  );
}

/** The device route. */
export function DeviceScene() {
  let loadedFor: string | null = null;
  effect(() => {
    const current = currentView();
    const id = current?.deviceId ?? "";
    if (!current?.fleet || !id) {
      loadedFor = null;
      detail.set(null);
      return;
    }
    if (id !== loadedFor) {
      loadedFor = id;
      void loadDetail(id);
    }
  });
  const view = () => currentView();
  return (
    <Scroll
      accessibilityLabel="device-scene"
      scrollbar={true}
      style={{ flex: 1, minHeight: 0, backgroundColor: palette().canvas }}
      contentStyle={{
        width: "100%",
        maxWidth: layout.pageWidth + (compactLayout() ? layout.phoneGutter : layout.pageGutter) * 2,
        alignSelf: "center",
        paddingHorizontal: compactLayout() ? layout.phoneGutter : layout.pageGutter,
        paddingTop: compactLayout() ? layout.phonePagePaddingTop : layout.pagePaddingTop,
        paddingBottom: space.x5l,
        gap: layout.sectionGap,
      }}
    >
      <If
        when={view()}
        else={
          <View style={{ gap: space.lg }}>
            <Text style={textStyle("body", { color: palette().textSecondary })}>{tr("device.notFound")}</Text>
            <View style={{ flexDirection: "row" }}>
              <Button label={tr("allSessions.title")} variant="secondary" size="md" onPress={() => openAllSessions("by-device")} />
            </View>
          </View>
        }
      >
        {current => (
          <>
            <Header view={current()} />
            <Sections view={current()} />
            <DeviceDialogs view={current()} />
          </>
        )}
      </If>
    </Scroll>
  );
}
