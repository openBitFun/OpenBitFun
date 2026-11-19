import { cleanup, computed, Scroll, signal, Text, View } from "nsh";
import { TextView } from "nsh/base";
import { invokeCommand, invokeRawCommand } from "../bridge";
import {
  botVerboseMode,
  connectorBusy,
  connectorError,
  connectorNotice,
  connectorStatus,
  connectorsLoading,
  connectorsSupported,
  copyPairingLink,
  ensureConnectors,
  feishuAppId,
  feishuAppSecret,
  isRelayRouteConnected,
  lanIpInput,
  loadConnectors,
  pollWeixinQr,
  relayPairing,
  relayUrlForMethod,
  saveAndConnectFeishu,
  saveAndConnectTelegram,
  setBotVerboseConnectorMode,
  startRelayConnector,
  startWeixinQr,
  stopBotConnector,
  stopRelayConnector,
  telegramToken,
  weixinQr,
  weixinVerifyCode,
  agreeRemoteDisclaimer,
  declineRemoteDisclaimer,
  openRemoteDisclaimer,
  remoteDisclaimerAgreed,
  remoteDisclaimerOpen,
  remoteControlSaving,
  setRemoteControlAllowed,
} from "../connectorsStore";
import {
  hiddenDevices,
  loadDevicePreferences,
  loadLocalDeviceId,
  localDeviceId,
  moveDevice,
  sortDevices,
  toggleDeviceVisible,
} from "../devicePrefsStore";
import {
  answerObservedPermission,
  cancelObservedJob,
  closeObservedJob,
  observedBusy,
  observedDraft,
  observedJobFinished,
  observedJobId,
  observedJobTitle,
  observedNotice,
  observedPending,
  observedRows,
  observedState,
  observedTruncated,
  openObservedJob,
  pollObservedJob,
  sendToObservedJob,
  syncObservedResult,
  type DispatchRow,
} from "../dispatchObserver";
import {
  DISPATCH_APPROVAL_POLICIES,
  cancelDispatch,
  dispatchApprovalPolicy,
  dispatchFormOpen,
  dispatchBaseRef,
  dispatchIncludeUncommitted,
  dispatchModel,
  dispatchProbe,
  dispatchTargetReady,
  dispatchTitle,
  chooseDispatchTarget,
  probeDispatchTarget,
  dispatchJobs,
  dispatchNotice,
  dispatchPrompt,
  dispatchSupported,
  dispatchTargetKey,
  dispatchTargets,
  dispatchWorkspacePath,
  ensureDispatch,
  openDispatchForm,
  refreshDispatchJobs,
  selectedTarget,
  submitDispatch,
  targetKey,
} from "../dispatchStore";
import { formatPlural } from "../format";
import {
  accountStatus,
  authLoading,
  githubUser,
  isAccountSignedIn,
  loadAccountState,
  signOutAccount,
} from "../homeStore";
import {
  currentLocale,
  isAuthRequiredError,
  localizeHostError,
  tr,
  type MessageKey,
} from "../i18n";
import { peerBusy, peerError, peerReconnecting, peerScope } from "../peerState";
import { enterPeer, leavePeer, reconnectPeer } from "../peerStore";
import { activeScene, resetForDeviceChange, runStep } from "../state";
import { forgetTerminals } from "../terminalStore";
import { fontMono, palette, radii, textLineHeight, textSize, textStyle } from "../theme";
import { onAccountAuthChanged, openAccountAuthModal } from "../ui/AccountAuthModal";
import { ObpPairingCard } from "./ObpPairingCard";
import { Icon, type IconName } from "../ui/icons";
import {
  InsetGroup,
  InsetRow,
  MoreMenu,
  QrCodeView,
  StudioBody,
  StudioEmpty,
  StudioHeader,
  StudioSection,
  studioCompact,
  trackStudioWidth,
} from "../ui/studio";
import { createMarkdownCodeActions, createMarkdownStyles } from "../ui/markdown";
import { ModalDialog, SelectDropdown, pushToast, type DropdownMenuItem } from "../ui/overlays";
import {
  Button,
  ConfigRow,
  IconButton,
  InlineBanner,
  InputBox,
  PillChip,
  SegmentedTabs,
  StatusDot,
  StatusPill,
  ToggleSwitch,
  type StatusDotKind,
} from "../ui/primitives";


interface DeviceRow {
  id: string;
  name: string;
  platform: string;
  online: boolean;
  alias?: string;
}

type ChannelId = "telegram" | "feishu" | "weixin" | "relay";

const devices = signal<DeviceRow[]>([]);
const devicesLoaded = signal(false);
const devicesError = signal<string | null>(null);
const editingDeviceId = signal<string | null>(null);
const aliasValue = signal("");
const showHiddenDevices = signal(false);
const activeChannelModal = signal<ChannelId | null>(null);
const connectingDeviceId = signal<string | null>(null);
const removingDeviceId = signal<string | null>(null);
const removeDeviceBusy = signal(false);
const removeDeviceError = signal("");

function isExplicitlySignedOut(): boolean {
  return accountStatus()?.loggedIn === false && githubUser() === null;
}

function needsAccountSignIn(): boolean {
  return !isAccountSignedIn() && (isExplicitlySignedOut() || isAuthRequiredError(devicesError()));
}

function signedInAccountDisplay(): string {
  const login = githubUser()?.login;
  if (login) return `@${login}`;
  return accountStatus()?.userId || tr("home.signedIn");
}

function nonAuthDevicesError(): string | null {
  const err = devicesError();
  if (!err) return null;
  if (isAuthRequiredError(err) || needsAccountSignIn()) return null;
  return localizeHostError(err);
}

const APPROVAL_POLICY_LABELS: Record<string, { labelKey: MessageKey; hintKey: MessageKey }> = {
  auto: { labelKey: "devices.approvalAuto", hintKey: "devices.approvalAutoHint" },
  "reject-and-report": { labelKey: "devices.approvalReject", hintKey: "devices.approvalRejectHint" },
  remote: { labelKey: "devices.approvalRemote", hintKey: "devices.approvalRemoteHint" },
};

function approvalPolicyLabel(value: string, fallback: string): string {
  const entry = APPROVAL_POLICY_LABELS[value];
  return entry ? tr(entry.labelKey) : fallback;
}

function approvalPolicyHint(value: string): string {
  const entry = APPROVAL_POLICY_LABELS[value];
  return entry ? tr(entry.hintKey) : "";
}

/**
 * Removes a device from the account (`account_delete_device`, positional
 * `targetDeviceId`). Removing this machine signs it out, as on the desktop.
 */
export async function removeAccountDevice(deviceId: string): Promise<void> {
  if (removeDeviceBusy()) return;
  const device = devices().find(item => item.id === deviceId);
  const name = device?.alias || device?.name || deviceId;
  const isLocal = deviceId === localDeviceId();
  removeDeviceBusy.set(true);
  removeDeviceError.set("");
  try {
    await invokeRawCommand<unknown>("account_delete_device", { targetDeviceId: deviceId });
    removingDeviceId.set(null);
    pushToast(isLocal ? tr("devices.currentDeviceRemoved") : tr("devices.deviceRemoved", { name }), "success");
    if (isLocal) {
      devices.set([]);
      await loadAccountState();
    }
    await loadDevices();
  } catch (error) {
    removeDeviceError.set(localizeHostError(error instanceof Error ? error.message : String(error)));
  } finally {
    removeDeviceBusy.set(false);
  }
}

/** Persists a device alias; `null` clears it and the account falls back to the name. */
export async function saveDeviceAlias(deviceId: string, alias: string): Promise<void> {
  const trimmed = alias.trim();
  await runStep(async () => {
    await invokeCommand<unknown>("account_update_device_alias", {
      device_id: deviceId,
      device_alias: trimmed || null,
    });
    devices.update(current =>
      current.map(device => (device.id === deviceId ? { ...device, alias: trimmed || undefined } : device)),
    );
    editingDeviceId.set(null);
  });
}

function readString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value) return value;
  }
  return "";
}

function readDevice(record: Record<string, unknown>, onlineIds: Set<string>): DeviceRow {
  const id = readString(record, ["deviceId", "device_id", "id"]);
  return {
    id,
    name: readString(record, ["deviceName", "device_name", "name", "hostname"]) || id,
    platform: readString(record, [
      "deviceOs",
      "device_os",
      "platform",
      "os",
      "deviceKind",
      "device_kind",
      "deviceType",
      "device_type",
    ]),
    alias:
      readString(record, [
        "deviceAlias",
        "device_alias",
        "alias",
        "displayName",
        "display_name",
      ]) || undefined,
    online:
      record.online === true ||
      record.is_online === true ||
      record.isOnline === true ||
      onlineIds.has(id),
  };
}

