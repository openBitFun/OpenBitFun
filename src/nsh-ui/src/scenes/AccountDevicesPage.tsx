// Settings › Account › Devices and chat apps (visual spec §4.9, ux-redesign §3.8).
//
// Two sections that match what their controls do. Devices: the account's
// devices as informative rows, then this device's own switch (may the others
// control it) and "Open on your phone", whose address and QR open in a sheet.
// Chat apps: Telegram, Feishu and WeChat, each with its own state and action,
// and the reply-detail switch of the bots. Everything is the backend's answer:
// the fleet navigator for devices, the connector store for chat apps.

import { signal, Text, View } from "nsh";
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
  loadConnectors,
  pollWeixinQr,
  saveAndConnectFeishu,
  saveAndConnectTelegram,
  setBotVerboseConnectorMode,
  startWeixinQr,
  stopBotConnector,
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
import { fleetDevices } from "../fleetStore";
import type { FleetDevice } from "../fleetTypes";
import { localizeHostError, tr, type MessageKey } from "../i18n";
import { loadObpStatus, obpStatus } from "../obpStore";
import { superAgentUi } from "../productGates";
import { compactLayout, controlHeight, fontMono, layout, palette, radii, space, textStyle, touchSlop } from "../theme";
import { DeviceGlyph, deviceException, stateColor } from "../ui/fleet";
import { ObpPairingCard } from "./ObpPairingCard";
import { UseOnPhonePanel } from "./UseOnPhonePanel";
import { Icon, type IconName } from "../ui/icons";
import { MOTION_DURATION, pressTransition, tactileActiveStyle } from "../ui/motion";
import { InsetGroup, InsetRow, MoreMenu, QrCodeView, StudioEmpty, StudioSection } from "../ui/studio";
import { ModalDialog, pushToast, type DropdownMenuItem } from "../ui/overlays";
import { Badge, Button, InlineBanner, InputBox, ToggleSwitch, focusRingStyle } from "../ui/primitives";

type ChannelId = "telegram" | "feishu" | "weixin";

const activeChannelModal = signal<ChannelId | null>(null);
const connectorBannerOwner = signal<ChannelId | "page" | "device">("page");
const phoneSheetOpen = signal(false);

function openChannelModal(channel: ChannelId): void {
  connectorNotice.set("");
  connectorError.set("");
  connectorBannerOwner.set(channel);
  activeChannelModal.set(channel);
}

function closeChannelModal(): void {
  activeChannelModal.set(null);
  connectorBannerOwner.set("page");
  connectorNotice.set("");
  connectorError.set("");
}

/**
 * Runs a page-level connector action. Its confirmation is a toast, so nothing
 * on the page moves; an error stays inline under the owning section.
 */
async function runPageAction(owner: "page" | "device", action: () => Promise<void>): Promise<void> {
  connectorBannerOwner.set(owner);
  connectorNotice.set("");
  await action();
  const notice = connectorNotice();
  if (notice && activeChannelModal() === null) {
    pushToast(localizeHostError(notice), "success");
    connectorNotice.set("");
  }
}

const CHANNEL_KEYWORDS: Record<ChannelId, readonly string[]> = {
  telegram: ["telegram"],
  feishu: ["feishu", "lark"],
  weixin: ["weixin", "wechat"],
};

/** The chat app whose bot this device runs now (the host runs one at a time), if it is one of ours. */
function activeChannel(): ChannelId | null {
  const connected = (connectorStatus()?.botConnected ?? "").toLowerCase();
  if (!connected) return null;
  for (const id of Object.keys(CHANNEL_KEYWORDS) as ChannelId[]) {
    if (CHANNEL_KEYWORDS[id].some(keyword => connected.includes(keyword))) return id;
  }
  return null;
}

/** The host reports `Telegram(<chat>)`; the row already names the app, so show the chat only. */
function connectedChat(): string {
  const raw = connectorStatus()?.botConnected ?? "";
  const match = /^[^()]*\((.+)\)\s*$/.exec(raw);
  return match ? match[1] : raw;
}

/** A wrapping secondary line under an inset row's label. */
function RowNote(props: { text: string }) {
  return (
    <Text
      style={{
        ...textStyle("caption", { color: palette().textMuted }),
      }}
    >
      {props.text}
    </Text>
  );
}

function DisconnectButton() {
  return (
    <Button
      label={tr("devices.chatAppDisconnect")}
      variant="secondary"
      size="sm"
      accessibilityLabel="connector-bot-stop"
      disabled={connectorBusy()}
      onPress={() => void runPageAction("page", stopBotConnector)}
    />
  );
}

