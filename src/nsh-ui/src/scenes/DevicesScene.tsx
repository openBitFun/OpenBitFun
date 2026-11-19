import { cleanup, computed, Scroll, signal, Text, View, type ViewRef } from "nsh";
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
import {
  fontMono,
  palette,
  radii,
  textLineHeight,
  textSize,
  textStyle,
  textTracking,
} from "../theme";
import { onAccountAuthChanged, openAccountAuthModal } from "../ui/AccountAuthModal";
import { Icon, type IconName } from "../ui/icons";
import { createMarkdownCodeActions, createMarkdownStyles } from "../ui/markdown";
import { MOTION_DURATION, paintTransition, pressTransition, tactileActiveStyle } from "../ui/motion";
import { DropdownMenu, ModalDialog, SelectDropdown } from "../ui/overlays";
import {
  Badge,
  Button,
  ConfigSection,
  DeviceGlyph,
  EmptyStateCard,
  IconButton,
  InlineBanner,
  InputBox,
  PillChip,
  SegmentedTabs,
  StatusDot,
  StatusPill,
  ToggleSwitch,
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
const deviceMenuId = signal<string | null>(null);
const deviceMenuAnchors = signal<Record<string, ViewRef | null>>({});
const connectingDeviceId = signal<string | null>(null);

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

function setDeviceAnchor(id: string, el: ViewRef | null): void {
  deviceMenuAnchors.update(current => {
    if (current[id] === el) return current;
    return { ...current, [id]: el };
  });
}

function inferDeviceGlyphKind(device: DeviceRow): string {
  const hint = `${device.platform} ${device.alias ?? ""} ${device.name}`.toLowerCase();
  if (hint.includes("docker") || hint.includes("container")) return "container";
  if (hint.includes("linux") || hint.includes("server") || hint.includes("build") || hint.includes("ssh")) {
    return "server";
  }
  if (hint.includes("ios") || hint.includes("android") || hint.includes("mobile") || hint.includes("phone")) {
    return "mobile";
  }
  if (hint.includes("studio") || hint.includes("desktop") || hint.includes("workstation") || hint.includes("windows")) {
    return "desktop";
  }
  if (hint.includes("cloud") || hint.includes("relay")) return "cloud";
  return "laptop";
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

function stateDotKind(text: string): "success" | "danger" | "accent" {
  const lower = text.toLowerCase();
  if (lower.includes("succeed")) return "success";
  if (lower.includes("fail") || lower.includes("cancel") || lower.includes("error")) return "danger";
  return "accent";
}

function ObservedEventRow(props: { row: () => DispatchRow }) {
  return (
    <View>
      <If when={props.row().kind === "state"}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 7,
            maxWidth: "100%",
            paddingHorizontal: 10,
            paddingVertical: 4,
            borderRadius: radii.pill,
            borderCurve: "continuous",
            alignSelf: "flex-start",
            backgroundColor: palette().panelRaised,
            borderWidth: 1,
            borderColor: palette().borderSubtle,
          }}
        >
          <StatusDot kind={stateDotKind(props.row().text)} size={5.5} />
          <Text
            style={{
              flexShrink: 1,
              minWidth: 0,
              color: palette().textSecondary,
              fontFamily: fontMono,
              fontSize: textSize(10.5),
              fontWeight: "500",
              fontVariant: ["tabular-nums"],
              lineHeight: textLineHeight(10.5, 1.38),
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
            borderColor: palette().borderStrong,
            paddingLeft: 10,
            paddingVertical: 6,
            paddingRight: 10,
            borderRadius: radii.xs,
            borderCurve: "continuous",
            backgroundColor: palette().surfaceSubtle,
            gap: 3,
          }}
        >
          <Text
            style={{
              color: palette().textMuted,
              fontSize: textSize(10),
              fontWeight: "600",
              letterSpacing: textTracking(10, true),
              lineHeight: textLineHeight(10, 1.3),
            }}
          >
            {tr("devices.thinkingHeader")}
          </Text>
          <Text
            style={{
              minWidth: 0,
              color: palette().textMuted,
              fontSize: textSize(11.5),
              lineHeight: textLineHeight(11.5, 1.48),
            }}
          >
            {props.row().text}
          </Text>
        </View>
      </If>

      <If when={props.row().kind === "tool"}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "flex-start",
            gap: 8,
            borderLeftWidth: 2,
            borderColor: palette().accent,
            paddingHorizontal: 10,
            paddingVertical: 7,
            borderRadius: radii.sm,
            borderCurve: "continuous",
            backgroundColor: palette().panelRaised,
            borderWidth: 1,
            borderTopColor: palette().borderSubtle,
            borderRightColor: palette().borderSubtle,
            borderBottomColor: palette().borderSubtle,
          }}
        >
          <View style={{ flexShrink: 0, marginTop: 2 }}>
            <Icon name="wrench" size={12} color={palette().accent} />
          </View>
          <Text
            style={{
              flex: 1,
              minWidth: 0,
              color: palette().textSecondary,
              fontFamily: fontMono,
              fontSize: textSize(11.5),
              lineHeight: textLineHeight(11.5, 1.42),
            }}
          >
            {props.row().text}
          </Text>
        </View>
      </If>

      <If when={props.row().kind === "error"}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "flex-start",
            gap: 8,
            borderLeftWidth: 2,
            borderColor: palette().danger,
            paddingHorizontal: 10,
            paddingVertical: 7,
            borderRadius: radii.sm,
            borderCurve: "continuous",
            backgroundColor: palette().dangerSoft,
          }}
        >
          <View style={{ flexShrink: 0, marginTop: 2 }}>
            <Icon name="alert-circle" size={13} color={palette().danger} />
          </View>
          <Text
            style={{
              flex: 1,
              minWidth: 0,
              color: palette().danger,
              fontSize: textSize(11.5),
              lineHeight: textLineHeight(11.5, 1.45),
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
            paddingHorizontal: 13,
            paddingVertical: 8,
            borderRadius: radii.xl,
            borderCurve: "continuous",
            backgroundColor: palette().userBubble,
          }}
        >
          <Text
            style={{
              minWidth: 0,
              color: palette().userBubbleText,
              fontSize: textSize(12.5),
              lineHeight: textLineHeight(12.5, 1.48),
            }}
          >
            {props.row().text}
          </Text>
        </View>
      </If>

      <If when={props.row().kind === "assistant"}>
        <View
          style={{
            borderLeftWidth: 2,
            borderColor: palette().borderSubtle,
            paddingLeft: 12,
            paddingVertical: 2,
          }}
        >
          <TextView
            markdown={props.row().text}
            selectable={true}
            links="open"
            codeBlockActions={createMarkdownCodeActions()}
            styles={createMarkdownStyles({ compact: true, baseFontSize: 12.5 })}
          />
        </View>
      </If>
    </View>
  );
}