export async function loadDevices(): Promise<void> {
  void loadDevicePreferences();
  void loadLocalDeviceId();
  await runStep(async () => {
    devicesError.set(null);
    const [list, online] = await Promise.all([
      invokeRawCommand<Array<Record<string, unknown>>>("account_list_devices").catch(error => {
        devicesError.set(error instanceof Error ? error.message : String(error));
        return [] as Array<Record<string, unknown>>;
      }),
      invokeRawCommand<Array<Record<string, unknown>>>("account_online_devices").catch(
        () => [] as Array<Record<string, unknown>>,
      ),
    ]);
    const onlineIds = new Set(
      (Array.isArray(online) ? online : []).map(record =>
        readString(record ?? {}, ["deviceId", "device_id", "id"]),
      ),
    );
    const rows = (Array.isArray(list) ? list : []).map(record => readDevice(record ?? {}, onlineIds));
    devices.set(rows);
    devicesLoaded.set(true);
  });
}

/** The devices in presentation order: arranged ones first, then this device, presence and name. */
const orderedDevices = computed(() => sortDevices(devices(), localDeviceId()));
/** What the scene lists: the arranged devices, or every device when the user asked for the hidden ones too. */
const listedDevices = computed(() => {
  const all = orderedDevices();
  return showHiddenDevices() ? all : all.filter(device => hiddenDevices()[device.id] !== true);
});
const hiddenCount = computed(() => orderedDevices().filter(device => hiddenDevices()[device.id] === true).length);

/**
 * Moves a listed device one place up or down. The moved id and its neighbour swap
 * by id, so the stored order is the arrangement the user sees, not the raw list.
 */
function moveListed(deviceId: string, direction: -1 | 1): void {
  const listed = listedDevices();
  const index = listed.findIndex(device => device.id === deviceId);
  if (index < 0) return;
  const target = listed[index + direction];
  if (!target) return;
  const ids = listed.map(device => device.id);
  moveDevice(deviceId, target.id, direction < 0 ? "before" : "after", ids);
}

/**
 * Enters Peer Device Mode for one device. The caches of the machine this
 * surface was reading are dropped first, so a peer's session list is loaded from
 * the peer and never from what was on screen before.
 */
async function switchToDevice(device: DeviceRow): Promise<void> {
  connectingDeviceId.set(device.id);
  try {
    if (!(await enterPeer(device.id, device.alias || device.name))) return;
    forgetTerminals();
    await resetForDeviceChange();
    activeScene.set("sessions");
  } finally {
    if (connectingDeviceId() === device.id) connectingDeviceId.set(null);
  }
}

/** Leaves Peer Device Mode and reads this machine again. */
export async function returnToThisMachine(): Promise<void> {
  await leavePeer();
  forgetTerminals();
  await resetForDeviceChange();
}

function isBotActive(keyword: string): boolean {
  const bot = (connectorStatus()?.botConnected ?? "").toLowerCase();
  if (!bot) return false;
  return bot.includes(keyword);
}

function pairingUrl(): string {
  return (
    relayUrlForMethod("lan") ||
    relayUrlForMethod("openbitfun_server") ||
    relayPairing()?.qrUrl ||
    relayPairing()?.botLink ||
    relayPairing()?.qrData ||
    ""
  );
}


function stateDotKind(text: string): StatusDotKind {
  const lower = text.toLowerCase();
  if (lower.includes("succeed")) return "success";
  if (lower.includes("fail") || lower.includes("cancel") || lower.includes("error")) return "danger";
  return "accent";
}

function jobDotKind(state: string): StatusDotKind {
  if (state === "succeeded") return "success";
  if (state === "failed" || state === "cancelled") return "danger";
  return "accent";
}

/** A status dot with its text beside it: the one status mark a header or row carries. */
function InlineStatus(props: { kind: StatusDotKind; label: string; pulse?: boolean; accessibilityLabel?: string }) {
  return (
    <View
      accessibilityLabel={props.accessibilityLabel}
      style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 0 }}
    >
      <StatusDot kind={props.kind} size={7} pulse={props.pulse} />
      <Text
        style={{
          color: palette().textSecondary,
          fontSize: textSize(13),
          fontVariant: ["tabular-nums"],
          lineHeight: textLineHeight(13, 1.35),
        }}
      >
        {props.label}
      </Text>
    </View>
  );
}

/** Quiet trailing text on a section header line. */
function QuietText(props: { label: string }) {
  return (
    <Text
      style={{
        color: palette().textSecondary,
        fontSize: textSize(13),
        fontVariant: ["tabular-nums"],
        lineHeight: textLineHeight(13, 1.35),
      }}
    >
      {props.label}
    </Text>
  );
}

/** A wrapping secondary line under an inset row's label. */
function RowNote(props: { text: string }) {
  return (
    <Text
      style={{
        color: palette().textMuted,
        fontSize: textSize(12),
        lineHeight: textLineHeight(12, 1.45),
      }}
    >
      {props.text}
    </Text>
  );
}

function ObservedEventRow(props: { row: () => DispatchRow }) {
  return (
    <View>
      <If when={props.row().kind === "state"}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 }}>
          <StatusDot kind={stateDotKind(props.row().text)} size={6} />
          <Text
            style={{
              flexShrink: 1,
              minWidth: 0,
              color: palette().textSecondary,
              fontFamily: fontMono,
              fontSize: textSize(12),
              fontVariant: ["tabular-nums"],
              lineHeight: textLineHeight(12, 1.4),
              numberOfLines: 2,
              textOverflow: "ellipsis",
            }}
          >
            {props.row().text}
          </Text>
        </View>
      </If>

      <If when={props.row().kind === "thinking"}>
        <View
          style={{
            borderLeftWidth: 2,
            borderColor: palette().borderSubtle,
            paddingLeft: 10,
            paddingVertical: 2,
            gap: 2,
          }}
        >
          <Text
            style={{
              color: palette().textMuted,
              fontSize: textSize(12),
              fontWeight: "600",
              lineHeight: textLineHeight(12, 1.35),
            }}
          >
            {tr("devices.polish.thinking")}
          </Text>
          <Text
            style={{
              minWidth: 0,
              color: palette().textMuted,
              fontSize: textSize(13),
              lineHeight: textLineHeight(13, 1.5),
            }}
          >
            {props.row().text}
          </Text>
        </View>
      </If>

      <If when={props.row().kind === "tool"}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, minWidth: 0 }}>
          <View style={{ flexShrink: 0, marginTop: 2 }}>
            <Icon name="wrench" size={12} color={palette().textMuted} />
          </View>
          <Text
            style={{
              flex: 1,
              minWidth: 0,
              color: palette().textSecondary,
              fontFamily: fontMono,
              fontSize: textSize(12),
              lineHeight: textLineHeight(12, 1.45),
            }}
          >
            {props.row().text}
          </Text>
        </View>
      </If>

      <If when={props.row().kind === "error"}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, minWidth: 0 }}>
          <View style={{ flexShrink: 0, marginTop: 2 }}>
            <Icon name="alert-circle" size={13} color={palette().danger} />
          </View>
          <Text
            style={{
              flex: 1,
              minWidth: 0,
              color: palette().danger,
              fontSize: textSize(13),
              lineHeight: textLineHeight(13, 1.45),
            }}
          >
            {localizeHostError(props.row().text)}
          </Text>
        </View>
      </If>

      <If when={props.row().kind === "user"}>
        <View
          style={{
            alignSelf: "flex-end",
            maxWidth: "82%",
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderRadius: radii.lg,
            borderCurve: "continuous",
            backgroundColor: palette().userBubble,
          }}
        >
          <Text
            style={{
              minWidth: 0,
              color: palette().userBubbleText,
              fontSize: textSize(13),
              lineHeight: textLineHeight(13, 1.48),
            }}
          >
            {props.row().text}
          </Text>
        </View>
      </If>

      <If when={props.row().kind === "assistant"}>
        <TextView
          markdown={props.row().text}
          selectable={true}
          links="open"
          codeBlockActions={createMarkdownCodeActions()}
          styles={createMarkdownStyles({ compact: true, baseFontSize: 13 })}
        />
      </If>
    </View>
  );
}

function observerMenuItems(): DropdownMenuItem[] {
  const items: DropdownMenuItem[] = [
    {
      id: "poll",
      label: tr("devices.pollTargetLog"),
      icon: "refresh",
      accessibilityLabel: "dispatch-observe-poll",
      onSelect: () => void pollObservedJob(),
    },
  ];
  if (!observedJobFinished()) {
    items.push({
      id: "cancel",
      label: tr("devices.cancelJob"),
      icon: "stop",
      danger: true,
      accessibilityLabel: "dispatch-observe-cancel",
      onSelect: () => void cancelObservedJob(),
    });
  }
  items.push(
    { id: "sep", label: "", separator: true },
    {
      id: "close",
      label: tr("common.close"),
      icon: "close",
      accessibilityLabel: "dispatch-observe-close",
      onSelect: () => closeObservedJob(),
    },
  );
  return items;
}