/** One chat app: its own state on the second line and the one action that fits it. */
function ChannelRow(props: { first?: boolean; channel: ChannelId; icon: IconName; label: string }) {
  const active = () => activeChannel() === props.channel;
  return (
    <InsetRow
      first={props.first}
      icon={props.icon}
      label={props.label}
      detail={active() ? tr("devices.channelConnected", { bot: connectedChat() }) : tr("devices.noBotConnected")}
      accessibilityLabel={`channel-row-${props.channel}`}
      trailing={
        active() ? (
          <DisconnectButton />
        ) : (
          <Button
            label={tr("devices.channelConnect")}
            variant="secondary"
            size="sm"
            accessibilityLabel={`channel-toggle-${props.channel}`}
            onPress={() => openChannelModal(props.channel)}
          />
        )
      }
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
      onSelect: () => {
        connectorBannerOwner.set("page");
        void loadConnectors();
      },
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

/** Inline errors of a page-level action, under the section that owns it. */
function PageError(props: { owner: "page" | "device" }) {
  return (
    <If
      when={
        activeChannelModal() === null && connectorBannerOwner() === props.owner && connectorError()
          ? connectorError()
          : ""
      }
    >
      {err => <InlineBanner tone="danger" message={localizeHostError(err())} onDismiss={() => connectorError.set("")} />}
    </If>
  );
}

function ChannelsSection() {
  ensureConnectors();

  return (
    <StudioSection
      title={tr("devices.chatAppsTitle")}
      accessibilityLabel="channels-section"
      footnote={
        connectorsSupported() === true
          ? connectorStatus()?.remoteControlAllowed === false
            ? tr("devices.chatAppsPaused")
            : tr("devices.channelsSubtitle")
          : undefined
      }
      trailing={
        <MoreMenu
          accessibilityLabel="channels-menu"
          tooltip={tr("common.actions")}
          minWidth={200}
          items={channelMenuItems()}
        />
      }
    >
      <View style={{ gap: space.md, minWidth: 0 }}>
        <If when={connectorsSupported() === false}>
          <StudioEmpty
            icon="wifi"
            message={tr("devices.connectorsUnavailable")}
            detail={tr("devices.connectorsUnavailableSubtitle")}
          />
        </If>
        <If when={connectorsSupported() === true}>
          <PageError owner="page" />
          <InsetGroup accessibilityLabel="channels-list">
            <ChannelRow first channel="telegram" icon="message-circle" label={tr("devices.telegram")} />
            <ChannelRow channel="feishu" icon="globe" label={tr("devices.feishu")} />
            <ChannelRow channel="weixin" icon="smartphone" label={tr("devices.wechat")} />
            {/* A bot of a kind this build does not list still shows, and can still be stopped. */}
            <If when={connectorStatus()?.botConnected && activeChannel() === null ? connectorStatus()!.botConnected! : ""}>
              {name => (
                <InsetRow
                  icon="message-circle"
                  label={name()}
                  detail={tr("devices.channelConnected", { bot: connectedChat() })}
                  trailing={<DisconnectButton />}
                />
              )}
            </If>
          </InsetGroup>
          <InsetGroup accessibilityLabel="channels-options">
            <InsetRow
              first
              label={tr("devices.verboseBotMode")}
              below={
                <RowNote
                  text={
                    connectorStatus()?.botConnected
                      ? tr("devices.verboseBotModeHint")
                      : tr("devices.verboseBotModeNeedsBot")
                  }
                />
              }
              trailing={
                <ToggleSwitch
                  value={botVerboseMode()}
                  accessibilityLabel="connector-bot-verbose"
                  disabled={connectorBusy() || !connectorStatus()?.botConnected}
                  onChange={next => void runPageAction("page", () => setBotVerboseConnectorMode(next))}
                />
              }
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
        onClose={closeChannelModal}
        onSubmit={() => {
          if (connectorBusy()) return;
          connectorBannerOwner.set("telegram");
          void saveAndConnectTelegram();
        }}
        footer={
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", gap: space.sm, flex: 1 }}>
            <Button
              label={tr("common.done")}
              variant="secondary"
              size="md"
              onPress={closeChannelModal}
            />
            <Button
              label={tr("devices.saveConnectTelegram")}
              variant="primary"
              size="md"
              accessibilityLabel="connector-telegram-connect"
              disabled={connectorBusy()}
              onPress={() => {
                connectorBannerOwner.set("telegram");
                void saveAndConnectTelegram();
              }}
            />
          </View>
        }
      >
        <View style={{ gap: space.md }}>
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
          <If when={connectorBannerOwner() === "telegram" && connectorNotice() ? connectorNotice() : ""}>
            {msg => <InlineBanner tone="success" message={localizeHostError(msg())} />}
          </If>
          <If when={connectorBannerOwner() === "telegram" && connectorError() ? connectorError() : ""}>
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
        onClose={closeChannelModal}
        onSubmit={() => {
          if (connectorBusy()) return;
          connectorBannerOwner.set("feishu");
          void saveAndConnectFeishu();
        }}
        footer={
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", gap: space.sm, flex: 1 }}>
            <Button
              label={tr("common.done")}
              variant="secondary"
              size="md"
              onPress={closeChannelModal}
            />
            <Button
              label={tr("devices.saveConnectFeishu")}
              variant="primary"
              size="md"
              accessibilityLabel="connector-feishu-connect"
              disabled={connectorBusy()}
              onPress={() => {
                connectorBannerOwner.set("feishu");
                void saveAndConnectFeishu();
              }}
            />
          </View>
        }
      >
        <View style={{ gap: space.md }}>
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
          <If when={connectorBannerOwner() === "feishu" && connectorNotice() ? connectorNotice() : ""}>
            {msg => <InlineBanner tone="success" message={localizeHostError(msg())} />}
          </If>
          <If when={connectorBannerOwner() === "feishu" && connectorError() ? connectorError() : ""}>
            {err => <InlineBanner tone="danger" message={localizeHostError(err())} />}
          </If>
        </View>
      </ModalDialog>

      {/* WeChat Modal — strictly one primary CTA per step */}
      <ModalDialog
        open={activeChannelModal() === "weixin"}
        title={tr("devices.wechatBot")}
        subtitle={tr("devices.wechatSubtitle")}
        size="md"
        accessibilityLabel="connector-modal-weixin"
        // The QR is scanned on a phone: the click that brings the window back must not end it.
        keepOpenOnBackdrop={Boolean(weixinQr()) && weixinQr()!.status !== "confirmed"}
        onClose={closeChannelModal}
        footer={
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", gap: space.sm, flex: 1 }}>
            <Button
              label={tr("common.done")}
              variant="secondary"
              size="md"
              onPress={closeChannelModal}
            />
          </View>
        }
      >
        <View style={{ gap: space.md }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm }}>
            <Button
              label={tr("devices.startWechatQr")}
              variant={weixinQr() ? "secondary" : "primary"}
              size="md"
              leadingIcon="smartphone"
              accessibilityLabel="connector-weixin-qr-start"
              disabled={connectorBusy()}
              onPress={() => {
                connectorBannerOwner.set("weixin");
                void startWeixinQr();
              }}
            />
          </View>
          <If when={weixinQr()}>
            {qr => (
              <View
                style={{
                  gap: space.md,
                  paddingTop: space.md,
                  borderTopWidth: 1,
                  borderColor: palette().borderSubtle,
                }}
              >
                <Text
                  style={{
                    ...textStyle("label", { color: palette().text }),
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
                    <View style={{ alignSelf: "flex-start", borderRadius: radii.md, overflow: "hidden" }}>
                      <QrCodeView value={content()} size={164} accessibilityLabel="connector-weixin-qr" />
                    </View>
                  )}
                </If>
                <If when={qr().status === "need_verify_code"}>
                  <View style={{ gap: space.sm }}>
                    <Text style={textStyle("caption")}>{tr("devices.weixinVerifyHint")}</Text>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "flex-end", gap: space.sm }}>
                      <View style={{ flex: 1, minWidth: 140 }}>
                        <InputBox
                          value={weixinVerifyCode()}
                          placeholder={tr("devices.weixinVerifyPlaceholder")}
                          accessibilityLabel="connector-weixin-verify-code"
                          onChange={value => weixinVerifyCode.set(value)}
                          onSubmit={() => {
                            if (weixinVerifyCode().trim()) {
                              connectorBannerOwner.set("weixin");
                              void pollWeixinQr();
                            }
                          }}
                        />
                      </View>
                      <Button
                        label={tr("devices.weixinVerifySubmit")}
                        variant="primary"
                        size="md"
                        accessibilityLabel="connector-weixin-verify-submit"
                        disabled={connectorBusy() || !weixinVerifyCode().trim()}
                        onPress={() => {
                          connectorBannerOwner.set("weixin");
                          void pollWeixinQr();
                        }}
                      />
                    </View>
                  </View>
                </If>
                <If when={qr().qrImageUrl}>
                  {url => (
                    <View
                      style={{
                        paddingHorizontal: space.md,
                        paddingVertical: space.sm,
                        borderRadius: radii.sm,
                        borderCurve: "continuous",
                        borderWidth: 1,
                        borderColor: palette().borderSubtle,
                        backgroundColor: palette().surfaceTertiary,
                      }}
                    >
                      <Text
                        style={{
                          minWidth: 0,
                          fontFamily: fontMono(),
                          ...textStyle("caption", { color: palette().textSecondary }),
                          numberOfLines: 2,
                          textOverflow: "ellipsis-middle",
                          userSelect: "text",
                        }}
                      >
                        {url()}
                      </Text>
                    </View>
                  )}
                </If>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
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
                    variant={qr().status === "need_verify_code" ? "secondary" : "primary"}
                    size="sm"
                    accessibilityLabel="connector-weixin-qr-poll"
                    disabled={connectorBusy()}
                    onPress={() => {
                      connectorBannerOwner.set("weixin");
                      void pollWeixinQr();
                    }}
                  />
                </View>
              </View>
            )}
          </If>
          <If when={connectorBannerOwner() === "weixin" && connectorNotice() ? connectorNotice() : ""}>
            {msg => <InlineBanner tone="success" message={localizeHostError(msg())} />}
          </If>
          <If when={connectorBannerOwner() === "weixin" && connectorError() ? connectorError() : ""}>
            {err => <InlineBanner tone="danger" message={localizeHostError(err())} />}
          </If>
        </View>
      </ModalDialog>
    </StudioSection>
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
    <View style={{ gap: space.sm }}>
      <Each of={props.items}>
        {(key, index) => (
          <View style={{ flexDirection: "row", gap: space.sm, alignItems: "flex-start" }}>
            <Text
              style={{
                width: space.xl,
                flexShrink: 0,
                ...textStyle("label", { color: palette().textMuted }),
                fontWeight: "400",
              }}
            >
              {`${props.start + index()}.`}
            </Text>
            <Text
              style={{
                flex: 1,
                minWidth: 0,
                ...textStyle("label", { color: palette().textSecondary }),
                fontWeight: "400",
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
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", gap: space.sm, flex: 1 }}>
          <Button
            label={remoteDisclaimerAgreed() ? tr("common.close") : tr("devices.remote.disclaimerDecline")}
            variant="secondary"
            size="md"
            accessibilityLabel="remote-disclaimer-decline"
            onPress={() => declineRemoteDisclaimer()}
          />
          <If when={!remoteDisclaimerAgreed()}>
            <Button
              label={tr("devices.remote.disclaimerAgree")}
              variant="primary"
              size="md"
              accessibilityLabel="remote-disclaimer-agree"
              onPress={() => void agreeRemoteDisclaimer()}
            />
          </If>
        </View>
      }
    >
      <View style={{ gap: space.lg }}>
        <Text
          style={textStyle("caption", {
            color: remoteDisclaimerAgreed() ? palette().textMuted : stateColor("needs_you"),
          })}
        >
          {remoteDisclaimerAgreed()
            ? tr("devices.remote.disclaimerStatusAgreed")
            : tr("devices.remote.disclaimerStatusPending")}
        </Text>
        <Text
          style={{
            ...textStyle("label", { color: palette().textSecondary }),
            fontWeight: "400",
          }}
        >
          {tr("devices.remote.disclaimerIntro")}
        </Text>
        <Text style={textStyle("body", { color: palette().text })}>{tr("devices.remote.disclaimerKeyRisks")}</Text>
        <DisclaimerList items={DISCLAIMER_KEY_ITEMS} start={1} />
        <View
          role="button"
          accessibilityLabel="remote-disclaimer-details"
          accessibilityState={{ expanded: detailsOpen() }}
          hitSlop={touchSlop(controlHeight.sm)}
          onPress={() => detailsOpen.update(open => !open)}
          hoverStyle={{ backgroundColor: palette().panelHover }}
          activeStyle={tactileActiveStyle(0.98)}
          focusVisibleStyle={focusRingStyle()}
          style={{
            alignSelf: "flex-start",
            minHeight: compactLayout() ? layout.touchTarget : controlHeight.sm,
            paddingHorizontal: space.sm,
            marginLeft: -space.sm,
            borderRadius: radii.md,
            borderCurve: "continuous",
            flexDirection: "row",
            alignItems: "center",
            gap: space.xs,
            cursor: "pointer",
            userSelect: "none",
            ...pressTransition(MOTION_DURATION.fast),
          }}
        >
          <Icon name={detailsOpen() ? "chevron-down" : "chevron-right"} size={14} color={palette().textMuted} />
          <Text style={textStyle("label", { color: palette().textSecondary })}>
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

function deviceKindWord(kind: string): string {
  if (kind === "cli") return tr("settings.devicesPage.kindServer");
  if (kind === "container") return tr("settings.devicesPage.kindContainer");
  return tr("settings.devicesPage.kindComputer");
}

/** "Computer · OpenBitFun 2.0.1": what the device is, as quiet secondary text. */
function deviceDetail(device: FleetDevice): string {
  const parts = [deviceKindWord(device.hostKind)];
  if (device.version) parts.push(tr("settings.devicesPage.version", { version: device.version }));
  return parts.join(" · ");
}

/** The device's reachability as the backend reports it; an unknown state draws nothing. */
function DeviceStateText(props: { device: FleetDevice }) {
  const exception = () => deviceException(props.device.state);
  return (
    <If
      when={exception()}
      else={
        <If when={props.device.state === "online"}>
          <Text style={textStyle("caption", { color: palette().textSecondary })}>
            {tr("settings.devicesPage.online")}
          </Text>
        </If>
      }
    >
      {kind => (
        <Text
          style={textStyle("caption", {
            color: kind() === "update_required" ? stateColor("needs_you") : stateColor("idle"),
          })}
        >
          {kind() === "update_required" ? tr("state.updateNeeded") : tr("state.offline")}
        </Text>
      )}
    </If>
  );
}

/**
 * Whether the account's other devices (and the chat apps this device serves)
 * may reach this device (`remote_connect_set_allowed`). A host that does not
 * report it says so instead of drawing a switch that would do nothing.
 */
function AllowControlRow() {
  ensureConnectors();
  return (
    <InsetRow
      first
      icon="shield"
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
            onChange={next => void runPageAction("device", () => setRemoteControlAllowed(next))}
          />
        ) : undefined
      }
    />
  );
}

function AccountDevicesSection() {
  const visibleDevices = () =>
    superAgentUi()
      ? fleetDevices()
      : fleetDevices().filter(device => device.hostKind.toLowerCase() !== "cloud");

  return (
    <StudioSection title={tr("settings.devicesPage.devices")} accessibilityLabel="account-devices-section">
      <View style={{ gap: space.md, minWidth: 0 }}>
        <If
          when={visibleDevices().length > 0}
          else={<Text style={textStyle("caption", { color: palette().textMuted })}>{tr("settings.devicesPage.none")}</Text>}
        >
          {/* Informative rows: a device is used from the sidebar, not from here. */}
          <InsetGroup accessibilityLabel="account-devices-list">
            <Each of={visibleDevices()} key={device => device.deviceId}>
              {(device, index) => (
                <InsetRow
                  first={index() === 0}
                  leading={<DeviceGlyph kind={device().hostKind} size={16} />}
                  label={device().name}
                  detail={deviceDetail(device())}
                  trailing={
                    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                      <If when={device().isClientDevice}>
                        <Badge label={tr("devices.thisDevice")} size="xs" />
                      </If>
                      <DeviceStateText device={device()} />
                    </View>
                  }
                  accessibilityLabel={`account-device-${device().deviceId}`}
                />
              )}
            </Each>
          </InsetGroup>
        </If>
        <PageError owner="device" />
        <InsetGroup accessibilityLabel="account-this-device-group">
          <AllowControlRow />
          <InsetRow
            icon="smartphone"
            label={tr("settings.devicesPage.phone")}
            chevron
            accessibilityLabel="account-open-on-phone"
            onPress={() => phoneSheetOpen.set(true)}
          />
        </InsetGroup>
      </View>
      <ModalDialog
        open={phoneSheetOpen()}
        title={tr("settings.devicesPage.phone")}
        size="sm"
        accessibilityLabel="account-phone-sheet"
        onClose={() => phoneSheetOpen.set(false)}
      >
        <UseOnPhonePanel />
      </ModalDialog>
    </StudioSection>
  );
}

/** The page body Settings draws for Account › Devices and chat apps. */
export function AccountDevicesPage() {
  void loadObpStatus();
  return (
    <View style={{ gap: layout.sectionGap }}>
      <AccountDevicesSection />
      <If when={obpStatus()?.available === true && (obpStatus()?.pairedClients?.length ?? 0) > 0}>
        <ObpPairingCard autoload={false} />
      </If>
      <ChannelsSection />
      <RemoteDisclaimerModal />
    </View>
  );
}
