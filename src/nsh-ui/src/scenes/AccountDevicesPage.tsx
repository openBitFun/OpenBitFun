// Settings › Account › Devices and chat apps (visual spec §4.9, ux-redesign §3.8).
//
// The account's devices as quiet rows (a device opens its page), one "Open on
// your phone" row whose address and QR open in a sheet, and the chat apps
// (Telegram, Feishu, WeChat) this device's connector serves. Everything is the
// backend's answer: the fleet navigator for devices, the connector store for
// chat apps.

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
import { localizeHostError, tr, type MessageKey } from "../i18n";
import { loadObpStatus, obpStatus } from "../obpStore";
import { superAgentUi } from "../productGates";
import * as navigation from "../state";
import { compactLayout, controlHeight, fontMono, layout, palette, radii, space, textStyle, touchSlop } from "../theme";
import { DeviceGlyph, deviceException, stateColor } from "../ui/fleet";
import { ObpPairingCard } from "./ObpPairingCard";
import { UseOnPhonePanel } from "./UseOnPhonePanel";
import { Icon, type IconName } from "../ui/icons";
import { MOTION_DURATION, pressTransition, tactileActiveStyle } from "../ui/motion";
import { InsetGroup, InsetRow, MoreMenu, QrCodeView, StudioEmpty, StudioSection } from "../ui/studio";
import { ModalDialog, type DropdownMenuItem } from "../ui/overlays";
import { Button, InlineBanner, InputBox, ToggleSwitch, focusRingStyle } from "../ui/primitives";

type ChannelId = "telegram" | "feishu" | "weixin";

const activeChannelModal = signal<ChannelId | null>(null);
const connectorBannerOwner = signal<ChannelId | "page">("page");
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

function isChannelActive(keyword: string): boolean {
  const connected = (connectorStatus()?.botConnected ?? "").toLowerCase();
  if (!connected) return false;
  return connected.includes(keyword);
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

function ChannelRow(props: {
  icon: IconName;
  label: string;
  description: string;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  return (
    <InsetRow
      icon={props.icon}
      label={props.label}
      detail={props.description}
      chevron
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

function ChannelsSection() {
  ensureConnectors();

  return (
    <StudioSection
      title={tr("devices.chatAppsTitle")}
      accessibilityLabel="channels-section"
      footnote={connectorsSupported() === true ? tr("devices.channelsSubtitle") : undefined}
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
          <If when={activeChannelModal() === null && connectorBannerOwner() === "page" && connectorNotice() ? connectorNotice() : ""}>
            {notice => <InlineBanner tone="success" message={localizeHostError(notice())} onDismiss={() => connectorNotice.set("")} />}
          </If>
          <If when={activeChannelModal() === null && connectorBannerOwner() === "page" && connectorError() ? connectorError() : ""}>
            {err => <InlineBanner tone="danger" message={localizeHostError(err())} onDismiss={() => connectorError.set("")} />}
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
                    onChange={next => {
                      connectorBannerOwner.set("page");
                      void setRemoteControlAllowed(next);
                    }}
                  />
                ) : undefined
              }
            />
            <InsetRow
              icon="message-circle"
              label={
                connectorStatus()?.botConnected
                  ? tr("devices.chatAppActive", { name: connectorStatus()!.botConnected! })
                  : tr("devices.noBotConnected")
              }
              trailing={
                connectorStatus()?.botConnected ? (
                  <Button
                    label={tr("devices.chatAppDisconnect")}
                    variant="ghost"
                    size="sm"
                    accessibilityLabel="connector-bot-stop"
                    disabled={connectorBusy()}
                    onPress={() => {
                      connectorBannerOwner.set("page");
                      void stopBotConnector();
                    }}
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
                  onChange={next => {
                    connectorBannerOwner.set("page");
                    void setBotVerboseConnectorMode(next);
                  }}
                />
              }
            />
            <ChannelRow
              icon="message-circle"
              label={tr("devices.telegram")}
              description={
                isChannelActive("telegram")
                  ? tr("devices.channelConnected", { bot: connectorStatus()?.botConnected ?? "" })
                  : tr("devices.telegramDesc")
              }
              accessibilityLabel="channel-toggle-telegram"
              onPress={() => openChannelModal("telegram")}
            />
            <ChannelRow
              icon="globe"
              label={tr("devices.feishu")}
              description={
                isChannelActive("feishu") || isChannelActive("lark")
                  ? tr("devices.channelConnected", { bot: connectorStatus()?.botConnected ?? "" })
                  : tr("devices.feishuDesc")
              }
              accessibilityLabel="channel-toggle-feishu"
              onPress={() => openChannelModal("feishu")}
            />
            <ChannelRow
              icon="smartphone"
              label={tr("devices.wechat")}
              description={
                isChannelActive("weixin") || isChannelActive("wechat")
                  ? tr("devices.channelConnected", { bot: connectorStatus()?.botConnected ?? "" })
                  : tr("devices.wechatDesc")
              }
              accessibilityLabel="channel-toggle-weixin"
              onPress={() => openChannelModal("weixin")}
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
                          fontFamily: fontMono,
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
          <InsetGroup accessibilityLabel="account-devices-list">
            <Each of={visibleDevices()} key={device => device.deviceId}>
              {(device, index) => {
                const exception = () => deviceException(device().state);
                return (
                  <InsetRow
                    first={index() === 0}
                    leading={<DeviceGlyph kind={device().hostKind} size={16} />}
                    label={device().name}
                    trailing={
                      exception() ? (
                        <Text
                          style={textStyle("caption", {
                            color: exception() === "update_required" ? stateColor("needs_you") : stateColor("idle"),
                          })}
                        >
                          {exception() === "update_required" ? tr("state.updateNeeded") : tr("state.offline")}
                        </Text>
                      ) : undefined
                    }
                    chevron
                    accessibilityLabel={`account-device-${device().deviceId}`}
                    onPress={() => navigation.openDevicePage(device().deviceId)}
                  />
                );
              }}
            </Each>
          </InsetGroup>
        </If>
        <InsetGroup accessibilityLabel="account-phone-group">
          <InsetRow
            first
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
        size="md"
        accessibilityLabel="account-phone-sheet"
        onClose={() => phoneSheetOpen.set(false)}
        footer={
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", gap: space.sm, flex: 1 }}>
            <Button
              label={tr("common.close")}
              variant="secondary"
              size="md"
              accessibilityLabel="account-phone-sheet-close"
              onPress={() => phoneSheetOpen.set(false)}
            />
          </View>
        }
      >
        <UseOnPhonePanel embedded={true} />
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