function DispatchObserverPanel() {
  cleanup(() => closeObservedJob());
  return (
    <If when={observedJobId()}>
      <StudioSection
        title={tr("devices.observedJob")}
        accessibilityLabel="dispatch-observer"
        trailing={
          <>
            <If when={observedState()}>
              {state => (
                <InlineStatus
                  kind={jobDotKind(state())}
                  label={state()}
                  pulse={!observedJobFinished()}
                />
              )}
            </If>
            <If when={observedJobFinished()}>
              <Button
                label={tr("devices.syncResult")}
                variant="secondary"
                size="sm"
                leadingIcon="download"
                accessibilityLabel="dispatch-observe-sync"
                onPress={() => void syncObservedResult()}
              />
            </If>
            <MoreMenu
              accessibilityLabel="dispatch-observe-menu"
              tooltip={tr("common.actions")}
              items={observerMenuItems()}
            />
          </>
        }
      >
        <View style={{ gap: 14, minWidth: 0 }}>
          <If when={observedJobTitle()}>
            {title => (
              <Text
                style={{
                  paddingHorizontal: 4,
                  color: palette().textSecondary,
                  fontSize: textSize(13),
                  lineHeight: textLineHeight(13, 1.45),
                }}
              >
                {title()}
              </Text>
            )}
          </If>
          <If when={observedNotice()}>
            {notice => <InlineBanner tone="neutral" message={localizeHostError(notice())} />}
          </If>
          <If when={observedTruncated()}>
            <InlineBanner tone="warning" message={tr("devices.observedTruncated")} />
          </If>
          <If when={observedPending().length > 0}>
            <InsetGroup>
              <Each of={observedPending()} key={request => request.requestId}>
                {(request, index) => (
                  <View
                    style={{
                      gap: 12,
                      paddingHorizontal: 16,
                      paddingVertical: 14,
                      borderTopWidth: index() === 0 ? 0 : 1,
                      borderColor: palette().borderSubtle,
                    }}
                  >
                    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                      <View style={{ paddingTop: 2 }}>
                        <Icon name="shield" size={16} color={palette().textMuted} />
                      </View>
                      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                        <Text
                          style={{
                            color: palette().text,
                            fontSize: textSize(14),
                            fontWeight: "600",
                            lineHeight: textLineHeight(14, 1.35),
                          }}
                        >
                          {request().title}
                        </Text>
                        <Text
                          style={{
                            color: palette().textSecondary,
                            fontFamily: fontMono,
                            fontSize: textSize(12),
                            lineHeight: textLineHeight(12, 1.45),
                          }}
                        >
                          {request().detail}
                        </Text>
                      </View>
                    </View>
                    <View
                      style={{
                        flexDirection: "row",
                        flexWrap: "wrap",
                        alignItems: "center",
                        justifyContent: "flex-end",
                        gap: 8,
                      }}
                    >
                      <Button
                        label={tr("sessions.reject")}
                        variant="ghost"
                        size="sm"
                        accessibilityLabel={`dispatch-permission-reject-${request().requestId}`}
                        onPress={() => void answerObservedPermission(request().requestId, "reject")}
                      />
                      <Button
                        label={tr("devices.always")}
                        variant="secondary"
                        size="sm"
                        accessibilityLabel={`dispatch-permission-always-${request().requestId}`}
                        onPress={() => void answerObservedPermission(request().requestId, "always")}
                      />
                      <Button
                        label={tr("sessions.allowOnce")}
                        variant="primary"
                        size="sm"
                        accessibilityLabel={`dispatch-permission-once-${request().requestId}`}
                        onPress={() => void answerObservedPermission(request().requestId, "once")}
                      />
                    </View>
                  </View>
                )}
              </Each>
            </InsetGroup>
          </If>

          <View
            style={{
              borderRadius: radii.lg,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: palette().borderSubtle,
              backgroundColor: palette().panelRaised,
              paddingHorizontal: 16,
              paddingVertical: 14,
            }}
          >
            <Scroll style={{ maxHeight: 320, minHeight: 0 }}>
              <View style={{ gap: 12 }}>
                <If when={observedRows().length === 0}>
                  <Text style={textStyle("caption")}>{tr("devices.noJobEvents")}</Text>
                </If>
                <Each of={observedRows()} key={row => row.id}>
                  {row => <ObservedEventRow row={row} />}
                </Each>
              </View>
            </Scroll>
          </View>

          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <InputBox
              size="md"
              value={observedDraft()}
              placeholder={
                observedJobFinished() ? tr("devices.followUpPlaceholder") : tr("devices.steerPlaceholder")
              }
              accessibilityLabel="dispatch-observe-message"
              style={{ flex: 1, minWidth: 0 }}
              onChange={val => observedDraft.set(val)}
              onSubmit={() => void sendToObservedJob()}
            />
            <Button
              label={tr("common.send")}
              variant="primary"
              size="md"
              leadingIcon="arrow-up"
              disabled={observedBusy()}
              accessibilityLabel="dispatch-observe-send"
              onPress={() => void sendToObservedJob()}
            />
          </View>
        </View>
      </StudioSection>
    </If>
  );
}

function JobActions(props: { jobId: string; onObserve: () => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <Button
        label={tr("devices.observe")}
        variant="secondary"
        size="sm"
        accessibilityLabel={`dispatch-observe-${props.jobId}`}
        onPress={props.onObserve}
      />
      <Button
        label={tr("common.cancel")}
        variant="ghost"
        size="sm"
        accessibilityLabel={`dispatch-cancel-${props.jobId}`}
        onPress={() => void cancelDispatch(props.jobId)}
      />
    </View>
  );
}