function DispatchObserverPanel() {
  cleanup(() => closeObservedJob());
  return (
    <If when={observedJobId()}>
      <ConfigSection
        title={tr("devices.observedJob")}
        subtitle={observedJobTitle() || undefined}
        bodyPadding={16}
        extra={
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "flex-end",
              gap: 6,
            }}
          >
            <If when={observedState()}>
              {state => (
                <StatusPill
                  label={state()}
                  kind={
                    state() === "succeeded"
                      ? "success"
                      : state() === "failed" || state() === "cancelled"
                        ? "danger"
                        : "accent"
                  }
                  pulse={!observedJobFinished()}
                />
              )}
            </If>
            <IconButton
              icon="refresh"
              size="sm"
              tooltip={tr("devices.pollTargetLog")}
              accessibilityLabel="dispatch-observe-poll"
              onPress={() => void pollObservedJob()}
            />
            <If when={observedJobFinished()}>
              <Button
                label={tr("devices.syncResult")}
                variant="primary"
                size="sm"
                leadingIcon="download"
                accessibilityLabel="dispatch-observe-sync"
                onPress={() => void syncObservedResult()}
              />
            </If>
            <If when={!observedJobFinished()}>
              <Button
                label={tr("devices.cancelJob")}
                variant="danger"
                size="sm"
                accessibilityLabel="dispatch-observe-cancel"
                onPress={() => void cancelObservedJob()}
              />
            </If>
            <Button
              label={tr("common.close")}
              variant="ghost"
              size="sm"
              accessibilityLabel="dispatch-observe-close"
              onPress={() => closeObservedJob()}
            />
          </View>
        }
      >
        <View style={{ gap: 14 }}>
          <If when={observedNotice()}>
            {notice => <InlineBanner tone="neutral" message={localizeHostError(notice())} />}
          </If>
          <If when={observedTruncated()}>
            <InlineBanner tone="warning" message={tr("devices.observedTruncated")} />
          </If>
          <If when={observedPending().length > 0}>
            <Each of={observedPending()} key={request => request.requestId}>
              {request => (
                <View
                  style={{
                    gap: 12,
                    paddingHorizontal: 14,
                    paddingVertical: 13,
                    borderRadius: radii.md,
                    borderCurve: "continuous",
                    borderWidth: 1,
                    borderColor: palette().accentBorder,
                    backgroundColor: palette().accentSoft,
                  }}
                >
                  <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                    <View
                      style={{
                        width: 28,
                        height: 28,
                        flexShrink: 0,
                        borderRadius: radii.sm,
                        borderCurve: "continuous",
                        backgroundColor: palette().panelRaised,
                        borderWidth: 1,
                        borderColor: palette().accentBorder,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Icon name="shield" size={14} color={palette().accent} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                      <Text
                        style={{
                          color: palette().text,
                          fontSize: textSize(13),
                          fontWeight: "600",
                          lineHeight: textLineHeight(13, 1.35),
                        }}
                      >
                        {request().title}
                      </Text>
                      <Text
                        style={{
                          color: palette().textSecondary,
                          fontFamily: fontMono,
                          fontSize: textSize(11.5),
                          lineHeight: textLineHeight(11.5, 1.44),
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
                      variant="danger"
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
          </If>

          {/* Typed Event Rail */}
          <View
            style={{
              borderRadius: radii.md,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: palette().borderSubtle,
              backgroundColor: palette().surfaceTertiary,
              boxShadow: palette().shadowInset,
              padding: 14,
            }}
          >
            <Scroll style={{ maxHeight: 280, minHeight: 0 }}>
              <View style={{ gap: 10 }}>
                <If when={observedRows().length === 0}>
                  <Text style={textStyle("caption")}>
                    {tr("devices.noJobEvents")}
                  </Text>
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
                observedJobFinished()
                  ? tr("devices.followUpPlaceholder")
                  : tr("devices.steerPlaceholder")
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
      </ConfigSection>
    </If>
  );
}

function DispatchCard() {
  ensureDispatch();
  const chosen = () => selectedTarget();
  const needsPath = () => {
    const target = chosen();
    return target !== null && target.kind !== "local";
  };
  return (
    <If when={dispatchSupported() !== false}>
      <View style={{ gap: 20 }}>
        <ConfigSection
          title={tr("devices.dispatchTitle")}
          subtitle={tr("devices.dispatchSubtitle")}
          flush
          extra={
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <IconButton
                icon="refresh"
                size="sm"
                tooltip={tr("devices.refreshJobs")}
                accessibilityLabel="dispatch-refresh"
                onPress={() => void refreshDispatchJobs()}
              />
              <Button
                label={tr("devices.newJob")}
                variant="primary"
                size="sm"
                leadingIcon="plus"
                accessibilityLabel="dispatch-form-toggle"
                onPress={() => {
                  const hadPath = Boolean(dispatchWorkspacePath().trim());
                  openDispatchForm();
                  if (!hadPath && needsPath()) dispatchWorkspacePath.set("");
                }}
              />
            </View>
          }
        >
          <View>
            <If when={dispatchNotice()}>
              {notice => (
                <View style={{ padding: 14, borderBottomWidth: 1, borderColor: palette().borderSubtle }}>
                  <InlineBanner tone="neutral" message={localizeHostError(notice())} />
                </View>
              )}
            </If>
            <If when={dispatchJobs().length === 0}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  paddingHorizontal: 16,
                  paddingVertical: 18,
                }}
              >
                <View
                  style={{
                    width: 34,
                    height: 34,
                    flexShrink: 0,
                    borderRadius: radii.sm,
                    borderCurve: "continuous",
                    borderWidth: 1,
                    borderColor: palette().borderSubtle,
                    backgroundColor: palette().surfaceTertiary,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Icon name="activity" size={15} color={palette().textMuted} />
                </View>
                <Text
                  style={{
                    flex: 1,
                    minWidth: 0,
                    color: palette().textMuted,
                    fontSize: textSize(12.5),
                    lineHeight: textLineHeight(12.5, 1.48),
                  }}
                >
                  {tr("devices.noJobsYet")}
                </Text>
              </View>
            </If>
            <Each of={dispatchJobs()} key={job => job.jobId}>
              {(job, index) => (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    paddingHorizontal: 16,
                    paddingVertical: 13,
                    borderTopWidth: index() === 0 ? 0 : 1,
                    borderColor: palette().borderSubtle,
                    ...paintTransition(MOTION_DURATION.fast),
                  }}
                  hoverStyle={{ backgroundColor: palette().surfaceSubtle }}
                >
                  <StatusDot
                    kind={
                      job().state === "succeeded"
                        ? "success"
                        : job().state === "failed" || job().state === "cancelled"
                          ? "danger"
                          : "accent"
                    }
                    size={6.5}
                    pulse={job().state === "running"}
                  />
                  <Text
                    style={{
                      color: palette().text,
                      fontSize: textSize(13),
                      fontWeight: "500",
                      lineHeight: textLineHeight(13, 1.38),
                      flex: 1,
                      minWidth: 0,
                      numberOfLines: 1,
                      textOverflow: "ellipsis",
                    }}
                  >
                    {`${job().title || job().promptPreview || job().jobId} · ${job().target?.displayName ?? job().target?.kind ?? tr("common.local")}`}
                  </Text>
                  <View style={{ flexDirection: "row", alignItems: "center", flexShrink: 0, gap: 8 }}>
                    <Badge
                      label={job().state}
                      tone={
                        job().state === "succeeded"
                          ? "success"
                          : job().state === "failed" || job().state === "cancelled"
                            ? "danger"
                            : "accent"
                      }
                    />
                    <Button
                      label={tr("devices.observe")}
                      variant="secondary"
                      size="sm"
                      accessibilityLabel={`dispatch-observe-${job().jobId}`}
                      onPress={() => void openObservedJob(job())}
                    />
                    <Button
                      label={tr("common.cancel")}
                      variant="ghost"
                      size="sm"
                      accessibilityLabel={`dispatch-cancel-${job().jobId}`}
                      onPress={() => void cancelDispatch(job().jobId)}
                    />
                  </View>
                </View>
              )}
            </Each>
          </View>
        </ConfigSection>

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
                onChange={val => dispatchTargetKey.set(val)}
              />
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
      </View>
    </If>
  );
}

function PeerDevicesCard() {
  const editingDevice = () => {
    const id = editingDeviceId();
    return id ? devices().find(device => device.id === id) ?? null : null;
  };
  return (
    <ConfigSection
      title={tr("devices.peerDevices")}
      subtitle={tr("devices.peerDevicesSubtitle")}
      flush
      extra={
        <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end", gap: 8 }}>
          <If when={isAccountSignedIn()}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <View
                role="button"
                accessibilityLabel="devices-account-pill"
                onPress={() => openAccountAuthModal()}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  paddingHorizontal: 9,
                  paddingVertical: 4,
                  borderRadius: radii.pill,
                  borderCurve: "continuous",
                  borderWidth: 1,
                  borderColor: palette().borderSubtle,
                  backgroundColor: palette().surfaceSubtle,
                  cursor: "pointer",
                  ...pressTransition(MOTION_DURATION.fast),
                }}
                hoverStyle={{
                  backgroundColor: palette().panelHover,
                  borderColor: palette().border,
                }}
                activeStyle={tactileActiveStyle(0.97)}
              >
                <StatusDot kind="success" size={5.5} />
                <Text
                  style={{
                    color: palette().textSecondary,
                    fontSize: textSize(11.5),
                    fontWeight: "500",
                    lineHeight: textLineHeight(11.5, 1.24),
                    numberOfLines: 1,
                  }}
                >
                  {signedInAccountDisplay()}
                </Text>
              </View>
              <Button
                label={tr("devices.signOut")}
                variant="ghost"
                size="xs"
                leadingIcon="log-out"
                disabled={authLoading()}
                accessibilityLabel="devices-sign-out"
                onPress={() => void signOutAccount()}
              />
            </View>
          </If>
          <If when={needsAccountSignIn()}>
            <Badge label={tr("devices.accountSignedOut")} tone="neutral" />
          </If>
          <If when={!needsAccountSignIn() && hiddenCount() > 0}>
            <PillChip
              label={tr("devices.hiddenCount", { count: hiddenCount() })}
              active={showHiddenDevices()}
              accessibilityLabel="toggle-hidden-devices"
              onPress={() => showHiddenDevices.set(!showHiddenDevices())}
            />
          </If>
          <If when={!needsAccountSignIn()}>
            <Badge
              label={formatPlural(devices().length, "devices.deviceCountOne", "devices.deviceCountOther")}
              tone="neutral"
            />
          </If>
        </View>
      }
    >
      <View>
        <If when={needsAccountSignIn()}>
          <View
            accessibilityLabel="devices-sign-in-panel"
            style={{
              paddingHorizontal: 24,
              paddingVertical: 30,
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
            }}
          >
            <View
              style={{
                width: 40,
                height: 40,
                flexShrink: 0,
                borderRadius: radii.md,
                borderCurve: "continuous",
                borderWidth: 1,
                borderColor: palette().border,
                backgroundColor: palette().surfaceTertiary,
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 2,
              }}
            >
              <Icon name="user" size={18} color={palette().accent} />
            </View>
            <Text
              style={{
                color: palette().text,
                fontSize: textSize(14.5),
                fontWeight: "600",
                letterSpacing: textTracking(14.5),
                textAlign: "center",
                lineHeight: textLineHeight(14.5, 1.32),
              }}
            >
              {tr("devices.signInRequiredTitle")}
            </Text>
            <Text
              style={{
                color: palette().textMuted,
                fontSize: textSize(12),
                textAlign: "center",
                maxWidth: 440,
                lineHeight: textLineHeight(12, 1.5),
              }}
            >
              {tr("devices.signInRequiredSubtitle")}
            </Text>
            <View style={{ marginTop: 4 }}>
              <Button
                label={tr("devices.signInCta")}
                variant="primary"
                size="md"
                leadingIcon="log-in"
                accessibilityLabel="devices-sign-in"
                onPress={() =>
                  openAccountAuthModal({ autoStart: true, onSuccess: () => void loadDevices() })
                }
              />
            </View>
          </View>
        </If>
        <If when={!needsAccountSignIn() && devices().length === 0}>
          <View style={{ paddingHorizontal: 16, paddingVertical: 16 }}>
            <Text style={textStyle("caption")}>
              {devicesLoaded() ? tr("devices.noDevices") : tr("devices.loadingDevices")}
            </Text>
          </View>
        </If>
        <If when={!needsAccountSignIn()}>
          <Each of={listedDevices()} key={device => device.id}>
          {(device, index) => (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                paddingHorizontal: 16,
                paddingVertical: 14,
                borderTopWidth: index() === 0 ? 0 : 1,
                borderColor: palette().borderSubtle,
                backgroundColor:
                  peerScope()?.deviceId === device().id ? palette().accentSoft : "transparent",
                ...paintTransition(MOTION_DURATION.fast),
              }}
              hoverStyle={{
                backgroundColor:
                  peerScope()?.deviceId === device().id ? palette().accentSoft : palette().surfaceSubtle,
              }}
            >
              <DeviceGlyph
                kind={inferDeviceGlyphKind(device())}
                size={36}
                status={
                  connectingDeviceId() === device().id
                    ? "connecting"
                    : device().online
                      ? "online"
                      : "muted"
                }
                active={peerScope()?.deviceId === device().id}
                ringColor={palette().panelRaised}
              />
              <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 7, minWidth: 0 }}>
                  <Text
                    style={{
                      flexShrink: 1,
                      minWidth: 0,
                      color: palette().text,
                      fontSize: textSize(13.5),
                      fontWeight: "600",
                      letterSpacing: textTracking(13.5),
                      lineHeight: textLineHeight(13.5, 1.32),
                      numberOfLines: 1,
                      textOverflow: "ellipsis",
                    }}
                  >
                    {device().alias || device().name}
                  </Text>
                  <If when={device().id === localDeviceId()}>
                    <Badge label={tr("devices.thisDevice")} tone="neutral" />
                  </If>
                </View>
                <Text
                  style={{
                    color: palette().textMuted,
                    fontSize: textSize(11.5),
                    fontVariant: ["tabular-nums"],
                    lineHeight: textLineHeight(11.5, 1.38),
                    numberOfLines: 1,
                    textOverflow: "ellipsis-middle",
                  }}
                >
                  {`${device().platform || tr("devices.unknownPlatform")} · ${device().online ? tr("devices.online") : tr("devices.offline")} · ${device().id}`}
                </Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", flexShrink: 0, gap: 8 }}>
                <If when={peerScope()?.deviceId === device().id}>
                  <StatusPill label={tr("devices.activePeer")} kind="accent" />
                </If>
                <If when={peerScope()?.deviceId !== device().id && device().online && device().id !== localDeviceId()}>
                  <Button
                    label={
                      connectingDeviceId() === device().id
                        ? tr("devices.connectingEllipsis")
                        : tr("common.use")
                    }
                    variant="primary"
                    size="sm"
                    loading={connectingDeviceId() === device().id}
                    disabled={peerBusy()}
                    accessibilityLabel={`device-use-${device().id}`}
                    onPress={() => void switchToDevice(device())}
                  />
                </If>
                <View ref={el => setDeviceAnchor(device().id, el)} style={{ flexShrink: 0 }}>
                  <IconButton
                    icon="more"
                    size="sm"
                    tooltip={tr("devices.deviceActions")}
                    active={deviceMenuId() === device().id}
                    accessibilityLabel={`device-actions-${device().id}`}
                    onPress={() =>
                      deviceMenuId.set(deviceMenuId() === device().id ? null : device().id)
                    }
                  />
                </View>
              </View>
              <DropdownMenu
                open={deviceMenuId() === device().id}
                anchor={deviceMenuAnchors()[device().id] ?? null}
                align="end"
                minWidth={155}
                items={[
                  {
                    id: "up",
                    label: tr("common.up"),
                    icon: "arrow-up",
                    accessibilityLabel: `device-up-${device().id}`,
                    onSelect: () => moveListed(device().id, -1),
                  },
                  {
                    id: "down",
                    label: tr("common.down"),
                    icon: "chevron-down",
                    accessibilityLabel: `device-down-${device().id}`,
                    onSelect: () => moveListed(device().id, 1),
                  },
                  {
                    id: "hide",
                    label: hiddenDevices()[device().id] === true ? tr("devices.show") : tr("devices.hide"),
                    icon: hiddenDevices()[device().id] === true ? "eye" : "eye-off",
                    accessibilityLabel: `device-hide-${device().id}`,
                    onSelect: () => toggleDeviceVisible(device().id),
                  },
                  {
                    id: "rename",
                    label: tr("common.rename"),
                    icon: "edit",
                    accessibilityLabel: `device-rename-${device().id}`,
                    onSelect: () => {
                      aliasValue.set("");
                      editingDeviceId.set(device().id);
                    },
                  },
                ]}
                onClose={() => deviceMenuId.set(null)}
              />
            </View>
          )}
        </Each>
        </If>

        {/* Compact Peer Mode Footer Strip */}
        <If when={!needsAccountSignIn() || Boolean(peerScope())}>
          <View
            style={{
              gap: 8,
              paddingHorizontal: 16,
              paddingVertical: 12,
              borderTopWidth: 1,
              borderColor: palette().borderSubtle,
              backgroundColor: palette().surfaceSubtle,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
              }}
            >
              <View style={{ flex: 1, minWidth: 200, gap: 2 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
                  <StatusDot kind={peerScope() ? "accent" : "muted"} size={6} />
                  <Text
                    style={{
                      color: palette().textSecondary,
                      fontSize: textSize(12),
                      fontWeight: "600",
                      lineHeight: textLineHeight(12, 1.35),
                    }}
                  >
                    {peerScope()
                      ? tr("devices.drivingAnother")
                      : currentLocale() === "en-US"
                        ? tr("devices.drivingAnother")
                        : tr("devices.peerModeIdle")}
                  </Text>
                </View>
                <If when={peerScope()}>
                  {scope => (
                    <Text
                      style={{
                        color: palette().textMuted,
                        fontSize: textSize(11.5),
                        fontVariant: ["tabular-nums"],
                        lineHeight: textLineHeight(11.5, 1.44),
                      }}
                    >
                      {tr("devices.drivingActiveSummary", {
                        label: scope().label,
                        hostKind: scope().hostKind,
                        capabilities: formatPlural(
                          scope().capabilityCount,
                          "devices.capabilityOne",
                          "devices.capabilityOther",
                        ),
                      })}
                    </Text>
                  )}
                </If>
                <If when={!peerScope()}>
                  <Text
                    style={{
                      color: palette().textMuted,
                      fontSize: textSize(11.5),
                      lineHeight: textLineHeight(11.5, 1.44),
                    }}
                  >
                    {tr("devices.drivingIdleHint")}
                  </Text>
                </If>
              </View>
              <If when={Boolean(peerScope())}>
                <View style={{ flexDirection: "row", alignItems: "center", flexShrink: 0, gap: 6 }}>
                  <Button
                    label={
                      peerReconnecting()
                        ? tr("nav.peerReconnecting")
                        : tr("nav.peerReconnect")
                    }
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
            </View>
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
        </If>
      </View>

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
    </ConfigSection>
  );
}