function DispatchSection() {
  ensureDispatch();
  const chosen = () => selectedTarget();
  const needsPath = () => {
    const target = chosen();
    return target !== null && target.kind !== "local";
  };
  return (
    <If when={dispatchSupported() !== false}>
      <StudioSection
        title={tr("devices.dispatchTitle")}
        accessibilityLabel="dispatch-section"
        footnote={tr("devices.dispatchSubtitle")}
        trailing={
          <>
            <IconButton
              icon="refresh"
              size="sm"
              tooltip={tr("devices.refreshJobs")}
              accessibilityLabel="dispatch-refresh"
              onPress={() => void refreshDispatchJobs()}
            />
            <Button
              label={tr("devices.newJob")}
              variant="secondary"
              size="sm"
              leadingIcon="plus"
              accessibilityLabel="dispatch-form-toggle"
              onPress={() => {
                const hadPath = Boolean(dispatchWorkspacePath().trim());
                openDispatchForm();
                if (!hadPath && needsPath()) dispatchWorkspacePath.set("");
              }}
            />
          </>
        }
      >
        <View style={{ gap: 12, minWidth: 0 }}>
          <If when={dispatchNotice()}>
            {notice => <InlineBanner tone="neutral" message={localizeHostError(notice())} />}
          </If>
          <If
            when={dispatchJobs().length > 0}
            else={
              <Text
                style={{
                  paddingHorizontal: 4,
                  color: palette().textMuted,
                  fontSize: textSize(13),
                  lineHeight: textLineHeight(13, 1.45),
                }}
              >
                {tr("devices.noJobsYet")}
              </Text>
            }
          >
            <InsetGroup accessibilityLabel="dispatch-jobs">
              <Each of={dispatchJobs()} key={job => job.jobId}>
                {(job, index) => (
                  <InsetRow
                    first={index() === 0}
                    leading={<StatusDot kind={jobDotKind(job().state)} size={7} pulse={job().state === "running"} />}
                    label={`${job().title || job().promptPreview || job().jobId} · ${job().target?.displayName ?? job().target?.kind ?? tr("common.local")}`}
                    value={job().state}
                    trailing={
                      studioCompact() ? undefined : (
                        <JobActions jobId={job().jobId} onObserve={() => void openObservedJob(job())} />
                      )
                    }
                    below={
                      studioCompact() ? (
                        <JobActions jobId={job().jobId} onObserve={() => void openObservedJob(job())} />
                      ) : undefined
                    }
                  />
                )}
              </Each>
            </InsetGroup>
          </If>
        </View>
      </StudioSection>

      <ModalDialog
        open={dispatchFormOpen()}
        title={tr("devices.newJobTitle")}
        subtitle={tr("devices.newJobSubtitle")}
        size="md"
        accessibilityLabel="dispatch-job-modal"
        onClose={() => dispatchFormOpen.set(false)}
        footer={
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Button
              label={tr("common.cancel")}
              variant="ghost"
              size="sm"
              onPress={() => dispatchFormOpen.set(false)}
            />
            <Button
              label={tr("devices.submitJob")}
              variant="primary"
              size="sm"
              accessibilityLabel="dispatch-submit"
              disabled={!dispatchTargetReady()}
              tooltip={dispatchTargetReady() ? undefined : dispatchProbe()?.message || tr("devices.dispatchNotReady")}
              onPress={() => void submitDispatch()}
            />
          </View>
        }
      >
        <View style={{ gap: 14 }}>
          <View style={{ gap: 6 }}>
            <Text style={textStyle("label", { color: palette().textSecondary })}>
              {tr("devices.targetHost")}
            </Text>
            <SelectDropdown
              options={dispatchTargets().map(target => ({
                value: targetKey(target),
                label: `${target.displayName} (${target.kind}${target.online === false ? `, ${tr("devices.offline")}` : ""})`,
                icon: target.kind === "ssh" ? ("server" as const) : ("laptop" as const),
                accessibilityLabel: `dispatch-target-${targetKey(target)}`,
              }))}
              value={dispatchTargetKey()}
              placeholder={tr("devices.chooseTargetHost")}
              fullWidth={true}
              accessibilityLabel="dispatch-target-select"
              onChange={val => chooseDispatchTarget(val)}
            />
            <If when={dispatchProbe()}>
              {probe => (
                <View
                  accessibilityLabel="dispatch-probe-status"
                  style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 24 }}
                >
                  <StatusDot
                    kind={
                      probe().status === "ready"
                        ? "success"
                        : probe().status === "checking"
                          ? "muted"
                          : "danger"
                    }
                  />
                  <Text
                    style={{
                      flex: 1,
                      minWidth: 0,
                      color: probe().status === "ready" || probe().status === "checking"
                        ? palette().textMuted
                        : palette().danger,
                      fontSize: textSize(12),
                      lineHeight: textLineHeight(12, 1.4),
                    }}
                  >
                    {probe().status === "checking"
                      ? tr("devices.dispatchChecking")
                      : probe().status === "ready"
                        ? tr("devices.dispatchReady")
                        : probe().status === "failed"
                          ? tr("devices.dispatchProbeFailed", { error: probe().message })
                          : probe().message}
                  </Text>
                  <If when={probe().status === "failed" || probe().status === "not-ready"}>
                    <Button
                      label={tr("common.retry")}
                      variant="ghost"
                      size="sm"
                      accessibilityLabel="dispatch-probe-retry"
                      onPress={() => void probeDispatchTarget()}
                    />
                  </If>
                </View>
              )}
            </If>
          </View>
          <If when={needsPath()}>
            <InputBox
              label={tr("devices.targetWorkspacePath")}
              leadingIcon="folder"
              monospace
              value={dispatchWorkspacePath()}
              placeholder="/path/on/that/host"
              accessibilityLabel="dispatch-workspace"
              onChange={val => dispatchWorkspacePath.set(val)}
            />
          </If>
          <InputBox
            label={tr("devices.prompt")}
            multiline
            minHeight={88}
            value={dispatchPrompt()}
            placeholder={tr("devices.promptPlaceholder")}
            accessibilityLabel="dispatch-prompt"
            onChange={val => dispatchPrompt.set(val)}
            onSubmit={() => void submitDispatch()}
          />
          <InputBox
            label={tr("devices.dispatchTitleLabel")}
            value={dispatchTitle()}
            placeholder={tr("devices.dispatchTitlePlaceholder")}
            accessibilityLabel="dispatch-title"
            onChange={val => dispatchTitle.set(val)}
          />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
            <View style={{ flex: 1, minWidth: 180 }}>
              <InputBox
                label={tr("devices.dispatchBaseRef")}
                hint={tr("devices.dispatchBaseRefHint")}
                monospace
                value={dispatchBaseRef()}
                placeholder="HEAD"
                accessibilityLabel="dispatch-base-ref"
                onChange={val => dispatchBaseRef.set(val)}
              />
            </View>
            <View style={{ flex: 1, minWidth: 180, gap: 6 }}>
              <Text style={textStyle("label", { color: palette().textSecondary })}>
                {tr("devices.dispatchModel")}
              </Text>
              <SelectDropdown
                options={[
                  {
                    value: "",
                    label: tr("devices.dispatchModelDefault"),
                    accessibilityLabel: "dispatch-model-default",
                  },
                  ...(dispatchProbe()?.availableModels ?? []).map(model => ({
                    value: model,
                    label: model === dispatchProbe()?.defaultModel
                      ? tr("devices.dispatchModelTargetDefault", { model })
                      : model,
                    accessibilityLabel: `dispatch-model-${model}`,
                  })),
                ]}
                value={dispatchModel()}
                fullWidth={true}
                accessibilityLabel="dispatch-model-select"
                onChange={val => dispatchModel.set(val)}
              />
            </View>
          </View>
          <ConfigRow
            label={tr("devices.dispatchIncludeUncommitted")}
            description={tr("devices.dispatchIncludeUncommittedHint")}
            divider={false}
          >
            <ToggleSwitch
              value={dispatchIncludeUncommitted()}
              accessibilityLabel="dispatch-include-uncommitted"
              onChange={next => dispatchIncludeUncommitted.set(next)}
            />
          </ConfigRow>
          <View style={{ gap: 6 }}>
            <Text style={textStyle("label", { color: palette().textSecondary })}>
              {tr("devices.approvalPolicy")}
            </Text>
            <SegmentedTabs
              size="sm"
              value={dispatchApprovalPolicy()}
              options={DISPATCH_APPROVAL_POLICIES.map(policy => ({
                value: policy.value,
                label: approvalPolicyLabel(policy.value, policy.label),
                accessibilityLabel: `dispatch-approval-${policy.value}`,
              }))}
              onChange={value => dispatchApprovalPolicy.set(value)}
            />
            <If when={approvalPolicyHint(dispatchApprovalPolicy())}>
              {hint => <Text style={textStyle("caption")}>{hint()}</Text>}
            </If>
          </View>
        </View>
      </ModalDialog>

      <DispatchObserverPanel />
    </If>
  );
}

function deviceDotKind(device: DeviceRow): StatusDotKind {
  if (connectingDeviceId() === device.id) return "accent";
  if (peerScope()?.deviceId === device.id) return "accent";
  return device.online ? "success" : "muted";
}

function deviceMenuItems(device: DeviceRow): DropdownMenuItem[] {
  const hidden = hiddenDevices()[device.id] === true;
  return [
    {
      id: "up",
      label: tr("common.up"),
      icon: "arrow-up",
      accessibilityLabel: `device-up-${device.id}`,
      onSelect: () => moveListed(device.id, -1),
    },
    {
      id: "down",
      label: tr("common.down"),
      icon: "chevron-down",
      accessibilityLabel: `device-down-${device.id}`,
      onSelect: () => moveListed(device.id, 1),
    },
    {
      id: "hide",
      label: hidden ? tr("devices.show") : tr("devices.hide"),
      icon: hidden ? "eye" : "eye-off",
      accessibilityLabel: `device-hide-${device.id}`,
      onSelect: () => toggleDeviceVisible(device.id),
    },
    {
      id: "rename",
      label: tr("common.rename"),
      icon: "edit",
      accessibilityLabel: `device-rename-${device.id}`,
      onSelect: () => {
        aliasValue.set("");
        editingDeviceId.set(device.id);
      },
    },
    {
      id: "remove",
      label: device.id === localDeviceId() ? tr("devices.removeCurrentDevice") : tr("devices.removeDevice"),
      icon: "trash",
      danger: true,
      separator: true,
      accessibilityLabel: `device-remove-${device.id}`,
      onSelect: () => {
        removeDeviceError.set("");
        removingDeviceId.set(device.id);
      },
    },
  ];
}

function accountMenuItems(): DropdownMenuItem[] {
  return [
    {
      id: "account",
      label: signedInAccountDisplay(),
      icon: "user",
      accessibilityLabel: "devices-account-pill",
      onSelect: () => openAccountAuthModal(),
    },
    {
      id: "sign-out",
      label: tr("devices.signOut"),
      icon: "log-out",
      disabled: authLoading(),
      accessibilityLabel: "devices-sign-out",
      onSelect: () => void signOutAccount(),
    },
  ];
}

function devicesFootnote(): string | undefined {
  if (needsAccountSignIn()) return undefined;
  const parts: string[] = [];
  if (isAccountSignedIn()) parts.push(tr("devices.accountSignedInAs", { account: signedInAccountDisplay() }));
  parts.push(formatPlural(devices().length, "devices.deviceCountOne", "devices.deviceCountOther"));
  return parts.join(" · ");
}

function DeviceListRow(props: { device: () => DeviceRow; first: boolean }) {
  const isPeer = () => peerScope()?.deviceId === props.device().id;
  const isLocal = () => props.device().id === localDeviceId();
  return (
    <InsetRow
      first={props.first}
      selected={isPeer()}
      leading={
        <View style={{ width: 16, alignItems: "center" }}>
          <StatusDot
            kind={deviceDotKind(props.device())}
            size={8}
            pulse={connectingDeviceId() === props.device().id}
          />
        </View>
      }
      label={props.device().alias || props.device().name}
      detail={`${props.device().platform || tr("devices.unknownPlatform")} · ${props.device().online ? tr("devices.online") : tr("devices.offline")} · ${props.device().id}`}
      value={isPeer() ? tr("devices.activePeer") : isLocal() ? tr("devices.thisDevice") : undefined}
      trailing={
        <>
          <If when={!isPeer() && props.device().online && !isLocal()}>
            <Button
              label={
                connectingDeviceId() === props.device().id ? tr("devices.connectingEllipsis") : tr("common.use")
              }
              variant="secondary"
              size="sm"
              loading={connectingDeviceId() === props.device().id}
              disabled={peerBusy()}
              accessibilityLabel={`device-use-${props.device().id}`}
              onPress={() => void switchToDevice(props.device())}
            />
          </If>
          <MoreMenu
            accessibilityLabel={`device-actions-${props.device().id}`}
            tooltip={tr("devices.deviceActions")}
            minWidth={168}
            items={deviceMenuItems(props.device())}
          />
        </>
      }
    />
  );
}