function ConnectorChannelRow(props: {
  icon: IconName;
  label: string;
  description: string;
  active: boolean;
  actionLabel: string;
  accessibilityLabel: string;
  divider?: boolean;
  onPress: () => void;
}) {
  return (
    <View
      style={{
        minHeight: 60,
        paddingHorizontal: 16,
        paddingVertical: 13,
        flexDirection: "row",
        alignItems: "center",
        gap: 13,
        borderBottomWidth: props.divider === false ? 0 : 1,
        borderColor: palette().borderSubtle,
        ...paintTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{ backgroundColor: palette().surfaceSubtle }}
    >
      <View
        style={{
          position: "relative",
          width: 36,
          height: 36,
          flexShrink: 0,
          borderRadius: radii.md,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: props.active ? palette().successBorder : palette().border,
          backgroundColor: props.active ? palette().successSoft : palette().surfaceTertiary,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon
          name={props.icon}
          size={16}
          color={props.active ? palette().success : palette().textSecondary}
        />
        <View
          style={{
            position: "absolute",
            right: -2,
            bottom: -2,
            padding: 1.5,
            borderRadius: radii.pill,
            backgroundColor: palette().panelRaised,
          }}
        >
          <StatusDot kind={props.active ? "success" : "muted"} size={6.5} />
        </View>
      </View>

      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Text
          style={{
            color: palette().text,
            fontSize: textSize(13.5),
            fontWeight: "500",
            letterSpacing: textTracking(13.5),
            lineHeight: textLineHeight(13.5, 1.34),
            numberOfLines: 1,
            textOverflow: "ellipsis",
          }}
        >
          {props.label}
        </Text>
        <Text
          style={{
            color: palette().textMuted,
            fontSize: textSize(12),
            lineHeight: textLineHeight(12, 1.42),
            numberOfLines: 1,
            textOverflow: "ellipsis",
          }}
        >
          {props.description}
        </Text>
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", flexShrink: 0, gap: 8 }}>
        <Button
          label={props.actionLabel}
          variant="secondary"
          size="sm"
          accessibilityLabel={props.accessibilityLabel}
          onPress={props.onPress}
        />
      </View>
    </View>
  );
}

function ConnectorsCard() {
  ensureConnectors();

  return (
    <ConfigSection
      title={tr("devices.channelsTitle")}
      subtitle={tr("devices.channelsSubtitle")}
      flush
      extra={
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <If when={Boolean(peerScope())}>
            <Badge label={tr("common.controllerLocal")} tone="accent" />
          </If>
          <IconButton
            icon="refresh"
            size="sm"
            tooltip={tr("devices.refreshChannels")}
            accessibilityLabel="connectors-refresh"
            disabled={connectorsLoading()}
            onPress={() => void loadConnectors()}
          />
        </View>
      }
    >
      <View>
        <If when={peerScope()}>
          {scope => (
            <View style={{ padding: 14, borderBottomWidth: 1, borderColor: palette().borderSubtle }}>
              <InlineBanner
                tone="info"
                icon="laptop"
                message={tr("devices.connectorsPeerBanner", { label: scope().label })}
              />
            </View>
          )}
        </If>
        <If when={connectorsSupported() === false}>
          <View style={{ padding: 16 }}>
            <EmptyStateCard
              icon="wifi"
              title={tr("devices.connectorsUnavailable")}
              subtitle={tr("devices.connectorsUnavailableSubtitle")}
            />
          </View>
        </If>
        <If when={connectorsSupported() === true}>
          <View>
            {/* Spacious Active Bot Bar */}
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                paddingHorizontal: 16,
                paddingVertical: 13,
                borderBottomWidth: 1,
                borderColor: palette().borderSubtle,
                backgroundColor: palette().surfaceSubtle,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 9, flex: 1, minWidth: 180 }}>
                <StatusDot
                  kind={connectorStatus()?.botConnected ? "success" : "muted"}
                  size={6.5}
                />
                <Text
                  style={{
                    flexShrink: 1,
                    minWidth: 0,
                    color: connectorStatus()?.botConnected ? palette().text : palette().textSecondary,
                    fontSize: textSize(12.5),
                    fontWeight: "500",
                    lineHeight: textLineHeight(12.5, 1.35),
                    numberOfLines: 1,
                    textOverflow: "ellipsis",
                  }}
                >
                  {connectorStatus()?.botConnected
                    ? tr("devices.activeBot", { bot: connectorStatus()!.botConnected! })
                    : tr("devices.noBotConnected")}
                </Text>
                <If when={(connectorStatus()?.clients.length ?? 0) > 0}>
                  <Text
                    style={{
                      flexShrink: 0,
                      color: palette().textMuted,
                      fontSize: textSize(11.5),
                      fontVariant: ["tabular-nums"],
                    }}
                  >
                    {`· ${formatPlural(
                      connectorStatus()?.clients.length ?? 0,
                      "devices.clientOne",
                      "devices.clientOther",
                    )}`}
                  </Text>
                </If>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", flexShrink: 0, gap: 12 }}>
                <ToggleSwitch
                  value={botVerboseMode()}
                  label={tr("devices.verboseBotMode")}
                  accessibilityLabel="connector-bot-verbose"
                  disabled={connectorBusy()}
                  onChange={next => void setBotVerboseConnectorMode(next)}
                />
                <If when={connectorStatus()?.botConnected ?? ""}>
                  <Button
                    label={tr("devices.stopBot")}
                    variant="danger"
                    size="sm"
                    accessibilityLabel="connector-bot-stop"
                    disabled={connectorBusy()}
                    onPress={() => void stopBotConnector()}
                  />
                </If>
              </View>
            </View>

            <If when={connectorNotice() || connectorError()}>
              <View
                style={{
                  padding: 14,
                  gap: 8,
                  borderBottomWidth: 1,
                  borderColor: palette().borderSubtle,
                }}
              >
                <If when={connectorNotice()}>
                  {notice => <InlineBanner tone="success" message={localizeHostError(notice())} />}
                </If>
                <If when={connectorError()}>
                  {err => <InlineBanner tone="danger" message={localizeHostError(err())} />}
                </If>
              </View>
            </If>

            <ConnectorChannelRow
              icon="message-circle"
              label={tr("devices.telegram")}
              description={
                isBotActive("telegram")
                  ? tr("devices.channelConnected", { bot: connectorStatus()?.botConnected ?? "" })
                  : tr("devices.telegramDesc")
              }
              active={isBotActive("telegram")}
              actionLabel={tr("common.configure")}
              accessibilityLabel="channel-toggle-telegram"
              onPress={() => activeChannelModal.set("telegram")}
            />

            <ConnectorChannelRow
              icon="globe"
              label={tr("devices.feishu")}
              description={
                isBotActive("feishu") || isBotActive("lark")
                  ? tr("devices.channelConnected", { bot: connectorStatus()?.botConnected ?? "" })
                  : tr("devices.feishuDesc")
              }
              active={isBotActive("feishu") || isBotActive("lark")}
              actionLabel={tr("common.configure")}
              accessibilityLabel="channel-toggle-feishu"
              onPress={() => activeChannelModal.set("feishu")}
            />

            <ConnectorChannelRow
              icon="smartphone"
              label={tr("devices.wechat")}
              description={
                isBotActive("weixin") || isBotActive("wechat")
                  ? tr("devices.channelConnected", { bot: connectorStatus()?.botConnected ?? "" })
                  : tr("devices.wechatDesc")
              }
              active={isBotActive("weixin") || isBotActive("wechat")}
              actionLabel={tr("common.configure")}
              accessibilityLabel="channel-toggle-weixin"
              onPress={() => activeChannelModal.set("weixin")}
            />

            <ConnectorChannelRow
              icon="wifi"
              label={tr("devices.lanServerRelay")}
              description={
                isRelayRouteConnected("lan") || isRelayRouteConnected("openbitfun_server")
                  ? `${isRelayRouteConnected("lan") ? tr("devices.lanActive") : tr("devices.lanIdle")} · ${
                      isRelayRouteConnected("openbitfun_server")
                        ? tr("devices.serverActive")
                        : tr("devices.serverIdle")
                    }`
                  : tr("devices.relayDesc")
              }
              active={isRelayRouteConnected("lan") || isRelayRouteConnected("openbitfun_server")}
              actionLabel={tr("common.manage")}
              accessibilityLabel="channel-toggle-relay"
              divider={false}
              onPress={() => activeChannelModal.set("relay")}
            />
          </View>
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
                  padding: 14,
                  borderRadius: radii.md,
                  borderCurve: "continuous",
                  borderWidth: 1,
                  borderColor: palette().borderSubtle,
                  backgroundColor: palette().surfaceTertiary,
                }}
              >
                <Text
                  style={{
                    color: palette().text,
                    fontSize: textSize(12.5),
                    fontWeight: "500",
                    lineHeight: textLineHeight(12.5, 1.4),
                  }}
                >
                  {qr().message || tr("devices.qrStatus", { status: qr().status })}
                </Text>
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
                          fontSize: textSize(11.5),
                          lineHeight: textLineHeight(11.5, 1.42),
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
          <View
            style={{
              gap: 10,
              padding: 14,
              borderRadius: radii.md,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: palette().borderSubtle,
              backgroundColor: palette().surfaceTertiary,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <Text style={textStyle("cardTitle")}>{tr("devices.localNetworkLan")}</Text>
              <Badge
                label={isRelayRouteConnected("lan") ? tr("common.active") : tr("devices.idle")}
                tone={isRelayRouteConnected("lan") ? "success" : "neutral"}
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
              padding: 14,
              borderRadius: radii.md,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: palette().borderSubtle,
              backgroundColor: palette().surfaceTertiary,
            }}
          >
            <View style={{ flex: 1, minWidth: 180, gap: 3 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text style={textStyle("cardTitle")}>{tr("devices.cloudRelay")}</Text>
                <Badge
                  label={
                    isRelayRouteConnected("openbitfun_server")
                      ? tr("common.active")
                      : tr("devices.idle")
                  }
                  tone={isRelayRouteConnected("openbitfun_server") ? "success" : "neutral"}
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
                    fontSize: textSize(11.5),
                    fontFamily: fontMono,
                    lineHeight: textLineHeight(11.5, 1.4),
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
    </ConfigSection>
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
    <View style={{ flex: 1, minHeight: 0, flexDirection: "column", backgroundColor: palette().canvas }}>
      <Scroll style={{ flex: 1, minHeight: 0 }} contentStyle={{ alignItems: "center" }}>
        <View
          style={{
            width: "100%",
            maxWidth: 820,
            paddingHorizontal: 28,
            paddingTop: 24,
            paddingBottom: 56,
            gap: 28,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 14,
              paddingBottom: 16,
              borderBottomWidth: 1,
              borderColor: palette().borderSubtle,
            }}
          >
            <View
              style={{
                width: 38,
                height: 38,
                flexShrink: 0,
                borderRadius: radii.md,
                borderCurve: "continuous",
                borderWidth: 1,
                borderColor: palette().border,
                backgroundColor: palette().panelRaised,
                boxShadow: `${palette().shadowButton}, ${palette().innerHighlight}`,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon name="server" size={17} color={palette().textSecondary} />
            </View>
            <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
              <Text style={textStyle("pageTitle")}>{tr("devices.title")}</Text>
              <Text style={textStyle("caption")}>{tr("devices.subtitle")}</Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", flexShrink: 0, gap: 8 }}>
              <If when={needsAccountSignIn()}>
                <Button
                  label={tr("devices.signInCta")}
                  variant="secondary"
                  size="sm"
                  leadingIcon="log-in"
                  accessibilityLabel="devices-header-sign-in"
                  onPress={() =>
                    openAccountAuthModal({ autoStart: true, onSuccess: () => void loadDevices() })
                  }
                />
              </If>
              <IconButton
                icon="refresh"
                size="sm"
                tooltip={tr("devices.reloadTooltip")}
                accessibilityLabel="devices-reload"
                onPress={() => {
                  void loadAccountState();
                  void loadDevices();
                  void loadConnectors();
                }}
              />
            </View>
          </View>
          <If when={nonAuthDevicesError()}>
            {message => (
              <InlineBanner
                tone="warning"
                message={message()}
                onDismiss={() => devicesError.set(null)}
              />
            )}
          </If>
          <ConnectorsCard />
          <PeerDevicesCard />
          <DispatchCard />
        </View>
      </Scroll>
    </View>
  );
}