/** What Peer Device Mode is doing right now, under the device list. */
function PeerModeNote() {
  return (
    <View accessibilityLabel="devices-peer-mode" style={{ marginTop: 14, paddingHorizontal: 4, gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <StatusDot kind={peerScope() ? "accent" : "muted"} size={7} />
        <Text
          style={{
            color: palette().textSecondary,
            fontSize: textSize(13),
            fontWeight: "600",
            lineHeight: textLineHeight(13, 1.35),
          }}
        >
          {peerScope()
            ? tr("devices.drivingAnother")
            : currentLocale() === "en-US"
              ? tr("devices.drivingAnother")
              : tr("devices.peerModeIdle")}
        </Text>
      </View>
      <Text
        style={{
          color: palette().textMuted,
          fontSize: textSize(12),
          fontVariant: ["tabular-nums"],
          lineHeight: textLineHeight(12, 1.5),
        }}
      >
        {peerScope()
          ? tr("devices.drivingActiveSummary", {
              label: peerScope()!.label,
              hostKind: peerScope()!.hostKind,
              capabilities: formatPlural(
                peerScope()!.capabilityCount,
                "devices.capabilityOne",
                "devices.capabilityOther",
              ),
            })
          : tr("devices.drivingIdleHint")}
      </Text>
      <If when={Boolean(peerScope())}>
        <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
          <Button
            label={peerReconnecting() ? tr("nav.peerReconnecting") : tr("nav.peerReconnect")}
            variant="secondary"
            size="sm"
            leadingIcon="refresh"
            loading={peerReconnecting()}
            disabled={peerBusy() || peerReconnecting()}
            accessibilityLabel="peer-reconnect"
            onPress={() => void reconnectPeer()}
          />
          <Button
            label={tr("devices.thisMachine")}
            variant="ghost"
            size="sm"
            disabled={peerBusy()}
            accessibilityLabel="peer-leave"
            onPress={() => void returnToThisMachine()}
          />
        </View>
      </If>
      <If when={peerError()}>
        {message => (
          <InlineBanner
            tone="danger"
            message={localizeHostError(message())}
            actionLabel={peerScope() ? tr("nav.peerReconnect") : undefined}
            onAction={peerScope() ? () => void reconnectPeer() : undefined}
          />
        )}
      </If>
    </View>
  );
}

function DevicesSection() {
  const editingDevice = () => {
    const id = editingDeviceId();
    return id ? devices().find(device => device.id === id) ?? null : null;
  };
  return (
    <StudioSection
      title={tr("devices.polish.devicesSection")}
      accessibilityLabel="devices-section"
      footnote={devicesFootnote()}
      trailing={
        <>
          <If when={!needsAccountSignIn() && hiddenCount() > 0}>
            <PillChip
              label={tr("devices.hiddenCount", { count: hiddenCount() })}
              active={showHiddenDevices()}
              accessibilityLabel="toggle-hidden-devices"
              onPress={() => showHiddenDevices.set(!showHiddenDevices())}
            />
          </If>
          <If when={isAccountSignedIn()}>
            <MoreMenu
              accessibilityLabel="devices-account-menu"
              tooltip={tr("devices.polish.accountActions")}
              icon="user"
              minWidth={200}
              items={accountMenuItems()}
            />
          </If>
        </>
      }
    >
      <If when={needsAccountSignIn()}>
        <StudioEmpty
          accessibilityLabel="devices-sign-in-panel"
          icon="user"
          message={tr("devices.signInRequiredTitle")}
          detail={tr("devices.signInRequiredSubtitle")}
          action={
            <Button
              label={tr("devices.signInCta")}
              variant="primary"
              size="md"
              leadingIcon="log-in"
              accessibilityLabel="devices-sign-in"
              onPress={() => openAccountAuthModal({ autoStart: true, onSuccess: () => void loadDevices() })}
            />
          }
        />
      </If>
      <If when={!needsAccountSignIn()}>
        <If
          when={devices().length > 0}
          else={
            <Text
              style={{
                paddingHorizontal: 4,
                color: palette().textMuted,
                fontSize: textSize(13),
                lineHeight: textLineHeight(13, 1.45),
              }}
            >
              {devicesLoaded() ? tr("devices.noDevices") : tr("devices.loadingDevices")}
            </Text>
          }
        >
          <InsetGroup accessibilityLabel="devices-list">
            <Each of={listedDevices()} key={device => device.id}>
              {(device, index) => <DeviceListRow device={device} first={index() === 0} />}
            </Each>
          </InsetGroup>
        </If>
      </If>
      <If when={!needsAccountSignIn() || Boolean(peerScope())}>
        <PeerModeNote />
      </If>

      <ModalDialog
        open={Boolean(removingDeviceId())}
        title={
          removingDeviceId() === localDeviceId()
            ? tr("devices.removeCurrentDevice")
            : tr("devices.removeDevice")
        }
        size="sm"
        accessibilityLabel="device-remove-modal"
        onClose={() => removingDeviceId.set(null)}
        footer={
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Button
              label={tr("common.cancel")}
              variant="ghost"
              size="sm"
              onPress={() => removingDeviceId.set(null)}
            />
            <Button
              label={
                removingDeviceId() === localDeviceId()
                  ? tr("devices.removeCurrentDevice")
                  : tr("devices.removeDevice")
              }
              variant="danger"
              size="sm"
              loading={removeDeviceBusy()}
              accessibilityLabel="device-remove-confirm"
              onPress={() => {
                const id = removingDeviceId();
                if (id) void removeAccountDevice(id);
              }}
            />
          </View>
        }
      >
        <View style={{ gap: 10 }}>
          <Text
            style={{
              color: palette().textSecondary,
              fontSize: textSize(13),
              lineHeight: textLineHeight(13, 1.5),
            }}
          >
            {(() => {
              const id = removingDeviceId() ?? "";
              const device = devices().find(item => item.id === id);
              const name = device?.alias || device?.name || id;
              return id === localDeviceId()
                ? tr("devices.confirmRemoveCurrentDevice", { name })
                : tr("devices.confirmRemoveDevice", { name });
            })()}
          </Text>
          <If when={removeDeviceError()}>
            {err => <InlineBanner tone="danger" message={err()} />}
          </If>
        </View>
      </ModalDialog>

      <ModalDialog
        open={Boolean(editingDeviceId())}
        title={tr("devices.renameDeviceTitle")}
        subtitle={tr("devices.renameDeviceSubtitle")}
        size="sm"
        accessibilityLabel="device-rename-modal"
        onClose={() => editingDeviceId.set(null)}
        footer={
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Button
              label={tr("common.cancel")}
              variant="ghost"
              size="sm"
              onPress={() => editingDeviceId.set(null)}
            />
            <Button
              label={tr("common.save")}
              variant="primary"
              size="sm"
              onPress={() => {
                const id = editingDeviceId();
                if (id) void saveDeviceAlias(id, aliasValue());
              }}
            />
          </View>
        }
      >
        <InputBox
          label={tr("devices.displayAlias")}
          value={aliasValue()}
          placeholder={
            editingDevice()?.alias
              ? tr("devices.aliasCurrentPlaceholder", { alias: editingDevice()!.alias! })
              : tr("devices.aliasClearPlaceholder")
          }
          accessibilityLabel="device-alias"
          autoFocus={true}
          onChange={val => aliasValue.set(val)}
          onSubmit={() => {
            const id = editingDeviceId();
            if (id) void saveDeviceAlias(id, aliasValue());
          }}
        />
      </ModalDialog>
    </StudioSection>
  );
}

function ChannelRow(props: {
  icon: IconName;
  label: string;
  description: string;
  active: boolean;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  return (
    <InsetRow
      icon={props.icon}
      label={props.label}
      detail={props.description}
      chevron
      trailing={props.active ? <StatusDot kind="success" size={7} /> : undefined}
      accessibilityLabel={props.accessibilityLabel}
      onPress={props.onPress}
    />
  );
}

function channelMenuItems(): DropdownMenuItem[] {
  return [
    {
      id: "refresh",
      label: tr("devices.refreshChannels"),
      icon: "refresh",
      disabled: connectorsLoading(),
      accessibilityLabel: "connectors-refresh",
      onSelect: () => void loadConnectors(),
    },
    {
      id: "disclaimer",
      label: tr("devices.remote.disclaimerReview"),
      icon: "shield",
      accessibilityLabel: "remote-disclaimer-review",
      onSelect: () => openRemoteDisclaimer(),
    },
  ];
}

function ChannelsSection() {
  ensureConnectors();

  return (
    <StudioSection
      title={tr("devices.polish.channelsSection")}
      accessibilityLabel="channels-section"
      footnote={connectorsSupported() === true ? tr("devices.channelsSubtitle") : undefined}
      trailing={
        <>
          <If when={Boolean(peerScope())}>
            <QuietText label={tr("common.controllerLocal")} />
          </If>
          <MoreMenu
            accessibilityLabel="channels-menu"
            tooltip={tr("common.actions")}
            minWidth={200}
            items={channelMenuItems()}
          />
        </>
      }
    >
      <View style={{ gap: 12, minWidth: 0 }}>
        <If when={peerScope()}>
          {scope => (
            <InlineBanner
              tone="info"
              icon="laptop"
              message={tr("devices.connectorsPeerBanner", { label: scope().label })}
            />
          )}
        </If>
        <If when={connectorsSupported() === false}>
          <StudioEmpty
            icon="wifi"
            message={tr("devices.connectorsUnavailable")}
            detail={tr("devices.connectorsUnavailableSubtitle")}
          />
        </If>
        <If when={connectorsSupported() === true}>
          <If when={connectorNotice()}>
            {notice => <InlineBanner tone="success" message={localizeHostError(notice())} />}
          </If>
          <If when={connectorError()}>
            {err => <InlineBanner tone="danger" message={localizeHostError(err())} />}
          </If>
          <InsetGroup accessibilityLabel="channels-list">
            <InsetRow
              first
              label={tr("devices.remoteControlAllowed")}
              below={<RowNote text={tr("devices.remoteControlAllowedHint")} />}
              value={
                connectorStatus()?.remoteControlAllowed === undefined ? tr("devices.remoteControlUnreported") : undefined
              }
              trailing={
                connectorStatus()?.remoteControlAllowed !== undefined ? (
                  <ToggleSwitch
                    value={connectorStatus()?.remoteControlAllowed === true}
                    disabled={remoteControlSaving()}
                    accessibilityLabel="remote-control-allowed"
                    onChange={next => void setRemoteControlAllowed(next)}
                  />
                ) : undefined
              }
            />
            <InsetRow
              leading={
                <View style={{ width: 16, alignItems: "center" }}>
                  <StatusDot kind={connectorStatus()?.botConnected ? "success" : "muted"} size={7} />
                </View>
              }
              label={
                connectorStatus()?.botConnected
                  ? tr("devices.activeBot", { bot: connectorStatus()!.botConnected! })
                  : tr("devices.noBotConnected")
              }
              detail={
                (connectorStatus()?.clients.length ?? 0) > 0
                  ? formatPlural(connectorStatus()?.clients.length ?? 0, "devices.clientOne", "devices.clientOther")
                  : undefined
              }
              trailing={
                connectorStatus()?.botConnected ? (
                  <Button
                    label={tr("devices.stopBot")}
                    variant="ghost"
                    size="sm"
                    accessibilityLabel="connector-bot-stop"
                    disabled={connectorBusy()}
                    onPress={() => void stopBotConnector()}
                  />
                ) : undefined
              }
            />
            <InsetRow
              label={tr("devices.verboseBotMode")}
              trailing={
                <ToggleSwitch
                  value={botVerboseMode()}
                  accessibilityLabel="connector-bot-verbose"
                  disabled={connectorBusy()}
                  onChange={next => void setBotVerboseConnectorMode(next)}
                />
              }
            />
            <ChannelRow
              icon="message-circle"
              label={tr("devices.telegram")}
              description={
                isBotActive("telegram")
                  ? tr("devices.channelConnected", { bot: connectorStatus()?.botConnected ?? "" })
                  : tr("devices.telegramDesc")
              }
              active={isBotActive("telegram")}
              accessibilityLabel="channel-toggle-telegram"
              onPress={() => activeChannelModal.set("telegram")}
            />
            <ChannelRow
              icon="globe"
              label={tr("devices.feishu")}
              description={
                isBotActive("feishu") || isBotActive("lark")
                  ? tr("devices.channelConnected", { bot: connectorStatus()?.botConnected ?? "" })
                  : tr("devices.feishuDesc")
              }
              active={isBotActive("feishu") || isBotActive("lark")}
              accessibilityLabel="channel-toggle-feishu"
              onPress={() => activeChannelModal.set("feishu")}
            />
            <ChannelRow
              icon="smartphone"
              label={tr("devices.wechat")}
              description={
                isBotActive("weixin") || isBotActive("wechat")
                  ? tr("devices.channelConnected", { bot: connectorStatus()?.botConnected ?? "" })
                  : tr("devices.wechatDesc")
              }
              active={isBotActive("weixin") || isBotActive("wechat")}
              accessibilityLabel="channel-toggle-weixin"
              onPress={() => activeChannelModal.set("weixin")}
            />
            <ChannelRow
              icon="wifi"
              label={tr("devices.lanServerRelay")}
              description={
                isRelayRouteConnected("lan") || isRelayRouteConnected("openbitfun_server")
                  ? `${isRelayRouteConnected("lan") ? tr("devices.lanActive") : tr("devices.lanIdle")} · ${
                      isRelayRouteConnected("openbitfun_server") ? tr("devices.serverActive") : tr("devices.serverIdle")
                    }`
                  : tr("devices.relayDesc")
              }
              active={isRelayRouteConnected("lan") || isRelayRouteConnected("openbitfun_server")}
              accessibilityLabel="channel-toggle-relay"
              onPress={() => activeChannelModal.set("relay")}
            />
          </InsetGroup>
        </If>
      </View>

      {/* Telegram Modal */}
      <ModalDialog
        open={activeChannelModal() === "telegram"}
        title={tr("devices.telegramBot")}
        subtitle={tr("devices.telegramSubtitle")}
        size="sm"
        accessibilityLabel="connector-modal-telegram"
        onClose={() => activeChannelModal.set(null)}
        footer={
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Button
              label={tr("common.done")}
              variant="ghost"
              size="sm"
              onPress={() => activeChannelModal.set(null)}
            />
            <Button
              label={tr("devices.saveConnectTelegram")}
              variant="primary"
              size="sm"
              accessibilityLabel="connector-telegram-connect"
              disabled={connectorBusy()}
              onPress={() => void saveAndConnectTelegram()}
            />
          </View>
        }
      >
        <View style={{ gap: 12 }}>
          <InputBox
            label={tr("devices.botToken")}
            leadingIcon="key"
            masked={true}
            monospace
            value={telegramToken()}
            placeholder={tr("devices.botTokenPlaceholder")}
            accessibilityLabel="connector-telegram-token"
            onChange={val => telegramToken.set(val)}
          />
          <If when={connectorNotice()}>
            {msg => <InlineBanner tone="success" message={localizeHostError(msg())} />}
          </If>
          <If when={connectorError()}>
            {err => <InlineBanner tone="danger" message={localizeHostError(err())} />}
          </If>
        </View>
      </ModalDialog>

      {/* Feishu Modal */}
      <ModalDialog
        open={activeChannelModal() === "feishu"}
        title={tr("devices.feishuBot")}
        subtitle={tr("devices.feishuSubtitle")}
        size="md"
        accessibilityLabel="connector-modal-feishu"
        onClose={() => activeChannelModal.set(null)}
        footer={
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Button
              label={tr("common.done")}
              variant="ghost"
              size="sm"
              onPress={() => activeChannelModal.set(null)}
            />
            <Button
              label={tr("devices.saveConnectFeishu")}
              variant="primary"
              size="sm"
              accessibilityLabel="connector-feishu-connect"
              disabled={connectorBusy()}
              onPress={() => void saveAndConnectFeishu()}
            />
          </View>
        }
      >
        <View style={{ gap: 12 }}>
          <InputBox
            label={tr("devices.appId")}
            monospace
            value={feishuAppId()}
            placeholder={tr("devices.appIdPlaceholder")}
            accessibilityLabel="connector-feishu-app-id"
            onChange={val => feishuAppId.set(val)}
          />
          <InputBox
            label={tr("devices.appSecret")}
            leadingIcon="key"
            masked={true}
            monospace
            value={feishuAppSecret()}
            placeholder={tr("devices.appSecretPlaceholder")}
            accessibilityLabel="connector-feishu-app-secret"
            onChange={val => feishuAppSecret.set(val)}
          />
          <If when={connectorNotice()}>
            {msg => <InlineBanner tone="success" message={localizeHostError(msg())} />}
          </If>
          <If when={connectorError()}>
            {err => <InlineBanner tone="danger" message={localizeHostError(err())} />}
          </If>
        </View>
      </ModalDialog>

      {/* WeChat Modal */}
      <ModalDialog
        open={activeChannelModal() === "weixin"}
        title={tr("devices.wechatBot")}
        subtitle={tr("devices.wechatSubtitle")}
        size="md"
        accessibilityLabel="connector-modal-weixin"
        onClose={() => activeChannelModal.set(null)}
        footer={
          <Button
            label={tr("common.done")}
            variant="ghost"
            size="sm"
            onPress={() => activeChannelModal.set(null)}
          />
        }
      >
        <View style={{ gap: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Button
              label={tr("devices.startWechatQr")}
              variant="primary"
              size="sm"
              leadingIcon="smartphone"
              accessibilityLabel="connector-weixin-qr-start"
              disabled={connectorBusy()}
              onPress={() => void startWeixinQr()}
            />
          </View>
          <If when={weixinQr()}>
            {qr => (
              <View
                style={{
                  gap: 10,
                  paddingTop: 12,
                  borderTopWidth: 1,
                  borderColor: palette().borderSubtle,
                }}
              >
                <Text
                  style={{
                    color: palette().text,
                    fontSize: textSize(13),
                    fontWeight: "500",
                    lineHeight: textLineHeight(13, 1.4),
                  }}
                >
                  {qr().message || tr("devices.qrStatus", { status: qr().status })}
                </Text>
                <If
                  when={
                    qr().status === "wait" &&
                    qr().qrImageUrl &&
                    !/^data:image\//i.test(qr().qrImageUrl) &&
                    !/\.(png|jpe?g|gif|webp|svg)(\?|#|$)/i.test(qr().qrImageUrl)
                      ? qr().qrImageUrl
                      : ""
                  }
                >
                  {content => (
                    <View style={{ alignSelf: "flex-start", padding: 6, borderRadius: radii.md, backgroundColor: "#ffffff" }}>
                      <QrCodeView value={content()} size={164} accessibilityLabel="connector-weixin-qr" />
                    </View>
                  )}
                </If>
                <If when={qr().status === "need_verify_code"}>
                  <View style={{ gap: 8 }}>
                    <Text style={textStyle("caption")}>{tr("devices.weixinVerifyHint")}</Text>
                    <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <InputBox
                          value={weixinVerifyCode()}
                          placeholder={tr("devices.weixinVerifyPlaceholder")}
                          accessibilityLabel="connector-weixin-verify-code"
                          onChange={value => weixinVerifyCode.set(value)}
                          onSubmit={() => {
                            if (weixinVerifyCode().trim()) void pollWeixinQr();
                          }}
                        />
                      </View>
                      <Button
                        label={tr("devices.weixinVerifySubmit")}
                        variant="primary"
                        size="sm"
                        accessibilityLabel="connector-weixin-verify-submit"
                        disabled={connectorBusy() || !weixinVerifyCode().trim()}
                        onPress={() => void pollWeixinQr()}
                      />
                    </View>
                  </View>
                </If>
                <If when={qr().qrImageUrl}>
                  {url => (
                    <View
                      style={{
                        paddingHorizontal: 10,
                        paddingVertical: 8,
                        borderRadius: radii.sm,
                        borderCurve: "continuous",
                        borderWidth: 1,
                        borderColor: palette().borderSubtle,
                        backgroundColor: palette().canvas,
                      }}
                    >
                      <Text
                        style={{
                          minWidth: 0,
                          color: palette().textSecondary,
                          fontFamily: fontMono,
                          fontSize: textSize(12),
                          lineHeight: textLineHeight(12, 1.42),
                          numberOfLines: 2,
                          textOverflow: "ellipsis-middle",
                        }}
                      >
                        {url()}
                      </Text>
                    </View>
                  )}
                </If>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  <If when={qr().qrImageUrl}>
                    {url => (
                      <Button
                        label={tr("devices.copyQrUrl")}
                        variant="secondary"
                        size="sm"
                        leadingIcon="copy"
                        accessibilityLabel="connector-weixin-copy-url"
                        onPress={() => void copyPairingLink(url())}
                      />
                    )}
                  </If>
                  <Button
                    label={tr("devices.checkWechatQr")}
                    variant="primary"
                    size="sm"
                    accessibilityLabel="connector-weixin-qr-poll"
                    disabled={connectorBusy()}
                    onPress={() => void pollWeixinQr()}
                  />
                </View>
              </View>
            )}
          </If>
          <If when={connectorNotice()}>
            {msg => <InlineBanner tone="success" message={localizeHostError(msg())} />}
          </If>
          <If when={connectorError()}>
            {err => <InlineBanner tone="danger" message={localizeHostError(err())} />}
          </If>
        </View>
      </ModalDialog>

      {/* Relay Modal */}
      <ModalDialog
        open={activeChannelModal() === "relay"}
        title={tr("devices.mobileWebRelay")}
        subtitle={tr("devices.mobileWebRelaySubtitle")}
        size="md"
        accessibilityLabel="connector-modal-relay"
        onClose={() => activeChannelModal.set(null)}
        footer={
          <Button
            label={tr("common.done")}
            variant="ghost"
            size="sm"
            onPress={() => activeChannelModal.set(null)}
          />
        }
      >
        <View style={{ gap: 12 }}>
          <View style={{ gap: 10 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <Text style={textStyle("cardTitle")}>{tr("devices.localNetworkLan")}</Text>
              <InlineStatus
                kind={isRelayRouteConnected("lan") ? "success" : "muted"}
                label={isRelayRouteConnected("lan") ? tr("common.active") : tr("devices.idle")}
              />
            </View>
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
              <InputBox
                size="sm"
                value={lanIpInput()}
                placeholder={tr("devices.lanIpOptional")}
                leadingIcon="wifi"
                monospace
                accessibilityLabel="connector-lan-ip"
                style={{ flex: 1, minWidth: 168 }}
                onChange={val => lanIpInput.set(val)}
              />
              <If when={!isRelayRouteConnected("lan")}>
                <Button
                  label={tr("devices.startLanRelay")}
                  variant="primary"
                  size="sm"
                  accessibilityLabel="connector-lan-start"
                  disabled={connectorBusy()}
                  onPress={() => void startRelayConnector("lan")}
                />
              </If>
              <If when={isRelayRouteConnected("lan")}>
                <Button
                  label={tr("devices.stopLanRelay")}
                  variant="danger"
                  size="sm"
                  accessibilityLabel="connector-lan-stop"
                  disabled={connectorBusy()}
                  onPress={() => void stopRelayConnector("lan")}
                />
              </If>
            </View>
          </View>

          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              paddingTop: 14,
              borderTopWidth: 1,
              borderColor: palette().borderSubtle,
            }}
          >
            <View style={{ flex: 1, minWidth: 180, gap: 3 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Text style={textStyle("cardTitle")}>{tr("devices.cloudRelay")}</Text>
                <InlineStatus
                  kind={isRelayRouteConnected("openbitfun_server") ? "success" : "muted"}
                  label={
                    isRelayRouteConnected("openbitfun_server")
                      ? tr("common.active")
                      : tr("devices.idle")
                  }
                />
              </View>
              <Text style={textStyle("caption")}>{tr("devices.cloudRelaySubtitle")}</Text>
            </View>
            <If when={!isRelayRouteConnected("openbitfun_server")}>
              <Button
                label={tr("devices.startServerRelay")}
                variant="secondary"
                size="sm"
                accessibilityLabel="connector-server-start"
                disabled={connectorBusy()}
                onPress={() => void startRelayConnector("openbitfun_server")}
              />
            </If>
            <If when={isRelayRouteConnected("openbitfun_server")}>
              <Button
                label={tr("devices.stopServerRelay")}
                variant="danger"
                size="sm"
                accessibilityLabel="connector-server-stop"
                disabled={connectorBusy()}
                onPress={() => void stopRelayConnector("openbitfun_server")}
              />
            </If>
          </View>

          <If when={/^https?:\/\//i.test(pairingUrl()) ? pairingUrl() : ""}>
            {url => (
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: 16,
                  paddingTop: 14,
                  borderTopWidth: 1,
                  borderColor: palette().borderSubtle,
                }}
              >
                <View
                  accessibilityLabel={tr("devices.copyPairingUrl")}
                  onPress={() => void copyPairingLink(url())}
                  tooltip={tr("devices.copyPairingUrl")}
                  style={{
                    padding: 6,
                    borderRadius: radii.md,
                    borderCurve: "continuous",
                    backgroundColor: "#ffffff",
                    cursor: "pointer",
                  }}
                >
                  <QrCodeView value={url()} size={180} accessibilityLabel="connector-pairing-qr" />
                </View>
                <View style={{ flex: 1, minWidth: 200, gap: 6 }}>
                  <Text style={textStyle("cardTitle")}>{tr("devices.pairingQrTitle")}</Text>
                  <Text style={textStyle("caption")}>{tr("devices.pairingQrHint")}</Text>
                </View>
              </View>
            )}
          </If>
          <If when={pairingUrl()}>
            {url => (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  borderRadius: radii.sm,
                  borderCurve: "continuous",
                  borderWidth: 1,
                  borderColor: palette().borderSubtle,
                  backgroundColor: palette().canvas,
                }}
              >
                <Text
                  style={{
                    color: palette().textSecondary,
                    fontSize: textSize(12),
                    fontFamily: fontMono,
                    lineHeight: textLineHeight(12, 1.4),
                    flex: 1,
                    minWidth: 0,
                    numberOfLines: 2,
                    textOverflow: "ellipsis-middle",
                  }}
                >
                  {url()}
                </Text>
                <Button
                  label={tr("devices.copyPairingUrl")}
                  variant="secondary"
                  size="sm"
                  leadingIcon="copy"
                  accessibilityLabel="connector-copy-url"
                  onPress={() => void copyPairingLink(url())}
                />
              </View>
            )}
          </If>
          <If when={connectorNotice()}>
            {msg => <InlineBanner tone="success" message={localizeHostError(msg())} />}
          </If>
          <If when={connectorError()}>
            {err => <InlineBanner tone="danger" message={localizeHostError(err())} />}
          </If>
        </View>
      </ModalDialog>
    </StudioSection>
  );
}

export function DevicesScene() {
  void loadAccountState();
  void loadDevices();
  const unsubAuth = onAccountAuthChanged(signedIn => {
    devicesError.set(null);
    if (signedIn) {
      void loadDevices();
      if (dispatchSupported() !== false) void refreshDispatchJobs();
    } else {
      devices.set([]);
      void loadDevices();
    }
  });
  cleanup(() => unsubAuth());

  return (
    <View
      onLayout={trackStudioWidth}
      style={{ flex: 1, minWidth: 0, minHeight: 0, flexDirection: "column", backgroundColor: palette().canvas }}
    >
      <Scroll style={{ flex: 1, minHeight: 0 }}>
        <StudioHeader
          title={tr("devices.title")}
          subtitle={tr("devices.subtitle")}
          actions={
            <IconButton
              icon="refresh"
              size="md"
              tooltip={tr("devices.reloadTooltip")}
              accessibilityLabel="devices-reload"
              onPress={() => {
                void loadAccountState();
                void loadDevices();
                void loadConnectors();
              }}
            />
          }
        />
        <StudioBody>
          <If when={nonAuthDevicesError()}>
            {message => (
              <InlineBanner tone="warning" message={message()} onDismiss={() => devicesError.set(null)} />
            )}
          </If>
          <DevicesSection />
          <ObpPairingCard />
          <ChannelsSection />
          <DispatchSection />
        </StudioBody>
      </Scroll>
      <RemoteDisclaimerModal />
    </View>
  );
}


const DISCLAIMER_KEY_ITEMS = [
  "devices.remote.disclaimerItemGeneralRisk",
  "devices.remote.disclaimerItemSecurity",
  "devices.remote.disclaimerItemEncryption",
  "devices.remote.disclaimerItemPrivacy",
] as const;
const DISCLAIMER_DETAIL_ITEMS = [
  "devices.remote.disclaimerItemOpenSource",
  "devices.remote.disclaimerItemDataUsage",
  "devices.remote.disclaimerItemCredentials",
  "devices.remote.disclaimerItemQrCode",
  "devices.remote.disclaimerItemRelay",
  "devices.remote.disclaimerItemNetwork",
  "devices.remote.disclaimerItemBot",
  "devices.remote.disclaimerItemBotPersistence",
  "devices.remote.disclaimerItemMobileBrowser",
  "devices.remote.disclaimerItemCompliance",
  "devices.remote.disclaimerItemLiability",
] as const;

function DisclaimerList(props: { items: readonly MessageKey[]; start: number }) {
  return (
    <View style={{ gap: 8 }}>
      <Each of={props.items}>
        {(key, index) => (
          <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
            <Text
              style={{
                width: 20,
                flexShrink: 0,
                color: palette().textMuted,
                fontSize: textSize(13),
                fontVariant: ["tabular-nums"],
                lineHeight: textLineHeight(13, 1.5),
              }}
            >
              {`${props.start + index()}.`}
            </Text>
            <Text
              style={{
                flex: 1,
                minWidth: 0,
                color: palette().textSecondary,
                fontSize: textSize(13),
                lineHeight: textLineHeight(13, 1.5),
              }}
            >
              {tr(key())}
            </Text>
          </View>
        )}
      </Each>
    </View>
  );
}

/** The desktop's Remote Connect disclaimer: a gate before the first connection. */
function RemoteDisclaimerModal() {
  const detailsOpen = signal(false);
  return (
    <ModalDialog
      open={remoteDisclaimerOpen()}
      title={tr("devices.remote.disclaimerTitle")}
      size="md"
      accessibilityLabel="remote-disclaimer-modal"
      onClose={() => declineRemoteDisclaimer()}
      footer={
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Button
            label={remoteDisclaimerAgreed() ? tr("common.close") : tr("devices.remote.disclaimerDecline")}
            variant="ghost"
            size="sm"
            accessibilityLabel="remote-disclaimer-decline"
            onPress={() => declineRemoteDisclaimer()}
          />
          <If when={!remoteDisclaimerAgreed()}>
            <Button
              label={tr("devices.remote.disclaimerAgree")}
              variant="primary"
              size="sm"
              accessibilityLabel="remote-disclaimer-agree"
              onPress={() => void agreeRemoteDisclaimer()}
            />
          </If>
        </View>
      }
    >
      <View style={{ gap: 14 }}>
        <View style={{ flexDirection: "row" }}>
          <StatusPill
            label={
              remoteDisclaimerAgreed()
                ? tr("devices.remote.disclaimerStatusAgreed")
                : tr("devices.remote.disclaimerStatusPending")
            }
            kind={remoteDisclaimerAgreed() ? "success" : "warning"}
          />
        </View>
        <Text
          style={{
            color: palette().textSecondary,
            fontSize: textSize(13),
            lineHeight: textLineHeight(13, 1.55),
          }}
        >
          {tr("devices.remote.disclaimerIntro")}
        </Text>
        <Text style={textStyle("cardTitle")}>{tr("devices.remote.disclaimerKeyRisks")}</Text>
        <DisclaimerList items={DISCLAIMER_KEY_ITEMS} start={1} />
        <View
          role="button"
          accessibilityLabel="remote-disclaimer-details"
          onPress={() => detailsOpen.update(open => !open)}
          style={{ flexDirection: "row", alignItems: "center", gap: 6, cursor: "pointer" }}
        >
          <Icon name={detailsOpen() ? "chevron-down" : "chevron-right"} size={14} color={palette().textMuted} />
          <Text style={{ color: palette().accent, fontSize: textSize(13), lineHeight: textLineHeight(13, 1.4) }}>
            {tr("devices.remote.disclaimerFullDetails")}
          </Text>
        </View>
        <If when={detailsOpen()}>
          <DisclaimerList items={DISCLAIMER_DETAIL_ITEMS} start={5} />
        </If>
      </View>
    </ModalDialog>
  );
}
